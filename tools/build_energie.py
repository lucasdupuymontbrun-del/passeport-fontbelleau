#!/usr/bin/env python3
"""Jumeau énergétique du Domaine de Fontbelleau : génère data/energie/.

Ce que fait le script :
1. Retrouve les 129 logements dans la maquette (model/site.json + site.bin) : chaque étage courant des tours est découpé
   en 9 « modules » de 40° par les voiles séparatifs radiaux ; les logements sont reconstitués à partir de ces voiles et
   du tableau des surfaces ind. A (typologies et SHAB par étage).
2. Rattache les ouvrages de la maquette (menuiseries, voiles de façade, balcons…) à leur logement.
3. Simule la première année d'exploitation (1er octobre 2027 → 30 septembre 2028) : consommations journalières de
   chaque logement relevées par son module thermique d'appartement (chauffage, eau chaude sanitaire, eau froide)
   et son compteur électrique, comptage de la sous-station, services généraux, production solaire (tour A2).
   Les anomalies du scénario sont injectées ici ; les alertes, elles, sont trouvées par des règles de détection
   appliquées aux données, comme le ferait la plateforme réelle.
4. Écrit les données du jumeau (logements, séries, alertes, hypothèses) et le volet « Énergie » de chaque fiche.

Tout ce qui est mesuré dans ce scénario est FICTIF. Les caractéristiques des ouvrages (U, R, typologies, surfaces,
équipements) viennent du DCE ou de la maquette, avec leur source.

Utilisation : python tools/build_energie.py   (depuis la racine du dépôt, Python 3.8+, aucune dépendance)
"""
import array
import datetime as dt
import json
import math
import os
import random
import statistics as stx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'energie')
SEED = 20271001

START = dt.date(2027, 10, 1)
NDAYS = 366  # 1er oct. 2027 → 30 sept. 2028 (année bissextile)
DAYS = [START + dt.timedelta(days=i) for i in range(NDAYS)]
LIVRAISON = dt.date(2027, 9, 24)

# ------------------------------------------------------------------ données du DCE
# Tableau des surfaces ind. A (12/03/2021) : typologies par étage et surfaces par type
TYPO = {
    'A1': {1: (3, 2, 2, 0), 2: (6, 1, 1, 0), 3: (3, 0, 4, 0), 4: (6, 1, 1, 0), 5: (3, 1, 3, 0),
           6: (9, 0, 0, 0), 7: (6, 1, 1, 0), 8: (9, 0, 0, 0), 9: (5, 0, 0, 2)},
    'A2': {1: (3, 2, 2, 0), 2: (3, 2, 2, 0), 3: (3, 1, 3, 0), 4: (3, 1, 3, 0), 5: (3, 1, 3, 0),
           6: (2, 1, 1, 2), 7: (2, 1, 1, 2), 8: (2, 1, 1, 2), 9: (2, 1, 1, 2)},
}
SHAB = {'A1': {'T2': 43.6, 'T3A': 65.86, 'T3B': 65.73, 'T4': 87.51},
        'A2': {'T2': 43.6, 'T3A': 66.0, 'T3B': 66.0, 'T4': 88.2}}
EXT = {'A2': {'T2': 3.6, 'T3A': 6.2, 'T3B': 6.2, 'T4': 11.35}}
PLAN = {'A1': {1: 'plan courant B', 2: 'plan courant A', 3: 'plan courant B', 4: 'plan courant A', 5: 'plan courant B',
               6: 'plan C', 7: 'plan D', 8: 'plan E', 9: 'plan F'},
        'A2': {1: 'plan courant A1', 2: 'plan courant B1', 3: 'plan courant', 4: 'plan courant', 5: 'plan courant',
               6: 'plan courant C1', 7: 'plan courant D1', 8: 'plan courant', 9: 'plan courant'}}
TOWER = {'A1': 'Tour A1 — COGEDIM', 'A2': 'Tour A2 — CDC Habitat'}
# Angle (repère maquette, degrés, sens trigonométrique) contenu dans le logement n°1 de chaque étage :
# A2 d'après les portes « A2 PO R5-L1 » de la maquette ; A1 d'après le logement témoin A1.31.
REF_ANGLE = {'A1': 327.0, 'A2': 21.0}
GRID = [0.5, 40.3, 80.0, 119.8, 159.8, 199.9, 240.2, 280.4, 320.6]  # voiles séparatifs radiaux (module de 40°)
R_IN, R_OUT = 5.40, 12.70  # rayon intérieur (circulation) et nu intérieur de la façade, m
STOREY = 2.79

# ------------------------------------------------------------------ lecture de la maquette


def load_model():
    man = json.load(open(os.path.join(ROOT, 'model', 'site.json'), encoding='utf-8'))
    raw = open(os.path.join(ROOT, 'model', 'site.bin'), 'rb').read()
    idx = json.load(open(os.path.join(ROOT, 'data', 'index.json'), encoding='utf-8'))
    meta = {r[0]: dict(zip(idx['colonnes'], r)) for r in idx['ouvrages']}
    els = []
    for g in man['groups']:
        a = array.array('h')
        a.frombytes(raw[g['byteOffset']:g['byteOffset'] + g['byteLength']])
        for rid, s, n, ident, ref in g['elements']:
            pts = [(a[k] / 100, a[k + 1] / 100, a[k + 2] / 100) for k in range(s * 9, (s + n) * 9, 3)]
            els.append({'group': g['name'], 'id': rid, 'ident': ident, 'ref': ref, 'pts': pts, 'meta': meta.get(ref, {})})
    return els


def tower_center(els, zone):
    xs, ys = [], []
    for e in els:
        m = e['meta']
        if m.get('zone') == zone and m.get('famille') == 'dalle' and 'haute' in m.get('designation', '').lower():
            xs += [p[0] for p in e['pts']]
            ys += [p[1] for p in e['pts']]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def ang(c, x, y):
    return math.degrees(math.atan2(y - c[1], x - c[0])) % 360


def radial_walls(els, zone, etage, c):
    """Angles des voiles séparatifs radiaux (de la circulation à la façade) d'un étage."""
    out = []
    for e in els:
        m = e['meta']
        if m.get('zone') != zone or m.get('etage') != etage or m.get('famille') not in ('voile', 'premur'):
            continue
        P = e['pts']
        mx = sum(p[0] for p in P) / len(P)
        my = sum(p[1] for p in P) / len(P)
        sxx = sum((p[0] - mx) ** 2 for p in P)
        syy = sum((p[1] - my) ** 2 for p in P)
        sxy = sum((p[0] - mx) * (p[1] - my) for p in P)
        th = 0.5 * math.atan2(2 * sxy, sxx - syy)
        d = (math.cos(th), math.sin(th))
        proj = [(p[0] - mx) * d[0] + (p[1] - my) * d[1] for p in P]
        L = max(proj) - min(proj)
        if L < 3:
            continue
        rad = (mx - c[0], my - c[1])
        nr = math.hypot(*rad)
        if nr == 0:
            continue
        cos = abs((d[0] * rad[0] + d[1] * rad[1]) / nr)
        far = max(math.hypot(p[0] - c[0], p[1] - c[1]) for p in P)
        if cos > 0.93 and far > 12.0:
            out.append(ang(c, mx + d[0] * (max(proj) if abs(max(proj)) > abs(min(proj)) else min(proj)),
                           my + d[1] * (max(proj) if abs(max(proj)) > abs(min(proj)) else min(proj))))
    return sorted(out)


def snap(a):
    best = min(range(9), key=lambda i: min(abs(a - GRID[i]), 360 - abs(a - GRID[i])))
    return best


