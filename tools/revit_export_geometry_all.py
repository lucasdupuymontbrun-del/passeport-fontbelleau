# Export de la géométrie 3D de toute la maquette, élément par élément, pour la visionneuse des passeports.
# À exécuter dans Revit (pont Python Horizun, pyRevit ou RevitPythonShell) avec MQT-FONTBELLEAU-G4 ouverte.
# Lecture seule : la maquette n'est pas modifiée.
# Sortie : Documents\Passeport_Fontbelleau\export3d\manifest.json, geometry.bin et geometry.b64 (transfert)
# Ensuite : python tools/build_passeports.py <ouvrages.json> <dossier export3d>
import json, os, array, zlib, base64
from Autodesk.Revit.DB import (FilteredElementCollector, Options, ViewDetailLevel, Solid, GeometryInstance,
                               Mesh, BuiltInCategory, ElementMulticategoryFilter)
from System.Collections.Generic import List

doc = __revit__.ActiveUIDocument.Document
OUT = os.path.join(os.path.expanduser('~'), 'Documents', 'Passeport_Fontbelleau', 'export3d')
if not os.path.isdir(OUT):
    os.makedirs(OUT)
FT2CM = 30.48
CX, CY = -6652.39, 10957.51   # centre de la tour A2, en cm (coordonnées internes)
LIM = 32000                   # limite Int16 en cm

bic = BuiltInCategory
cats = [bic.OST_Walls, bic.OST_Floors, bic.OST_StructuralFraming, bic.OST_StructuralColumns, bic.OST_Stairs,
        bic.OST_StairsRailing, bic.OST_Railings, bic.OST_Windows, bic.OST_Doors, bic.OST_CurtainWallPanels,
        bic.OST_CurtainWallMullions, bic.OST_StructuralFoundation, bic.OST_GenericModel, bic.OST_Toposolid,
        bic.OST_Roofs, bic.OST_MechanicalEquipment, bic.OST_DuctCurves]
lst = List[BuiltInCategory]()
for c in cats:
    lst.Add(c)
opt = Options(); opt.DetailLevel = ViewDetailLevel.Coarse; opt.ComputeReferences = False
wt = doc.GetWorksetTable()
A1WS = set(['RDC'] + ['R+%d' % i for i in range(1, 10)])
KIND = {'Murs': 'walls', 'Sols': 'floors', 'Toits': 'floors', 'Ossature': 'frame', 'Poteaux porteurs': 'frame',
        'Escalier': 'stairs', 'Garde-corps': 'rail', 'Fenêtres': 'openings', 'Portes': 'openings',
        'Panneaux de murs-rideaux': 'openings', 'Meneaux de murs-rideaux': 'openings',
        'Modèles génériques': 'generic', 'Fondations': 'found',
        'Equipement de génie climatique': 'generic', 'Gaines': 'vmc'}
NOMETA = ('topo', 'a2_vmc')   # colonnes de VMC : visibles en 3D, sans passeport (une colonne = plusieurs tronçons)


def group_of(ws, cat):
    k = KIND.get(cat)
    if ws.startswith('A2 - '):
        return 'a2_' + k if k else None
    if ws in A1WS:
        return 'a1_' + k if k else None
    if ws == '04-Parking':
        return 'parking'
    if ws == '03-Fondations':
        return 'found'
    if ws == 'EXT - Terrain fini':
        return 'topo'
    if ws.startswith('EXT'):
        return 'ext'
    if ws.startswith('LT A1.31'):
        return 'lt'
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


groups, meta, skipped = {}, {}, []
for e in FilteredElementCollector(doc).WherePasses(ElementMulticategoryFilter(lst)).WhereElementIsNotElementType():
    try:
        ws = wt.GetWorkset(e.WorksetId).Name
    except Exception:
        ws = ''
    cat = e.Category.Name if e.Category else ''
    if e.Category is not None and e.Category.BuiltInCategory in (bic.OST_MechanicalEquipment, bic.OST_DuctCurves):
        if not ws.startswith('A2 - Lot 502'):
            continue
        if e.Category.BuiltInCategory == bic.OST_MechanicalEquipment:
            t = doc.GetElement(e.GetTypeId())
            if t is None or not t.FamilyName.startswith('VAR A2 - Extracteur'):
                continue
        else:
            cat = 'Gaines'
    eid = int(e.Id.Value) if hasattr(e.Id, 'Value') else int(e.Id.IntegerValue)
    g = group_of(ws, cat)
    if g is None:
        continue
    tmp = []
    try:
        n = emit(e.get_Geometry(opt), tmp)
    except Exception:
        skipped.append([eid, 'geometry_error'])
        continue
    if n == 0:
        skipped.append([eid, 'no_geometry'])
        continue
    if max(abs(v) for v in tmp) > LIM:
        skipped.append([eid, 'out_of_range'])
        continue
    buf = groups.setdefault(g, array.array('h'))
    start = len(buf) // 9
    buf.extend(tmp)
    if g not in NOMETA:
        meta.setdefault(g, []).append([eid, start, n])

manifest = {'version': 2, 'units': 'cm', 'origin_internal_cm': [CX, CY, 0], 'z0_ngf_m': 37.89, 'groups': [],
            'skipped': skipped}
blobs, offset = [], 0
for name in sorted(groups):
    b = groups[name].tobytes()
    manifest['groups'].append({'name': name, 'byteOffset': offset, 'byteLength': len(b),
                               'triangles': len(groups[name]) // 9, 'elements': meta.get(name, [])})
    offset += len(b)
    blobs.append(b)
raw = b''.join(blobs)
mj = json.dumps(manifest, ensure_ascii=False).encode('utf-8')
with open(os.path.join(OUT, 'manifest.json'), 'wb') as fh:
    fh.write(mj)
with open(os.path.join(OUT, 'geometry.bin'), 'wb') as fh:
    fh.write(raw)
b64 = base64.b64encode(zlib.compress(raw, 9)).decode('ascii')
with open(os.path.join(OUT, 'geometry.b64'), 'w') as fh:
    fh.write(b64)
__output__ = {'status': 'completed_unverified', 'out': OUT, 'bin_bytes': len(raw), 'b64_chars': len(b64),
              'manifest_bytes': len(mj), 'skipped': len(skipped),
              'groups': dict((g['name'], [g['triangles'], len(g['elements'])]) for g in manifest['groups'])}
