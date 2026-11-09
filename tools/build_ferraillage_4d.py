# Étape complémentaire, après tools/build_passeports.py (et après le générateur du jumeau, qui écrit dans data/o/) :
#   python tools/build_ferraillage_4d.py <ouvrages.json exporté de Revit>
# 1. Ferraillage d'exemple FICTIF pour chaque ouvrage en béton armé, dimensionné d'après la maquette
#    (bloc « ferraillage » de data/o/<REF>.json). Ce n'est pas un calcul de structure : les règles ci-dessous
#    sont des dispositions courantes choisies pour la démonstration, toujours affichées « Exemple fictif ».
# 2. Dates de passage de chaque statut (4D), ajoutées à data/index.json (colonne « dates », jours depuis le 01/01/2026).
import json, os, re, sys, math, glob, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/work/export/ouvrages.json'
E = {e['id']: e for e in json.load(open(SRC, encoding='utf-8'))['elements']}
KG = {6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888, 14: 1.208, 16: 1.578, 20: 2.466}
C = 0.03  # enrobage retenu pour l'exemple (m)
EPOCH = dt.date(2026, 1, 1)
STATUS_ORDER = ['commande', 'fabrication', 'pret', 'livre', 'attente_pose', 'pose_en_cours', 'pose', 'receptionne']


def bar(rep, d, nb, lg, role, esp=None, forme='droite', vue='elevation', dir=None):
    return {'rep': rep, 'd': d, 'nb': int(nb), 'l': round(lg, 2), 'role': role, 'esp': esp, 'forme': forme, 'vue': vue, 'dir': dir,
            'kg': round(nb * lg * KG[d], 1)}


def n_esp(length, e):
    return max(2, int(math.floor(max(0.0, length - 2 * C) / e)) + 1)


def sec_from_type(t):
    m = re.search(r'(\d+)\s*x\s*(\d+)', t or '')
    if m:
        return int(m.group(1)) / 100, int(m.group(2)) / 100, None
    m = re.search(r'Ø\s*(\d+)', t or '')
    if m:
        return None, None, int(m.group(1)) / 100
    return None, None, None