def floor_layout(zone, n, walls):
    """Découpe d'un étage en logements : liste de (angle début, angle fin, type)."""
    t2, t3a, t3b, t4 = TYPO[zone][n]
    idx = sorted(set(snap(a) for a in walls))
    if not idx:
        raise SystemExit(f'{zone} R+{n} : aucun voile séparatif trouvé')
    spans = []  # (index module début, nombre de modules)
    for k, i in enumerate(idx):
        j = idx[(k + 1) % len(idx)]
        m = (j - i) % 9 or 9
        spans.append((i, m))
    need = {'T2': t2, 'T3': t3a + t3b, 'T4': t4}
    # cas du plan D de la tour A1 : tous les voiles sont présents mais l'étage compte 2 T3 (comme le plan A)
    if need['T3'] and not any(m == 3 for _, m in spans):
        spans = [s for s in spans if s[0] not in (3, 4, 5)] + [(3, 3)]
        spans.sort()
    secs = []
    for i, m in spans:
        a0 = GRID[i]
        a1 = GRID[(i + m) % 9] + (360 if (i + m) >= 9 else 0)
        if m == 1:
            secs.append((a0, a1, 'T2'))
        elif m == 2:
            if need['T4'] > 0:
                secs.append((a0, a1, 'T4')); need['T4'] -= 1
            else:
                mid = (a0 + a1) / 2
                secs += [(a0, mid, 'T2'), (mid, a1, 'T2')]
        elif m == 3:
            mid = a0 + (a1 - a0) / 2
            secs += [(a0, mid, 'T3'), (mid, a1, 'T3')]
        else:
            step = (a1 - a0) / m
            secs += [(a0 + k * step, a0 + (k + 1) * step, 'T2') for k in range(m)]
    got = {'T2': sum(s[2] == 'T2' for s in secs), 'T3': sum(s[2] == 'T3' for s in secs), 'T4': sum(s[2] == 'T4' for s in secs)}
    want = {'T2': t2, 'T3': t3a + t3b, 'T4': t4}
    if got != want:
        raise SystemExit(f'{zone} R+{n} : découpage {got} différent du tableau des surfaces {want}')
    return [(a0 % 360, a1 % 360 if a1 % 360 > a0 % 360 else a1 % 360 + 360, t) for a0, a1, t in secs]


def in_sector(a, a0, a1):
    a = a % 360
    if a1 > 360:
        return a >= a0 or a < a1 - 360
    return a0 <= a < a1


ORIENT = ['E', 'NE', 'N', 'NO', 'O', 'SO', 'S', 'SE']


