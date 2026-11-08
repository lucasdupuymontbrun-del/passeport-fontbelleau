# Export des données de tous les ouvrages de la maquette, pour les passeports numériques.
# À exécuter dans Revit (pont Python Horizun, pyRevit ou RevitPythonShell) avec MQT-FONTBELLEAU-G4 ouverte.
# Lecture seule : la maquette n'est pas modifiée.
# Sortie : Documents\Passeport_Fontbelleau\export\ouvrages.json (+ ouvrages.b64, version compressée pour transfert)
# Argument facultatif (HORIZUN_ARGS_JSON) : {"chunk": n} renvoie le n-ième morceau du fichier compressé déjà produit.
import json, os, zlib, base64
from Autodesk.Revit.DB import (FilteredElementCollector, BuiltInCategory, BuiltInParameter, ElementMulticategoryFilter,
                               ElementId, StorageType, FamilyInstance, Wall, LocationCurve, LocationPoint)
from System.Collections.Generic import List

OUT = os.path.join(os.path.expanduser('~'), 'Documents', 'Passeport_Fontbelleau', 'export')
CHUNK = 180000
try:
    ARGS = json.loads(HORIZUN_ARGS_JSON)
except Exception:
    ARGS = {}

if 'chunk' in ARGS:
    with open(os.path.join(OUT, 'ouvrages.b64')) as fh:
        s = fh.read()
    i = int(ARGS['chunk'])
    __output__ = {'chunk': i, 'of': (len(s) + CHUNK - 1) // CHUNK, 'data': s[i * CHUNK:(i + 1) * CHUNK]}
else:
    doc = __revit__.ActiveUIDocument.Document
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    FT, FT2, FT3 = 0.3048, 0.09290304, 0.028316846592
    CX, CY = -6652.39, 10957.51   # centre de la tour A2 en cm (même repère que la vue 3D)
    bic = BuiltInCategory
    cats = [bic.OST_Walls, bic.OST_Floors, bic.OST_StructuralColumns, bic.OST_StructuralFraming,
            bic.OST_StructuralFoundation, bic.OST_Stairs, bic.OST_Roofs, bic.OST_Doors, bic.OST_Windows,
            bic.OST_GenericModel, bic.OST_CurtainWallPanels, bic.OST_StairsRailing, bic.OST_Railings,
            bic.OST_MechanicalEquipment]
    # Équipements de génie climatique : seuls les extracteurs de la VMC hybride (variante A2, en toiture) ont un passeport.
    MECH_FAMILLES = ('VAR A2 - Extracteur',)
    lst = List[BuiltInCategory]()
    for c in cats:
        lst.Add(c)
    wt = doc.GetWorksetTable()

    def iid(x):
        return int(x.Value) if hasattr(x, 'Value') else int(x.IntegerValue)

    def pstr(el, bip):
        if bip is None:
            return None
        try:
            p = el.get_Parameter(bip)
            if p is None or not p.HasValue:
                return None
            if p.StorageType == StorageType.String:
                return p.AsString() or None
            if p.StorageType == StorageType.ElementId:
                e2 = doc.GetElement(p.AsElementId())
                return e2.Name if e2 is not None else None
            return p.AsValueString()
        except Exception:
            return None

    def pdbl(el, bip, k):
        try:
            p = el.get_Parameter(bip)
            if p is None or not p.HasValue or p.StorageType != StorageType.Double:
                return None
            v = p.AsDouble() * k
            return round(v, 4) if v else None
        except Exception:
            return None

    def pint(el, bip):
        if bip is None:
            return None
        try:
            p = el.get_Parameter(bip)
            if p is None or not p.HasValue:
                return None
            return p.AsInteger()
        except Exception:
            return None

    def byname(el, name):
        try:
            p = el.LookupParameter(name)
            if p is None or not p.HasValue:
                return None
            if p.StorageType == StorageType.String:
                return p.AsString() or None
            return p.AsValueString()
        except Exception:
            return None

    def bp(name):
        return getattr(BuiltInParameter, name, None)

    LEVEL_BIPS = [bp(n) for n in ('WALL_BASE_CONSTRAINT', 'FAMILY_LEVEL_PARAM', 'SCHEDULE_LEVEL_PARAM',
                                  'STAIRS_BASE_LEVEL_PARAM', 'LEVEL_PARAM', 'INSTANCE_REFERENCE_LEVEL_PARAM',
                                  'FAMILY_BASE_LEVEL_PARAM', 'ROOF_BASE_LEVEL_PARAM') if bp(n) is not None]
    COVER = [(n, bp(n)) for n in ('CLEAR_COVER_EXTERIOR', 'CLEAR_COVER_INTERIOR', 'CLEAR_COVER_TOP',
                                  'CLEAR_COVER_BOTTOM', 'CLEAR_COVER_OTHER') if bp(n) is not None]
    levels = {}
    out = []
    for e in FilteredElementCollector(doc).WherePasses(ElementMulticategoryFilter(lst)).WhereElementIsNotElementType():
        if e.Category is None:
            continue
        t = doc.GetElement(e.GetTypeId())
        r = {'id': iid(e.Id), 'uid': e.UniqueId, 'cat': e.Category.Name}
        try:
            r['ws'] = wt.GetWorkset(e.WorksetId).Name
        except Exception:
            r['ws'] = None
        r['ident'] = byname(e, 'Identifiant')
        r['ifc'] = pstr(e, bp('IFC_GUID')) or byname(e, 'IfcGUID')
        r['type'] = t.Name if t is not None else None
        try:
            r['fam'] = t.FamilyName if t is not None else None
        except Exception:
            r['fam'] = None
        if e.Category.BuiltInCategory == bic.OST_MechanicalEquipment:
            if not (r.get('fam') or '').startswith(MECH_FAMILLES):
                continue
            r['vmc'] = {'colonne': byname(e, 'Colonne VMC'), 'debit': byname(e, 'Débit DCE (m³/h)')}
        r['comm'] = pstr(e, bp('ALL_MODEL_INSTANCE_COMMENTS'))
        r['mark'] = pstr(e, bp('ALL_MODEL_MARK'))
        if t is not None:
            r['tcomm'] = pstr(t, bp('ALL_MODEL_TYPE_COMMENTS'))
            r['tdesc'] = pstr(t, bp('ALL_MODEL_DESCRIPTION'))
            r['tmanuf'] = pstr(t, bp('ALL_MODEL_MANUFACTURER'))
            r['tmodel'] = pstr(t, bp('ALL_MODEL_MODEL'))
            r['keynote'] = pstr(t, bp('KEYNOTE_PARAM'))
            r['assembly'] = pstr(t, bp('UNIFORMAT_CODE'))
        lvl = None
        try:
            if e.LevelId is not None and iid(e.LevelId) > 0:
                lvl = doc.GetElement(e.LevelId)
        except Exception:
            lvl = None
        if lvl is None:
            for b in LEVEL_BIPS:
                try:
                    p = e.get_Parameter(b)
                    if p is not None and p.HasValue and p.StorageType == StorageType.ElementId and iid(p.AsElementId()) > 0:
                        lvl = doc.GetElement(p.AsElementId())
                        break
                except Exception:
                    pass
        if lvl is not None:
            r['lv'] = lvl.Name
            levels[lvl.Name] = round(lvl.Elevation * FT, 3)
        try:
            ph = doc.GetElement(e.CreatedPhaseId)
            r['phase'] = ph.Name if ph is not None else None
        except Exception:
            pass
        try:
            if iid(e.GroupId) > 0:
                r['group'] = doc.GetElement(e.GroupId).Name
        except Exception:
            pass
        try:
            if e.DesignOption is not None:
                r['option'] = e.DesignOption.Name
                r['option_primary'] = bool(e.DesignOption.IsPrimary)
        except Exception:
            pass
        bb = e.get_BoundingBox(None)
        if bb is not None:
            r['bb'] = [int(round(bb.Min.X * 30.48 - CX)), int(round(bb.Min.Y * 30.48 - CY)), int(round(bb.Min.Z * 30.48)),
                       int(round(bb.Max.X * 30.48 - CX)), int(round(bb.Max.Y * 30.48 - CY)), int(round(bb.Max.Z * 30.48))]
        d = {}
        for key, b, k in (('longueur', 'CURVE_ELEM_LENGTH', FT), ('longueur_inst', 'INSTANCE_LENGTH_PARAM', FT),
                          ('longueur_coupe', 'STRUCTURAL_FRAME_CUT_LENGTH', FT), ('hauteur', 'WALL_USER_HEIGHT_PARAM', FT),
                          ('surface', 'HOST_AREA_COMPUTED', FT2), ('volume', 'HOST_VOLUME_COMPUTED', FT3),
                          ('perimetre', 'HOST_PERIMETER_COMPUTED', FT), ('epaisseur', 'FLOOR_ATTR_THICKNESS_PARAM', FT),
                          ('largeur', 'FAMILY_WIDTH_PARAM', FT), ('hauteur_fam', 'FAMILY_HEIGHT_PARAM', FT),
                          ('largeur_brute', 'FAMILY_ROUGH_WIDTH_PARAM', FT), ('hauteur_brute', 'FAMILY_ROUGH_HEIGHT_PARAM', FT),
                          ('allege', 'INSTANCE_SILL_HEIGHT_PARAM', FT), ('hauteur_marche', 'STAIRS_ACTUAL_RISER_HEIGHT', FT),
                          ('giron', 'STAIRS_ACTUAL_TREAD_DEPTH', FT), ('hauteur_esc', 'STAIRS_STAIRS_HEIGHT', FT),
                          ('epaisseur_toit', 'ROOF_ATTR_THICKNESS_PARAM', FT), ('decalage_base', 'WALL_BASE_OFFSET', FT)):
            b2 = bp(b)
            if b2 is None:
                continue
            v = pdbl(e, b2, k)
            if v is None and t is not None and key in ('largeur', 'hauteur_fam', 'largeur_brute', 'hauteur_brute', 'epaisseur'):
                v = pdbl(t, b2, k)
            if v is not None:
                d[key] = v
        if isinstance(e, Wall):
            try:
                d['epaisseur'] = round(e.Width * FT, 4)
            except Exception:
                pass
            r['structurel'] = pint(e, bp('WALL_STRUCTURAL_SIGNIFICANT'))
        nr = pint(e, bp('STAIRS_ACTUAL_NUM_RISERS')) if bp('STAIRS_ACTUAL_NUM_RISERS') else None
        if nr:
            d['nb_marches'] = nr
        r['dim'] = d
        mats = []
        sm = pstr(e, bp('STRUCTURAL_MATERIAL_PARAM'))
        if sm is None and t is not None:
            sm = pstr(t, bp('STRUCTURAL_MATERIAL_PARAM'))
        if sm:
            r['mat_struct'] = sm
        try:
            for mid in e.GetMaterialIds(False):
                m = doc.GetElement(mid)
                vol = 0.0
                try:
                    vol = e.GetMaterialVolume(mid) * FT3
                except Exception:
                    pass
                mats.append([m.Name if m is not None else None, round(vol, 3)])
        except Exception:
            pass
        if mats:
            r['mats'] = sorted(mats, key=lambda x: -x[1])[:5]
        cov = {}
        for n, b in COVER:
            v = pstr(e, b)
            if v:
                cov[n] = v
        if cov:
            r['enrobage'] = cov
        if isinstance(e, FamilyInstance):
            try:
                if e.Host is not None:
                    r['host'] = iid(e.Host.Id)
            except Exception:
                pass
            try:
                if e.SuperComponent is not None:
                    r['super'] = iid(e.SuperComponent.Id)
            except Exception:
                pass
        loc = e.Location
        try:
            if isinstance(loc, LocationCurve):
                c = loc.Curve
                p0, p1 = c.GetEndPoint(0), c.GetEndPoint(1)
                r['axe'] = [int(round(p0.X * 30.48 - CX)), int(round(p0.Y * 30.48 - CY)),
                            int(round(p1.X * 30.48 - CX)), int(round(p1.Y * 30.48 - CY))]
            elif isinstance(loc, LocationPoint):
                p0 = loc.Point
                r['pt'] = [int(round(p0.X * 30.48 - CX)), int(round(p0.Y * 30.48 - CY)), int(round(p0.Z * 30.48))]
        except Exception:
            pass
        for k in list(r.keys()):
            if r[k] is None or r[k] == {}:
                del r[k]
        out.append(r)
    data = {'version': 1, 'document': doc.Title, 'origin_internal_cm': [CX, CY, 0], 'z0_ngf_m': 37.89,
            'levels': levels, 'elements': out}
    raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
    with open(os.path.join(OUT, 'ouvrages.json'), 'wb') as fh:
        fh.write(raw)
    b64 = base64.b64encode(zlib.compress(raw, 9)).decode('ascii')
    with open(os.path.join(OUT, 'ouvrages.b64'), 'w') as fh:
        fh.write(b64)
    __output__ = {'status': 'completed_unverified', 'elements': len(out), 'json_bytes': len(raw),
                  'chunks': (len(b64) + CHUNK - 1) // CHUNK, 'out': OUT}
