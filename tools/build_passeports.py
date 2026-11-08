# Génère les passeports de tous les ouvrages à partir des exports Revit.
#   python tools/build_passeports.py <ouvrages.json> <dossier export3d>
# Entrées : export de tools/revit_export_ouvrages.py et de tools/revit_export_geometry_all.py.
# Sorties (racine du site) :
#   data/commun.json          définitions partagées (fiabilités, statuts, zones, documents, modèles de familles)
#   data/o/<REF>.json         une fiche par ouvrage
#   data/index.json           registre (recherche, filtres)
#   model/site.json + site.bin(.gz)   maquette 3D de tout le projet, élément par élément
#   plans/<CLE>.svg           un plan par zone et par étage
#   docs/AUDIT_OUVRAGES.md   anomalies relevées (doublons, éléments sans identifiant, sans géométrie)
# Règle : aucune donnée n'est inventée sans être marquée « fictif ». Les valeurs tirées de la maquette sont « modele ».
import json, os, re, sys, math, gzip, hashlib, datetime as dt
from collections import Counter, defaultdict
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/work/export/ouvrages.json'
G3D = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/work/export3d'
TODAY = dt.date(2026, 11, 8)
Z0 = 37.89
SITE = 'https://lucasdupuymontbrun-del.github.io/passeport-fontbelleau/'
SPECIAL = {439362: 'A2-PM106'}     # passeport détaillé existant (adresse déjà imprimée)

D = json.load(open(SRC, encoding='utf-8'))
E = D['elements']
LEVELS = D['levels']

# ------------------------------------------------------------------ zones et étages
A1WS = ['RDC'] + ['R+%d' % i for i in range(1, 10)]
STOREYS = ['RDC'] + ['R+%d' % i for i in range(1, 10)] + ['Toiture']
FLOOR_A2 = {'RDC': 37.89, 'R+1': 43.47, 'R+2': 46.26, 'R+3': 49.05, 'R+4': 51.84, 'R+5': 54.63, 'R+6': 57.42,
            'R+7': 60.21, 'R+8': 63.00, 'R+9': 65.79, 'Toiture': 68.56}
ZONES = {
    'A1': {'label': 'Tour A1', 'batiment': 'Bâtiment 1 — COGEDIM', 'fiab': 'verifie',
           'sources': ['Maquette — sous-projets RDC à R+9', 'DCE — DWG « BAT 1 - COGEDIM »']},
    'A2': {'label': 'Tour A2', 'batiment': 'Bâtiment 2 — CDC Habitat', 'fiab': 'verifie',
           'sources': ['Maquette — sous-projets « A2 - … »', 'DCE — dossier « BAT 2 - CDC », plans CVC « tour CDC »']},
    'PARK': {'label': 'Parking R-1', 'batiment': 'Sous-sol commun aux deux tours', 'fiab': 'modele',
             'sources': ['Maquette — sous-projet 04-Parking']},
    'FOND': {'label': 'Fondations', 'batiment': 'Fondations des tours et du parking', 'fiab': 'modele',
             'sources': ['Maquette — sous-projet 03-Fondations']},
    'EXT': {'label': 'Aménagements extérieurs', 'batiment': 'Abords et voirie', 'fiab': 'modele',
            'sources': ['Maquette — sous-projet EXT - Aménagements extérieurs']},
    'LT': {'label': 'Logement témoin A1.31', 'batiment': 'Tour A1, étage R+3', 'fiab': 'modele',
           'sources': ['Maquette — sous-projets « LT A1.31 - … »']},
}


def zone_of(ws):
    if ws.startswith('A2 - '):
        return 'A2'
    if ws in A1WS:
        return 'A1'
    if ws == '03-Fondations':
        return 'FOND'
    if ws == '04-Parking':
        return 'PARK'
    if ws.startswith('EXT'):
        return 'EXT'
    if ws.startswith('LT A1.31'):
        return 'LT'
    return None


def storey_from_level(lv):
    el = LEVELS.get(lv)
    if el is None:
        return None
    best = None
    for s in STOREYS:
        if FLOOR_A2[s] <= el + 0.15:
            best = s
    return best


def storey_of(e, z):
    ws = e['ws']
    if z == 'A2':
        s = ws.replace('A2 - ', '')
        return s if s in STOREYS else (storey_from_level(e.get('lv')) or 'RDC')
    if z == 'A1':
        return ws
    if z == 'LT':
        return 'R+3'
    return {'PARK': 'R-1', 'FOND': 'Fondations', 'EXT': 'Extérieurs'}[z]


def plan_key(z, s):
    if z in ('A1', 'A2'):
        return '%s-%s' % (z, s.replace('+', ''))
    if z == 'LT':
        return 'A1-R3'
    return z


def storey_label(z, s):
    if z in ('A1', 'A2', 'LT'):
        return 'Toiture' if s == 'Toiture' else ('Rez-de-chaussée' if s == 'RDC' else 'Étage ' + s)
    return {'PARK': 'Sous-sol R-1', 'FOND': 'Fondations', 'EXT': 'Niveau du terrain'}[z]


# ------------------------------------------------------------------ familles
def code_of(e):
    t = (e.get('ident') or '').split()
    if not t:
        return '-'
    if t[0] in ('A1', 'A2') and len(t) > 1:
        return t[1]
    return t[0]


def kind_of(e, z):
    c, cat = code_of(e), e['cat']
    if z == 'EXT':
        return 'ext'
    if z == 'FOND':
        return 'fondation'
    if cat == 'Murs':
        if c == 'PM':
            return 'premur'
        if c in ('V', 'PV', 'Pt', 'GC'):
            return 'voile'
        if c == 'ME':
            return 'menuiserie_ext'
        if c == 'ITE':
            return 'ite'
        if c in ('PE', 'PL', 'FA', 'TB'):
            return 'finition'
        return 'cloison'
    if cat == 'Poteaux porteurs':
        return 'poteau'
    if cat == 'Ossature':
        return 'poutre'
    if cat == 'Sols':
        if c == 'SO':
            return 'finition'
        if c == 'TV':
            return 'toiture'
        return 'dalle'
    if cat == 'Escalier':
        return 'escalier'
    if cat == 'Fondations':
        return 'fondation'
    if cat in ('Fenêtres', 'Panneaux de murs-rideaux'):
        return 'menuiserie_ext'
    if cat == 'Portes':
        return 'porte_int'
    if cat == 'Garde-corps':
        return 'garde_corps'
    if cat == 'Equipement de génie climatique':
        return 'cvc'
    if cat == 'Modèles génériques':
        if c in ('EV', 'ET'):
            return 'ecaille'
        if c in ('VR', 'SE'):
            return 'fermeture'
        if c in ('ST', 'VMC'):
            return 'cvc'
    return 'autre'


GO_KINDS = ('premur', 'voile', 'poteau', 'poutre', 'dalle', 'escalier', 'fondation')
KIND_LABEL = {'premur': 'Prémur', 'voile': 'Voile béton armé', 'poteau': 'Poteau béton armé', 'poutre': 'Poutre ou linteau béton armé',
              'dalle': 'Dalle béton armé', 'escalier': 'Escalier béton armé', 'fondation': 'Ouvrage de fondation',
              'menuiserie_ext': 'Menuiserie extérieure', 'ecaille': 'Écaille de façade', 'garde_corps': 'Garde-corps ou clôture',
              'porte_int': 'Porte intérieure', 'cloison': 'Cloison, doublage ou gaine', 'finition': 'Revêtement de finition',
              'fermeture': 'Fermeture (volet ou screen)', 'ite': 'Isolation thermique par l\'extérieur', 'cvc': 'Équipement CVC',
              'toiture': 'Complexe de toiture', 'ext': 'Aménagement extérieur', 'autre': 'Ouvrage'}

LOTS = {'301': 'Gros œuvre', '309': 'Isolation, flocage', '402': 'Étanchéité', '416': 'Menuiseries extérieures aluminium',
        '417': 'Menuiseries extérieures PVC', '417C': 'Fermetures (screens)', '422': 'Stores et occultations',
        '502': 'Chauffage, ventilation, plomberie', '602': 'Plâtrerie, cloisons, doublages', '603': 'Menuiseries intérieures',
        '609': 'Carrelage, faïence', '611': 'Sols souples', '616': 'Peinture', '620': 'Métallerie'}
CCTP_DCE = {'0', '301', '309', '402', '416', '417', '422', '502'}


def lot_of(e, k):
    for fld, lab in (('type', 'type'), ('tmanuf', 'fabricant du type'), ('ws', 'sous-projet'), ('comm', 'commentaire'),
                     ('tcomm', 'commentaire du type'), ('tdesc', 'description du type')):
        m = re.search(r'\b[Ll]ot (\d{3}[A-Z]?)\b', e.get(fld) or '')
        if m:
            return m.group(1), 'modele', 'Maquette — %s' % lab
    if k in GO_KINDS:
        return '301', 'verifie', 'CCTP 301 Gros œuvre ind B (le lot comprend les fondations)'
    return None, 'nd', None


# ------------------------------------------------------------------ références
def slug_tokens(tokens):
    if len(tokens) >= 2 and tokens[1][:1].isdigit():
        merged, rest = tokens[0] + tokens[1], tokens[2:]
    else:
        merged, rest = tokens[0], tokens[1:]
    return [merged] + rest