def orient_label(theta):
    return ORIENT[int(((theta % 360) + 22.5) // 45) % 8]


def build_logements(els):
    centers = {z: tower_center(els, z) for z in ('A1', 'A2')}
    logs = []
    for zone in ('A1', 'A2'):
        c = centers[zone]
        for n in range(1, 10):
            walls = radial_walls(els, zone, f'R+{n}', c)
            secs = floor_layout(zone, n, walls)
            # numérotation : le logement qui contient l'angle de référence est le n°1, puis sens trigonométrique
            secs.sort(key=lambda s: s[0])
            first = next(i for i, s in enumerate(secs) if in_sector(REF_ANGLE[zone], s[0], s[1]))
            secs = secs[first:] + secs[:first]
            t3a = TYPO[zone][n][1]
            k3 = 0
            for num, (a0, a1, t) in enumerate(secs, 1):
                if t == 'T3':
                    t = 'T3A' if k3 < t3a else 'T3B'
                    k3 += 1
                mid = ((a0 + a1) / 2) % 360
                lid = f'{zone}.{n}{num}'
                logs.append({
                    'id': lid, 'tour': zone, 'etage': n, 'num': num, 'typo': t, 'shab': SHAB[zone][t],
                    'ext': EXT.get(zone, {}).get(t), 'a0': round(a0, 2), 'a1': round(a1, 2), 'mid': round(mid, 1),
                    'orient': orient_label(mid), 'plan': PLAN[zone][n],
                })
    # contrôle des totaux du tableau des surfaces
    for zone, total in (('A1', 3538.94), ('A2', 3556.4)):
        s = sum(l['shab'] for l in logs if l['tour'] == zone)
        assert abs(s - total) < 0.05, (zone, s)
    return logs, centers


# ------------------------------------------------------------------ rattachement des ouvrages aux logements

def elem_info(e, c):
    xs = [p[0] for p in e['pts']]; ys = [p[1] for p in e['pts']]; zs = [p[2] for p in e['pts']]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    rr = [math.hypot(p[0] - c[0], p[1] - c[1]) for p in e['pts']]
    return {'a': ang(c, cx, cy), 'r': math.hypot(cx - c[0], cy - c[1]), 'rmin': min(rr), 'rmax': max(rr), 'zmin': min(zs), 'zmax': max(zs)}


def profile_of(e, info, zone):
    m = e['meta']
    f = m.get('famille'); d = m.get('designation', '')
    et = m.get('etage', '')
    dl = d.lower()
    if zone in ('FOND',):
        return 'fondation_var' if 'bas carbone' in dl else 'hors_volume'
    if zone in ('PARK',):
        return 'parking_ph' if f == 'dalle' and 'haute' in dl else 'hors_volume'
    if zone == 'EXT':
        return 'hors_volume'
    if zone == 'LT':
        if 'doublage' in dl:
            return 'lt_doublage'
        if f == 'fermeture':
            return 'fermeture'
        return 'interieur'
    # tours
    if f == 'ite':
        return 'ite_A2'
    if f == 'toiture':
        return 'toiture_A2'
    if f == 'cvc':
        return 'cta' if 'cta' in dl else 'capteur'
    if f == 'menuiserie_ext':
        if 'mur-rideau' in dl or 'porte d' in dl:
            return 'hall'
        return 'menuiserie_' + zone
    if f in ('voile', 'premur'):
        if info['rmax'] > 12.6 and info['rmin'] > 11.5:
            return 'facade_' + zone if et not in ('RDC',) else 'facade_rdc'
        if info['rmin'] < 5.7:
            return 'noyau'
        return 'separatif'
    if f == 'dalle':
        if 'balcon' in dl:
            return 'balcon'
        if et == 'RDC':
            return 'plancher_bas'
        if et == 'R+9':
            return 'toiture_' + zone
        return 'plancher_inter'
    if f == 'ecaille':
        return 'ecaille'
    if f == 'garde_corps':
        return 'garde_corps'
    return 'interieur'


def map_ouvrages(els, logs, centers):
    by = {}
    for l in logs:
        by.setdefault((l['tour'], l['etage']), []).append(l)
    out = {}
    for e in els:
        m = e['meta']
        ref = m.get('ref')
        if not ref:
            continue
        zone = m.get('zone')
        c = centers['A2' if zone == 'A2' else 'A1']
        info = elem_info(e, c) if zone in ('A1', 'A2', 'LT') else None
        prof = profile_of(e, info or {'rmax': 0, 'rmin': 0}, zone)
        rec = {'p': prof}
        et = m.get('etage', '')
        if zone == 'LT':
            rec['l'] = ['A1.31']
        elif zone in ('A1', 'A2') and et.startswith('R+') and info and info['r'] > 5.6:
            n = int(et[2:])
            cand = by.get((zone, n), [])
            if prof == 'separatif':
                near = [l['id'] for l in cand if in_sector(info['a'] + 3, l['a0'], l['a1']) or in_sector(info['a'] - 3, l['a0'], l['a1'])]
                if near:
                    rec['l'] = sorted(set(near))
            else:
                hit = [l['id'] for l in cand if in_sector(info['a'], l['a0'], l['a1'])]
                if hit:
                    rec['l'] = hit[:1]
        out[ref] = rec
    return out


# ------------------------------------------------------------------ scénario d'exploitation (fictif)
# Moyennes mensuelles de température retenues pour Bordeaux (ordre de grandeur des normales), °C
TNORM = {1: 7.1, 2: 7.7, 3: 10.4, 4: 12.8, 5: 16.3, 6: 19.6, 7: 21.6, 8: 21.7, 9: 18.6, 10: 14.9, 11: 10.2, 12: 7.6}
# Ensoleillement quotidien moyen sur capteur incliné à 30° plein sud, kWh/m².j (ordre de grandeur, Bordeaux)
SNORM = {1: 2.3, 2: 3.2, 3: 4.3, 4: 5.0, 5: 5.4, 6: 5.8, 7: 6.0, 8: 5.7, 9: 5.0, 10: 3.8, 11: 2.6, 12: 2.1}


def interp_month(tab, d):
    # interpolation linéaire entre milieux de mois
    mid = dt.date(d.year, d.month, 15)
    if d >= mid:
        nm = d.month % 12 + 1
        ny = d.year + (1 if d.month == 12 else 0)
        nxt = dt.date(ny, nm, 15)
        t = (d - mid).days / (nxt - mid).days
        return tab[d.month] * (1 - t) + tab[nm] * t
    pm = (d.month - 2) % 12 + 1
    py = d.year - (1 if d.month == 1 else 0)
    prv = dt.date(py, pm, 15)
    t = (d - prv).days / (mid - prv).days
    return tab[pm] * (1 - t) + tab[d.month] * t


def weather(rng):
    T, S = [], []
    e = 0.0; c = 0.0
    for d in DAYS:
        e = 0.78 * e + rng.gauss(0, 1.7)
        bump = 0.0
        # vague de froid du 17 au 25 janvier 2028, épisode chaud du 31 juillet au 7 août 2028
        k = (d - dt.date(2028, 1, 21)).days
        if abs(k) <= 4:
            bump -= 6.5 * math.cos(k / 4 * math.pi / 2)
        k = (d - dt.date(2028, 8, 3)).days
        if abs(k) <= 4:
            bump += 5.5 * math.cos(k / 4 * math.pi / 2)
        T.append(round(interp_month(TNORM, d) + e + bump, 1))
        c = 0.6 * c + rng.gauss(0, 0.35)
        f = min(1.25, max(0.25, 0.92 + c))
        S.append(round(interp_month(SNORM, d) * f, 2))
    return T, S


def lognorm(rng, s):
    return math.exp(rng.gauss(-s * s / 2, s))


OCC = {  # répartition du nombre d'occupants par typologie (hypothèse)
    'A1': {'T2': [(1, .55), (2, .45)], 'T3': [(2, .5), (3, .35), (4, .15)], 'T4': [(3, .35), (4, .45), (5, .2)]},
    'A2': {'T2': [(1, .4), (2, .5), (3, .1)], 'T3': [(2, .3), (3, .45), (4, .25)], 'T4': [(3, .2), (4, .5), (5, .3)]},
}


def pick(rng, dist):
    x = rng.random(); acc = 0
    for v, p in dist:
        acc += p
        if x <= acc:
            return v
    return dist[-1][0]


# Hypothèses de calage (fictif) : chauffage moyen au compteur des MTA, kWh/m² SHAB.an
HEAT_TARGET = {'A1': 36.0, 'A2': 25.0}
TBAL = {'A1': 16.0, 'A2': 15.0}       # température de non-chauffage
LOSS_SHARE = {'A1': 0.16, 'A2': 0.15}  # pertes de distribution (sous-station → MTA), part de l'énergie livrée aux MTA
SOLAR_M2, SOLAR_ETA = 30.0, 0.30      # capteurs de la variante A2 et rendement annuel moyen de l'installation


def simulate(logs, T, S, rng):
    hdd = {z: [max(0.0, TBAL[z] - t) for t in T] for z in TBAL}
    sun_mean = sum(S) / len(S)
    # caractéristiques des ménages (fictif)
    vacant_long = {'A1.84': dt.date(2028, 2, 1), 'A2.62': dt.date(2028, 4, 15)}
    for l in logs:
        z = l['tour']; t = l['typo'][:2]
        l['occupants'] = pick(rng, OCC[z][t])
        r = rng.random()
        if l['id'] in vacant_long:
            mv = vacant_long[l['id']]
        elif r < 0.74:
            mv = START + dt.timedelta(days=rng.randrange(0, 31))
        elif r < 0.92:
            mv = dt.date(2027, 11, 1) + dt.timedelta(days=rng.randrange(0, 30))
        else:
            mv = dt.date(2027, 12, 1) + dt.timedelta(days=rng.randrange(0, 50))
        l['emmenagement'] = mv.isoformat()
        l['behav'] = min(1.22, max(0.80, lognorm(rng, 0.12)))  # comportement (consigne, aération), borné
        l['xmas'] = rng.random() < 0.3
        l['aout'] = rng.random() < 0.55
        l['aout_start'] = dt.date(2028, 7, 25) + dt.timedelta(days=rng.randrange(0, 18))
        l['aout_len'] = rng.randrange(10, 22)
        th = math.radians(l['mid'])
        l['f_or'] = 1 + 0.10 * math.sin(th)          # nord (+), sud (−) : apports solaires
        l['south'] = (1 - math.sin(th)) / 2
        n = l['etage']
        l['f_floor'] = 1.09 if n == 1 else (1.12 if n == 9 else 0.97)
        l['f_typo'] = {'T2': 1.04, 'T3': 1.0, 'T4': 0.96}[t]

    # calage du coefficient par tour pour atteindre l'objectif moyen (sans anomalies)
    def base_heat(l, i, k):
        d = DAYS[i]
        occ = 1.0 if d >= dt.date.fromisoformat(l['emmenagement']) else 0.35
        sunf = 1 - 0.28 * l['south'] * min(1.6, S[i] / max(0.5, interp_month(SNORM, d)) ) * (1 if hdd[l['tour']][i] > 0 else 0) * 0.55
        return k * l['shab'] * l['f_or'] * l['f_floor'] * l['f_typo'] * l['behav'] * hdd[l['tour']][i] * occ * sunf

    K = {}
    for z in ('A1', 'A2'):
        L = [l for l in logs if l['tour'] == z]
        tot = sum(base_heat(l, i, 1.0) for l in L for i in range(NDAYS))
        K[z] = HEAT_TARGET[z] * sum(l['shab'] for l in L) / tot

    noise = lambda s: lognorm(rng, s)
    for l in logs:
        z = l['tour']; occ_n = l['occupants']
        mv = dt.date.fromisoformat(l['emmenagement'])
        H, E, W, P, Href = [], [], [], [], []
        for i, d in enumerate(DAYS):
            here = d >= mv
            away = 1.0
            if here and l['xmas'] and dt.date(2027, 12, 22) <= d <= dt.date(2028, 1, 1):
                away = 0.12
            if here and l['aout'] and l['aout_start'] <= d < l['aout_start'] + dt.timedelta(days=l['aout_len']):
                away = 0.06
            h = base_heat(l, i, K[z])
            href = h / l['behav']  # référence « logement comparable » (sans comportement ni anomalie)
            if away < 1:
                h *= 0.72
            h *= noise(0.07)
            doy = (d - dt.date(d.year, 1, 1)).days
            seas = 1 + 0.13 * math.cos(2 * math.pi * (doy - 20) / 366)
            wk = 1.08 if d.weekday() >= 5 else 1.0
            ecs = (occ_n * 1.95 * seas * wk * noise(0.12) * away) if here else 0.0
            water = (occ_n * 118 * (1 + 0.06 * math.sin(2 * math.pi * (doy - 100) / 366)) * wk * noise(0.12) * away) if here else 0.0
            elec_base = 2.2 + 1.45 * occ_n + 0.012 * l['shab']
            elec = (elec_base * (1 + 0.16 * math.cos(2 * math.pi * (doy - 15) / 366)) * noise(0.12) * (0.35 + 0.65 * away)) if here else 0.35
            H.append(h); E.append(ecs); W.append(water); P.append(elec); Href.append(href)
        l['_H'], l['_E'], l['_W'], l['_P'], l['_Href'] = H, E, W, P, Href

    by = {l['id']: l for l in logs}
    di = lambda y, m, d: (dt.date(y, m, d) - START).days

    # ---- anomalies injectées (scénario)
    # 1) A1.92 : surconsommation de chauffage persistante (dernier étage, nord-ouest) +38 %
    for i in range(NDAYS):
        by['A1.92']['_H'][i] *= 1.38
    # 2) A1.73 : fuite d'eau (chasse d'eau) du 8 mars au 2 avril 2028, ≈ 340 L/j
    for i in range(di(2028, 3, 8), di(2028, 4, 3)):
        by['A1.73']['_W'][i] += 340 * lognorm(rng, 0.08)
    # 3) A1.45 : fenêtre restée ouverte pendant la vague de froid, 18 → 23 janvier 2028
    for i in range(di(2028, 1, 18), di(2028, 1, 24)):
        by['A1.45']['_H'][i] = by['A1.45']['_H'][i] * 2.6 + 6
    # 4) A2.36 : module radio du compteur MTA muet du 2 au 22 février 2028 (aucune donnée)
    silent = set(range(di(2028, 2, 2), di(2028, 2, 23)))
    # 5) CTA A2 VMC 002 : encrassement des filtres, rendement de récupération en baisse du 8 janvier au 1er mars 2028
    cta_eff = []
    for i, d in enumerate(DAYS):
        base = 0.82 + rng.gauss(0, 0.008)
        if di(2028, 1, 8) <= i < di(2028, 3, 2):
            base -= 0.19 * min(1, (i - di(2028, 1, 8)) / 24)
        cta_eff.append(round(base, 3))
    # effet sur le chauffage de la tour A2 (part des logements desservis par la CTA 002 : colonnes c3, c8, c9 ≈ 1/3)
    for l in logs:
        if l['tour'] != 'A2':
            continue
        for i in range(NDAYS):
            drop = 0.82 - cta_eff[i]
            if drop > 0.03:
                l['_H'][i] *= 1 + drop * 0.35  # ≈ +6 % au pire sur la tour, réparti
                l['_Href'][i] *= 1 + drop * 0.35  # effet commun à toute la tour : présent aussi chez les logements comparables
    # 6) Sous-station A1 : by-pass thermostatique bloqué ouvert, pertes en hausse du 20 janvier au 9 avril 2028
    bypass = (di(2028, 1, 20), di(2028, 4, 10))

    # ---- sous-stations, services généraux, solaire
    towers = {}
    for z in ('A1', 'A2'):
        L = [l for l in logs if l['tour'] == z]
        mta = [sum(l['_H'][i] + l['_E'][i] for l in L) for i in range(NDAYS)]
        loss0 = LOSS_SHARE[z] * sum(mta) / NDAYS
        loss, solar, rcu, sg = [], [], [], []
        for i, d in enumerate(DAYS):
            cold = max(0.0, 12 - T[i]) / 12
            lo = loss0 * (0.92 + 0.18 * cold) * lognorm(rng, 0.04)
            if z == 'A1' and bypass[0] <= i < bypass[1]:
                lo *= 1.0 + 0.85 * min(1, (i - bypass[0]) / 6)
            sol = 0.0
            if z == 'A2':
                ecs_day = sum(l['_E'][i] for l in L)
                sol = min(SOLAR_M2 * S[i] * SOLAR_ETA * (1 + 0.15 * (T[i] - 15) / 10), 0.55 * ecs_day)
                sol = max(0.0, sol)
            loss.append(lo); solar.append(sol)
            rcu.append(mta[i] + lo - sol)
            doy = (d - dt.date(d.year, 1, 1)).days
            light = 12 * (1 + 0.3 * math.cos(2 * math.pi * (doy - 355) / 366))
            if z == 'A1':
                vent = 38 * lognorm(rng, 0.05)
            else:
                vent = 82 * lognorm(rng, 0.05) * (1 + max(0, 0.82 - cta_eff[i]) * 0.6)
            sg.append({'vent': vent, 'asc': 14 * lognorm(rng, 0.1), 'ecl': light, 'aux': 6 + (2.0 * S[i] / sun_mean if z == 'A2' else 0)})
        towers[z] = {'mta': mta, 'loss': loss, 'solar': solar, 'rcu': rcu, 'sg': sg}
    towers['_T'] = T
    return towers, cta_eff, silent, by


# ------------------------------------------------------------------ détection (règles appliquées aux données)

def rolling(a, i, n):
    lo = max(0, i - n + 1)
    return sum(a[lo:i + 1])


def detect(logs, towers, cta_eff, silent, by):
    alerts = []
    D = lambda i: DAYS[i].isoformat()
    # R1 – surconsommation de chauffage : écart > +30 % à la référence recalée sur 30 jours glissants (≥ 300 kWh de référence)
    for l in logs:
        for i in range(29, NDAYS):
            ref = rolling(l['_Href'], i, 30)
            if ref < 200:
                continue
            ecart = rolling(l['_H'], i, 30) / ref - 1
            if ecart > 0.30:
                fin = None
                for j in range(i + 1, NDAYS):
                    r2 = rolling(l['_Href'], j, 30)
                    if r2 >= 200 and rolling(l['_H'], j, 30) / r2 - 1 < 0.15:
                        fin = j; break
                kind = 'episode' if (fin is not None and fin - i < 45) else 'chronique'
                alerts.append({'id': f'CH-{l["id"]}', 'regle': 'R1', 'cible': l['id'], 'type': 'chauffage', 'nature': kind,
                               'debut': D(i), 'fin': D(fin) if fin else None, 'ecart': round(ecart, 2)})
                break
    # R2 – fuite d'eau : volume journalier > 1,8 × médiane des 60 jours précédents pendant 5 jours de suite
    for l in logs:
        run = 0
        i0 = (dt.date.fromisoformat(l['emmenagement']) - START).days + 60
        for i in range(max(60, i0), NDAYS):
            win = [x for x in l['_W'][i - 60:i] if x > 20]  # jours de présence seulement
            if len(win) < 30:
                run = 0
                continue
            med = stx.median(win)
            if med > 50 and l['_W'][i] > 1.8 * med:
                run += 1
                if run == 5:
                    s = i - 4
                    fin = next((j for j in range(i, NDAYS) if l['_W'][j] < 1.3 * med), None)
                    extra = sum(l['_W'][k] - med for k in range(s, fin or NDAYS))
                    alerts.append({'id': f'EA-{l["id"]}', 'regle': 'R2', 'cible': l['id'], 'type': 'eau', 'nature': 'fuite',
                                   'debut': D(s), 'fin': D(fin) if fin else None, 'volume_l': round(extra)})
                    break
            else:
                run = 0
    # R3 – compteur muet : aucune donnée pendant plus de 3 jours
    l = by['A2.36']
    s = min(silent); f = max(silent) + 1
    alerts.append({'id': 'CP-A2.36', 'regle': 'R3', 'cible': 'A2.36', 'type': 'donnees', 'nature': 'compteur',
                   'debut': D(s + 3), 'fin': D(f), 'jours': len(silent)})
    # R4 – pertes de distribution : (sous-station − Σ MTA) supérieures de 25 % au modèle appris sur le premier trimestre
    #      (pertes = a + b × max(0, 12 − T)), sur 14 jours glissants
    for z in ('A1', 'A2'):
        tw = towers[z]
        X = [max(0.0, 12 - t) / 12 for t in towers['_T'][:92]]
        Y = tw['loss'][:92]
        mx, my = sum(X) / len(X), sum(Y) / len(Y)
        b = sum((x - mx) * (y - my) for x, y in zip(X, Y)) / max(1e-9, sum((x - mx) ** 2 for x in X))
        a0 = my - b * mx
        exp = [a0 + b * max(0.0, 12 - t) / 12 for t in towers['_T']]
        tw['loss_exp'] = exp
        for i in range(92, NDAYS):
            ratio = rolling(tw['loss'], i, 14) / rolling(exp, i, 14)
            if ratio > 1.25:
                fin = next((j for j in range(i, NDAYS) if rolling(tw['loss'], j, 14) / rolling(exp, j, 14) < 1.08), None)
                part = rolling(tw['loss'], i, 14) / (rolling(tw['mta'], i, 14) + rolling(tw['loss'], i, 14))
                pk = max(rolling(tw['loss'], j, 14) / rolling(exp, j, 14) for j in range(i, fin or NDAYS))
                alerts.append({'id': f'SS-{z}', 'regle': 'R4', 'cible': f'SS-{z}', 'type': 'reseau', 'nature': 'pertes',
                               'debut': D(i), 'fin': D(fin) if fin else None, 'part': round(part, 3), 'exces': round(pk - 1, 2)})
                break
    # R5 – récupération de chaleur : rendement de la CTA < 72 % pendant 7 jours
    run = 0
    for i, e in enumerate(cta_eff):
        run = run + 1 if e < 0.72 else 0
        if run == 7:
            fin = next((j for j in range(i, NDAYS) if cta_eff[j] > 0.78), None)
            alerts.append({'id': 'CTA-A2-VMC002', 'regle': 'R5', 'cible': 'A2-VMC002', 'type': 'ventilation', 'nature': 'filtres',
                           'debut': D(i - 6), 'fin': D(fin) if fin else None, 'rendement': min(cta_eff)})
            break
    return alerts


ALERT_TEXT = {
    'CH-A1.92': {
        'titre': 'Chauffage : +{pct} % par rapport aux logements comparables',
        'cause': "Écart présent dès l'emménagement et indépendant de la météo : défaut d'enveloppe probable au dernier étage. "
                 "Le DCE retient une perméabilité à l'air à la valeur limite (Q4Pa-surf 1,00 m³/h.m²) et pas de rupteur au droit des balcons.",
        'action': "Thermographie infrarouge par temps froid et test d'infiltrométrie du logement ; contrôle de l'isolant de toiture "
                  "(PU 120 mm, R ≥ 5,40). Réclamation au titre de la garantie de parfait achèvement si le défaut est confirmé.",
        'gravite': 'serieuse'},
    'CH-A1.45': {
        'titre': 'Pic de chauffage pendant la vague de froid (×2,6)',
        'cause': "Consommation multipliée en quelques heures puis retour à la normale : fenêtre restée ouverte ou robinet "
                 "thermostatique bloqué en position ouverte pendant une absence.",
        'action': "Message automatique à l'occupant le 2ᵉ jour ; aucune intervention technique nécessaire si le profil redevient normal.",
        'gravite': 'attention'},
    'EA-A1.73': {
        'titre': "Fuite d'eau probable : {litres} L perdus",
        'cause': "Consommation d'eau presque doublée sans hausse de l'eau chaude, y compris la nuit : fuite de chasse d'eau ou de robinet.",
        'action': "Prévenir l'occupant et le gestionnaire ; intervention du plombier. À 4,16 €/m³, chaque jour de fuite coûte ≈ 1,40 €.",
        'gravite': 'serieuse'},
    'CP-A2.36': {
        'titre': 'Compteur du module thermique muet pendant {jours} jours',
        'cause': "Plus aucune télé-relève : pile du module radio ou défaut de communication. Les consommations de la période sont estimées.",
        'action': "Intervention de l'exploitant sur le module de comptage (CCTP 502 : télé-relève des consommations tous usages).",
        'gravite': 'attention'},
    'SS-A1': {
        'titre': 'Pertes de distribution : +{pct} % par rapport au modèle appris',
        'cause': "L'écart entre le compteur de la sous-station et la somme des modules thermiques augmente brutalement : "
                 "by-pass thermostatique d'un module bloqué ouvert (maintien en température du primaire, CCTP 502 §5.5.1) "
                 "ou calorifuge dégradé en gaine.",
        'action': "Relevé des températures de retour colonne par colonne, remplacement du by-pass en cause. "
                  "Garantie de bon fonctionnement (2 ans) du lot 502.",
        'gravite': 'critique'},
    'CTA-A2-VMC002': {
        'titre': 'Double flux : rendement de récupération tombé à {rend} %',
        'cause': "Les températures de soufflage de la CTA A2 VMC 002 (colonnes c3, c8, c9) montrent une récupération en baisse : filtres encrassés.",
        'action': "Remplacement des filtres et contrat d'entretien semestriel : sans entretien, la variante perd une partie de son gain.",
        'gravite': 'serieuse'},
}


def finalize_alerts(alerts, towers, by):
    out = []
    for a in alerts:
        t = ALERT_TEXT.get(a['id'])
        if not t:
            continue
        r = dict(a)
        r.update({k: v for k, v in t.items()})
        if a['type'] == 'chauffage':
            r['titre'] = t['titre'].format(pct=round(a['ecart'] * 100))
        elif a['type'] == 'eau':
            r['titre'] = t['titre'].format(litres=f"{a['volume_l']:,}".replace(',', ' '))
            r['cout_eur'] = round(a['volume_l'] / 1000 * 4.16, 2)
        elif a['type'] == 'donnees':
            r['titre'] = t['titre'].format(jours=a['jours'])
        elif a['type'] == 'reseau':
            r['titre'] = t['titre'].format(pct=round(a['exces'] * 100))
        elif a['type'] == 'ventilation':
            r['titre'] = t['titre'].format(rend=round(a['rendement'] * 100))
        out.append(r)
    # coût de l'excès de pertes A1 pendant l'anomalie
    for r in out:
        if r['id'] == 'SS-A1':
            tw = towers['A1']
            base = stx.median(tw['loss'][:100])
            exc = sum(max(0, x - base) for x in tw['loss'])
            r['exces_kwh'] = round(exc)
            r['cout_eur'] = round(exc / 1000 * 96.72)
    out.sort(key=lambda r: r['debut'])
    return out


# ------------------------------------------------------------------ profils thermiques des ouvrages (volet « Énergie » des fiches)
SRC = {
    'etude': "Étude thermique RT 2012 de la tour A2 (Home Inclusiv, 06/07/2020), reprise dans la présentation synthétique du DCE — pièce non jointe au dossier",
    '301': 'CCTP 301 Gros œuvre ind B, §6.7.10',
    '309': 'CCTP 309 Isolation / flocage ind 0, §3.2',
    '402': 'CCTP 402 Étanchéité ind B, §3.2.2',
    '417': 'CCTP 417 Menuiseries extérieures PVC ind A',
    '502': 'CCTP 502-503-504 CVC plomberie ind B',
    'var': 'Maquette MQT-FONTBELLEAU-G4 — variante RE2020 de la tour A2 (sous-projets « VAR A2 »)',
}
PROFILS = {
    'facade_A1': {'titre': 'Paroi extérieure — tour A1 (conception DCE)', 'role': 'enveloppe', 'lignes': [
        {'label': 'Composition', 'valeur': 'Voile béton armé 20 cm + doublage intérieur PSE graphité 10 cm', 'fiab': 'cite', 'src': ['etude']},
        {'label': 'Coefficient U', 'valeur': '0,27 W/m².K', 'fiab': 'cite', 'src': ['etude']},
        {'label': 'Ponts thermiques', 'valeur': 'Rupteurs Schöck Rutherma en nez de plancher R+2 à R+9, sauf au droit des balcons', 'fiab': 'verifie', 'src': ['301']},
        {'label': 'Pset IFC', 'valeur': 'Pset_WallCommon.ThermalTransmittance = 0,27 ; IsExternal = TRUE', 'fiab': 'cite', 'src': ['etude']}]},
    'facade_A2': {'titre': 'Paroi extérieure — tour A2 (variante RE2020)', 'role': 'enveloppe', 'lignes': [
        {'label': 'Composition', 'valeur': 'Voile béton armé 20 cm + ITE PSE graphité 140 mm (λ 0,031) sous enduit mince', 'fiab': 'modele', 'src': ['var']},
        {'label': 'Coefficient U', 'valeur': '≈ 0,21 W/m².K', 'detail': 'R isolant 0,14 / 0,031 = 4,52 + béton 0,10 + Rsi + Rse 0,17 ; hors ponts thermiques.', 'fiab': 'estime', 'src': ['var']},
        {'label': 'Base DCE remplacée', 'valeur': 'Doublage intérieur PSE 10 cm, U 0,27 W/m².K', 'fiab': 'cite', 'src': ['etude']},
        {'label': 'Pset IFC', 'valeur': 'Pset_WallCommon.ThermalTransmittance ≈ 0,21 ; IsExternal = TRUE', 'fiab': 'estime', 'src': ['var']}]},
    'facade_rdc': {'titre': 'Paroi du rez-de-chaussée', 'role': 'hors_logement', 'lignes': [
        {'label': 'Rôle', 'valeur': 'Halls et locaux communs : non rattachés à un logement', 'fiab': 'modele', 'src': []}]},
    'ite_A2': {'titre': 'Isolation thermique par l\'extérieur — variante A2', 'role': 'enveloppe', 'lignes': [
        {'label': 'Isolant', 'valeur': 'PSE graphité 140 mm, λ 0,031 W/m.K (Knauf XTherm ITEx Sun+ dans la maquette)', 'fiab': 'modele', 'src': ['var']},
        {'label': 'Résistance thermique', 'valeur': 'R ≈ 4,52 m².K/W', 'fiab': 'estime', 'src': ['var']},
        {'label': 'Effet attendu', 'valeur': 'Chauffage ≈ −12 % par rapport au doublage intérieur', 'fiab': 'hypothese', 'src': []}]},
    'separatif': {'titre': 'Voile séparatif entre logements', 'role': 'interne', 'lignes': [
        {'label': 'Rôle thermique', 'valeur': 'Entre deux logements chauffés : pas de déperdition', 'fiab': 'modele', 'src': []},
        {'label': 'Inertie', 'valeur': 'Béton 20 cm : inertie lourde, utile au confort d\'été (Tic étude 26,4 °C)', 'fiab': 'cite', 'src': ['etude']}]},
    'noyau': {'titre': 'Voile du noyau (circulations, escalier, gaines)', 'role': 'interne', 'lignes': [
        {'label': 'Rôle thermique', 'valeur': 'Paroi intérieure, hors enveloppe ; inertie lourde', 'fiab': 'modele', 'src': []}]},
    'plancher_bas': {'titre': 'Plancher bas des logements du R+1', 'role': 'enveloppe', 'lignes': [
        {'label': 'Isolation', 'valeur': 'Flocage 24 cm en sous-face, R = 6,3 m².K/W, au droit des zones non chauffées du RDC', 'fiab': 'verifie', 'src': ['309']}]},
    'plancher_inter': {'titre': 'Plancher intermédiaire', 'role': 'interne', 'lignes': [
        {'label': 'Rôle thermique', 'valeur': 'Entre logements chauffés : pas de déperdition', 'fiab': 'modele', 'src': []},
        {'label': 'Nez de plancher', 'valeur': 'Rupteurs de pont thermique (laine de roche 60 mm), R+2 à R+9, sauf balcons', 'fiab': 'verifie', 'src': ['301']}]},
    'toiture_A1': {'titre': 'Toiture-terrasse — tour A1', 'role': 'enveloppe', 'lignes': [
        {'label': 'Isolant', 'valeur': 'Polyuréthane 120 mm (type Efigreen Duo), R ≥ 5,40 m².K/W', 'fiab': 'verifie', 'src': ['402']},
        {'label': 'Protection', 'valeur': 'Gravillons 4 cm', 'fiab': 'verifie', 'src': ['402']}]},
    'toiture_A2': {'titre': 'Toiture — tour A2 (variante végétalisée)', 'role': 'enveloppe', 'lignes': [
        {'label': 'Isolant', 'valeur': 'PU 120 mm, R 5,45 m².K/W', 'fiab': 'modele', 'src': ['var']},
        {'label': 'Végétalisation', 'valeur': 'Substrat extensif 8 cm et sédums : rafraîchissement d\'été, rétention des eaux pluviales', 'fiab': 'modele', 'src': ['var']},
        {'label': 'Base DCE', 'valeur': 'PU 120 mm R ≥ 5,40 sous gravillons', 'fiab': 'verifie', 'src': ['402']}]},
    'balcon': {'titre': 'Dalle de balcon', 'role': 'pont', 'lignes': [
        {'label': 'Pont thermique', 'valeur': 'Pas de rupteur au droit des balcons : liaison balcon-plancher non traitée', 'fiab': 'verifie', 'src': ['301']},
        {'label': 'Point de contrôle', 'valeur': 'À vérifier en thermographie si le logement surconsomme', 'fiab': 'modele', 'src': []}]},
    'menuiserie_A1': {'titre': 'Menuiserie extérieure PVC — tour A1', 'role': 'enveloppe', 'lignes': [
        {'label': 'Vitrage', 'valeur': 'Double vitrage 4/16/4 à isolation thermique renforcée, gaz selon performance', 'fiab': 'verifie', 'src': ['417']},
        {'label': 'Coefficient Uw', 'valeur': None, 'detail': 'Le CCTP renvoie à l\'étude thermique, absente du DCE.', 'fiab': 'nd', 'src': ['417']},
        {'label': 'Entrée d\'air', 'valeur': 'Hygroréglable Atlantic EH 5/45 (VMC hygro B)', 'fiab': 'verifie', 'src': ['502']},
        {'label': 'Étanchéité à l\'air', 'valeur': 'Bâtiment ≤ 1 m³/h.m² ; essais à la porte soufflante (NF EN 13829)', 'fiab': 'verifie', 'src': ['417']}]},
    'menuiserie_A2': {'titre': 'Menuiserie extérieure PVC — tour A2', 'role': 'enveloppe', 'lignes': [
        {'label': 'Vitrage', 'valeur': 'Double vitrage 4/16/4 à isolation thermique renforcée', 'fiab': 'verifie', 'src': ['417']},
        {'label': 'Coefficient Uw', 'valeur': None, 'detail': 'Le CCTP renvoie à l\'étude thermique, absente du DCE.', 'fiab': 'nd', 'src': ['417']},
        {'label': 'Variante A2', 'valeur': 'Coffre de volet roulant isolé et étanche ; pas d\'entrée d\'air (ventilation double flux)', 'fiab': 'modele', 'src': ['var']},
        {'label': 'Étanchéité à l\'air', 'valeur': 'Bâtiment ≤ 1 m³/h.m² ; essais à la porte soufflante (NF EN 13829)', 'fiab': 'verifie', 'src': ['417']}]},
    'hall': {'titre': 'Menuiserie de hall', 'role': 'hors_logement', 'lignes': [
        {'label': 'Rôle', 'valeur': 'Hall du RDC, non rattaché à un logement', 'fiab': 'modele', 'src': []}]},
    'cta': {'titre': 'Centrale de ventilation double flux — variante A2', 'role': 'equipement', 'lignes': [
        {'label': 'Fonction', 'valeur': 'Soufflage et extraction des logements, récupération de chaleur sur l\'air extrait', 'fiab': 'modele', 'src': ['var']},
        {'label': 'Rendement de récupération', 'valeur': '82 % en régime nominal', 'fiab': 'hypothese', 'src': []},
        {'label': 'Suivi dans le jumeau', 'valeur': 'Rendement journalier et consommation des ventilateurs', 'fiab': 'fictif', 'src': []}]},
    'capteur': {'titre': 'Capteur solaire thermique — variante A2', 'role': 'equipement', 'lignes': [
        {'label': 'Installation', 'valeur': '12 capteurs plans de 2,5 m² (30 m²), plein sud à 30°, ballon solaire 1 500 L', 'fiab': 'modele', 'src': ['var']},
        {'label': 'Rôle', 'valeur': 'Préchauffe l\'eau chaude : réduit la chaleur achetée au réseau', 'fiab': 'modele', 'src': ['var']},
        {'label': 'Rendement annuel', 'valeur': '30 % du rayonnement reçu', 'fiab': 'hypothese', 'src': []}]},
    'parking_ph': {'titre': 'Plancher haut du parking', 'role': 'enveloppe', 'lignes': [
        {'label': 'Isolation', 'valeur': 'Flocage 14 cm, R = 3,7 m².K/W, sous les zones isolées non chauffées du RDC', 'fiab': 'verifie', 'src': ['309']}]},
    'lt_doublage': {'titre': 'Doublage du logement témoin A1.31', 'role': 'enveloppe', 'lignes': [
        {'label': 'Composition', 'valeur': 'Doublage PSE graphité 13+100 (Prégymax), R = 3', 'fiab': 'modele', 'src': []},
        {'label': 'Paroi complète', 'valeur': 'Voile 20 cm + doublage : U 0,27 W/m².K', 'fiab': 'cite', 'src': ['etude']}]},
    'fermeture': {'titre': 'Fermeture', 'role': 'interne', 'lignes': [
        {'label': 'Rôle thermique', 'valeur': 'Occultation : limite les apports solaires d\'été', 'fiab': 'modele', 'src': []}]},
    'ecaille': {'titre': 'Écaille de façade', 'role': 'sans', 'lignes': [
        {'label': 'Rôle thermique', 'valeur': 'Élément rapporté sans rôle d\'isolation ; effet d\'ombrage non quantifié dans le DCE', 'fiab': 'modele', 'src': []}]},
    'garde_corps': {'titre': 'Garde-corps', 'role': 'sans', 'lignes': [
        {'label': 'Rôle thermique', 'valeur': 'Aucun', 'fiab': 'modele', 'src': []}]},
    'interieur': {'titre': 'Ouvrage intérieur', 'role': 'interne', 'lignes': [
        {'label': 'Rôle thermique', 'valeur': 'À l\'intérieur du volume chauffé : pas de déperdition propre', 'fiab': 'modele', 'src': []}]},
    'fondation_var': {'titre': 'Fondation en béton bas carbone — variante A2', 'role': 'carbone', 'lignes': [
        {'label': 'Volume chauffé', 'valeur': 'Hors volume chauffé : pas de consommation d\'usage', 'fiab': 'modele', 'src': []},
        {'label': 'Carbone', 'valeur': 'Béton bas carbone : réduit l\'impact de construction (indicateur Ic construction RE2020)', 'fiab': 'modele', 'src': ['var']}]},
    'hors_volume': {'titre': 'Hors volume chauffé', 'role': 'sans', 'lignes': [
        {'label': 'Rôle thermique', 'valeur': 'Ouvrage hors volume chauffé : pas de donnée de consommation', 'fiab': 'modele', 'src': []}]},
}


# ------------------------------------------------------------------ hypothèses économiques et carbone (modifiables sur la page)
HYP = {
    'prix_chaleur': {'label': 'Chaleur du réseau', 'valeur': 96.72, 'unite': '€ TTC/MWh', 'fiab': 'verifie',
                     'src': "Réseau des Hauts de Garonne (3324C) : prix moyen 2023, dossier de classement, Bordeaux Métropole (déc. 2024)"},
    'prix_elec': {'label': 'Électricité', 'valeur': 0.2001, 'unite': '€ TTC/kWh', 'fiab': 'verifie',
                  'src': "Tarif réglementé, option Base 6 kVA, depuis le 1er août 2026"},
    'abo_elec': {'label': 'Abonnement électrique', 'valeur': 191.40, 'unite': '€ TTC/an', 'fiab': 'verifie',
                 'src': "Tarif réglementé, option Base 6 kVA (2026)"},
    'prix_eau': {'label': 'Eau (distribution + assainissement)', 'valeur': 4.16, 'unite': '€ TTC/m³', 'fiab': 'verifie',
                 'src': "Bordeaux Métropole, observatoire SISPEA (tarif 2024)"},
    'co2_chaleur': {'label': 'Contenu CO₂ de la chaleur', 'valeur': 0.034, 'unite': 'kgCO₂e/kWh', 'fiab': 'verifie',
                    'src': "Réseau 3324C, contenu CO₂ ACV (arrêté du 11 avril 2025, année 2023). Un arrêté du 30 mars 2026 a mis à jour les valeurs : à reprendre"},
    'co2_elec': {'label': 'Contenu CO₂ de l\'électricité', 'valeur': 0.064, 'unite': 'kgCO₂e/kWh', 'fiab': 'hypothese',
                 'src': "Ordre de grandeur des facteurs réglementaires pour les usages hors chauffage : à vérifier"},
    'ep_elec': {'label': 'Coefficient énergie primaire électricité', 'valeur': 2.3, 'unite': '', 'fiab': 'hypothese', 'src': "Convention RE2020 (réseau de chaleur : 1)"},
    'evol_energie': {'label': 'Évolution annuelle des prix de l\'énergie', 'valeur': 2.0, 'unite': '%/an', 'fiab': 'hypothese', 'src': "Hypothèse de coût global, à ajuster"},
    'evol_eau': {'label': 'Évolution annuelle du prix de l\'eau', 'valeur': 2.5, 'unite': '%/an', 'fiab': 'hypothese', 'src': "Hypothèse de coût global, à ajuster"},
}


def r1(x):
    return round(x, 1)


def main():
    rng = random.Random(SEED)
    els = load_model()
    logs, centers = build_logements(els)
    T, S = weather(rng)
    towers, cta_eff, silent, by = simulate(logs, T, S, rng)
    alerts = finalize_alerts(detect(logs, towers, cta_eff, silent, by), towers, by)
    ouv = map_ouvrages(els, logs, centers)

    # logements rattachés : ouvrages par logement (menuiseries, façade, balcons)
    elems = {}
    for ref, rec in ouv.items():
        for lid in rec.get('l', []):
            elems.setdefault(lid, []).append(ref)

    # ---- séries journalières (entiers compacts) : chauffage et ECS en 0,1 kWh, eau en L, électricité en 0,1 kWh
    series = {}
    for l in logs:
        H = [int(round(x * 10)) for x in l['_H']]
        E = [int(round(x * 10)) for x in l['_E']]
        W = [int(round(x)) for x in l['_W']]
        P = [int(round(x * 10)) for x in l['_P']]
        R = [int(round(x * 10)) for x in l['_Href']]
        if l['id'] == 'A2.36':
            for i in silent:
                H[i] = E[i] = W[i] = -1  # aucune donnée télé-relevée
        series[l['id']] = {'h': H, 'e': E, 'w': W, 'p': P, 'r': R}

    # valeurs annuelles et mensuelles pour chaque logement (les jours sans donnée sont estimés par la référence)
    def months_of(arr):
        m = {}
        for i, d in enumerate(DAYS):
            k = d.strftime('%Y-%m')
            m[k] = m.get(k, 0) + arr[i]
        return [m[k] for k in sorted(m)]

    out_logs = []
    for l in logs:
        H = l['_H']; E = l['_E']; W = l['_W']; P = l['_P']
        out_logs.append({
            'id': l['id'], 'tour': l['tour'], 'etage': l['etage'], 'num': l['num'], 'typo': l['typo'], 'shab': l['shab'],
            'ext': l['ext'], 'a0': l['a0'], 'a1': l['a1'], 'orient': l['orient'], 'plan': l['plan'],
            'occupants': l['occupants'], 'emmenagement': l['emmenagement'],
            'an': {'chauffage': round(sum(H)), 'ecs': round(sum(E)), 'eau': round(sum(W) / 1000, 1), 'elec': round(sum(P)),
                   'ref_chauffage': round(sum(l['_Href']))},
            'ouvrages': sorted(elems.get(l['id'], [])),
        })

    tw_out = {}
    for z in ('A1', 'A2'):
        tw = towers[z]
        sg = tw['sg']
        tw_out[z] = {
            'nom': TOWER[z], 'shab': round(sum(l['shab'] for l in logs if l['tour'] == z), 2),
            'logements': sum(1 for l in logs if l['tour'] == z),
            'conception': 'DCE — RT 2012 : doublage intérieur, VMC hygro B' if z == 'A1' else 'Variante RE2020 : ITE 140 mm, double flux, solaire thermique 30 m², toiture végétalisée',
            'centre': [round(centers[z][0], 3), round(centers[z][1], 3)],
            'jour': {
                'mta': [int(round(x)) for x in tw['mta']], 'pertes': [int(round(x)) for x in tw['loss']],
                'solaire': [int(round(x)) for x in tw['solar']], 'reseau': [int(round(x)) for x in tw['rcu']],
                'pertes_modele': [int(round(x)) for x in tw['loss_exp']],
                'ventilation': [r1(s['vent']) for s in sg], 'ascenseurs': [r1(s['asc']) for s in sg],
                'eclairage': [r1(s['ecl']) for s in sg], 'auxiliaires': [r1(s['aux']) for s in sg],
            },
        }
    tw_out['A2']['cta_rendement'] = cta_eff

    meta = {
        'schema': 1, 'genere': dt.date.today().isoformat(),
        'periode': {'debut': START.isoformat(), 'fin': DAYS[-1].isoformat(), 'jours': NDAYS, 'livraison': LIVRAISON.isoformat()},
        'statut': 'fictif',
        'avertissement': "Consommations simulées pour la démonstration : première année d'exploitation après la livraison prévue au scénario du chantier. "
                         "Les ouvrages, typologies, surfaces et équipements viennent du DCE et de la maquette.",
        'meteo': {'temperature': T, 'ensoleillement': S, 'source': 'Simulée autour des moyennes mensuelles de Bordeaux (fictif)'},
        'tours': tw_out,
        'reference': {
            'cep_etude': 40.1, 'cep_max': 53.5, 'bbio': 20.2, 'bbio_max': 54, 'tic': 26.4, 'q4': 1.0,
            'src': SRC['etude'],
            'note': "Le Cep est un calcul conventionnel (météo et occupation types, 5 usages en énergie primaire). Il ne se compare pas "
                    "directement aux compteurs : le jumeau compare chaque logement à une référence recalée sur la météo réelle et sur "
                    "les logements comparables.",
        },
        'hypotheses': HYP,
        'calage': {
            'chauffage_cible_kwh_m2': HEAT_TARGET, 'temperature_non_chauffage': TBAL, 'pertes_distribution': LOSS_SHARE,
            'solaire_m2': SOLAR_M2, 'solaire_rendement': SOLAR_ETA,
            'variante_A2': "Chauffage −30 % par rapport à A1 (ITE ≈ −12 %, double flux ≈ −20 %) ; ventilation : consommation électrique ×2,2",
        },
        'regles': [
            {'id': 'R1', 'label': 'Surconsommation de chauffage', 'texte': 'Écart > +30 % à la référence recalée (météo, orientation, étage, typologie) sur 30 jours glissants.'},
            {'id': 'R2', 'label': "Fuite d'eau", 'texte': 'Volume journalier > 1,8 × la médiane des 60 jours précédents (jours de présence seulement), 5 jours de suite.'},
            {'id': 'R3', 'label': 'Compteur muet', 'texte': 'Aucune télé-relève pendant plus de 3 jours.'},
            {'id': 'R4', 'label': 'Pertes de distribution', 'texte': 'Pertes (sous-station − Σ modules thermiques) supérieures de 25 % au modèle appris sur le premier trimestre, sur 14 jours glissants.'},
            {'id': 'R5', 'label': 'Récupération double flux', 'texte': 'Rendement de récupération de la CTA < 72 % pendant 7 jours.'},
        ],
        'alertes': alerts,
    }

    os.makedirs(OUT, exist_ok=True)
    def dump(name, obj):
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    dump('jumeau.json', meta)
    dump('logements.json', {'colonnes_jour': {'h': 'chauffage, 0,1 kWh', 'e': 'eau chaude sanitaire, 0,1 kWh', 'w': 'eau, litres',
                                               'p': 'électricité, 0,1 kWh', 'r': 'référence chauffage recalée, 0,1 kWh', '-1': 'pas de donnée'},
                            'geometrie': {'r_int': R_IN, 'r_ext': R_OUT, 'hauteur_etage': STOREY,
                                          'plancher_r1': {'A1': 5.63, 'A2': 5.58}, 'note': "Logements reconstitués depuis les voiles séparatifs de la maquette et le tableau des surfaces ind. A"},
                            'logements': out_logs})
    dump('series.json', series)
    dump('ouvrages.json', {'profils': PROFILS, 'sources': SRC, 'ouvrages': ouv})

    # résumé console
    for z in ('A1', 'A2'):
        L = [l for l in logs if l['tour'] == z]
        sh = sum(l['shab'] for l in L)
        print(z, 'chauffage', round(sum(sum(l['_H']) for l in L) / sh, 1), 'kWh/m²', 'ECS', round(sum(sum(l['_E']) for l in L) / sh, 1),
              'eau m3/logt', round(sum(sum(l['_W']) for l in L) / len(L) / 1000, 1), 'réseau MWh', round(sum(towers[z]['rcu']) / 1000, 1),
              'pertes %', round(100 * sum(towers[z]['loss']) / (sum(towers[z]['mta']) + sum(towers[z]['loss'])), 1),
              'solaire MWh', round(sum(towers[z]['solar']) / 1000, 1))
    print('DJU16', round(sum(max(0, 16 - t) for t in T)), 'DJU18', round(sum(max(0, 18 - t) for t in T)))
    for a in alerts:
        print(a['debut'], a['id'], a['titre'])
    print(len(out_logs), 'logements ;', sum(1 for r in ouv.values() if r.get('l')), 'ouvrages rattachés à un logement')


if __name__ == '__main__':
    main()