def ferraillage(rec, e):
    fam = rec.get('famille')
    bb = [v / 100 for v in e['bb']]
    dx, dy, h = bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]
    d = e.get('dim', {})
    t = e.get('type') or ''
    vol = d.get('volume') or dx * dy * h
    code = (e.get('ident') or '').split()
    code = code[1] if code and code[0] in ('A1', 'A2') and len(code) > 1 else (code[0] if code else '')
    out = None
    if d.get('volume') is not None and d['volume'] < 0.02:
        return None   # résidu de modélisation (volume quasi nul) : pas d'exemple
    if fam == 'dalle' and not d.get('epaisseur'):
        return None   # forme libre sans épaisseur renseignée (rampe) : pas d'exemple
    if fam in ('voile', 'premur') or (fam == 'fondation' and e['cat'] == 'Murs'):
        L = d.get('longueur') or max(dx, dy)
        H = d.get('hauteur') or h
        ep = d.get('epaisseur') or min(dx, dy)
        if fam == 'premur' and ep >= 0.16:
            peau = 0.06
            bars = [bar('1', 8, 2 * n_esp(L, 0.15), H - 2 * C, 'Treillis des peaux, barres verticales (2 peaux)', 0.15, vue='elevation', dir='v'),
                    bar('2', 8, 2 * n_esp(H, 0.15), L - 2 * C, 'Treillis des peaux, barres horizontales (2 peaux)', 0.15, vue='elevation', dir='h'),
                    bar('3', 8, n_esp(L, 0.625), H - 2 * C, 'Raidisseurs en treillis entre les peaux', 0.625, forme='raidisseur', vue='elevation', dir='v'),
                    bar('4', 10, n_esp(L, 0.20), H + 0.50, 'Aciers de couture en attente, coulés avec le béton de remplissage', 0.20, forme='attente', vue='coupe')]
            out = {'type': 'premur', 'L': L, 'H': H, 'ep': ep, 'peau': peau, 'bars': bars,
                   'note': 'Prémur à deux peaux de 6 cm reliées par des raidisseurs ; noyau coulé sur place.'}
        else:
            two = ep >= 0.16
            k = 2 if two else 1
            bars = [bar('1', 10, k * n_esp(L, 0.20), H + 0.40, 'Barres verticales%s' % (', 2 faces' if two else ''), 0.20, forme='attente', dir='v'),
                    bar('2', 8, k * n_esp(H, 0.20), L - 2 * C, 'Barres horizontales%s' % (', 2 faces' if two else ''), 0.20, dir='h'),
                    bar('3', 12, 4, H + 0.40, 'Chaînages verticaux aux extrémités (2 × 2 HA12)', forme='attente', dir='v'),
                    bar('4', 12, 4 if two else 2, L - 2 * C, 'Chaînage horizontal en tête', dir='h')]
            if two:
                bars.append(bar('5', 6, max(4, int(round(L * H * 4))), ep - 2 * C + 0.10, 'Épingles de liaison (4 par m²)', forme='epingle', vue='coupe'))
            out = {'type': 'voile' if fam != 'premur' else 'premur_mince', 'L': L, 'H': H, 'ep': ep, 'bars': bars,
                   'note': ('Voile ' if fam != 'premur' else 'Prémur mince, ') + ('ferraillé sur deux faces.' if two else 'ferraillé en une nappe centrale.')}
    elif fam == 'poteau':
        b, hh, D = sec_from_type(t)
        H = d.get('longueur_inst') or d.get('longueur') or h
        if D:
            nl = 6 if D <= 0.45 else 10
            bars = [bar('1', 16, nl, H + 0.60, 'Barres longitudinales', forme='attente', dir='v'),
                    bar('2', 8, n_esp(H, 0.15), math.pi * (D - 2 * C), 'Cerces', 0.15, forme='cerce', dir='h')]
            out = {'type': 'poteau_rond', 'D': D, 'H': H, 'bars': bars, 'note': 'Poteau circulaire.'}
        else:
            b = b or min(dx, dy); hh = hh or max(dx, dy)
            big = max(b, hh)
            nl, dl = (4, 16) if big <= 0.40 else ((8, 14) if big <= 0.75 else (12, 14))
            bars = [bar('1', dl, nl, H + 0.60, 'Barres longitudinales', forme='attente', dir='v'),
                    bar('2', 8, n_esp(H, 0.15), 2 * (b + hh - 4 * C) + 0.20, 'Cadres', 0.15, forme='cadre', dir='h')]
            if big > 0.75:
                bars.append(bar('3', 8, n_esp(H, 0.15), b - 2 * C + 0.20, 'Épingles intermédiaires', 0.15, forme='epingle', dir='h'))
            out = {'type': 'poteau', 'b': b, 'h': hh, 'H': H, 'bars': bars, 'note': 'Poteau rectangulaire.'}
    elif fam == 'poutre' or (fam == 'fondation' and code in ('LG',)):
        b, hh, _ = sec_from_type(t)
        if fam == 'fondation':
            b, hh = min(dx, dy), h
        b = b or min(dx, dy); hh = hh or h
        L = d.get('longueur') or d.get('longueur_coupe') or max(dx, dy)
        ninf = 3 if b <= 0.30 else (4 if b <= 0.60 else 6)
        dinf = 16 if hh <= 0.75 else 20
        bars = [bar('1', dinf, ninf, L + 0.40, 'Barres inférieures', forme='crosse', dir='h'),
                bar('2', 12, 2 if b <= 0.40 else 3, L + 0.40, 'Barres supérieures', forme='crosse', dir='h'),
                bar('3', 8, n_esp(L, 0.20), 2 * (b + hh - 4 * C) + 0.20, 'Cadres', 0.20, forme='cadre', dir='v')]
        if hh >= 0.70:
            bars.append(bar('4', 10, 2 * max(1, int(hh / 0.35) - 1), L - 2 * C, 'Aciers de peau', dir='h'))
        out = {'type': 'poutre', 'b': b, 'h': hh, 'L': L, 'bars': bars,
               'note': 'Longrine de fondation.' if fam == 'fondation' else 'Poutre ou linteau.'}
    elif fam == 'fondation' and code == 'PIEUX':
        A = d.get('surface')
        D = math.sqrt(4 * A / math.pi) if A else min(dx, dy)
        L = d.get('epaisseur') or h
        nl = 6 if D < 0.5 else 8
        bars = [bar('1', 16, nl, L + 0.80, 'Barres longitudinales de la cage', forme='attente', dir='v'),
                bar('2', 8, 1, (L / 0.20) * math.pi * (D - 2 * 0.07), 'Spire continue, pas de 20 cm', 0.20, forme='spire', dir='h')]
        out = {'type': 'pieu', 'D': D, 'H': L, 'bars': bars, 'note': 'Cage d\'armature de pieu foré, enrobage de 7 cm.'}
    elif fam == 'fondation' or fam == 'dalle':
        ep = d.get('epaisseur') or h
        S = d.get('surface') or dx * dy
        A, B = max(dx, dy), min(dx, dy)
        ratio = min(1.0, S / max(1e-6, dx * dy))
        massif = fam == 'fondation'
        d1, e1, d2, e2 = (16, 0.15, 12, 0.20) if massif else (10, 0.15, 8, 0.20)
        bars = [bar('1', d1, n_esp(B, e1) * ratio, A - 2 * C, 'Nappe inférieure, sens long', e1, vue='plan', dir='x'),
                bar('2', d1, n_esp(A, e1) * ratio, B - 2 * C, 'Nappe inférieure, sens court', e1, vue='plan', dir='y'),
                bar('3', d2, n_esp(B, e2) * ratio, A - 2 * C, 'Nappe supérieure, sens long', e2, vue='plan', dir='x'),
                bar('4', d2, n_esp(A, e2) * ratio, B - 2 * C, 'Nappe supérieure, sens court', e2, vue='plan', dir='y')]
        if massif:
            bars.append(bar('5', 10, max(4, int(2 * (A + B) / 0.20)), ep - 2 * C + 0.40, 'Cadres de rive', 0.20, forme='cadre', vue='coupe'))
        out = {'type': 'massif' if massif else 'dalle', 'A': A, 'B': B, 'ep': ep, 'S': S, 'bars': bars,
               'note': ('Massif de fondation (casque) sur pieux.' if massif else 'Dalle pleine ; emprise simplifiée en rectangle, quantités ramenées à la surface réelle.')}
    if not out:
        return None
    for k in ('L', 'H', 'ep', 'b', 'h', 'D', 'A', 'B', 'S', 'peau'):
        if k in out and out[k] is not None:
            out[k] = round(out[k], 3)
    tot = round(sum(b_['kg'] for b_ in out['bars']), 1)
    if vol and not 20 <= tot / vol <= 300:
        return None   # dimensions incohérentes : pas d'exemple plutôt qu'un exemple absurde
    out.update({'poids_kg': tot, 'volume_m3': round(vol, 3), 'ratio_kg_m3': round(tot / vol) if vol else None,
                'enrobage_cm': 7 if out['type'] == 'pieu' else 3, 'acier': 'B500B', 'beton': (e.get('mat_struct') or None),
                'fiab': 'fictif', 'avertissement': "Exemple fictif généré pour la démonstration à partir des dimensions de la maquette. "
                                                    "Ce n'est pas un plan d'exécution : aucun calcul de structure n'a été fait."})
    return out