def clean(s):
    s = s.replace('+', '')
    return re.sub(r'[^A-Za-z0-9.\-_]', '', s)


recs = []
skipped = []
for e in E:
    z = zone_of(e['ws'] or '')
    if z is None:
        skipped.append((e, 'sous-projet hors périmètre'))
        continue
    if e['cat'] == 'Panneaux de murs-rideaux' and not e.get('ident'):
        skipped.append((e, 'panneau de mur-rideau sans identifiant (sous-élément du mur-rideau)'))
        continue
    recs.append({'e': e, 'zone': z})

for r in recs:
    e, z = r['e'], r['zone']
    ident = e.get('ident')
    toks = ident.split() if ident else []
    if toks and toks[0] in ('A1', 'A2'):
        prefix, body = toks[0], toks[1:]
    else:
        prefix, body = (z if z in ('A1', 'A2') else None), toks
    if body:
        parts = slug_tokens(body)
        slug = '-'.join([prefix] + parts if prefix else parts)
        disp = ' '.join([prefix] + body if prefix else body)
    else:
        slug = '%s-SANSID-%d' % (prefix or z, e['id'])
        disp = 'Sans identifiant (Revit %d)' % e['id']
    r['slug'] = clean(slug)
    r['disp'] = disp
    r['prefixed'] = bool(prefix and toks and toks[0] not in ('A1', 'A2'))
    r['storey'] = storey_of(e, z)
    r['plan'] = plan_key(z, r['storey'])
    r['kind'] = kind_of(e, z)
    if e['id'] in SPECIAL:
        r['slug'] = SPECIAL[e['id']]

cnt = Counter(r['slug'] for r in recs)
dups = defaultdict(list)
for r in recs:
    if cnt[r['slug']] > 1:
        dups[r['slug']].append(r)
for s, lst in dups.items():
    lst.sort(key=lambda r: r['e']['id'])
    for i, r in enumerate(lst, 1):
        r['slug'] = '%s-%d' % (s, i)
        r['dup'] = (i, len(lst))
assert len(set(r['slug'] for r in recs)) == len(recs), 'références non uniques'
BYID = {r['e']['id']: r for r in recs}
BYSLUG = {r['slug']: r for r in recs}


def url_of(r):
    if r['slug'] in SPECIAL.values():
        return SITE + r['slug'] + '/'
    return SITE + 'o/?r=' + r['slug']


# ------------------------------------------------------------------ géométrie : boîtes, centres, voisinage
BB = np.array([r['e']['bb'] for r in recs], dtype=float) / 100.0  # m, repère A2
for i, r in enumerate(recs):
    r['i'] = i
ZC = {}
for z in ZONES:
    idx = [r['i'] for r in recs if r['zone'] == z]
    b = BB[idx]
    ZC[z] = ((b[:, 0].min() + b[:, 3].max()) / 2, (b[:, 1].min() + b[:, 4].max()) / 2)
ZC['LT'] = ZC['A1']


def gap_xy(i, J):
    a = BB[i]
    dx = np.maximum(0, np.maximum(BB[J, 0] - a[3], a[0] - BB[J, 3]))
    dy = np.maximum(0, np.maximum(BB[J, 1] - a[4], a[1] - BB[J, 4]))
    return np.hypot(dx, dy)


def zover(i, J):
    a = BB[i]
    return np.minimum(BB[J, 5], a[5]) - np.maximum(BB[J, 2], a[2])


ALL = np.arange(len(recs))
PLANIDX = defaultdict(list)
for r in recs:
    PLANIDX[r['plan']].append(r['i'])
PLANIDX = {k: np.array(v) for k, v in PLANIDX.items()}

SECT = ['est', 'nord-est', 'nord', 'nord-ouest', 'ouest', 'sud-ouest', 'sud', 'sud-est']


