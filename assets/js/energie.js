// Jumeau énergétique du Domaine de Fontbelleau : données, indicateurs, frise, détail, alertes, coût global.
import { createTwin } from './energie3d.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const bind = (k) => $(`[data-bind="${k}"]`);
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function sv(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const icon = (id, cls = 'ico') => { const s = sv('svg', { class: cls, 'aria-hidden': 'true' }); s.append(sv('use', { href: `#${id}` })); return s; };
const nf = (d = 0) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 0) => (v == null || !isFinite(v) ? '—' : nf(d).format(v));
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const USAGE = {
  chauffage: { key: 'h', label: 'Chauffage', unit: 'kWh', icon: 'i-flame', css: '--s-chauffage', hex: '#d95926', ramp: ['#170904', '#3d1606', '#7a2c0c', '#c24a17', '#e8742c', '#f7a052'] },
  ecs: { key: 'e', label: 'Eau chaude', unit: 'kWh', icon: 'i-shower', css: '--s-ecs', hex: '#3987e5', ramp: ['#050c16', '#0d2343', '#164a8c', '#2a78d6', '#5598e7', '#86b6ef'] },
  eau: { key: 'w', label: 'Eau', unit: 'L', icon: 'i-drop', css: '--s-eau', hex: '#199e70', ramp: ['#03110c', '#072c1c', '#0d573d', '#168c63', '#28b583', '#6fd8af'] },
  elec: { key: 'p', label: 'Électricité', unit: 'kWh', icon: 'i-bolt', css: '--s-elec', hex: '#c98500', ramp: ['#120c02', '#332103', '#6b4600', '#ad7200', '#d99a12', '#f0c050'] },
};
const DIVERGE = ['#3987e5', '#2f5c93', '#3a3f45', '#93453f', '#e66767'];
const STATUS = { critique: { c: '#d03b3b', icon: 'i-octagon', label: 'Critique' }, serieuse: { c: '#ec835a', icon: 'i-alert', label: 'Importante' }, attention: { c: '#fab219', icon: 'i-info', label: 'À surveiller' } };
const TYPE_ICON = { chauffage: 'i-flame', eau: 'i-drop', donnees: 'i-wifi-off', reseau: 'i-network', ventilation: 'i-fan' };
const FAMILLE = { menuiserie_ext: 'Menuiserie', ecaille: 'Écaille', garde_corps: 'Garde-corps', dalle: 'Dalle', voile: 'Voile', premur: 'Prémur', cloison: 'Cloison', porte_int: 'Porte', finition: 'Finition', fermeture: 'Fermeture', poutre: 'Poutre', poteau: 'Poteau' };

const S = {
  J: null, L: [], byId: new Map(), series: null, ouv: null, days: [], N: 0, ND: 0,
  usage: 'chauffage', color: 'intensite', period: 'an', day: 112, tower: 'ALL', floor: 0, sel: null, special: null,
  playing: false, twin: null, scale: {}, hyp: {}, index: null,
};

// ------------------------------------------------------------------ données
function prefix(arr) { const p = new Float64Array(arr.length + 1); for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i]; return p; }
function prepare(J, LG, SE, OU) {
  S.J = J; S.L = LG.logements; S.N = S.L.length; S.ND = J.periode.jours; S.ouv = OU;
  const d0 = new Date(J.periode.debut + 'T12:00:00');
  S.days = Array.from({ length: S.ND }, (_, i) => new Date(d0.getTime() + i * 86400000));
  S.L.forEach((l, i) => {
    S.byId.set(l.id, l); l.i = i;
    const raw = SE[l.id];
    l.miss = new Uint8Array(S.ND);
    const fill = (a, k) => {
      const out = new Float64Array(S.ND);
      for (let d = 0; d < S.ND; d++) {
        if (a[d] < 0) {
          l.miss[d] = 1;
          // estimation : référence × rapport habituel (chauffage), moyenne des 14 jours précédents (autres usages)
          if (k === 'h') {
            let s = 0, r = 0; for (let j = Math.max(0, d - 60); j < d; j++) if (a[j] >= 0) { s += a[j]; r += raw.r[j]; }
            out[d] = raw.r[d] * (r > 0 ? s / r : 1);
          } else { let s = 0, n = 0; for (let j = Math.max(0, d - 14); j < d; j++) if (a[j] >= 0) { s += a[j]; n++; } out[d] = n ? s / n : 0; }
        } else out[d] = a[d];
      }
      return out;
    };
    const scale = { h: 0.1, e: 0.1, w: 1, p: 0.1, r: 0.1 };
    l.d = {};
    for (const k of ['h', 'e', 'w', 'p', 'r']) {
      const f = fill(raw[k], k);
      for (let d = 0; d < S.ND; d++) f[d] *= scale[k];
      l.d[k] = f; l['P' + k] = prefix(f);
    }
  });
  // séries des tours
  for (const z of ['A1', 'A2']) {
    const T = J.tours[z].jour;
    T.elec_priv = Array.from({ length: S.ND }, (_, d) => S.L.filter(l => l.tour === z).reduce((s, l) => s + l.d.p[d], 0));
    T.sg = T.ventilation.map((v, d) => v + T.ascenseurs[d] + T.eclairage[d] + T.auxiliaires[d]);
    T.P = {};
    for (const k of Object.keys(T)) if (Array.isArray(T[k])) T.P[k] = prefix(T[k]);
  }
  for (const [k, h] of Object.entries(J.hypotheses)) S.hyp[k] = h.valeur;
  // ouvrage → indice de logement (vitrages)
  S.index = new Map();
  for (const [ref, rec] of Object.entries(OU.ouvrages)) if (rec.l && rec.l.length === 1) S.index.set(ref, S.byId.get(rec.l[0])?.i);
  // échelles d'intensité (95e centile) par usage et par période
  for (const [u, U] of Object.entries(USAGE)) {
    const k = U.key;
    const an = S.L.map(l => l['P' + k][S.ND] / l.shab).sort((a, b) => a - b);
    const mo = [], dy = [];
    for (const l of S.L) {
      for (const [a, b] of monthRanges()) mo.push((l['P' + k][b + 1] - l['P' + k][a]) / l.shab);
      for (let d = 6; d < S.ND; d += 3) dy.push((l['P' + k][d + 1] - l['P' + k][d - 6]) / 7 / l.shab);
    }
    mo.sort((a, b) => a - b); dy.sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    S.scale[u] = { an: q(an, 0.96), mois: q(mo, 0.97), jour: q(dy, 0.975) };
  }
}
let _mr = null;
function monthRanges() {
  if (_mr) return _mr;
  _mr = []; let s = 0;
  for (let d = 1; d <= S.ND; d++) {
    if (d === S.ND || S.days[d].getMonth() !== S.days[s].getMonth()) { _mr.push([s, d - 1]); s = d; }
  }
  return _mr;
}
function monthOf(day) { return monthRanges().findIndex(([a, b]) => day >= a && day <= b); }
function range() {
  if (S.period === 'an') return [0, S.ND - 1];
  if (S.period === 'mois') return monthRanges()[monthOf(S.day)];
  return [Math.max(0, S.day - 6), S.day];
}
const sumL = (l, k, a, b) => l['P' + k][b + 1] - l['P' + k][a];
const sumT = (z, k, a, b) => S.J.tours[z].jour.P[k][b + 1] - S.J.tours[z].jour.P[k][a];
function fmtDay(d, long = false) { const x = S.days[d]; return long ? `${x.getDate()} ${MOIS_L[x.getMonth()]} ${x.getFullYear()}` : `${x.getDate()} ${MOIS[x.getMonth()]} ${x.getFullYear()}`; }
function dayIndex(iso) { return Math.round((new Date(iso + 'T12:00:00') - S.days[0]) / 86400000); }
function periodLabel() {
  if (S.period === 'an') return 'Année complète';
  if (S.period === 'mois') { const [a] = range(); const x = S.days[a]; return `${MOIS_L[x.getMonth()]} ${x.getFullYear()}`; }
  return 'Moyenne des 7 derniers jours';
}