def status_dates(rec):
    js = (rec.get('planning') or {}).get('jalons') or []
    best = {}
    for j in js:
        st = j.get('statut')
        dte = j.get('reelle') or j.get('previsionnelle')
        if st in STATUS_ORDER and dte:
            n = (dt.date.fromisoformat(dte) - EPOCH).days
            best[st] = min(best.get(st, n), n)
    return [best.get(s) for s in STATUS_ORDER]


ix = json.load(open(os.path.join(ROOT, 'data', 'index.json'), encoding='utf-8'))
cols = ix['colonnes']
if 'dates' not in cols:
    cols.append('dates')
iref = cols.index('ref')
nf = 0
for row in ix['ouvrages']:
    p = os.path.join(ROOT, 'data', 'o', row[iref] + '.json')
    rec = json.load(open(p, encoding='utf-8'))
    dts = status_dates(rec)
    if len(row) < len(cols):
        row.append(dts)
    else:
        row[cols.index('dates')] = dts
    e = E.get(row[cols.index('revit')])
    f = ferraillage(rec, e) if e and e.get('bb') else None
    if f or 'ferraillage' in rec:
        if f:
            rec['ferraillage'] = f
            nf += 1
        else:
            rec.pop('ferraillage', None)
        json.dump(rec, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
ix['statuts_4d'] = STATUS_ORDER
ix['epoque_4d'] = EPOCH.isoformat()
ix['nb_ferraillage'] = nf
json.dump(ix, open(os.path.join(ROOT, 'data', 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('ferraillages', nf, 'ouvrages', len(ix['ouvrages']))