def orientation(r):
    cx, cy = (BB[r['i'], 0] + BB[r['i'], 3]) / 2, (BB[r['i'], 1] + BB[r['i'], 4]) / 2
    zx, zy = ZC[r['zone']]
    d = math.hypot(cx - zx, cy - zy)
    a = math.degrees(math.atan2(cy - zy, cx - zx)) % 360
    return d, SECT[int(((a + 22.5) % 360) // 45)]


def fmt(v, n=2):
    s = ('%.' + str(n) + 'f') % v
    return s.replace('.', ',')


def ngf(zcm):
    return zcm + Z0


# ------------------------------------------------------------------ désignation et dimensions
PREFIXES = ('STR - ', 'PKG - ', 'FND - ', 'INT - ', 'EXT - ', 'TOIT - ', 'ITE - ', 'MEX ALU - ', 'ESC BA - ', 'GC A1 - ', 'GC A2 - ')


def strip_type(t):
    t = t or ''
    for p in PREFIXES:
        if t.startswith(p):
            return t[len(p):]
    return t


def designation(r):
    e, k = r['e'], r['kind']
    t = strip_type(e.get('type'))
    comm = e.get('comm') or ''
    ep = e.get('dim', {}).get('epaisseur')
    if k == 'premur':
        return 'Prémur — voile béton armé de %s cm' % fmt(ep * 100, 0) if ep else 'Prémur'
    if k == 'voile':
        if comm.startswith('Poutre-voile'):
            return 'Poutre-voile béton armé' + (' de %s cm' % fmt(ep * 100, 0) if ep else '')
        if comm.startswith('Poteau en T'):
            return 'Poteau en T (voile béton armé)'
        if comm.startswith('Garde-corps BA'):
            return 'Garde-corps béton armé'
        return 'Voile béton armé' + (' de %s cm' % fmt(ep * 100, 0) if ep else '')
    if e.get('vmc'):
        v = e['vmc']
        deb = (' (%s m³/h)' % format(int(round(float(v['debit']))), ',').replace(',', ' ')) if v.get('debit') else ''
        return 'Extracteur hybride stato-mécanique %s — colonne %s%s' % (t, v.get('colonne') or '?', deb)
    td = e.get('tdesc')
    if td and len(td) <= 80 and ':' not in td:
        return td[0].upper() + td[1:]
    return t[0].upper() + t[1:] if t else KIND_LABEL[k]


def dims_row(r):
    e, k = r['e'], r['kind']
    d = e.get('dim', {})
    bb = BB[r['i']]
    L = []
    if e['cat'] == 'Murs' and d.get('longueur'):
        L.append('%s × %s × %s m' % (fmt(d['longueur']), fmt(d.get('hauteur') or (bb[5] - bb[2])), fmt(d.get('epaisseur', 0))))
        return L[0], 'Longueur × hauteur × épaisseur.'
    if e['cat'] in ('Fenêtres', 'Portes') and d.get('largeur'):
        return '%s × %s m' % (fmt(d['largeur']), fmt(d.get('hauteur_fam') or (bb[5] - bb[2]))), 'Largeur × hauteur de la famille.' + (
            ' Allège à %s m.' % fmt(d['allege']) if d.get('allege') and d['allege'] > 0 else '')
    if e['cat'] == 'Escalier' and d.get('nb_marches'):
        return '%d marches de %s cm, giron %s cm' % (d['nb_marches'], fmt(d.get('hauteur_marche', 0) * 100, 1), fmt(d.get('giron', 0) * 100, 1)), (
            'Hauteur franchie %s m.' % fmt(d['hauteur_esc']) if d.get('hauteur_esc') else None)
    if e['cat'] == 'Fondations' and code_of(e) == 'PIEUX' and d.get('epaisseur'):
        return 'Longueur %s m' % fmt(d['epaisseur']), 'Section %s m².' % fmt(d['surface'], 3) if d.get('surface') else None
    if e['cat'] in ('Sols', 'Fondations', 'Toits') and d.get('epaisseur'):
        return 'Épaisseur %s cm' % fmt(d['epaisseur'] * 100, 0), 'Emprise %s × %s m.' % (fmt(bb[3] - bb[0]), fmt(bb[4] - bb[1]))
    if e['cat'] == 'Garde-corps' and d.get('longueur'):
        return 'Longueur %s m' % fmt(d['longueur']), 'Hauteur hors tout %s m.' % fmt(bb[5] - bb[2])
    if e['cat'] in ('Ossature', 'Poteaux porteurs'):
        Ln = d.get('longueur') or d.get('longueur_inst')
        sec = re.search(r'(\d+)\s*x\s*(\d+)|Ø\s*(\d+)', e.get('type') or '')
        s = None
        if sec:
            s = 'section %s × %s cm' % (sec.group(1), sec.group(2)) if sec.group(1) else 'section Ø %s cm' % sec.group(3)
        if Ln:
            return ('Longueur %s m' % fmt(Ln)) + (', ' + s if s else ''), 'Section lue dans le nom du type.' if s else None
    return 'Encombrement %s × %s × %s m' % (fmt(bb[3] - bb[0]), fmt(bb[4] - bb[1]), fmt(bb[5] - bb[2])), 'Boîte englobante de l\'élément dans la maquette.'


# ------------------------------------------------------------------ catalogue des documents
DOCS = {}


def doc(id, categorie, titre, ref, indice, fichier=None, fiab='verifie', note=None, phase='Marché'):
    DOCS[id] = {'id': id, 'categorie': categorie, 'titre': titre, 'ref': ref, 'indice': indice, 'phase': phase,
                'fichier': fichier, 'acces': 'prive' if fichier else None, 'fiab': fiab, 'note': note}


DCE = 'dce/'
doc('go_fond', 'Plans de coffrage', 'Plan des fondations', 'GO.03.02.02', 'C', DCE + 'GO.03.02.02_MARCHE_plan_des_fondations_C.pdf',
    note='Le cartouche porte le n° GO.03.02.01.')
doc('go_r1', 'Plans de coffrage', 'Plan du plancher haut R-1 (parking)', 'GO.03.02.02', 'C', DCE + 'GO.03.02.02_MARCHE_plan_PH_R-1_C.pdf')
doc('go_a1_bas', 'Plans de coffrage', 'Plans PH RDC à R+5 — bâtiment A1', 'GO.03.02.03', 'C', DCE + 'GO.03.02.03_MARCHE_plan_PH_RDC_R5_A1_C.pdf')
doc('go_a1_haut', 'Plans de coffrage', 'Plans PH R+6 à R+9 — bâtiment A1', 'GO.03.02.04', 'B', DCE + 'GO.03.02.04_MARCHE_plan_PH_R6_R9_A1_B.pdf')
doc('go_a2_bas', 'Plans de coffrage', 'Plans PH RDC à R+5 — bâtiment A2', 'GO.03.02.05', 'C', 'A2-PM106/GO.03.02.05_MARCHE_plan_PH_RDC_R5_A2_C.pdf')
doc('go_a2_haut', 'Plans de coffrage', 'Plans PH R+6 à R+9 — bâtiment A2', 'GO.03.02.06', 'B', DCE + 'GO.03.02.06_MARCHE_plan_PH_R6_R9_A2_B.pdf')
doc('go_coupes', 'Coupes et détails', 'Coupes et détails structure', 'GO.03.02.07', 'C', 'A2-PM106/GO.03.02.07_MARCHE_coupes_details_C.pdf')
doc('coupe_a1', 'Coupes et détails', 'Coupe A1 — architecte', '03 01 01', 'A', DCE + '03_01_01_Coupe_A1.pdf')
doc('coupe_a2', 'Coupes et détails', 'Coupe A2 — architecte', '03 01 01', 'A', 'A2-PM106/03_01_01_Coupe_A2.pdf')
for s in STOREYS:
    n = 'TOITURE' if s == 'Toiture' else s.replace('+', '')
    doc('archi_a1_' + s, 'Plans architecte', 'Plan de niveau %s — tour A1' % s, '03 01 02', 'A', DCE + 'FONTBELLEAU_MAR_PLANS_A1_%s.pdf' % n,
        note='Plan sans numéro ni échelle pour certains niveaux (audit DCE).')
doc('archi_rdc', 'Plans architecte', "Plan d'ensemble RDC", '03 01 01', 'A', DCE + '03_01_01_Plan_densemble_RDC.pdf')
doc('archi_parking', 'Plans architecte', 'Plan parking R-1', '03 01 01', 'A', DCE + '03_01_01_Plan_parking_R-1.pdf')
doc('carnet_details', 'Détails architecte', 'Carnet de détails', '03 01 05', 'A', DCE + '03_01_05_CARNET_DE_DETAILS.pdf')
doc('carnet_typo', 'Détails architecte', 'Carnet des typologies de logements (1/50)', '03 01 05', 'A', DCE + '03_01_05_CARNET_TYPOLOGIE_A3_50.pdf')
doc('facade_temoin', 'Détails architecte', 'Façade témoin', '03 01 05', 'A', DCE + '03_01_05_FACADE_TEMOIN.pdf')
doc('surfaces_a1', 'Détails architecte', 'Tableau des surfaces A1', '03 01 04', 'A', DCE + '03_01_04_TABLEAUX_DES_SURFACES_A1.pdf')
for n, lab, ind in (('0', 'Généralités', 'B'), ('301', 'Gros œuvre', 'B'), ('309', 'Isolation, flocage', '0'), ('402', 'Étanchéité', 'B'),
                    ('416', 'Menuiseries extérieures aluminium', '0'), ('417', 'Menuiseries extérieures PVC', 'A'),
                    ('422', 'Stores et occultations', 'A'), ('502', 'CVC, plomberie', 'B')):
    f = 'A2-PM106/02.01.301_CCTP_GROS_OEUVRE_IndB.pdf' if n == '301' else DCE + '02.01.%s_CCTP.pdf' % n
    doc('cctp_' + n, 'Pièces écrites', 'CCTP lot %s — %s' % (n, lab), '02.01.%s' % n, ind, f)
for n in ('602', '603', '609', '611', '616', '620'):
    doc('cctp_' + n, 'Pièces écrites', 'CCTP lot %s — %s' % (n, LOTS[n]), None, None, fiab='nd',
        note="Absent du DCE : à réclamer à la maîtrise d'œuvre (audit DCE).")
doc('cctp_vrd', 'Pièces écrites', 'CCTP VRD et espaces verts', None, None, fiab='nd', note='Absent du DCE (audit DCE).')
doc('cvc_r1', 'Plans techniques', 'Plans CVC R-1 — tours COGEDIM et CDC', '03.02.01.04.01', 'C', DCE + '03.02.01.04.01_CVC_R-1.pdf')
doc('cvc_a1_bas', 'Plans techniques', 'Plans CVC RDC à R+5 — tour COGEDIM (A1)', '03.02.01.04.02', 'C', DCE + '03.02.01.04.02_CVC_RDC_R5_COGEDIM.pdf')
doc('cvc_a1_haut', 'Plans techniques', 'Plans CVC R+6 à toiture — tour COGEDIM (A1)', '03.02.01.04.03', 'B', DCE + '03.02.01.04.03_CVC_R6_TOIT_COGEDIM.pdf')
doc('cvc_a2_bas', 'Plans techniques', 'Plans CVC RDC à R+5 — tour CDC (A2)', '03.02.01.04.04', 'C', DCE + '03.02.01.04.04_CVC_RDC_R5_CDC.pdf')
doc('cvc_a2_haut', 'Plans techniques', 'Plans CVC R+6 à toiture — tour CDC (A2)', '03.02.01.04.05', 'B', DCE + '03.02.01.04.05_CVC_R6_TOIT_CDC.pdf')
doc('cvc_cellules', 'Plans techniques', 'Plans CVC des cellules types', '03.02.01.04.06', 'B', DCE + '03.02.01.04.06_CVC_CELLULES.pdf')
doc('cvc_synopt', 'Plans techniques', 'Locaux techniques et synoptiques CVC', '03.02.01.04.07', 'C', DCE + '03.02.01.04.07_CVC_SYNOPTIQUES.pdf')
doc('vrd_gen', 'Espaces extérieurs', 'Plan VRD général', '03.03.01.01', 'C', DCE + '03.03.01.01_VRD_gen_C.pdf')
doc('vrd_nivrev', 'Espaces extérieurs', 'Plan VRD revêtements et nivellement', '03.03.01.04', 'C', DCE + '03.03.01.04_VRD_NivRev_C.pdf',
    note='PDF modifié le 07/12/2022, après la phase marché (audit DCE).')
doc('archi_a2_nd', 'Plans architecte', 'Plans de niveaux architecte — tour A2', None, None, fiab='nd',
    note='Absents du DCE (audit DCE, point critique).')
doc('rep_menuiseries', 'Plans architecte', 'Plan de repérage des menuiseries extérieures', None, None, fiab='nd',
    note='Cité par les CCTP 416, 417 et 422 ; absent du DCE.')
doc('nd_ferraillage', "Plans d'exécution", 'Plan de ferraillage', None, None, fiab='nd', note="Aucun plan d'exécution dans le DCE.")
doc('nd_ndc', "Notes de calcul", 'Note de calcul structure', None, None, fiab='nd', note='Absente du dossier.')
doc('nd_fab', 'Fiches de fabrication', 'Fiche de fabrication et de livraison', None, None, fiab='nd', note='À fournir par le préfabricant.')
doc('nd_ft', 'Fiches produits', 'Fiche technique du produit', None, None, fiab='nd', note="À fournir par l'entreprise titulaire.")
doc('nd_pv', 'Contrôles', 'Procès-verbal de contrôle ou de réception', None, None, fiab='nd', note='Établi au chantier, pas encore disponible.')
doc('demo_fiche', 'Fiches de fabrication', 'Fiche de fabrication et de livraison (exemple)', 'DEMO-PM106', None,
    None, fiab='fictif', note='Document fictif, filigrané, créé pour montrer le parcours (passeport A2 PM 106).', phase='Démonstration')
DOCS['demo_fiche'].update({'fichier': '../docs/demo/Fiche_fabrication_A2-PM106_DEMO.pdf', 'acces': 'public'})

CITES = [(r'GO\.03\.02\.02[^,;)]*fondations|plan de fondations GO\.03\.02\.02', 'go_fond'), (r'PH R-1', 'go_r1'),
         (r'GO\.03\.02\.03', 'go_a1_bas'), (r'GO\.03\.02\.04', 'go_a1_haut'), (r'GO\.03\.02\.05', 'go_a2_bas'),
         (r'GO\.03\.02\.06', 'go_a2_haut'), (r'GO\.03\.02\.07', 'go_coupes'), (r'03\.02\.01\.04\.01', 'cvc_r1'),
         (r'03\.02\.01\.04\.02', 'cvc_a1_bas'), (r'03\.02\.01\.04\.03', 'cvc_a1_haut'), (r'03\.02\.01\.04\.04', 'cvc_a2_bas'),
         (r'03\.02\.01\.04\.05', 'cvc_a2_haut'), (r'03\.02\.01\.04\.06', 'cvc_cellules'), (r'synoptique', 'cvc_synopt'),
         (r'[Cc]arnet de d[ée]tails', 'carnet_details'), (r'[Ff]a[çc]ade t[ée]moin', 'facade_temoin'), (r'NivRev', 'vrd_nivrev'),
         (r'CCTP (?:GO|301)', 'cctp_301'), (r'CCTP 620', 'cctp_620'), (r'CCTP 616', 'cctp_616'), (r'CCTP 611', 'cctp_611'),
         (r'CCTP 609', 'cctp_609'), (r'CCTP 602', 'cctp_602'), (r'CCTP 603', 'cctp_603'), (r'CCTP VRD', 'cctp_vrd'),
         (r'CCTP 417', 'cctp_417'), (r'CCTP 416', 'cctp_416'), (r'CCTP 402|lot 402', 'cctp_402')]


def documents_of(r, lot):
    e, z, s, k = r['e'], r['zone'], r['storey'], r['kind']
    out = []

    def add(i, note=None, fiab=None):
        if i not in [x[0] for x in out]:
            out.append((i, note, fiab))
    txt = ' '.join(filter(None, [e.get('comm'), e.get('tcomm'), e.get('tdesc'), e.get('type')]))
    for pat, i in CITES:
        if re.search(pat, txt):
            add(i, 'Pièce citée dans la maquette (commentaire ou type de l\'élément).', 'modele' if DOCS[i]['fiab'] != 'nd' else None)
    low = s in ('RDC', 'R+1', 'R+2', 'R+3', 'R+4', 'R+5')
    if k in GO_KINDS:
        if z == 'A1':
            add('go_a1_bas' if low else 'go_a1_haut'); add('coupe_a1'); add('archi_a1_' + s)
        elif z == 'A2':
            add('go_a2_bas' if low else 'go_a2_haut'); add('coupe_a2'); add('archi_a2_nd')
        elif z == 'PARK':
            add('go_r1'); add('archi_parking')
        elif z == 'FOND':
            add('go_fond')
        add('go_coupes'); add('cctp_301'); add('nd_ferraillage'); add('nd_ndc')
        if k == 'premur':
            add('nd_fab')
        add('nd_pv')
    else:
        if z in ('A1', 'LT'):
            add('archi_a1_' + s)
        elif z == 'A2':
            add('archi_a2_nd')
        if k == 'menuiserie_ext':
            add('cctp_416' if lot == '416' else 'cctp_417'); add('carnet_details'); add('facade_temoin'); add('rep_menuiseries')
        elif k in ('ecaille', 'garde_corps') and z != 'EXT':
            add('carnet_details'); add('facade_temoin'); add('cctp_620')
        elif k == 'porte_int':
            add('cctp_603')
        elif k == 'cloison':
            add('cctp_602')
        elif k == 'finition':
            add('cctp_' + (lot if lot in ('609', '611', '616', '602') else '616')); add('carnet_typo'); add('surfaces_a1')
        elif k == 'fermeture':
            add('cctp_417' if lot == '417' else 'cctp_422', None if lot == '417' else 'Le CCTP 0 numérote ce lot 417C ; le fichier du DCE porte le n° 422 (audit DCE).')
        elif k == 'cvc':
            add('cctp_502'); add('cvc_a2_haut' if z == 'A2' else 'cvc_a1_haut'); add('cvc_synopt')
        elif k == 'toiture':
            add('cctp_402')
        elif k == 'ext':
            add('vrd_gen'); add('vrd_nivrev'); add('archi_rdc'); add('cctp_vrd')
        add('nd_ft'); add('nd_pv')
    if r['slug'] == 'A2-PM106':
        add('demo_fiche')
    return [{'id': i, **({'note': n} if n else {}), **({'fiab': f} if f else {})} for i, n, f in out]


# ------------------------------------------------------------------ scénario fictif par étage
def monday(y, m, d):
    return dt.date(y, m, d)


def storey_starts(first, n=11, brk=(dt.date(2026, 12, 21), dt.date(2027, 1, 1))):
    out, d = {}, first
    for s in STOREYS[:n]:
        if brk[0] <= d <= brk[1]:
            d = dt.date(2027, 1, 4)
        out[s] = d
        d = d + dt.timedelta(days=14)
    return out


START = {'A2': storey_starts(dt.date(2026, 10, 26)), 'A1': storey_starts(dt.date(2026, 9, 28))}


def h(s, n):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) % n


def wd(d):
    # repousse un jalon tombant le week-end au lundi
    while d.weekday() >= 5:
        d += dt.timedelta(days=1)
    return d


# modèles de jalons : (clé, libellé, statut atteint, décalage en jours par rapport à la date de pose)
JAL = {
    'premur': [('visa', 'Visa du plan de fabrication', None, -47), ('commande', 'Commande au préfabricant', 'commande', -42),
               ('fabrication', 'Fabrication en usine', 'fabrication', -22), ('expedition', 'Contrôle usine, prêt à expédier', 'pret', -19),
               ('livraison', 'Livraison sur chantier', 'livre', -14), ('pose', 'Levage et pose', 'pose_en_cours', 0),
               ('remplissage', 'Coulage du béton de remplissage', 'pose', 1), ('reception', 'Contrôle et réception', 'receptionne', 2)],
    'coule': [('commande', 'Commande du béton et des armatures', 'commande', -21), ('fabrication', 'Façonnage des armatures', 'fabrication', -9),
              ('livraison', 'Livraison des armatures', 'livre', -3), ('pose', 'Coffrage et ferraillage', 'pose_en_cours', -1),
              ('coulage', 'Coulage du béton', 'pose', 0), ('reception', 'Décoffrage, contrôle et réception', 'receptionne', 6)],
    'second': [('visa', 'Visa des fiches techniques', None, -56), ('commande', 'Commande au fournisseur', 'commande', -49),
               ('fabrication', 'Fabrication', 'fabrication', -21), ('livraison', 'Livraison sur chantier', 'livre', -4),
               ('pose', 'Pose', 'pose_en_cours', 0), ('fin_pose', 'Fin de pose', 'pose', 1), ('reception', 'Contrôle et réception', 'receptionne', 7)],
}
# jour de pose dans le cycle d'étage (gros œuvre) ou décalage en semaines (second œuvre)
GO_DAY = {'voile': 3, 'poteau': 3, 'premur': 9, 'poutre': 10, 'dalle': 11, 'escalier': 11}
SO_WEEKS = {'menuiserie_ext': 10, 'garde_corps': 12, 'ite': 13, 'ecaille': 14, 'cloison': 16, 'porte_int': 18, 'finition': 22,
            'fermeture': 20, 'cvc': 6, 'toiture': 4, 'autre': 16}


def pose_date(r):
    z, s, k = r['zone'], r['storey'], r['kind']
    i = r['i']
    if z == 'FOND':
        c = code_of(r['e'])
        base = {'PIEUX': dt.date(2026, 5, 4), 'MASS': dt.date(2026, 5, 26), 'LG': dt.date(2026, 6, 9)}.get(c, dt.date(2026, 6, 22))
        return wd(base + dt.timedelta(days=h(r['slug'], 18)))
    if z == 'PARK':
        base = {'poteau': dt.date(2026, 7, 6), 'voile': dt.date(2026, 7, 13), 'poutre': dt.date(2026, 8, 24),
                'dalle': dt.date(2026, 9, 7), 'escalier': dt.date(2026, 9, 14)}.get(k, dt.date(2026, 8, 3))
        if code_of(r['e']) == 'D':
            base = dt.date(2026, 6, 29)
        return wd(base + dt.timedelta(days=h(r['slug'], 14)))
    if z == 'EXT':
        return wd(dt.date(2027, 5, 10) + dt.timedelta(days=h(r['slug'], 30)))
    zz = 'A1' if z == 'LT' else z
    S = START[zz][s]
    if k in GO_KINDS:
        return wd(S + dt.timedelta(days=GO_DAY.get(k, 8)))
    return wd(S + dt.timedelta(weeks=SO_WEEKS.get(k, 16), days=h(r['slug'], 4)))


def jalons_of(r):
    k = r['kind']
    tpl = JAL['premur'] if k == 'premur' else (JAL['coule'] if k in GO_KINDS else JAL['second'])
    P = pose_date(r)
    out = []
    for cle, lab, st, off in tpl:
        prev = wd(P + dt.timedelta(days=off))
        var = h(r['slug'] + cle, 7) - 2           # -2 … +4 jours
        contr = wd(prev - dt.timedelta(days=var)) if cle in ('commande', 'livraison', 'pose', 'coulage', 'reception') else None
        reel = None
        if prev <= TODAY:
            reel = wd(prev + dt.timedelta(days=max(0, var - 2)))
            if reel > TODAY:
                reel = None
        j = {'cle': cle, 'label': lab, 'contractuelle': contr.isoformat() if contr else None,
             'previsionnelle': prev.isoformat(), 'reelle': reel.isoformat() if reel else None, 'fiab': 'fictif'}
        if st:
            j['statut'] = st
        out.append(j)
    return out


STATUTS = [{'cle': 'a_commander', 'label': 'À commander', 'phase': 'achat'}, {'cle': 'commande', 'label': 'Commandé', 'phase': 'achat'},
           {'cle': 'fabrication', 'label': 'En fabrication', 'phase': 'usine'}, {'cle': 'pret', 'label': 'Prêt à expédier', 'phase': 'usine'},
           {'cle': 'livre', 'label': 'Livré sur chantier', 'phase': 'chantier'}, {'cle': 'attente_pose', 'label': 'En attente de pose', 'phase': 'chantier'},
           {'cle': 'pose_en_cours', 'label': 'En cours de pose', 'phase': 'chantier'}, {'cle': 'pose', 'label': 'Posé', 'phase': 'fin'},
           {'cle': 'receptionne', 'label': 'Contrôlé et réceptionné', 'phase': 'fin'}]
SLAB = {s['cle']: s['label'] for s in STATUTS}
SORDER = [s['cle'] for s in STATUTS]
COMMENTS = {'commande': 'Commande passée (scénario).', 'fabrication': 'Fabrication lancée (scénario).', 'pret': 'Contrôle usine conforme.',
            'livre': 'Réceptionné sur le chantier et stocké.', 'pose_en_cours': 'Mise en œuvre commencée.', 'pose': 'Mise en œuvre terminée.',
            'receptionne': 'Contrôle conforme, ouvrage réceptionné.'}


def scenario_of(r, js):
    evs, cur, last = [], 'a_commander', None
    for j in js:
        st = j.get('statut')
        if st and j['reelle']:
            if SORDER.index(st) > SORDER.index(cur):
                evs.append({'type': 'statut', 'ancien': cur, 'nouveau': st, 'commentaire': COMMENTS.get(st, ''),
                            'cree_le': j['reelle'] + 'T08:00:00+01:00', 'auteur': 'Scénario de démonstration', 'fictif': True})
                cur = st
                last = j['reelle'] + 'T08:00:00+01:00'
    return {'statut': cur, 'maj_le': last or '2026-09-01T08:00:00+02:00', 'maj_par': 'Scénario de démonstration',
            'evenements': evs[::-1], 'notes': []}


# ------------------------------------------------------------------ approvisionnement fictif
APPRO = {
    'premur': ('Préfa Démo — usine de préfabrication fictive', 'm²', 190, '4 semaines entre la commande et la livraison'),
    'voile': ('Béton Démo (centrale BPE) et Armatures Démo — fournisseurs fictifs', 'm³', 520, '3 semaines pour les armatures façonnées'),
    'poteau': ('Béton Démo (centrale BPE) et Armatures Démo — fournisseurs fictifs', 'm³', 900, '3 semaines pour les armatures façonnées'),
    'poutre': ('Béton Démo (centrale BPE) et Armatures Démo — fournisseurs fictifs', 'm³', 850, '3 semaines pour les armatures façonnées'),
    'dalle': ('Béton Démo (centrale BPE) et Armatures Démo — fournisseurs fictifs', 'm³', 380, '3 semaines pour les armatures façonnées'),
    'escalier': ('Béton Démo (centrale BPE) et Armatures Démo — fournisseurs fictifs', 'm³', 1400, '3 semaines pour les armatures façonnées'),
    'fondation': ('Fondations Démo — entreprise de pieux fictive', 'm³', 450, '2 semaines'),
    'menuiserie_ext': ('Menuiseries Démo — fabricant fictif', 'm²', 320, '7 semaines'),
    'ecaille': ('Métallerie Démo — atelier fictif', 'u', 260, '6 semaines'),
    'garde_corps': ('Métallerie Démo — atelier fictif', 'ml', 420, '6 semaines'),
    'porte_int': ('Menuiserie intérieure Démo — fournisseur fictif', 'u', 380, '5 semaines'),
    'cloison': ('Plâtrerie Démo — négoce fictif', 'm²', 48, '2 semaines'),
    'finition': ('Revêtements Démo — fournisseur fictif', 'm²', 25, '2 semaines'),
    'fermeture': ('Fermetures Démo — fabricant fictif', 'u', 450, '5 semaines'),
    'ite': ('Façade Démo — fournisseur fictif', 'm²', 95, '3 semaines'),
    'cvc': ('CVC Démo — fournisseur fictif', 'u', 9000, '8 semaines'),
    'toiture': ('Étanchéité Démo — fournisseur fictif', 'm²', 120, '4 semaines'),
    'ext': ('VRD Démo — fournisseur fictif', 'u', 1500, '3 semaines'),
    'autre': ('Fournisseur Démo — fictif', 'u', 500, '4 semaines'),
}


def quantite(r):
    e, k = r['e'], r['kind']
    d = e.get('dim', {})
    unit = APPRO[k][1]
    if unit == 'm²':
        if e['cat'] in ('Fenêtres', 'Portes') and d.get('largeur') and d.get('hauteur_fam'):
            return d['largeur'] * d['hauteur_fam'], 'm²', 'largeur × hauteur'
        if d.get('surface'):
            return d['surface'], 'm²', 'surface'
    if unit == 'm³' and d.get('volume'):
        return d['volume'], 'm³', 'volume'
    if unit == 'ml' and d.get('longueur'):
        return d['longueur'], 'ml', 'longueur'
    return 1, 'u', 'unité'


def appro_rows(r, lot, ref_cmd):
    k = r['kind']
    four, unit, pu, delai = APPRO[k]
    q, u, how = quantite(r)
    if u != unit:
        pu = APPRO['autre'][2] if u == 'u' else pu
    tit = 'Veck Construction (lot 301)' if lot == '301' else None
    rows = [{'cle': 'fournisseur', 'label': 'Fournisseur', 'valeur': four, 'fiab': 'fictif'}]
    if tit:
        rows.append({'cle': 'titulaire', 'label': 'Entreprise titulaire', 'valeur': tit, 'fiab': 'fictif'})
    else:
        tm = r['e'].get('tmanuf') or ''
        rows.append({'cle': 'titulaire', 'label': 'Entreprise titulaire', 'valeur': None,
                     'detail': tm if tm.startswith('À compléter') else ('Lot %s : titulaire non désigné dans le dossier.' % lot if lot else None),
                     'fiab': 'nd' if not tm.startswith('À compléter') else 'modele',
                     'sources': ['Maquette — fabricant du type'] if tm.startswith('À compléter') else []})
    rows.append({'cle': 'ref_commande', 'label': 'Référence de commande', 'valeur': ref_cmd, 'fiab': 'fictif'})
    rows.append({'cle': 'quantite', 'label': 'Quantité (maquette)', 'valeur': '%s %s' % (fmt(q, 2 if u != 'u' else 0), u),
                 'detail': 'Mesure de la maquette (%s).' % how, 'fiab': 'modele', 'sources': ['Maquette']})
    rows.append({'cle': 'montant', 'label': 'Montant', 'valeur': '%s € HT' % format(int(round(q * pu)), ',').replace(',', ' '),
                 'detail': 'Prix unitaire fictif %s € HT/%s × quantité de la maquette.' % (format(pu, ',').replace(',', ' '), u), 'fiab': 'fictif'})
    rows.append({'cle': 'delai', 'label': "Délai d'approvisionnement", 'valeur': delai, 'fiab': 'fictif'})
    return rows


INFOS = {
    'premur': ("Environ 1 h de levage et de réglage, puis coulage avec le noyau de l'étage", 'Équipe gros œuvre Veck Construction : un chef d\'équipe, deux compagnons, un grutier',
               'Grue à tour, palonnier et élingues, étais tirant-poussant, cales de réglage, niveau laser', 'Levage par vent inférieur à 72 km/h, zone balisée sous la charge'),
    'coule': ("Une journée de coffrage-ferraillage, coulage le lendemain", 'Équipe gros œuvre Veck Construction : un chef d\'équipe, trois compagnons',
              'Banches ou coffrage de dalle, armatures façonnées, benne à béton, vibreur', 'Coulage hors gel et hors pluie forte, cure du béton 3 jours'),
    'second': ('Selon le métier : pose par étage après la fermeture du gros œuvre', "Équipe de l'entreprise titulaire du lot",
               'Outillage du métier, nacelle ou échafaudage pour la façade', "Accès par l'ascenseur de chantier, protection des ouvrages finis"),
    'fondation': ('Une à deux journées par massif selon le nombre de pieux', 'Équipe fondations (fictive) et équipe gros œuvre Veck Construction',
                  'Foreuse, tube plongeur, benne à béton', 'Plateforme de travail stabilisée, contrôle de la verticalité des pieux'),
}
CONTROLES = {
    'premur': ['Implantation tracée au sol conforme au plan', "Arase et niveau d'assise contrôlés", 'Aciers en attente en place et propres',
               'Peaux sans épaufrure ni fissure à la réception', 'Inserts de levage et de stabilité vérifiés', 'Étaiement posé avant décrochage de la grue'],
    'coule': ['Implantation et niveaux contrôlés', 'Ferraillage conforme au plan (enrobage, recouvrements)', 'Réservations et inserts en place',
              'Coffrage propre, huilé et étanche', 'Bon de livraison du béton conforme (classe, consistance)'],
    'fondation': ['Implantation des pieux contrôlée par le géomètre', 'Profondeur et verticalité relevées', 'Cage d\'armature conforme',
                  'Recépage et arase au niveau prévu'],
    'second': ['Support réceptionné et conforme', 'Produit livré conforme à la commande (référence, quantité)', 'Fiche technique visée',
               'Protection des ouvrages voisins en place'],
}


# ------------------------------------------------------------------ voisinage et dépendances
def neighbours(r):
    i = r['i']
    J = PLANIDX[r['plan']]
    J = J[J != i]
    g = gap_xy(i, J)
    zo = zover(i, J)
    ok = zo > -0.05
    J, g = J[ok], g[ok]
    order = np.argsort(g)[:5]
    out = []
    for j in J[order]:
        rr = recs[j]
        gg = float(gap_xy(i, np.array([j]))[0])
        out.append({'role': 'Au contact' if gg < 0.06 else 'À %s m' % fmt(gg, 1), 'ref': rr['disp'], 'slug': rr['slug'], 'texte': designation(rr)})
    e = r['e']
    if e.get('host') and e['host'] in BYID:
        hr = BYID[e['host']]
        out.insert(0, {'role': 'Hôte', 'ref': hr['disp'], 'slug': hr['slug'], 'texte': designation(hr)})
    return out[:6]


def deps(r):
    i = r['i']
    a = BB[i]
    J = ALL[ALL != i]
    g = gap_xy(i, J)
    near = g < 0.10
    below = near & (np.abs(BB[J, 5] - a[2]) < 0.30)
    above = near & (np.abs(BB[J, 2] - a[5]) < 0.30)
    same = (g < 0.06) & (zover(i, J) > 0.3) & ~below & ~above

    def names(mask, n=4):
        idx = J[mask]
        idx = sorted(idx, key=lambda j: (recs[j]['kind'] not in GO_KINDS, float(gap_xy(i, np.array([j]))[0])))
        return ['%s — %s' % (recs[j]['disp'], designation(recs[j])) for j in idx[:n]]
    return {'avant': names(below), 'pendant': names(same, 5), 'apres': names(above),
            'fiab': 'modele', 'sources': ['Maquette — éléments au contact (boîtes englobantes)']}


# ------------------------------------------------------------------ construction des fiches
def poids_row(r):
    e, k = r['e'], r['kind']
    v = e.get('dim', {}).get('volume')
    mats = ' '.join(m[0] or '' for m in e.get('mats', []))
    if k == 'premur' and e['dim'].get('surface'):
        s = e['dim']['surface']
        return {'cle': 'poids', 'label': 'Poids estimé', 'valeur': '≈ %s t au levage' % fmt(s * 0.12 * 2.5, 2),
                'detail': 'Hypothèse : deux peaux de 6 cm × %s m² × 2,5 t/m³ ; ≈ %s t une fois rempli.' % (fmt(s, 2), fmt(v * 2.5, 2) if v else '?'),
                'fiab': 'estime', 'sources': ['Calcul à partir de la maquette']}
    if v and 'éton' in (e.get('mat_struct') or mats):
        return {'cle': 'poids', 'label': 'Poids estimé', 'valeur': '≈ %s t' % fmt(v * 2.5, 2),
                'detail': 'Volume de la maquette (%s m³) × 2,5 t/m³, masse volumique courante du béton armé.' % fmt(v, 3),
                'fiab': 'estime', 'sources': ['Calcul à partir de la maquette']}
    return {'cle': 'poids', 'label': 'Poids', 'valeur': None, 'fiab': 'nd', 'detail': 'Aucune donnée de masse dans le dossier.'}


def materiaux(e):
    names = []
    if e.get('mat_struct'):
        names.append(e['mat_struct'])
    for m in e.get('mats', []):
        if m[0] and m[0] not in names:
            names.append(m[0])
    return names[:4]


def contexte_of(z, s):
    if z == 'LT':
        return 'Tour A1, logement témoin A1.31 (étage R+3)'
    if z in ('A1', 'A2'):
        return '%s, %s' % (ZONES[z]['label'], 'rez-de-chaussée' if s == 'RDC' else ('toiture' if s == 'Toiture' else 'étage ' + s))
    return {'PARK': 'Parking, sous-sol R-1', 'FOND': 'Fondations des tours et du parking', 'EXT': 'Aménagements extérieurs'}[z]


def build_record(r):
    e, z, s, k = r['e'], r['zone'], r['storey'], r['kind']
    zinfo = ZONES[z]
    lot, lot_fiab, lot_src = lot_of(e, k)
    ref_cmd = 'CMD-%s-%s-%s' % (lot or 'XXX', 'A1' if z == 'LT' else z, (s or '').replace('+', ''))
    des = designation(r)
    d, sect = orientation(r)
    where = 'au centre (noyau)' if z in ('A1', 'A2') and d < 4.5 else ('côté %s' % sect)
    bb = BB[r['i']]
    pied, tete = ngf(bb[2]), ngf(bb[5])
    warn = []
    if r.get('prefixed'):
        warn.append({'type': 'modele', 'titre': 'Identifiant sans préfixe de tour dans la maquette',
                     'texte': 'La maquette repère cet élément « %s ». Le passeport ajoute le préfixe %s, déduit du sous-projet, pour le distinguer de l\'autre tour.' % (e.get('ident'), z)})
    if r.get('dup'):
        warn.append({'type': 'conflit', 'titre': 'Identifiant partagé par %d éléments' % r['dup'][1],
                     'texte': 'Plusieurs éléments de la maquette portent l\'identifiant « %s ». Ce passeport concerne l\'élément Revit %d (n° %d sur %d). À corriger dans la maquette.' % (e.get('ident'), e['id'], r['dup'][0], r['dup'][1])})
    it = (e.get('ident') or '').split()
    if it and it[0] in ('A1', 'A2') and it[0] != ('A1' if z == 'LT' else z):
        warn.append({'type': 'conflit', 'titre': 'Identifiant et sous-projet incohérents',
                     'texte': "L'identifiant « %s » désigne la tour %s, mais l'élément est rangé dans le sous-projet « %s » (%s). À vérifier dans la maquette." % (e['ident'], it[0], e['ws'], zinfo['label'])})
    if not e.get('ident'):
        warn.append({'type': 'nd', 'titre': 'Élément sans identifiant', 'texte': "Le paramètre Identifiant est vide dans la maquette. Le passeport utilise le numéro d'élément Revit."})
    txt = ' '.join(filter(None, [e.get('ws'), e.get('comm'), e.get('type'), e.get('tcomm')]))
    if re.search(r'[Vv]ariante|VAR A2|\(var\. A2\)', txt):
        warn.append({'type': 'conflit', 'titre': 'Variante RE2020 étudiée par le groupe',
                     'texte': "Cet élément fait partie d'une variante d'amélioration RE2020 modélisée dans la maquette. Il ne figure pas dans les pièces du marché."})
    if e.get('comm') and re.search(r'hypoth[èe]se|à valider|à confirmer', e['comm'], re.I):
        warn.append({'type': 'modele', 'titre': 'Hypothèse de modélisation', 'texte': e['comm']})
    mats = materiaux(e)
    dv, ddet = dims_row(r)
    dim = e.get('dim', {})
    sv = []
    if dim.get('surface'):
        sv.append('%s m²' % fmt(dim['surface']))
    if dim.get('volume'):
        sv.append('%s m³' % fmt(dim['volume'], 3 if dim['volume'] < 0.1 else 2))
    ident_rows = [
        {'cle': 'reference', 'label': 'Référence', 'valeur': r['disp'], 'fiab': 'modele',
         'detail': 'Élément Revit %d.' % e['id'] + (' Identifiant maquette « %s ».' % e['ident'] if r.get('prefixed') else ''),
         'sources': ['Maquette — paramètre Identifiant']},
        {'cle': 'designation', 'label': 'Désignation', 'valeur': des, 'fiab': 'modele',
         'detail': ('Commentaire maquette : « %s ».' % e['comm']) if e.get('comm') else None,
         'sources': ['Maquette — type %s' % e.get('type')]},
        {'cle': 'famille', 'label': 'Catégorie', 'valeur': '%s — %s' % (KIND_LABEL[k], e['cat']), 'fiab': 'modele',
         'detail': 'Famille « %s », type « %s ».' % (e.get('fam'), e.get('type')), 'sources': ['Maquette — catégorie et famille']},
        {'cle': 'batiment', 'label': 'Bâtiment', 'valeur': '%s — %s' % (zinfo['label'], zinfo['batiment']), 'fiab': zinfo['fiab'], 'sources': zinfo['sources']},
        {'cle': 'niveau', 'label': 'Étage', 'valeur': storey_label(z, s), 'fiab': 'modele',
         'detail': 'Niveau de référence Revit « %s »%s ; sous-projet « %s ».' % (e.get('lv'), (' (%s NGF)' % fmt(LEVELS[e['lv']])) if e.get('lv') in LEVELS else '', e.get('ws')),
         'sources': ['Maquette — niveau et sous-projet']},
        {'cle': 'dimensions', 'label': 'Dimensions', 'valeur': dv, 'detail': ddet, 'fiab': 'modele', 'sources': ['Maquette']},
        {'cle': 'surface_volume', 'label': 'Surface et volume', 'valeur': ' · '.join(sv) or None, 'fiab': 'modele' if sv else 'nd', 'sources': ['Maquette'] if sv else []},
        poids_row(r),
        {'cle': 'materiaux', 'label': 'Matériaux', 'valeur': ', '.join(mats) or None, 'fiab': 'modele' if mats else 'nd',
         'detail': ('Description du type : %s' % e['tdesc']) if e.get('tdesc') and len(e['tdesc']) > 80 else None, 'sources': ['Maquette — matériaux'] if mats else []},
        {'cle': 'lot', 'label': 'Lot', 'valeur': ('Lot %s — %s' % (lot, LOTS.get(lot, ''))).rstrip(' —') if lot else None, 'fiab': lot_fiab,
         'detail': None if lot else 'Aucun lot indiqué dans la maquette ni dans les pièces du DCE.', 'sources': [lot_src] if lot_src else []},
    ]
    if e.get('tmanuf') and not e['tmanuf'].startswith('À compléter') and not e['tmanuf'].startswith('Lot'):
        ident_rows.append({'cle': 'fabricant', 'label': 'Fabricant', 'valeur': e['tmanuf'] + (' — ' + e['tmodel'] if e.get('tmodel') else ''), 'fiab': 'modele', 'sources': ['Maquette — type']})
    ident_rows.append({'cle': 'identifiants', 'label': 'Identifiants numériques', 'valeur': 'Revit %d' % e['id'], 'fiab': 'modele',
                       'detail': 'IfcGUID %s ; UniqueId %s.' % (e.get('ifc'), e.get('uid')), 'sources': ['Maquette']})
    js = jalons_of(r)
    sc = scenario_of(r, js)
    tplk = 'premur' if k == 'premur' else ('fondation' if k == 'fondation' else ('coule' if k in GO_KINDS else 'second'))
    dur, eq, mat, cc = INFOS[tplk]
    if lot and lot != '301' and tplk == 'second':
        eq = "Équipe de l'entreprise titulaire du lot %s (non désignée)" % lot
    infos = [{'cle': 'duree', 'label': 'Durée de mise en œuvre', 'valeur': dur, 'fiab': 'fictif'},
             {'cle': 'equipe', 'label': 'Équipe responsable', 'valeur': eq, 'fiab': 'fictif'},
             {'cle': 'materiel', 'label': 'Matériel nécessaire', 'valeur': mat, 'fiab': 'fictif'},
             {'cle': 'contrainte_chantier', 'label': 'Contraintes de chantier', 'valeur': cc, 'fiab': 'fictif'}]
    rec = {
        'schema': 2, 'ref': r['slug'], 'reference': r['disp'], 'designation': des, 'donnees_maj': TODAY.isoformat(),
        'url': url_of(r), 'zone': z, 'etage': s, 'famille': k,
        'contexte': contexte_of(z, s),
        'avertissements': warn,
        'identite': ident_rows,
        'localisation': {
            'resume': '%s, %s, %s. %s' % (zinfo['label'], storey_label(z, s).lower(), where,
                                            'Pied à %s NGF, tête à %s NGF.' % (fmt(pied), fmt(tete))),
            'ngf_pied': round(pied, 2), 'ngf_tete': round(tete, 2),
            'plan': '../plans/%s.svg' % r['plan'], 'cible': e['id'],
            'voisins': neighbours(r), 'fiab': 'modele', 'sources': ['Maquette — position et sous-projet']
        },
        'documents': documents_of(r, lot),
        'approvisionnement': appro_rows(r, lot, ref_cmd),
        'planning': {'jalons': js, 'infos': infos, 'dependances': deps(r), 'controles': CONTROLES[tplk], 'controles_fiab': 'fictif'},
        'scenario': sc
    }
    return rec


# ------------------------------------------------------------------ écriture
os.makedirs(os.path.join(ROOT, 'data', 'o'), exist_ok=True)
old = json.load(open(os.path.join(ROOT, 'tools', 'sources', 'A2-PM106.json'), encoding='utf-8'))  # fiche détaillée rédigée à la main
FIAB = old['fiabilites']
index, revit = [], []
for r in recs:
    rec = build_record(r)
    if r['slug'] == 'A2-PM106':
        # le passeport détaillé garde ses textes vérifiés ; on complète la localisation et la zone
        rich = dict(old)
        rich['schema'] = 2
        rich.update({'url': url_of(r), 'zone': 'A2', 'etage': 'R+1', 'famille': 'premur', 'contexte': 'Tour A2, étage R+1, noyau central'})
        loc = dict(rich['localisation'])
        loc.update({'plan': rec['localisation']['plan'], 'cible': r['e']['id']})
        rich['localisation'] = loc
        rich['documents'] = [dict(d, id=d.get('id') or d.get('titre')) for d in old['documents']]
        rich.pop('fiabilites', None); rich.pop('statuts', None)
        rec = rich
        st = rich['scenario']['statut']
    else:
        st = rec['scenario']['statut']
    with open(os.path.join(ROOT, 'data', 'o', r['slug'] + '.json'), 'w', encoding='utf-8') as fh:
        json.dump(rec, fh, ensure_ascii=False, separators=(',', ':'))
    index.append([r['slug'], r['disp'], rec['designation'], r['zone'], r['storey'], r['kind'], st, r['e']['id']])
    revit.append([r['e']['id'], url_of(r), '%s (scénario fictif)' % SLAB[st]])

commun = {'schema': 2, 'donnees_maj': TODAY.isoformat(), 'projet': old['projet'], 'fiabilites': FIAB, 'statuts': STATUTS,
          'zones': {k: {'label': v['label'], 'batiment': v['batiment']} for k, v in ZONES.items()},
          'etages': STOREYS, 'familles': KIND_LABEL, 'documents': DOCS}
json.dump(commun, open(os.path.join(ROOT, 'data', 'commun.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump({'colonnes': ['ref', 'reference', 'designation', 'zone', 'etage', 'famille', 'statut', 'revit'], 'ouvrages': index},
          open(os.path.join(ROOT, 'data', 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ------------------------------------------------------------------ maquette 3D
man = json.load(open(os.path.join(G3D, 'manifest.json'), encoding='utf-8'))
geo = np.fromfile(os.path.join(G3D, 'geometry.bin'), dtype='<i2')
IDENT = {r['e']['id']: r['disp'] for r in recs}
SLUGS = {r['e']['id']: r['slug'] for r in recs}
out = {'version': 2, 'units': 'cm', 'z0_ngf_m': Z0,
       'note': 'Maillage extrait de la maquette Revit MQT-FONTBELLEAU-G4 (LOD grossier). Origine : centre de la tour A2. z=0 : 37,89 NGF.',
       'groups': []}
blobs, off = [], 0
geo_by_id = {}
for g in man['groups']:
    a = geo[g['byteOffset'] // 2:(g['byteOffset'] + g['byteLength']) // 2]
    b = a.astype('<i2').tobytes()
    els = []
    for eid, s0, n in g['elements']:
        els.append([eid, s0, n, IDENT.get(eid, ''), SLUGS.get(eid, '')])
        geo_by_id[eid] = (g['name'], a.reshape(-1, 3, 3)[s0:s0 + n])
    out['groups'].append({'name': g['name'], 'byteOffset': off, 'byteLength': len(b), 'triangles': len(a) // 9, 'elements': els})
    blobs.append(b)
    off += len(b)
os.makedirs(os.path.join(ROOT, 'model'), exist_ok=True)
raw = b''.join(blobs)
open(os.path.join(ROOT, 'model', 'site.bin'), 'wb').write(raw)
with gzip.open(os.path.join(ROOT, 'model', 'site.bin.gz'), 'wb', compresslevel=9) as fh:
    fh.write(raw)
json.dump(out, open(os.path.join(ROOT, 'model', 'site.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ------------------------------------------------------------------ plans de niveau
KCLASS = {'premur': 'w', 'voile': 'w', 'poteau': 'w', 'poutre': 'f', 'dalle': 's', 'escalier': 'st', 'fondation': 'w',
          'menuiserie_ext': 'o', 'ecaille': 'g', 'garde_corps': 'r', 'porte_int': 'o', 'cloison': 'c', 'finition': 'c',
          'fermeture': 'g', 'ite': 'c', 'cvc': 'g', 'toiture': 's', 'ext': 'x', 'autre': 'g'}


def cut(T, z):
    zs = T[:, :, 2] - z
    m = (zs.min(1) < 0) & (zs.max(1) > 0)
    T, zs = T[m], zs[m]
    segs = []
    for t, q in zip(T, zs):
        pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if (q[a] > 0) != (q[b] > 0):
                k = q[a] / (q[a] - q[b])
                p = t[a] + (t[b] - t[a]) * k
                pts.append((p[0], p[1]))
        if len(pts) == 2:
            segs.append(pts)
    return segs


def chain(segs, P):
    # assemble les segments en polylignes pour alléger le SVG
    pts = [(P(a), P(b)) for a, b in segs]
    adj = defaultdict(list)
    for i, (a, b) in enumerate(pts):
        adj[a].append(i); adj[b].append(i)
    used = [False] * len(pts)
    out = []
    for i in range(len(pts)):
        if used[i]:
            continue
        used[i] = True
        a, b = pts[i]
        line = [a, b]
        for end in (1, 0):
            while True:
                tip = line[-1] if end else line[0]
                nxt = None
                for j in adj[tip]:
                    if not used[j]:
                        nxt = j
                        break
                if nxt is None:
                    break
                used[nxt] = True
                c, d = pts[nxt]
                o = d if c == tip else c
                if end:
                    line.append(o)
                else:
                    line.insert(0, o)
        out.append('M' + ' '.join('%g,%g' % p for p in line))
    return ''.join(out)


os.makedirs(os.path.join(ROOT, 'plans'), exist_ok=True)
plan_stats = {}
CONTEXT_PLANS = {'EXT': ['A1-RDC', 'A2-RDC']}
for key, idx in PLANIDX.items():
    els = [recs[i] for i in idx]
    b = BB[idx]
    x0, y0, x1, y1 = b[:, 0].min() - 2, b[:, 1].min() - 2, b[:, 3].max() + 2, b[:, 4].max() + 2
    if key.startswith('A'):
        zc = ZC['A2'] if key.startswith('A2') else ZC['A1']
        R = max(x1 - x0, y1 - y0) / 2
        x0, x1, y0, y1 = zc[0] - R, zc[0] + R, zc[1] - R, zc[1] + R
    ext = max(x1 - x0, y1 - y0)
    S = min(30.0, 2400.0 / ext)
    W, H = (x1 - x0) * S, (y1 - y0) * S

    def P(p):
        return (round((p[0] - x0) * S, 1), round((y1 - p[1]) * S, 1))
    zfloor = None
    if key.startswith('A'):
        st = key.split('-')[1]
        st = 'RDC' if st == 'RDC' else ('Toiture' if st == 'Toiture' else 'R+' + st[1:])
        zfloor = (FLOOR_A2[st] - Z0) if key.startswith('A2') else (FLOOR_A2[st] + 0.05 - Z0)
    parts = []
    order = sorted(els, key=lambda r: ['s', 'x', 'c', 'g', 'o', 'r', 'f', 'st', 'w'].index(KCLASS[r['kind']]))
    for r in order:
        g = geo_by_id.get(r['e']['id'])
        if g is None:
            continue
        T = g[1].astype(float) / 100.0
        bz0, bz1 = T[:, :, 2].min(), T[:, :, 2].max()
        zc_ = None
        if zfloor is not None and bz0 < zfloor + 1.2 < bz1:
            zc_ = zfloor + 1.2
        else:
            zc_ = (bz0 + bz1) / 2
        segs = cut(T, zc_)
        if not segs:
            continue
        parts.append('<g class="k-%s" data-id="%d" data-r="%s" data-i="%s"><path d="%s"/></g>' % (
            KCLASS[r['kind']], r['e']['id'], r['slug'], r['disp'].replace('"', ''), chain(segs, P)))
    ctx = []
    for ck in CONTEXT_PLANS.get(key, []):
        for i in PLANIDX.get(ck, []):
            r = recs[i]
            if r['kind'] not in ('voile', 'premur', 'poteau'):
                continue
            g = geo_by_id.get(r['e']['id'])
            if g is None:
                continue
            T = g[1].astype(float) / 100.0
            segs = cut(T, (T[:, :, 2].min() + T[:, :, 2].max()) / 2)
            if segs:
                ctx.append(chain(segs, P))
    zl = ZONES[els[0]['zone'] if els[0]['zone'] != 'LT' else 'A1']['label']
    title = 'Plan %s — %s' % (zl, storey_label(els[0]['zone'], els[0]['storey']).lower()) if key not in ('PARK', 'FOND', 'EXT') else 'Plan — %s' % ZONES[key]['label']
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" data-scale="%g" role="img" aria-label="%s">' % (round(W), round(H), S, title),
           '<title>%s</title>' % title,
           '<desc>Coupe horizontale générée depuis la maquette Revit MQT-FONTBELLEAU-G4 (1,20 m au-dessus du plancher pour les tours, mi-hauteur de chaque élément sinon). Nord du projet vers le haut.</desc>']
    if ctx:
        svg.append('<path class="pl-ctx" d="%s"/>' % ''.join(ctx))
    svg.append('<g class="pl-els">' + ''.join(parts) + '</g>')
    svg.append('<g class="pl-north" transform="translate(%d,70)"><path d="M0,-34 L12,12 L0,4 L-12,12 Z"/><text y="34" text-anchor="middle">N</text></g>' % (round(W) - 60))
    sb = 5 if S >= 15 else (10 if S >= 6 else 20)
    svg.append('<g class="pl-scale" transform="translate(40,%d)"><path d="M0,0 H%g M0,-6 V6 M%g,-6 V6"/><text x="%g" y="-12" text-anchor="middle">%d m</text></g>' % (round(H) - 40, sb * S, sb * S, sb * S / 2, sb))
    svg.append('</svg>')
    txt = '\n'.join(svg)
    open(os.path.join(ROOT, 'plans', key + '.svg'), 'w', encoding='utf-8').write(txt)
    plan_stats[key] = (len(parts), len(txt))

# ------------------------------------------------------------------ audit
ifc = Counter(r['e'].get('ifc') for r in recs)
lines = ['# Audit des ouvrages de la maquette (%s)' % TODAY.strftime('%d/%m/%Y'), '',
         'Source : export Revit de MQT-FONTBELLEAU-G4 (%d éléments lus, %d passeports créés).' % (len(E), len(recs)), '',
         '## Répartition', '', '| Zone | Passeports |', '|---|---|']
for z in ZONES:
    lines.append('| %s | %d |' % (ZONES[z]['label'], sum(1 for r in recs if r['zone'] == z)))
lines += ['', '## Éléments écartés', '']
for e, why in skipped:
    lines.append('- Revit %d (%s, %s) : %s' % (e['id'], e['cat'], e.get('ws'), why))
lines += ['', '## Identifiants en double', '']
for s, lst in sorted(dups.items()):
    lines.append('- « %s » : %d éléments (Revit %s) → passeports %s' % (lst[0]['e'].get('ident'), len(lst), ', '.join(str(x['e']['id']) for x in lst), ', '.join(x['slug'] for x in lst)))
lines += ['', '## Identifiant et sous-projet incohérents', '']
for r in recs:
    it = (r['e'].get('ident') or '').split()
    if it and it[0] in ('A1', 'A2') and it[0] != ('A1' if r['zone'] == 'LT' else r['zone']):
        lines.append('- « %s » (Revit %d) dans le sous-projet « %s »' % (r['e']['ident'], r['e']['id'], r['e']['ws']))
lines += ['', '## Éléments sans identifiant', '']
for r in recs:
    if not r['e'].get('ident'):
        lines.append('- Revit %d (%s, %s, %s) → %s' % (r['e']['id'], r['e']['cat'], r['e'].get('type'), r['e']['ws'], r['slug']))
lines += ['', '## Éléments sans préfixe de tour', '',
          '%d éléments de la tour A1 ont un identifiant sans préfixe ; le passeport ajoute « A1 ».' % sum(1 for r in recs if r.get('prefixed') and r['zone'] == 'A1'),
          '%d éléments de la tour A2 (extracteurs de la VMC hybride, « VHY-EXT-… ») ont un identifiant sans préfixe ; le passeport ajoute « A2 ».' % sum(1 for r in recs if r.get('prefixed') and r['zone'] == 'A2'), '',
          '## IfcGUID en double', '']
for g, n in ifc.items():
    if n > 1:
        lines.append('- %s : %s' % (g, ', '.join('%s (Revit %d)' % (r['disp'], r['e']['id']) for r in recs if r['e'].get('ifc') == g)))
lines += ['', '## Éléments sans géométrie 3D exportable', '']
for eid, why in man.get('skipped', []):
    rr = BYID.get(eid)
    lines.append('- Revit %d %s : %s' % (eid, '(' + rr['disp'] + ')' if rr else '', why))
open(os.path.join(ROOT, 'docs', 'AUDIT_OUVRAGES.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')

print('passeports', len(recs), 'écartés', len(skipped), 'doublons', sum(len(v) for v in dups.values()))
print('statuts', Counter(x[6] for x in index))
print('plans', {k: v for k, v in sorted(plan_stats.items())})
print('model', len(raw), os.path.getsize(os.path.join(ROOT, 'model', 'site.bin.gz')), os.path.getsize(os.path.join(ROOT, 'model', 'site.json')))