// ------------------------------------------------------------------ couleurs
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rampAt(ramp, t) {
  t = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(t)), f = t - i;
  const a = hex2rgb(ramp[i]), b = hex2rgb(ramp[i + 1]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
function valueOf(l, u = S.usage) {
  const [a, b] = range(); const k = USAGE[u].key;
  const v = sumL(l, k, a, b) / l.shab;
  return S.period === 'jour' ? v / (b - a + 1) : v;
}
function ecartOf(l, u = S.usage) {
  const [a, b] = range();
  if (u === 'chauffage') { const r = sumL(l, 'r', a, b); return r > 0.5 ? sumL(l, 'h', a, b) / r - 1 : 0; }
  const peers = S.L.filter(x => x.tour === l.tour && x.typo.slice(0, 2) === l.typo.slice(0, 2));
  const vals = peers.map(x => valueOf(x, u)).sort((p, q) => p - q);
  const med = vals[Math.floor(vals.length / 2)];
  return med > 0 ? valueOf(l, u) / med - 1 : 0;
}
function visible(l) { return (S.tower === 'ALL' || l.tour === S.tower); }
function paint() {
  if (!S.twin) return;
  const arr = new Uint8Array(S.N * 4);
  const U = USAGE[S.usage];
  const vmax = S.scale[S.usage][S.period];
  for (const l of S.L) {
    let rgb, k;
    if (!visible(l)) { rgb = [0, 0, 0]; k = 0; }
    else if (S.color === 'intensite') {
      const t = Math.pow(Math.min(1.15, valueOf(l) / vmax), 0.9);
      rgb = rampAt(U.ramp, 0.12 + 0.88 * Math.min(1, t)); k = Math.min(1, t);
    } else {
      const e = ecartOf(l);
      const t = Math.max(-1, Math.min(1, e / 0.4));
      rgb = rampAt(DIVERGE, (t + 1) / 2); k = 0.25 + 0.75 * Math.abs(t);
    }
    if (S.floor && l.etage !== S.floor) { rgb = rgb.map(v => v * 0.22); k *= 0.25; }
    const o = l.i * 4;
    arr[o] = rgb[0]; arr[o + 1] = rgb[1]; arr[o + 2] = rgb[2]; arr[o + 3] = Math.round(k * 255);
  }
  S.twin.setColors(arr);
  renderLegend();
}
function renderLegend() {
  const U = USAGE[S.usage];
  const bar = bind('legend-bar');
  if (S.color === 'intensite') {
    bar.style.background = `linear-gradient(90deg, ${U.ramp.slice(1).join(',')})`;
    const unit = S.usage === 'eau' ? 'L/m²' : 'kWh/m²';
    bind('legend-title').textContent = `${U.label}, ${unit}${S.period === 'jour' ? ' par jour' : ''}`;
    const vmax = S.scale[S.usage][S.period];
    const d = vmax < 1 ? 2 : vmax < 10 ? 1 : 0;
    bind('legend-min').textContent = '0';
    bind('legend-mid').textContent = fmt(vmax / 2, d);
    bind('legend-max').textContent = `≥ ${fmt(vmax, d)}`;
  } else {
    bar.style.background = `linear-gradient(90deg, ${DIVERGE.join(',')})`;
    bind('legend-title').textContent = S.usage === 'chauffage' ? 'Écart à la référence recalée' : `Écart aux logements comparables`;
    bind('legend-min').textContent = '−40 %'; bind('legend-mid').textContent = '0'; bind('legend-max').textContent = '+40 %';
  }
}

// ------------------------------------------------------------------ indicateurs
function scopeTowers() { return S.tower === 'ALL' ? ['A1', 'A2'] : [S.tower]; }
function totals(towers, a, b) {
  const H = S.hyp;
  let reseau = 0, priv = 0, sg = 0, eau = 0, shab = 0, nlog = 0, mta = 0, pers = 0;
  for (const z of towers) {
    reseau += sumT(z, 'reseau', a, b); sg += sumT(z, 'sg', a, b); priv += sumT(z, 'elec_priv', a, b); mta += sumT(z, 'mta', a, b);
    const L = S.L.filter(l => l.tour === z);
    eau += L.reduce((s, l) => s + sumL(l, 'w', a, b), 0) / 1000;
    shab += S.J.tours[z].shab; nlog += L.length; pers += L.reduce((s, l) => s + l.occupants, 0);
  }
  const nd = b - a + 1;
  const elec = priv + sg;
  const cout = reseau / 1000 * H.prix_chaleur + elec * H.prix_elec + nlog * H.abo_elec * nd / 366 + eau * H.prix_eau;
  const co2 = reseau * H.co2_chaleur + elec * H.co2_elec;
  return { reseau, elec, priv, sg, eau, shab, nlog, cout, co2, mta, pers, nd };
}
function renderKpis() {
  const [a, b] = range();
  const t = totals(scopeTowers(), a, b);
  const box = bind('kpis'); box.textContent = '';
  const big = t.reseau > 20000;
  const tile = (l, v, u, s, wide) => el('div', { class: 'kpi' + (wide ? ' is-wide' : '') }, el('span', { class: 'kpi-l', text: l }), el('span', { class: 'kpi-v' }, v, el('small', { text: u })), s ? el('span', { class: 'kpi-s', text: s }) : null);
  box.append(
    tile('Chaleur achetée au réseau', big ? fmt(t.reseau / 1000, 1) : fmt(t.reseau), big ? 'MWh' : 'kWh', `${fmt(t.reseau / t.shab, 1)} kWh/m²`),
    tile('Énergie et eau', t.cout > 10000 ? fmt(t.cout / 1000, 1) : fmt(t.cout), t.cout > 10000 ? 'k€ TTC' : '€ TTC', `${fmt(t.cout / t.nlog)} € par logement`),
    tile('Émissions', t.co2 > 5000 ? fmt(t.co2 / 1000, 1) : fmt(t.co2), t.co2 > 5000 ? 't CO₂e' : 'kg CO₂e', `${fmt(t.co2 / t.shab, 1)} kg/m²`),
    tile('Eau', fmt(t.eau, t.eau < 100 ? 1 : 0), 'm³', `${fmt(t.eau * 1000 / t.pers / t.nd)} L par habitant et par jour`),
  );
  bind('date-mode').textContent = periodLabel();
}
function renderCmp() {
  const [a, b] = range();
  const U = USAGE[S.usage]; const k = U.key;
  const per = (z) => { const L = S.L.filter(l => l.tour === z); return L.reduce((s, l) => s + sumL(l, k, a, b), 0) / S.J.tours[z].shab; };
  const v1 = per('A1'), v2 = per('A2');
  const mx = Math.max(v1, v2) || 1;
  const unit = S.usage === 'eau' ? 'L/m²' : 'kWh/m²';
  const d = mx < 10 ? 1 : 0;
  const box = bind('cmp'); box.textContent = '';
  box.style.setProperty('--uc', `var(${U.css})`);
  const row = (z, v, hollow) => el('div', { class: 'cmp-row' }, el('b', { text: z }),
    el('div', { class: 'cmp-track' }, el('div', { class: 'cmp-fill' + (hollow ? ' is-hollow' : ''), style: { width: `${(v / mx) * 100}%` } })),
    el('span', { text: `${fmt(v, d)} ${unit}` }));
  const g = v1 > 0 ? (v2 / v1 - 1) * 100 : 0;
  const why = { chauffage: 'ITE 140 mm et double flux', ecs: "plus d'occupants par logement en A2 (logement social)", eau: "plus d'occupants par logement en A2", elec: 'usages privés, hors ventilation' }[S.usage];
  box.append(el('h2', { text: `${U.label} : tour A1 (DCE) et tour A2 (variante)` }), row('A1', v1, true), row('A2', v2, false),
    el('p', { class: 'cmp-gain' }, el('b', { text: `${g > 0 ? '+' : ''}${fmt(g, 0)} %` }), ` en A2 · ${why}`));
}

// ------------------------------------------------------------------ alertes
function alertState(a, day = S.day) {
  const s = dayIndex(a.debut), f = a.fin ? dayIndex(a.fin) : Infinity;
  if (S.period === 'an' && !S.playing) return f < S.ND ? 'close' : 'open';
  if (day < s) return 'future';
  if (day >= f) return 'close';
  return 'open';
}
function alertTarget(a) {
  if (S.byId.has(a.cible)) return { kind: 'logement', id: a.cible };
  if (a.cible.startsWith('SS-')) return { kind: 'ss', tour: a.cible.slice(3) };
  return { kind: 'cta', revit: 476181, tour: 'A2' };
}
function renderAlerts() {
  const ol = bind('alerts'); ol.textContent = '';
  const A = S.J.alertes;
  const open = A.filter(a => alertState(a) === 'open').length;
  bind('alert-count').textContent = `${open} en cours · ${A.length} sur l'année`;
  for (const a of A) {
    const st = alertState(a); const g = STATUS[a.gravite] || STATUS.attention;
    const where = S.byId.has(a.cible) ? `Logement ${a.cible}` : a.cible.startsWith('SS-') ? `Sous-station ${a.cible.slice(3)}` : 'CTA A2 VMC 002';
    const stLabel = st === 'future' ? 'à venir' : st === 'open' ? `détectée le ${fmtDay(dayIndex(a.debut))}` : `résolue le ${fmtDay(dayIndex(a.fin))}`;
    const b = el('button', { class: 'al' + (st === 'future' ? ' is-future' : ''), type: 'button', style: { '--pc': g.c }, onclick: () => openAlert(a) },
      icon(TYPE_ICON[a.type] || g.icon),
      el('span', {}, el('span', { class: 'al-t', text: a.titre }),
        el('span', { class: 'al-m' }, el('span', { class: 'al-st' + (st === 'close' ? ' is-done' : ''), text: st === 'close' ? 'Résolue' : g.label }), el('span', { text: `${where} · ${stLabel}` }))));
    ol.append(el('li', {}, b));
  }
}
function openAlert(a) {
  stop();
  const t = alertTarget(a);
  if (S.period !== 'an') setDay(dayIndex(a.debut) + 2);
  if (t.kind === 'logement') { setFloor(0, false); selectLogement(t.id, true); }
  else if (t.kind === 'ss') { S.twin.select(null); S.twin.markElement(null); S.twin.focusPoint(S.twin.towerBase(t.tour).setY(8), 70); showSpecial({ kind: 'ss', tour: t.tour, alerte: a }); }
  else { S.twin.select(null); const p = S.twin.markElement(t.revit); S.twin.focusPoint(p || S.twin.roofOf('A2'), 48); showSpecial({ kind: 'cta', alerte: a }); }
}

// repères 3D
const pinEls = new Map();
function buildPins() {
  const host = $('[data-v="pins"]'); host.textContent = '';
  for (const a of S.J.alertes) {
    const g = STATUS[a.gravite] || STATUS.attention;
    const short = S.byId.has(a.cible) ? a.cible : a.cible.startsWith('SS-') ? `Sous-station ${a.cible.slice(3)}` : 'CTA 002';
    const p = el('button', { class: 'pin', type: 'button', style: { '--pc': g.c }, title: a.titre, onclick: () => openAlert(a) },
      el('span', { class: 'pin-head' }, icon(TYPE_ICON[a.type] || g.icon), short), el('span', { class: 'pin-stem' }), el('span', { class: 'pin-dot' }));
    host.append(p);
    pinEls.set(a.id, { el: p, a });
  }
}
function pinPoint(a) {
  const t = alertTarget(a);
  if (t.kind === 'logement') return S.twin.logementPoint(t.id);
  if (t.kind === 'ss') return S.twin.towerBase(t.tour);
  return S.twin.roofOf('A2');
}
const labelEls = new Map();
function updateLabels(project) {
  const host = $('[data-v="pins"]');
  const on = S.twin.state.plan && S.floor;
  const want = on ? S.L.filter(l => l.etage === S.floor && visible(l)) : [];
  const keep = new Set(want.map(l => l.id));
  for (const [id, n] of labelEls) if (!keep.has(id)) { n.remove(); labelEls.delete(id); }
  const U = USAGE[S.usage];
  for (const l of want) {
    let n = labelEls.get(l.id);
    if (!n) { n = el('button', { class: 'plabel', type: 'button', onclick: () => selectLogement(l.id, false) }, el('b'), el('span')); host.append(n); labelEls.set(l.id, n); }
    const sc = project(l._center);
    if (!sc || sc.hidden) { n.style.display = 'none'; continue; }
    n.style.display = ''; n.style.left = `${sc.x}px`; n.style.top = `${sc.y}px`;
    const v = S.color === 'intensite' ? valueOf(l) : ecartOf(l) * 100;
    n.children[0].textContent = l.id;
    n.children[1].textContent = S.color === 'intensite' ? `${fmt(v, v < 10 ? 2 : 0)}` : `${v > 0 ? '+' : ''}${fmt(v)} %`;
    n.classList.toggle('is-sel', S.sel === l.id);
  }
}
function updatePins(project) {
  if (!S.twin) return;
  updateLabels(project);
  for (const { el: p, a } of pinEls.values()) {
    const st = alertState(a);
    const t = alertTarget(a);
    let show = st !== 'future';
    if (t.kind === 'logement') { const l = S.byId.get(t.id); if (!visible(l) || (S.floor && l.etage !== S.floor)) show = false; }
    else if (S.tower !== 'ALL' && t.tour !== S.tower) show = false;
    if (S.sel === a.cible) show = false;
    const v = a._p || (a._p = pinPoint(a));
    const sc = show && v ? project(v) : null;
    if (!sc || sc.hidden) { p.style.display = 'none'; continue; }
    p.style.display = '';
    p.classList.toggle('is-closed', st === 'close');
    p.style.left = `${sc.x}px`; p.style.top = `${sc.y}px`;
  }
}

// ------------------------------------------------------------------ frise
const TL = { w: 0, h: 88, padL: 0, padR: 0 };
function tlScope() {
  if (S.sel) { const l = S.byId.get(S.sel); return { label: `Logement ${l.id}`, h: l.d.h, e: l.d.e }; }
  const zs = scopeTowers();
  const h = new Float64Array(S.ND), e = new Float64Array(S.ND);
  for (const l of S.L) if (zs.includes(l.tour)) for (let d = 0; d < S.ND; d++) { h[d] += l.d.h[d]; e[d] += l.d.e[d]; }
  return { label: S.tower === 'ALL' ? 'Deux tours' : `Tour ${S.tower}`, h, e };
}
function renderTimeline() {
  const host = bind('tl-chart'); host.textContent = '';
  const W = host.clientWidth || 800, H = host.clientHeight || 88;
  TL.w = W; TL.h = H;
  const sc = tlScope();
  const top = 12, stripH = 9, stripY = H - 22, base = stripY - 6;
  const mx = Math.max(...sc.h.map((v, i) => v + sc.e[i])) * 1.08 || 1;
  const x = (d) => (d / (S.ND - 1)) * W;
  const y = (v) => base - (v / mx) * (base - top);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Consommation quotidienne de chauffage et d'eau chaude, ${sc.label}` });
  // mois
  for (const [a, b] of monthRanges()) {
    svg.append(sv('line', { x1: x(a), x2: x(a), y1: top - 6, y2: H - 2, stroke: 'rgba(176,196,214,.10)' }));
    const m = S.days[a].getMonth();
    svg.append(sv('text', { x: x((a + b) / 2), y: H - 1, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#85919a' }, MOIS[m] + (m === 0 ? ` ${S.days[a].getFullYear()}` : '')));
  }
  // aires empilées : chauffage puis eau chaude, écart de 2 px
  const path = (lo, hi) => {
    let d = `M${x(0)},${y(hi(0))}`;
    for (let i = 1; i < S.ND; i++) d += `L${x(i)},${y(hi(i))}`;
    for (let i = S.ND - 1; i >= 0; i--) d += `L${x(i)},${y(lo(i))}`;
    return d + 'Z';
  };
  svg.append(sv('path', { d: path(() => 0, i => sc.h[i]), fill: '#d95926', opacity: 0.92 }));
  svg.append(sv('path', { d: path(i => sc.h[i], i => sc.h[i] + sc.e[i]), fill: '#3987e5', opacity: 0.92, stroke: '#11171c', 'stroke-width': 1.2 }));
  svg.append(sv('line', { x1: 0, x2: W, y1: base, y2: base, stroke: 'rgba(176,196,214,.25)' }));
  // bande de température (couleur seule, pas de second axe)
  const T = S.J.meteo.temperature;
  for (let i = 0; i < S.ND; i++) {
    const t = Math.max(-1, Math.min(1, (T[i] - 13) / 13));
    const c = rampAt(DIVERGE, (t + 1) / 2);
    svg.append(sv('rect', { x: x(i), y: stripY, width: Math.max(1, W / S.ND + 0.4), height: stripH, fill: `rgb(${c})` }));
  }
  // alertes
  for (const a of S.J.alertes) {
    const d = dayIndex(a.debut); const g = STATUS[a.gravite] || STATUS.attention;
    svg.append(sv('path', { d: `M${x(d)},${top - 2} l4,-5 l-4,-5 l-4,5z`, fill: g.c, stroke: '#0a0e12', 'stroke-width': 1 }));
  }
  // période et curseur
  const [a, b] = range();
  svg.append(sv('rect', { x: x(a), y: top - 6, width: Math.max(2, x(b) - x(a)), height: H - top - 10, fill: 'rgba(238,241,242,.06)', stroke: 'rgba(238,241,242,.18)', 'data-k': 'win' }));
  const cur = sv('g', { 'data-k': 'cur' });
  cur.append(sv('line', { x1: x(S.day), x2: x(S.day), y1: top - 8, y2: H - 14, stroke: '#ff3d8b', 'stroke-width': 2 }));
  cur.append(sv('circle', { cx: x(S.day), cy: top - 8, r: 4.5, fill: '#ff3d8b', stroke: '#0a0e12', 'stroke-width': 1.5 }));
  svg.append(cur);
  host.append(svg);
  const tip = el('div', { class: 'chart-tip', hidden: true }); host.append(tip);
  host._x = x; host._tip = tip; host._sc = sc;
  host.setAttribute('aria-valuenow', S.day); host.setAttribute('aria-valuetext', fmtDay(S.day, true));
}
function moveCursor() {
  const host = bind('tl-chart'); const x = host._x; if (!x) return;
  const g = host.querySelector('[data-k="cur"]');
  g.children[0].setAttribute('x1', x(S.day)); g.children[0].setAttribute('x2', x(S.day)); g.children[1].setAttribute('cx', x(S.day));
  const [a, b] = range(); const w = host.querySelector('[data-k="win"]');
  w.setAttribute('x', x(a)); w.setAttribute('width', Math.max(2, x(b) - x(a)));
  host.setAttribute('aria-valuenow', S.day); host.setAttribute('aria-valuetext', fmtDay(S.day, true));
}
function wireTimeline() {
  const host = bind('tl-chart');
  const dayAt = (e) => { const r = host.getBoundingClientRect(); return Math.max(0, Math.min(S.ND - 1, Math.round((e.clientX - r.left) / r.width * (S.ND - 1)))); };
  let drag = false;
  host.addEventListener('pointerdown', (e) => { drag = true; host.setPointerCapture(e.pointerId); stop(); if (S.period === 'an') setPeriod('jour'); setDay(dayAt(e)); });
  host.addEventListener('pointermove', (e) => {
    const d = dayAt(e);
    if (drag) setDay(d);
    const tip = host._tip, sc = host._sc; if (!tip) return;
    tip.hidden = false; tip.style.left = `${host._x(d)}px`; tip.style.top = '6px';
    tip.innerHTML = `<b>${fmtDay(d)}</b> · ${fmt(S.J.meteo.temperature[d], 1)} °C<br><span class="sw" style="background:#d95926"></span>Chauffage ${fmt(sc.h[d])} kWh &nbsp;<span class="sw" style="background:#3987e5"></span>Eau chaude ${fmt(sc.e[d])} kWh`;
  });
  host.addEventListener('pointerup', () => { drag = false; });
  host.addEventListener('pointerleave', () => { if (host._tip) host._tip.hidden = true; });
  host.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 7 : 1;
    if (e.key === 'ArrowRight') { setDay(Math.min(S.ND - 1, S.day + step)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setDay(Math.max(0, S.day - step)); e.preventDefault(); }
    else if (e.key === 'Home') { setDay(0); e.preventDefault(); } else if (e.key === 'End') { setDay(S.ND - 1); e.preventDefault(); }
    else if (e.key === ' ') { toggle(); e.preventDefault(); }
  });
  new ResizeObserver(() => renderTimeline()).observe(host);
}

// ------------------------------------------------------------------ lecture de l'année
let raf = 0, last = 0, acc = 0;
function toggle() { if (S.playing) stop(); else play(); }
function play() {
  if (S.day >= S.ND - 1) S.day = 0;
  S.playing = true; if (S.period !== 'jour') setPeriod('jour', false);
  const b = $('[data-act="play"]'); b.classList.add('is-playing'); b.firstChild.firstChild.setAttribute('href', '#i-pause'); b.setAttribute('aria-label', 'Mettre en pause');
  last = performance.now(); acc = S.day; setDay(S.day);
  const step = (now) => {
    if (!S.playing) return;
    acc += Math.max(0, now - last) / 1000 * 28; last = now;
    const d = Math.max(0, Math.min(S.ND - 1, Math.floor(acc)));
    if (d !== S.day) setDay(d);
    if (d >= S.ND - 1) { stop(); setPeriod('an'); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function stop() {
  if (!S.playing) return;
  S.playing = false; cancelAnimationFrame(raf);
  const b = $('[data-act="play"]'); b.classList.remove('is-playing'); b.firstChild.firstChild.setAttribute('href', '#i-play'); b.setAttribute('aria-label', "Lire l'année");
  renderAlerts();
}

// ------------------------------------------------------------------ état et mises à jour
function setDay(d) {
  S.day = d;
  bind('date-day').textContent = S.period === 'an' && !S.playing ? 'Oct. 2027 – sept. 2028' : fmtDay(d);
  bind('date-temp').textContent = S.period === 'an' && !S.playing ? '' : `${fmt(S.J.meteo.temperature[d], 1)} °C dehors`;
  paint(); renderKpis(); renderCmp(); moveCursor();
  if (!S.playing || d % 4 === 0) renderAlerts();
  if (S.sel && !S.playing) renderDetail();
}
function setPeriod(p, refresh = true) {
  S.period = p;
  $$('[data-period]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === p)));
  if (refresh) { setDay(S.day); renderTimeline(); }
}
function setUsage(u) {
  S.usage = u;
  $$('[data-usage]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.usage === u)));
  paint(); renderCmp(); if (S.sel) renderDetail();
}
function setFloor(n, fly = true) {
  S.floor = n;
  $$('[data-floor]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.floor === n)));
  S.twin.setFloor(n, fly);
  paint();
}
function setTower(z) {
  S.tower = z;
  $$('[data-tower]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tower === z)));
  S.twin.setTower(z); paint(); renderKpis(); renderTimeline();
}

// ------------------------------------------------------------------ détail d'un logement
function selectLogement(id, fly = false) {
  S.sel = id; S.special = null;
  S.twin.markElement(null);
  S.twin.select(id, fly);
  const url = new URL(location); if (id) url.searchParams.set('l', id); else url.searchParams.delete('l'); history.replaceState(null, '', url);
  if (!id) { closeDetail(); return; }
  $('#detail').hidden = false; document.body.classList.add('has-detail');
  renderDetail(); renderTimeline();
}
function updateInsets() {
  if (!S.twin) return;
  const wide = window.innerWidth > 900;
  const L = wide ? ($('.panel-left').getBoundingClientRect().right + 8) : 0;
  const R = wide ? (S.sel || S.special ? $('#detail').getBoundingClientRect().width + 26 : 70) : 0;
  S.twin.setInsets(L, R);
}
function closeDetail() {
  S.sel = null; S.special = null; S.twin?.select(null); S.twin?.markElement(null);
  $('#detail').hidden = true; document.body.classList.remove('has-detail');
  const url = new URL(location); url.searchParams.delete('l'); history.replaceState(null, '', url);
  renderTimeline(); updateInsets();
}
function showSpecial(sp) {
  S.sel = null; S.special = sp; S.twin.select(null);
  $('#detail').hidden = false; document.body.classList.add('has-detail');
  renderDetail(); renderTimeline(); updateInsets();
}
function monthlyBars(l) {
  const M = monthRanges();
  const vals = M.map(([a, b]) => ({ h: sumL(l, 'h', a, b), e: sumL(l, 'e', a, b), r: sumL(l, 'r', a, b), m: S.days[a].getMonth(), a, b }));
  const W = 340, H = 150, top = 8, base = H - 20, bw = W / 12;
  const mx = Math.max(...vals.map(v => Math.max(v.h + v.e, v.r + v.e))) * 1.08 || 1;
  const y = (v) => base - (v / mx) * (base - top);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Consommation mensuelle du logement ${l.id}` });
  for (const g of [0.5, 1]) svg.append(sv('line', { x1: 0, x2: W, y1: y(mx / 1.08 * g), y2: y(mx / 1.08 * g), stroke: 'rgba(176,196,214,.10)' }));
  const wrap = el('div', { class: 'chart-wrap' });
  const tip = el('div', { class: 'chart-tip', hidden: true });
  vals.forEach((v, i) => {
    const x0 = i * bw + 4, w = bw - 8;
    const g = sv('g', { tabindex: 0 });
    const hH = base - y(v.h), hE = base - y(v.e);
    if (v.h > 0) g.append(sv('rect', { x: x0, y: y(v.h), width: w, height: Math.max(0, hH), fill: '#d95926', rx: 0 }));
    if (v.e > 0) g.append(sv('rect', { x: x0, y: y(v.h + v.e) , width: w, height: Math.max(0, hE - 2), fill: '#3987e5', rx: 3 }));
    // référence recalée du chauffage : trait
    if (v.r > 1) g.append(sv('line', { x1: x0 - 2, x2: x0 + w + 2, y1: y(v.r), y2: y(v.r), stroke: '#eef1f2', 'stroke-width': 2, 'stroke-dasharray': '3 2' }));
    g.append(sv('rect', { x: i * bw, y: 0, width: bw, height: H, fill: 'transparent' }));
    svg.append(g);
    svg.append(sv('text', { x: i * bw + bw / 2, y: H - 5, 'text-anchor': 'middle', 'font-size': 10, fill: '#85919a' }, MOIS[v.m].replace('.', '')));
    const show = () => { tip.hidden = false; tip.style.left = `${((i + 0.5) / 12) * 100}%`; tip.style.top = `${(y(v.h + v.e) / H) * 100}%`;
      tip.innerHTML = `<b>${MOIS_L[v.m]}</b><br><span class="sw" style="background:#d95926"></span>Chauffage ${fmt(v.h)} kWh<br><span class="sw" style="background:#3987e5"></span>Eau chaude ${fmt(v.e)} kWh<br>Référence chauffage ${fmt(v.r)} kWh`; };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
    g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
  });
  wrap.append(svg, tip);
  return el('div', {}, wrap, el('div', { class: 'key' },
    el('span', {}, el('i', { style: { background: '#d95926' } }), 'Chauffage'), el('span', {}, el('i', { style: { background: '#3987e5' } }), 'Eau chaude'),
    el('span', {}, el('i', { class: 'line', style: { background: '#eef1f2' } }), 'Référence recalée')));
}
function alertCard(a) {
  const g = STATUS[a.gravite] || STATUS.attention;
  const d = dayIndex(a.debut);
  const per = a.fin ? `du ${fmtDay(d)} au ${fmtDay(dayIndex(a.fin))}` : `depuis le ${fmtDay(d)}`;
  const rule = S.J.regles.find(r => r.id === a.regle);
  return el('div', { class: 'alert-card', style: { '--pc': g.c } },
    el('h4', {}, icon(TYPE_ICON[a.type] || g.icon), a.titre),
    el('p', {}, el('b', { text: `${g.label} · ` }), per),
    el('p', {}, el('b', { text: 'Cause probable : ' }), a.cause),
    el('p', {}, el('b', { text: 'Action : ' }), a.action),
    a.cout_eur ? el('p', {}, el('b', { text: 'Coût estimé : ' }), `${fmt(a.cout_eur)} € TTC`) : null,
    rule ? el('p', {}, el('b', { text: `Règle ${rule.id} : ` }), rule.texte) : null,
    el('div', { class: 'tagline' }, el('span', { class: 'tag tag-fic', text: 'Anomalie simulée' }), el('span', { class: 'tag', text: 'Détection automatique' })));
}
function renderDetail() {
  const box = bind('detail'); box.textContent = '';
  if (S.special) return renderSpecial(box);
  const l = S.byId.get(S.sel); if (!l) return;
  const [a, b] = range();
  const U = USAGE[S.usage];
  const v = valueOf(l); const e = ecartOf(l);
  const unit = (S.usage === 'eau' ? 'L/m²' : 'kWh/m²') + (S.period === 'jour' ? ' par jour' : '');
  const dcls = Math.abs(e) < 0.05 ? 'flat' : e > 0 ? 'up' : 'down';
  const tours = { A1: 'Tour A1 · COGEDIM', A2: 'Tour A2 · CDC Habitat' };
  const em = new Date(l.emmenagement + 'T12:00:00');
  const H = S.hyp;
  const an = (k) => sumL(l, k, 0, S.ND - 1);
  const coutAn = (an('h') + an('e')) / 1000 * H.prix_chaleur + an('p') * H.prix_elec + H.abo_elec + an('w') / 1000 * H.prix_eau;
  const co2An = (an('h') + an('e')) * H.co2_chaleur + an('p') * H.co2_elec;
  const alerts = S.J.alertes.filter(x => x.cible === l.id);
  const miss = l.miss.reduce((s, x) => s + x, 0);
  box.append(...[
    el('p', { class: 'dt-eyebrow', text: `${tours[l.tour]} · R+${l.etage} · façade ${l.orient}` }),
    el('h2', { class: 'dt-title', text: l.id }),
    el('p', { class: 'dt-sub', text: `${l.typo} · ${fmt(l.shab, 2)} m²${l.ext ? ` + ${fmt(l.ext, 2)} m² extérieurs` : ''} · ${l.occupants} occupant${l.occupants > 1 ? 's' : ''} · emménagement ${em.getDate()} ${MOIS[em.getMonth()]} ${em.getFullYear()}` }),
    el('div', { class: 'dt-hero', style: { '--uc': `var(${U.css})` } }, el('span', { class: 'big', text: fmt(v, v < 10 ? 2 : 1) }), el('span', { class: 'unit', text: `${unit} · ${U.label.toLowerCase()}` }),
      el('span', { class: `delta ${dcls}`, text: `${e > 0 ? '+' : ''}${fmt(e * 100, 0)} %` })),
    el('p', { class: 'dt-note', text: `${periodLabel()} · écart ${S.usage === 'chauffage' ? 'à la référence recalée (météo, orientation, étage, typologie)' : `à la médiane des ${l.typo.slice(0, 2)} de la tour`}.` }),
    alerts.length ? el('div', { class: 'dt-section' }, el('h3', { text: 'Alertes' }), ...alerts.map(alertCard)) : null,
    el('div', { class: 'dt-section' }, el('h3', { text: 'Mois par mois' }), monthlyBars(l)),
    el('div', { class: 'dt-section' }, el('h3', { text: 'Sur l\'année' }),
      el('div', { class: 'dt-grid' },
        ...['chauffage', 'ecs', 'eau', 'elec'].map(u => {
          const K = USAGE[u]; const s = an(K.key);
          const val = u === 'eau' ? `${fmt(s / 1000, 1)} m³` : `${fmt(s)} kWh`;
          const sub = u === 'eau' ? `${fmt(s / l.occupants / S.ND)} L/hab./j` : `${fmt(s / l.shab, 1)} kWh/m²`;
          return el('div', { class: 'mini', style: { '--uc': `var(${K.css})` } }, el('span', { class: 'ml' }, icon(K.icon), K.label), el('div', { class: 'mv', text: val }), el('div', { class: 'ms', text: sub }));
        }),
        el('div', { class: 'mini' }, el('span', { class: 'ml', text: 'Facture énergie et eau' }), el('div', { class: 'mv', text: `${fmt(coutAn)} €` }), el('div', { class: 'ms', text: 'TTC, abonnement électrique compris' })),
        el('div', { class: 'mini' }, el('span', { class: 'ml', text: 'Émissions' }), el('div', { class: 'mv', text: `${fmt(co2An)} kg CO₂e` }), el('div', { class: 'ms', text: `${fmt(co2An / l.shab, 1)} kg/m²` })))),
    el('div', { class: 'dt-section' }, el('h3', { text: 'Comptage' }),
      el('dl', { class: 'facts' },
        el('dt', { text: 'Module' }), el('dd', { text: 'Module thermique d\'appartement Uponor Combi Port : chauffage, eau chaude et eau froide comptés séparément (CCTP 502 §5.5.1)' }),
        el('dt', { text: 'Relève' }), el('dd', { text: miss ? `Quotidienne ; ${miss} jours sans donnée, estimés` : 'Quotidienne, par radio' }),
        el('dt', { text: 'Ventilation' }), el('dd', { text: l.tour === 'A1' ? 'VMC simple flux hygroréglable B' : 'Double flux (variante A2)' }),
        el('dt', { text: 'Plan' }), el('dd', { text: `${l.plan} (tableau des surfaces ind. A)` })),
      el('div', { class: 'tagline' }, el('span', { class: 'tag tag-real', text: 'Typologie, surface, position : DCE et maquette' }), el('span', { class: 'tag tag-fic', text: 'Consommations simulées' }))),
    ouvragesBlock(l),
  ].filter(Boolean));
}
function ouvragesBlock(l) {
  if (!l.ouvrages.length) return null;
  const idx = S.J._idx;
  const rows = l.ouvrages.map(r => ({ ref: r, rec: S.ouv.ouvrages[r] })).filter(x => x.rec);
  const prio = { menuiserie_A1: 0, menuiserie_A2: 0, facade_A1: 1, facade_A2: 1, ite_A2: 1, balcon: 2, separatif: 3 };
  rows.sort((a, b) => (prio[a.rec.p] ?? 5) - (prio[b.rec.p] ?? 5) || a.ref.localeCompare(b.ref));
  const ul = el('ul', { class: 'links' });
  const shown = rows.slice(0, 7);
  for (const { ref, rec } of shown) {
    const p = S.ouv.profils[rec.p];
    ul.append(el('li', {}, el('a', { href: `../o/?r=${encodeURIComponent(ref)}#energie` }, el('b', { text: ref.replace(/^(A[12])-/, '$1 ').replace(/([A-Za-z]+)(\d)/, '$1 $2') }), el('span', { text: p ? p.titre.split(' — ')[0] : '' }))));
  }
  return el('div', { class: 'dt-section' }, el('h3', { text: `Ouvrages du logement (${rows.length})` }), ul,
    el('p', { class: 'dt-note', text: 'Chaque passeport d\'ouvrage porte maintenant un volet « Énergie » : composition, U ou R, source et fiabilité.' }));
}
function lineChart(series, opts) {
  // series : [{ v: [...], color, dash, label }] même unité (un seul axe)
  const W = 340, H = 140, top = 8, base = H - 18;
  const all = series.flatMap(s => s.v);
  const mn = opts.min ?? 0, mx = (opts.max ?? Math.max(...all)) * 1.05;
  const x = (i) => (i / (S.ND - 1)) * W, y = (v) => base - ((v - mn) / (mx - mn)) * (base - top);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label });
  for (const [a, b] of monthRanges()) { if (S.days[a].getMonth() % 3 === 0) svg.append(sv('text', { x: x(a), y: H - 3, 'font-size': 10, fill: '#85919a' }, MOIS[S.days[a].getMonth()])); }
  if (opts.band) svg.append(sv('rect', { x: x(opts.band[0]), y: top, width: x(opts.band[1]) - x(opts.band[0]), height: base - top, fill: 'rgba(255,61,139,.10)' }));
  for (const g of opts.grid || []) { svg.append(sv('line', { x1: 0, x2: W, y1: y(g), y2: y(g), stroke: 'rgba(176,196,214,.12)' })); svg.append(sv('text', { x: W, y: y(g) - 3, 'text-anchor': 'end', 'font-size': 10, fill: '#85919a' }, opts.gridLabel ? opts.gridLabel(g) : fmt(g))); }
  for (const s of series) {
    let d = ''; s.v.forEach((v, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); });
    svg.append(sv('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-dasharray': s.dash || null, 'stroke-linejoin': 'round' }));
  }
  return el('div', {}, el('div', { class: 'chart-wrap' }, svg), el('div', { class: 'key' }, ...series.map(s => el('span', {}, el('i', { class: 'line', style: { background: s.color } }), s.label))));
}
function smooth(a, n = 7) { return a.map((_, i) => { let s = 0, k = 0; for (let j = Math.max(0, i - n + 1); j <= i; j++) { s += a[j]; k++; } return s / k; }); }
function renderSpecial(box) {
  const sp = S.special;
  if (sp.kind === 'ss') {
    const T = S.J.tours[sp.tour].jour;
    const mta = T.mta, loss = T.pertes;
    const share = smooth(loss).map((v, i) => 100 * v / (v + smooth(mta)[i]));
    const a = sp.alerte;
    box.append(...[el('p', { class: 'dt-eyebrow', text: `${S.J.tours[sp.tour].nom} · parking R-1` }), el('h2', { class: 'dt-title', text: `Sous-station ${sp.tour}` }),
      el('p', { class: 'dt-sub', text: 'Échangeur raccordé au réseau de chaleur des Hauts de Garonne. Son compteur, comparé à la somme des modules thermiques, mesure les pertes de distribution.' }),
      el('div', { class: 'dt-section' }, el('h3', { text: 'Pertes de distribution, kWh par jour (moyenne 7 jours)' }),
        lineChart([{ v: smooth(loss), color: '#e66767', label: 'Pertes mesurées' }, { v: smooth(T.pertes_modele), color: '#b8c1c7', dash: '4 3', label: 'Modèle appris sur le 1er trimestre' }],
          { label: 'Pertes de distribution journalières, mesurées et attendues', grid: niceGrid(Math.max(...smooth(loss))), band: a ? [dayIndex(a.debut), a.fin ? dayIndex(a.fin) : S.ND - 1] : null })),
      el('div', { class: 'dt-section' }, el('h3', { text: 'Part de la chaleur perdue avant les logements' }),
        lineChart([{ v: share.map(x => Math.min(50, x)), color: '#c9a46a', label: 'Pertes / chaleur livrée, %' }], { label: 'Part des pertes', min: 0, max: 50, grid: [10, 20, 30, 40], gridLabel: (g) => `${g} %`, band: a ? [dayIndex(a.debut), a.fin ? dayIndex(a.fin) : S.ND - 1] : null })),
      a ? el('div', { class: 'dt-section' }, el('h3', { text: 'Alerte' }), alertCard(a)) : null,
      a ? el('p', { class: 'dt-note', text: `Excès de pertes sur l'épisode : ${fmt(a.exces_kwh)} kWh, soit ${fmt(a.cout_eur)} € TTC au prix du réseau.` }) : null].filter(Boolean));
  } else {
    const eff = S.J.tours.A2.cta_rendement.map(v => v * 100);
    const a = sp.alerte;
    box.append(...[el('p', { class: 'dt-eyebrow', text: 'Tour A2 · toiture · variante RE2020' }), el('h2', { class: 'dt-title', text: 'CTA A2 VMC 002' }),
      el('p', { class: 'dt-sub', text: 'Centrale double flux de 3 810 m³/h (colonnes c3, c8, c9). Le rendement de récupération est déduit des sondes de température de soufflage, d\'extraction et d\'air neuf.' }),
      el('div', { class: 'dt-section' }, el('h3', { text: 'Rendement de récupération, %' }),
        lineChart([{ v: eff, color: '#3987e5', label: 'Rendement journalier' }], { label: 'Rendement de récupération de la CTA', min: 50, max: 90, grid: [60, 72, 82], gridLabel: (g) => `${g} %`, band: a ? [dayIndex(a.debut), a.fin ? dayIndex(a.fin) : S.ND - 1] : null })),
      a ? el('div', { class: 'dt-section' }, el('h3', { text: 'Alerte' }), alertCard(a)) : null,
      el('div', { class: 'dt-section' }, el('h3', { text: 'Ouvrage dans la maquette' }), el('ul', { class: 'links' }, el('li', {}, el('a', { href: '../o/?r=A2-VMC002#energie' }, el('b', { text: 'A2 VMC 002' }), el('span', { text: 'Passeport de l\'équipement' })))))].filter(Boolean));
  }
}
function niceGrid(mx) { const p = Math.pow(10, Math.floor(Math.log10(mx))); const s = mx / p > 5 ? 2 * p : mx / p > 2 ? p : p / 2; const out = []; for (let v = s; v < mx; v += s) out.push(v); return out; }

// ------------------------------------------------------------------ récit : comparaison et coût global
function renderStory() {
  const J = S.J;
  // barres par usage (A1 creux, A2 plein, étiquettes directes)
  const host = bind('cmp-bars'); host.textContent = '';
  const per = (z, k) => S.L.filter(l => l.tour === z).reduce((s, l) => s + sumL(l, k, 0, S.ND - 1), 0) / J.tours[z].shab;
  const rows = [
    { u: 'chauffage', l: 'Chauffage', a: per('A1', 'h'), b: per('A2', 'h'), unit: 'kWh/m²' },
    { u: 'ecs', l: 'Eau chaude', a: per('A1', 'e'), b: per('A2', 'e'), unit: 'kWh/m²' },
    { u: 'ecs', l: 'Chaleur achetée au réseau', a: sumT('A1', 'reseau', 0, S.ND - 1) / J.tours.A1.shab, b: sumT('A2', 'reseau', 0, S.ND - 1) / J.tours.A2.shab, unit: 'kWh/m²', c: '#c9a46a' },
    { u: 'elec', l: 'Ventilation (électricité)', a: sumT('A1', 'ventilation', 0, S.ND - 1) / J.tours.A1.shab, b: sumT('A2', 'ventilation', 0, S.ND - 1) / J.tours.A2.shab, unit: 'kWh/m²' },
    { u: 'eau', l: 'Eau', a: per('A1', 'w'), b: per('A2', 'w'), unit: 'L/m²' },
  ];
  const W = Math.max(320, Math.round(host.clientWidth || 520)), rowH = 46, H = rows.length * rowH + 10, lab = Math.min(190, W * 0.36);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Consommation par m² des tours A1 et A2' });
  rows.forEach((r, i) => {
    const c = r.c || USAGE[r.u].hex;
    const mx = Math.max(r.a, r.b) * 1.15;
    const sx = (v) => (v / mx) * (W - lab - 84);
    const y0 = i * rowH + 6;
    svg.append(sv('text', { x: 0, y: y0 + 17, 'font-size': 13, fill: '#eef1f2', 'font-weight': 600 }, r.l));
    svg.append(sv('text', { x: 0, y: y0 + 33, 'font-size': 11.5, fill: '#85919a' }, `${r.b < r.a ? '−' : '+'}${fmt(Math.abs(r.b / r.a - 1) * 100)} % en A2`));
    svg.append(sv('rect', { x: lab, y: y0 + 4, width: Math.max(2, sx(r.a)), height: 14, rx: 4, fill: 'none', stroke: c, 'stroke-width': 1.5 }));
    svg.append(sv('text', { x: lab + sx(r.a) + 8, y: y0 + 15, 'font-size': 12, fill: '#b8c1c7' }, `A1 · ${fmt(r.a, r.a < 20 ? 1 : 0)}`));
    svg.append(sv('rect', { x: lab, y: y0 + 22, width: Math.max(2, sx(r.b)), height: 14, rx: 4, fill: c }));
    svg.append(sv('text', { x: lab + sx(r.b) + 8, y: y0 + 33, 'font-size': 12, fill: '#eef1f2', 'font-weight': 600 }, `A2 · ${fmt(r.b, r.b < 20 ? 1 : 0)}`));
  });
  host.append(el('div', { class: 'chart-wrap' }, svg), el('div', { class: 'key' }, el('span', {}, el('i', { class: 'hollow', style: { '--c': '#b8c1c7' } }), 'Tour A1 (DCE, contour)'), el('span', {}, el('i', { style: { background: '#b8c1c7' } }), 'Tour A2 (variante, plein)'),
    el('span', { text: 'Écart d\'eau et d\'eau chaude : effet du nombre d\'occupants, pas de la variante.' })));

  // réseau mois par mois : barres groupées
  const mh = bind('cmp-months'); mh.textContent = '';
  const M = monthRanges();
  const data = M.map(([a, b]) => ({ m: S.days[a].getMonth(), A1: sumT('A1', 'reseau', a, b) / 1000, A2: sumT('A2', 'reseau', a, b) / 1000, sol: sumT('A2', 'solaire', a, b) / 1000 }));
  const W2 = Math.max(320, Math.round(mh.clientWidth || 640)), H2 = 220, top = 10, base = H2 - 24, gw = W2 / 12;
  const mx = Math.max(...data.map(d => Math.max(d.A1, d.A2 + d.sol))) * 1.1;
  const y = (v) => base - (v / mx) * (base - top);
  const s2 = sv('svg', { viewBox: `0 0 ${W2} ${H2}`, role: 'img', 'aria-label': 'Chaleur achetée au réseau par mois, tours A1 et A2' });
  for (const g of niceGrid(mx)) { s2.append(sv('line', { x1: 0, x2: W2, y1: y(g), y2: y(g), stroke: 'rgba(176,196,214,.10)' })); s2.append(sv('text', { x: 0, y: y(g) - 3, 'font-size': 10, fill: '#85919a' }, `${fmt(g)} MWh`)); }
  const wrap = el('div', { class: 'chart-wrap' }); const tip = el('div', { class: 'chart-tip', hidden: true });
  data.forEach((d, i) => {
    const x0 = i * gw + gw * 0.14, bw = gw * 0.34;
    const g = sv('g', { tabindex: 0 });
    g.append(sv('rect', { x: x0, y: y(d.A1), width: bw, height: base - y(d.A1), fill: 'none', stroke: '#c9a46a', 'stroke-width': 1.5, rx: 3 }));
    g.append(sv('rect', { x: x0 + bw + 2, y: y(d.A2), width: bw, height: base - y(d.A2), fill: '#c9a46a', rx: 3 }));
    if (d.sol > 0.05) g.append(sv('rect', { x: x0 + bw + 2, y: y(d.A2 + d.sol), width: bw, height: Math.max(0, base - y(d.sol) - 2), fill: '#fab219', opacity: 0.0 }));
    if (d.sol > 0.05) g.append(sv('rect', { x: x0 + bw + 2, y: y(d.A2 + d.sol), width: bw, height: Math.max(1, y(d.A2) - y(d.A2 + d.sol) - 2), fill: 'url(#hatch-sol)', stroke: '#c98500', 'stroke-width': 1, rx: 3 }));
    g.append(sv('rect', { x: i * gw, y: 0, width: gw, height: H2, fill: 'transparent' }));
    s2.append(g);
    s2.append(sv('text', { x: i * gw + gw / 2, y: H2 - 6, 'text-anchor': 'middle', 'font-size': 11, fill: '#85919a' }, MOIS[d.m]));
    const show = () => { tip.hidden = false; tip.style.left = `${((i + 0.5) / 12) * 100}%`; tip.style.top = `${(y(Math.max(d.A1, d.A2 + d.sol)) / H2) * 100}%`;
      tip.innerHTML = `<b>${MOIS_L[d.m]}</b><br>A1 ${fmt(d.A1, 1)} MWh · A2 ${fmt(d.A2, 1)} MWh<br>Solaire A2 ${fmt(d.sol, 1)} MWh`; };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show); g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
  });
  const defs = sv('defs'); const pat = sv('pattern', { id: 'hatch-sol', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(sv('rect', { width: 6, height: 6, fill: 'rgba(201,133,0,.15)' }), sv('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#c98500', 'stroke-width': 2 })); defs.append(pat); s2.prepend(defs);
  wrap.append(s2, tip);
  mh.append(wrap, el('div', { class: 'key' }, el('span', {}, el('i', { class: 'hollow', style: { '--c': '#c9a46a' } }), 'Tour A1'), el('span', {}, el('i', { style: { background: '#c9a46a' } }), 'Tour A2'),
    el('span', {}, el('i', { style: { background: 'repeating-linear-gradient(45deg,#c98500 0 2px,rgba(201,133,0,.15) 2px 5px)' } }), 'Chaleur fournie par le soleil en A2')));

  renderCoutGlobal();
  // règles, sources, colophon
  const rl = bind('rules'); rl.textContent = '';
  for (const r of J.regles) rl.append(el('li', {}, el('b', {}, el('span', { class: 'rid', text: r.id }), r.label), r.texte));
  const src = bind('real-src'); src.textContent = '';
  const ul = el('ul', { class: 'norms' });
  for (const h of Object.values(J.hypotheses)) if (h.fiab === 'verifie') ul.append(el('li', {}, el('b', { text: `${h.label} : ${fmt(h.valeur, h.valeur < 1 ? 4 : 2)} ${h.unite}. ` }), h.src));
  src.append(ul);
  bind('cep').textContent = `Cep ${fmt(J.reference.cep_etude, 1)} kWhep/m².an pour ${fmt(J.reference.cep_max, 1)} autorisés, Bbio ${fmt(J.reference.bbio, 1)}`;
  bind('gen-date').textContent = new Date(J.genere + 'T12:00:00').toLocaleDateString('fr-FR');
}

function renderCoutGlobal() {
  const form = bind('cg-form');
  if (!form.childElementCount) {
    const H = S.J.hypotheses;
    const field = (k, step, label, hint, isHyp) => el('label', { class: isHyp ? 'is-hyp' : '' }, el('span', {}, label, el('small', { text: hint })),
      el('input', { type: 'number', step, value: S.hyp[k], 'data-k': k, inputmode: 'decimal', oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { S.hyp[k] = v; renderCoutGlobal(); renderKpis(); } } }));
    form.append(el('h3', { text: 'Prix (sources publiques)' }),
      field('prix_chaleur', 0.01, 'Chaleur du réseau, € TTC/MWh', 'Hauts de Garonne, prix moyen 2023'),
      field('prix_elec', 0.0001, 'Électricité, € TTC/kWh', 'Tarif réglementé Base 6 kVA'),
      field('prix_eau', 0.01, 'Eau, € TTC/m³', 'Bordeaux Métropole, 2024'),
      el('h3', { text: 'Hypothèses' }),
      field('evol_energie', 0.1, 'Évolution de l\'énergie, %/an', 'À ajuster', true),
      field('evol_eau', 0.1, 'Évolution de l\'eau, %/an', 'À ajuster', true),
      field('co2_elec', 0.001, 'CO₂ de l\'électricité, kg/kWh', 'Ordre de grandeur, à vérifier', true),
      el('h3', { text: 'Variante A2' }),
      el('label', {}, el('span', {}, 'Surcoût de la variante, € TTC', el('small', { text: 'Issu de votre chiffrage (vide = non calculé)' })),
        el('input', { type: 'number', step: 1000, placeholder: 'ex. 450 000', 'data-k': 'surcout', oninput: (e) => { S.surcout = parseFloat(e.target.value) || 0; renderCoutGlobal(); } })));
  }
  const H = S.hyp, YEARS = 50, J = S.J;
  const last = S.ND - 1;
  const yearCost = (z) => {
    const L = S.L.filter(l => l.tour === z);
    const heat = sumT(z, 'reseau', 0, last) / 1000 * H.prix_chaleur;
    const elec = (sumT(z, 'elec_priv', 0, last) + sumT(z, 'sg', 0, last)) * H.prix_elec + L.length * H.abo_elec;
    const water = L.reduce((s, l) => s + sumL(l, 'w', 0, last), 0) / 1000 * H.prix_eau;
    return { energy: heat + elec, water };
  };
  // économie attribuable à la variante (ramenée à la surface de A2) : chauffage, solaire, ventilation
  const sh2 = J.tours.A2.shab, sh1 = J.tours.A1.shab;
  const heat = (z) => S.L.filter(l => l.tour === z).reduce((s, l) => s + sumL(l, 'h', 0, last), 0);
  const dHeat = (heat('A1') / sh1 - heat('A2') / sh2) * sh2;           // kWh
  const solar = sumT('A2', 'solaire', 0, last);                          // kWh
  const dVent = (sumT('A2', 'ventilation', 0, last) / sh2 - sumT('A1', 'ventilation', 0, last) / sh1) * sh2; // kWh élec en plus
  const gainHeatKwh = (dHeat + solar) * (1 + J.calage.pertes_distribution.A2);
  const gainEur = gainHeatKwh / 1000 * H.prix_chaleur - dVent * H.prix_elec;
  const gainCo2 = gainHeatKwh * H.co2_chaleur - dVent * H.co2_elec;
  const c1 = yearCost('A1'), c2 = yearCost('A2');
  const ge = H.evol_energie / 100, gw = H.evol_eau / 100;
  const cum1 = [0], cum2 = [S.surcout || 0], save = [0];
  for (let y = 0; y < YEARS; y++) {
    cum1.push(cum1[y] + (c1.energy * Math.pow(1 + ge, y)) / sh1 * sh2);
    cum2.push(cum2[y] + c2.energy * Math.pow(1 + ge, y));
    save.push(save[y] + gainEur * Math.pow(1 + ge, y));
  }
  let payback = null;
  if (S.surcout > 0) { for (let y = 1; y <= YEARS; y++) if (save[y] >= S.surcout) { payback = y - 1 + (S.surcout - save[y - 1]) / (save[y] - save[y - 1]); break; } }
  // graphique
  const host = bind('cg-chart'); host.textContent = '';
  const W = Math.max(320, Math.round(host.clientWidth || 640)), Hh = 260, top = 10, base = Hh - 24, left = 46;
  const mx = Math.max(cum1[YEARS], cum2[YEARS]) * 1.05;
  const x = (y) => left + (y / YEARS) * (W - left - 70), yy = (v) => base - (v / mx) * (base - top);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': 'Dépenses cumulées d\'énergie sur 50 ans, tours A1 et A2' });
  for (const g of niceGrid(mx)) { svg.append(sv('line', { x1: left, x2: W - 70, y1: yy(g), y2: yy(g), stroke: 'rgba(176,196,214,.10)' })); svg.append(sv('text', { x: left - 6, y: yy(g) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#85919a' }, `${fmt(g / 1e6, 1)} M€`)); }
  for (const y of [0, 10, 20, 30, 40, 50]) svg.append(sv('text', { x: x(y), y: Hh - 6, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#85919a' }, y ? `${y} ans` : 'Livraison'));
  const line = (arr, color, dash) => { let d = ''; arr.forEach((v, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + yy(v).toFixed(1); }); svg.append(sv('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': dash })); };
  line(cum1, '#b8c1c7', '5 4'); line(cum2, '#c9a46a');
  svg.append(sv('text', { x: x(YEARS) + 6, y: yy(cum1[YEARS]) + 4, 'font-size': 12, fill: '#b8c1c7' }, 'Base DCE'));
  svg.append(sv('text', { x: x(YEARS) + 6, y: yy(cum2[YEARS]) + 4, 'font-size': 12, fill: '#c9a46a', 'font-weight': 700 }, 'Variante'));
  if (payback != null) { svg.append(sv('line', { x1: x(payback), x2: x(payback), y1: top, y2: base, stroke: '#ff3d8b', 'stroke-dasharray': '3 3' })); svg.append(sv('text', { x: x(payback) + 5, y: top + 12, 'font-size': 11.5, fill: '#ff3d8b' }, `retour en ${fmt(payback, 1)} ans`)); }
  host.append(el('div', { class: 'chart-wrap' }, svg), el('div', { class: 'key' }, el('span', {}, el('i', { class: 'line', style: { background: '#b8c1c7' } }), 'Tour A1 (base DCE), ramenée à la surface de A2'), el('span', {}, el('i', { class: 'line', style: { background: '#c9a46a' } }), 'Tour A2 (variante), surcoût compris')));
  bind('cg-sub').textContent = 'Chaleur et électricité, € TTC, prix évolutifs. Tour A1 ramenée à la surface de A2 pour comparer à périmètre égal.';
  const out = bind('cg-out'); out.textContent = '';
  const k = (l, v, u, s) => el('div', { class: 'kpi' }, el('span', { class: 'kpi-l', text: l }), el('span', { class: 'kpi-v' }, v, el('small', { text: u })), s ? el('span', { class: 'kpi-s', text: s }) : null);
  out.append(
    k('Économie de la variante, année 1', fmt(gainEur), '€ TTC', `${fmt(gainHeatKwh / 1000, 1)} MWh de chaleur évités, ventilation déduite`),
    k('Économie cumulée sur 50 ans', fmt(save[YEARS] / 1000), 'k€', `Émissions évitées : ${fmt(gainCo2 * YEARS / 1000, 0)} t CO₂e`),
    k('Temps de retour', payback != null ? fmt(payback, 1) : '—', payback != null ? 'ans' : '', S.surcout > 0 ? (payback == null ? 'Non atteint en 50 ans' : `Pour ${fmt(S.surcout)} € de surcoût`) : 'Saisissez le surcoût de la variante'),
  );
}

// ------------------------------------------------------------------ démarrage
async function main() {
  const get = (p) => fetch(p, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
  const [J, LG, SE, OU] = await Promise.all([get('../data/energie/jumeau.json'), get('../data/energie/logements.json'), get('../data/energie/series.json'), get('../data/energie/ouvrages.json')]);
  prepare(J, LG, SE, OU);
  bind('period-label').textContent = `${fmtDay(0)} → ${fmtDay(S.ND - 1)}`;
  renderStory();
  let rsT = 0; let lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (Math.abs(window.innerWidth - lastW) < 40) return; lastW = window.innerWidth; clearTimeout(rsT); rsT = setTimeout(renderStory, 250); });
  buildPins();
  wireTimeline();

  const params = new URLSearchParams(location.search);
  const centers = { A1: J.tours.A1.centre, A2: J.tours.A2.centre };
  S.twin = await createTwin($('#stage'), {
    logements: S.L, centers, floor0: LG.geometrie.plancher_r1, elementLog: S.index,
    onPick: (id) => { stop(); if (id) selectLogement(id, false); else if (!S.special) closeDetail(); },
    onHover: (id, x, y) => {
      const tip = $('[data-v="tip"]');
      if (!id) { tip.hidden = true; return; }
      const l = S.byId.get(id); const U = USAGE[S.usage];
      const v = valueOf(l), e = ecartOf(l);
      tip.innerHTML = `<b>${l.id} · ${l.typo}</b><span>${U.label} : ${fmt(v, v < 10 ? 2 : 1)} ${S.usage === 'eau' ? 'L/m²' : 'kWh/m²'} · ${e > 0 ? '+' : ''}${fmt(e * 100)} %</span>`;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`; tip.hidden = false;
    },
    onFrame: updatePins,
  });

  updateInsets();
  window.addEventListener('resize', updateInsets);
  const hint = $('[data-v="hint"]');
  if (hint) { const gone = () => hint.classList.add('is-gone'); $('#stage').addEventListener('pointerdown', gone, { once: true }); setTimeout(gone, 7000); }
  // contrôles
  $$('[data-usage]').forEach(b => b.addEventListener('click', () => setUsage(b.dataset.usage)));
  $$('[data-color]').forEach(b => b.addEventListener('click', () => { S.color = b.dataset.color; $$('[data-color]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); paint(); if (S.sel) renderDetail(); }));
  $$('[data-period]').forEach(b => b.addEventListener('click', () => { stop(); setPeriod(b.dataset.period); }));
  $$('[data-floor]').forEach(b => b.addEventListener('click', () => setFloor(+b.dataset.floor)));
  $$('[data-tower]').forEach(b => b.addEventListener('click', () => setTower(b.dataset.tower)));
  $('[data-act="play"]').addEventListener('click', toggle);
  $('[data-act="reset"]').addEventListener('click', () => { const pb = $('[data-act="plan"]'); pb.setAttribute('aria-pressed', 'false'); setFloor(0); S.twin.reset(); });
  $('[data-act="fullscreen"]').addEventListener('click', () => S.twin.fullscreen());
  $('[data-act="plan"]').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    if (on && !S.floor) { S.floor = 5; $$('[data-floor]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.floor === 5))); S.twin.state.floor = 5; }
    S.twin.state.plan = on; S.twin.setFloor(S.floor); paint();
  });
  $('[data-close-detail]').addEventListener('click', closeDetail);
  const dq = $('#dlg-qr');
  $('#btn-qr').addEventListener('click', () => { stop(); dq.showModal(); });
  dq.querySelector('[data-close]').addEventListener('click', () => dq.close());
  dq.addEventListener('click', (e) => { if (e.target === dq) dq.close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#detail').hidden) closeDetail(); });

  // état initial
  const d = params.get('d'); if (d) { const i = dayIndex(d); if (i >= 0 && i < S.ND) { S.day = i; S.period = 'jour'; } }
  const u = params.get('u'); if (u && USAGE[u]) S.usage = u;
  setPeriod(S.period, false); setUsage(S.usage); setDay(S.day); renderTimeline();
  const l = params.get('l');
  if (l && S.byId.has(l)) {
    const lg = S.byId.get(l);
    setTimeout(() => { selectLogement(l, true); }, 900);
    if (lg) S.tower = 'ALL';
  } else if (!reduceMotion() && !d) {
    // la ville s'allume : lecture de l'année au premier affichage
    setTimeout(() => { if (!S.sel && !S.playing && S.day === 112) { S.day = 0; play(); } }, 2400);
  }
  document.documentElement.classList.add('ready');
}
main().catch((e) => {
  console.error(e);
  const st = $('[data-v="status"]'); if (st) { st.hidden = false; st.textContent = 'Le jumeau n\'a pas pu se charger. Rechargez la page.'; }
});
