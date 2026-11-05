# Export de la géométrie 3D de la maquette Revit pour la visionneuse du passeport.
# À exécuter dans Revit (pont Python Horizun, pyRevit ou RevitPythonShell) avec MQT-FONTBELLEAU-G4 ouverte.
# Lecture seule : la maquette n'est pas modifiée.
# Sortie : Documents\Passeport_A2_PM106\export3d\manifest.json et geometry.bin
# Ensuite, sur un poste avec Python : python tools/build_model.py puis gzip -9 -k model/a2.bin
import json, os, array
from Autodesk.Revit.DB import (FilteredElementCollector, Options, ViewDetailLevel, Solid, GeometryInstance,
                               Mesh, BuiltInCategory, ElementMulticategoryFilter)
from System.Collections.Generic import List

doc = __revit__.ActiveUIDocument.Document
OUT = os.path.join(os.path.expanduser('~'), 'Documents', 'Passeport_A2_PM106', 'export3d')
if not os.path.isdir(OUT):
    os.makedirs(OUT)
FT2CM = 30.48
CX, CY = -6652.39, 10957.51   # centre de la tour A2, en cm (coordonnées internes)
TARGET = 439362               # ElementId de A2 PM 106
LIM = 32000                   # limite Int16 en cm

bic = BuiltInCategory
cats = [bic.OST_Walls, bic.OST_Floors, bic.OST_StructuralFraming, bic.OST_StructuralColumns, bic.OST_Stairs,
        bic.OST_StairsRailing, bic.OST_Windows, bic.OST_Doors, bic.OST_CurtainWallPanels, bic.OST_CurtainWallMullions,
        bic.OST_StructuralFoundation, bic.OST_GenericModel, bic.OST_Toposolid, bic.OST_Roofs]
lst = List[BuiltInCategory]()
for c in cats:
    lst.Add(c)
opt = Options(); opt.DetailLevel = ViewDetailLevel.Coarse; opt.ComputeReferences = False
wt = doc.GetWorksetTable()
A1WS = set(['RDC'] + ['R+%d' % i for i in range(1, 10)])


def group_of(ws, cat):
    if ws.startswith('A2 - R'):
        return {'Murs': 'a2_walls', 'Sols': 'a2_floors', 'Ossature': 'a2_frame', 'Poteaux porteurs': 'a2_frame',
                'Escalier': 'a2_stairs', 'Garde-corps': 'a2_rail', 'Fenêtres': 'a2_openings', 'Portes': 'a2_openings',
                'Panneaux de murs-rideaux': 'a2_openings', 'Meneaux de murs-rideaux': 'a2_openings',
                'Modèles génériques': 'a2_generic'}.get(cat)
    if ws in A1WS and cat in ('Murs', 'Sols', 'Ossature', 'Poteaux porteurs', 'Escalier'):
        return 'a1'
    if ws == '04-Parking' and cat in ('Murs', 'Sols', 'Ossature', 'Poteaux porteurs', 'Escalier'):
        return 'parking'
    if ws == '03-Fondations':
        return 'found'
    if ws == 'EXT - Terrain fini':
        return 'topo'
    return None


def emit(geo, buf, depth=0):
    n = 0
    if geo is None:
        return 0
    for g in geo:
        meshes = []
        if isinstance(g, Solid) and g.Faces.Size:
            for f in g.Faces:
                try:
                    meshes.append(f.Triangulate(0.2))
                except Exception:
                    pass
        elif isinstance(g, GeometryInstance) and depth < 3:
            n += emit(g.GetInstanceGeometry(), buf, depth + 1)
        elif isinstance(g, Mesh):
            meshes.append(g)
        for m in meshes:
            for i in range(m.NumTriangles):
                t = m.get_Triangle(i)
                for j in (0, 1, 2):
                    p = t.get_Vertex(j)
                    buf.append(int(round(p.X * FT2CM - CX)))
                    buf.append(int(round(p.Y * FT2CM - CY)))
                    buf.append(int(round(p.Z * FT2CM)))
                n += 1
    return n


groups, meta = {}, {}
for e in FilteredElementCollector(doc).WherePasses(ElementMulticategoryFilter(lst)).WhereElementIsNotElementType():
    try:
        ws = wt.GetWorkset(e.WorksetId).Name
    except Exception:
        ws = ''
    cat = e.Category.Name if e.Category else ''
    eid = int(e.Id.Value) if hasattr(e.Id, 'Value') else int(e.Id.IntegerValue)
    g = 'target' if eid == TARGET else group_of(ws, cat)
    if g is None:
        continue
    tmp = []
    try:
        n = emit(e.get_Geometry(opt), tmp)
    except Exception:
        continue
    if n == 0 or max(abs(v) for v in tmp) > LIM:
        continue
    buf = groups.setdefault(g, array.array('h'))
    start = len(buf) // 9
    buf.extend(tmp)
    zs = tmp[2::3]
    entry = {'id': eid, 's': start, 'n': n, 'z0': min(zs), 'z1': max(zs)}
    if g.startswith('a2_') or g == 'target':
        p = e.LookupParameter('Identifiant')
        entry.update({'ident': p.AsString() if p else None, 'type': str(doc.GetElement(e.GetTypeId()).Name),
                      'cat': str(cat), 'ws': str(ws)})
    meta.setdefault(g, []).append(entry)

manifest = {'version': 1, 'units': 'cm', 'origin_internal_cm': [CX, CY, 0], 'z0_ngf_m': 37.89, 'groups': []}
blobs, offset = [], 0
for name in sorted(groups):
    b = groups[name].tobytes()
    manifest['groups'].append({'name': name, 'byteOffset': offset, 'byteLength': len(b),
                               'triangles': len(groups[name]) // 9, 'elements': meta.get(name, [])})
    offset += len(b)
    blobs.append(b)
with open(os.path.join(OUT, 'manifest.json'), 'wb') as fh:
    fh.write(json.dumps(manifest, ensure_ascii=False).encode('utf-8'))
with open(os.path.join(OUT, 'geometry.bin'), 'wb') as fh:
    fh.write(b''.join(blobs))
__output__ = {'status': 'completed_unverified', 'out': OUT,
              'groups': dict((g['name'], g['triangles']) for g in manifest['groups'])}
