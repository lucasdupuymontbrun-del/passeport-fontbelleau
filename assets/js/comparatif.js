// Comparatif général des tours A1 et A2 : rendu de la page à partir de data/comparatif/comparatif.json.
// Les prix unitaires, les prix de l'énergie et l'entretien sont modifiables ; tout se recalcule.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const bind = (k) => $(`[data-bind="${k}"]`);
const NS = 'http://www.w3.org/2000/svg';
const STORE = 'fontbelleau-comparatif-v1';

const S = { D: null, pu: {}, maint: {}, prix: {}, lots: 'all', qgrp: 'Tout', qdiff: false };

// éléments de la variante : postes de coût, gain d'énergie et entretien rattachés
const ELEMS = [
  { id: 'ite', label: 'Enveloppe : ITE et coffres isolés', postes: ['ite', 'dbl', 'prep', 'las', 'vr'], gain: 'ite', maint: [] },
  { id: 'df', label: 'Ventilation double flux', postes: ['df', 'sf'], gain: 'df', maint: ['vent'] },
  { id: 'sol', label: 'Eau chaude solaire', postes: ['sol'], gain: 'sol', maint: ['sol'] },
  { id: 'tv', label: 'Toiture végétalisée', postes: ['tv', 'grav'], gain: 'tv', maint: ['toit'] },
  { id: 'bc', label: 'Béton bas carbone', postes: ['bc'], gain: 'bc', maint: [] },
];
const FIAB_CLASS = { maquette: 'fiab-modele', cctp: 'fiab-cctp', cctp_nm: 'fiab-cctpnm', variante: 'fiab-saisi', calcul: 'fiab-calc', estime: 'fiab-estime', cite: 'fiab-cite', hypothese: 'fiab-hypothese', budget: 'fiab-cctp', simule: 'fiab-fictif' };
const ECART = { identique: 'Identique', modifie: 'Modifié', ajoute: 'Ajouté', supprime: 'Supprimé', programme: 'Programme' };

// ---------- utilitaires ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv2] of Object.entries(v)) { if (sk.startsWith('--')) n.style.setProperty(sk, sv2); else n.style[sk] = sv2; } }
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function sv(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
function icon(id, cls = 'ico') {
  const s = sv('svg', { class: cls, 'aria-hidden': 'true' });
  s.append(sv('use', { href: '#' + id }));
  return s;
}
const nf = {};
function fmt(v, d = 0) {
  if (v == null || !isFinite(v)) return '—';
  const k = d;
  nf[k] = nf[k] || new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  return nf[k].format(v).replace(/ /g, ' ');
}
const sign = (v, d = 0) => (v > 0.5 * Math.pow(10, -d) ? '+' : v < -0.5 * Math.pow(10, -d) ? '−' : '') + fmt(Math.abs(v), d);
const fiab = (k) => el('span', { class: `fiab ${FIAB_CLASS[k] || ''}`, text: S.D.fiab[k] || k });

function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ pu: S.pu, maint: S.maint, prix: S.prix })); } catch (e) { /* stockage indisponible */ }
}
function restore() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (v) { S.pu = v.pu || {}; S.maint = v.maint || {}; S.prix = v.prix || {}; }
  } catch (e) { /* stockage indisponible */ }
}

// ---------- calculs ----------
function pu(p) { return S.pu[p.id] != null ? S.pu[p.id] : p.pu; }
function mt(m, z) { return S.maint[m.id] && S.maint[m.id][z] != null ? S.maint[m.id][z] : m[z]; }
function prix(k) { return S.prix[k] != null ? S.prix[k] : S.D.exploitation.prix[k]; }

function compute() {
  const D = S.D, C = D.couts, E = D.exploitation;
  const coef = C.bt01.actuel / C.bt01.base;
  const montant = {};
  for (const p of C.postes) montant[p.id] = p.qte * pu(p);
  const delta = Object.values(montant).reduce((a, b) => a + b, 0);
  const byLot = {};
  for (const p of C.postes) byLot[p.lot] = (byLot[p.lot] || 0) + montant[p.id];
  const a1 = C.budget.reduce((s, b) => s + b.A1_2020, 0) * coef;
  const gEur = {}, gCo2 = {};
  for (const g of E.gains) {
    gEur[g.id] = g.chaleur / 1000 * prix('prix_chaleur') + g.elec * prix('prix_elec');
    gCo2[g.id] = g.chaleur * prix('co2_chaleur') + g.elec * prix('co2_elec');
  }
  const dm = {};
  for (const m of E.maintenance) dm[m.id] = mt(m, 'A2') - mt(m, 'A1');
  const elems = ELEMS.map((x) => {
    const capex = x.postes.reduce((s, id) => s + (montant[id] || 0), 0);
    const energie = gEur[x.gain] || 0;
    const entretien = x.maint.reduce((s, id) => s + (dm[id] || 0), 0);
    const net = energie - entretien;
    return { ...x, capex, energie, entretien, net, co2: gCo2[x.gain] || 0, retour: net > 0 && capex > 0 ? capex / net : null };
  });
  const gain = Object.values(gEur).reduce((a, b) => a + b, 0);
  const co2 = Object.values(gCo2).reduce((a, b) => a + b, 0);
  const maint = Object.values(dm).reduce((a, b) => a + b, 0);
  return { coef, montant, delta, byLot, a1, a2: a1 + delta, gain, co2, maint, net: gain - maint, elems, gEur, gCo2, dm };
}

// ---------- info-bulle ----------
const tip = { el: null };
function showTip(e, html) {
  tip.el = tip.el || bind('tip');
  tip.el.innerHTML = html;
  tip.el.hidden = false;
  moveTip(e);
}
function moveTip(e) {
  if (!tip.el || tip.el.hidden) return;
  const x = e.clientX ?? 0, y = e.clientY ?? 0;
  const w = tip.el.offsetWidth, h = tip.el.offsetHeight;
  tip.el.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14)) + 'px';
  tip.el.style.top = Math.max(8, y - h - 12) + 'px';
}
function hideTip() { if (tip.el) tip.el.hidden = true; }
function hover(node, html) {
  node.addEventListener('pointerenter', (e) => showTip(e, typeof html === 'function' ? html() : html));
  node.addEventListener('pointermove', moveTip);
  node.addEventListener('pointerleave', hideTip);
}

// ---------- graphiques ----------
function width(host) { return Math.max(300, Math.round(host.clientWidth || host.parentElement.clientWidth || 640)); }

// barres horizontales autour de zéro : le signe est porté par la position, la couleur reste neutre
function divergingBars(host, rows, { unit = '€', aria, left = '← économie', right = 'surcoût →' }) {
  host.textContent = '';
  const W = width(host), narrow = W < 560;
  const labW = narrow ? 0 : Math.min(300, Math.round(W * 0.34));
  const rowH = narrow ? 50 : 34, barH = 16, top = 6, padR = 8;
  const H = top + rows.length * rowH + 22;
  const lo = Math.min(0, ...rows.map((r) => r.value)), hi = Math.max(0, ...rows.map((r) => r.value));
  const span = (hi - lo) || 1;
  // marges réservées aux étiquettes de valeur, selon leur longueur
  const lw = (v) => (`${sign(v)} ${unit}`.length * 7.4 + 10);
  const mL = lo < 0 ? Math.max(...rows.filter((r) => r.value < 0).map((r) => lw(r.value))) : 8;
  const mR = hi > 0 ? Math.max(...rows.filter((r) => r.value >= 0).map((r) => lw(r.value))) : 8;
  const x0 = labW + mL, x1 = W - padR - mR;
  const x = (v) => x0 + ((v - lo) / span) * (x1 - x0);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria });
  if (!narrow) {
    svg.append(sv('line', { x1: x(0), x2: x(0), y1: top - 2, y2: H - 18, stroke: '#1e2428', 'stroke-width': 1 }));
    svg.append(sv('text', { x: x(0), y: H - 4, class: 'ax', 'text-anchor': 'middle' }, '0'));
  }
  if (lo < 0) svg.append(sv('text', { x: narrow ? 0 : x0, y: H - 4, class: 'ax', 'text-anchor': 'start' }, left));
  if (hi > 0) svg.append(sv('text', { x: narrow ? W : x1, y: H - 4, class: 'ax', 'text-anchor': 'end' }, right));
  rows.forEach((r, i) => {
    const y = top + i * rowH + (narrow ? 22 : (rowH - barH) / 2);
    const g = sv('g', { class: 'row-g' });
    if (narrow) g.append(sv('text', { x: 0, y: y - 6, class: 'lbl' }, r.label));
    else g.append(sv('text', { x: 0, y: y + barH / 2 + 4.5, class: 'lbl' }, r.label));
    const a = x(Math.min(0, r.value)), b = x(Math.max(0, r.value));
    const w = Math.max(2, b - a);
    // extrémité arrondie du côté de la valeur, droite contre l'axe
    const neg = r.value < 0;
    const rad = Math.min(4, w / 2);
    const d = neg
      ? `M${b},${y} H${a + rad} Q${a},${y} ${a},${y + rad} V${y + barH - rad} Q${a},${y + barH} ${a + rad},${y + barH} H${b} Z`
      : `M${a},${y} H${b - rad} Q${b},${y} ${b},${y + rad} V${y + barH - rad} Q${b},${y + barH} ${b - rad},${y + barH} H${a} Z`;
    g.append(sv('path', { d, style: `fill:${r.color || 'var(--delta)'}`, class: 'mark-bar' }));
    if (narrow) g.append(sv('line', { x1: x(0), x2: x(0), y1: y - 3, y2: y + barH + 3, stroke: '#1e2428', 'stroke-width': 1 }));
    const tx = neg ? a - 6 : b + 6;
    g.append(sv('text', { x: tx, y: y + barH / 2 + 4.5, class: 'val', 'text-anchor': neg ? 'end' : 'start' }, `${sign(r.value)} ${unit}`));
    const hit = sv('rect', { x: 0, y: y - (narrow ? 20 : 8), width: W, height: rowH, class: 'hit' });
    g.prepend(hit);
    if (r.tip) hover(g, r.tip);
    svg.append(g);
  });
  host.append(svg);
}

// barres groupées A1 / A2 sur un axe commun
function groupedBars(host, rows, { unit, aria }) {
  host.textContent = '';
  const W = width(host), narrow = W < 560;
  const labW = narrow ? 0 : Math.min(260, Math.round(W * 0.3));
  const bh = 12, gap = 2, rowH = narrow ? 58 : 44, top = 4;
  const H = top + rows.length * rowH + 4;
  const mx = Math.max(...rows.flatMap((r) => [r.a1, r.a2])) || 1;
  const x0 = labW, x1 = W - 64;
  const x = (v) => x0 + (v / mx) * (x1 - x0);
  const key = el('div', { class: 'key' },
    el('span', { style: { '--c': 'var(--a1)' } }, el('i'), 'Tour A1 — DCE'),
    el('span', { style: { '--c': 'var(--a2)' } }, el('i'), 'Tour A2 — variante'));
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria });
  rows.forEach((r, i) => {
    const yb = top + i * rowH + (narrow ? 20 : (rowH - 2 * bh - gap) / 2);
    const g = sv('g', { class: 'row-g' });
    g.append(sv('rect', { x: 0, y: top + i * rowH, width: W, height: rowH, class: 'hit' }));
    if (narrow) g.append(sv('text', { x: 0, y: yb - 6, class: 'lbl' }, r.label));
    else g.append(sv('text', { x: 0, y: yb + bh + 4, class: 'lbl' }, r.label));
    [['a1', 'var(--a1)', 0], ['a2', 'var(--a2)', bh + gap]].forEach(([k, c, dy]) => {
      const v = r[k], w = Math.max(v > 0 ? 3 : 0, x(v) - x0), y = yb + dy, rad = Math.min(4, w / 2);
      if (w > 0) g.append(sv('path', { d: `M${x0},${y} H${x0 + w - rad} Q${x0 + w},${y} ${x0 + w},${y + rad} V${y + bh - rad} Q${x0 + w},${y + bh} ${x0 + w - rad},${y + bh} H${x0} Z`, style: `fill:${c}`, class: 'mark-bar' }));
      g.append(sv('text', { x: x0 + w + 6, y: y + bh - 2, class: 'val' }, fmt(v, 1)));
    });
    hover(g, () => `<b>${r.label}</b><br>Tour A1 : ${fmt(r.a1, 1)} ${unit}<br>Tour A2 : ${fmt(r.a2, 1)} ${unit}<br><span>Écart : ${sign(r.a2 - r.a1, 1)} ${unit}</span>`);
    svg.append(g);
  });
  svg.append(sv('line', { x1: x0, x2: x0, y1: top, y2: H - 4, stroke: '#1e2428', 'stroke-width': 1 }));
  host.append(key, svg);
}

// ---------- rendu ----------
function renderTowers() {
  const D = S.D, host = bind('towers');
  const tags = { A1: ['Doublage intérieur', 'VMC hygro B', 'Gravillons en toiture', 'Comptage en option'], A2: ['ITE 140 mm', 'Double flux', 'Solaire 30 m²', 'Toiture végétalisée', 'Béton bas carbone'] };
  for (const z of ['A1', 'A2']) {
    const t = D.tours[z];
    const typo = Object.entries(t.typologies).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${v} ${k}`).join(' · ');
    host.append(el('article', { class: 'tower', 'data-t': z },
      el('div', { class: 'tower-head' }, el('span', { class: 'tower-name', text: `Tour ${z}` }), el('span', { class: 'tower-who', text: t.nom.split('— ')[1] || '' })),
      el('div', { class: 'tower-concept', text: t.conception }),
      el('dl', { class: 'tower-facts' },
        el('div', {}, el('dt', { text: 'Logements' }), el('dd', { text: fmt(t.logements) })),
        el('div', {}, el('dt', { text: 'Surface habitable' }), el('dd', { text: `${fmt(t.shab)} m²` })),
        el('div', {}, el('dt', { text: 'Typologies' }), el('dd', { style: { fontSize: '15px', fontWeight: 650, fontStretch: '90%', paddingTop: '4px' }, text: typo }))),
      el('div', { class: 'tower-tags' }, tags[z].map((x) => el('span', { class: 'ttag', text: x })))));
  }
}

function renderDocs() {
  const host = bind('docs');
  for (const d of S.D.documents) {
    const ext = d.fichier.split('.').pop();
    const name = d.fichier.split('/').pop();
    host.append(el('li', {}, el('a', { class: `dl dl-${ext}`, href: d.fichier, download: name },
      icon(ext === 'xlsx' ? 'i-xlsx' : 'i-pdf', 'ico-big'),
      el('strong', { text: d.titre }), el('small', { text: `${d.detail} · .${ext}` }),
      el('span', { class: 'dl-go' }, icon('i-download'), el('span', { text: 'Télécharger' })))));
  }
  host.append(el('li', {}, el('a', { class: 'dl dl-quiet', href: '../data/comparatif/comparatif.json', download: 'comparatif_A1_A2.json' },
    icon('i-data', 'ico-big'), el('strong', { text: 'Données brutes' }), el('small', { text: 'Quantités, ratios et hypothèses · .json' }),
    el('span', { class: 'dl-go' }, icon('i-download'), el('span', { text: 'Télécharger' })))));
}

function renderKpis(R) {
  const host = bind('kpis'); host.textContent = '';
  const D = S.D, n2 = D.tours.A2.logements;
  const k = (l, v, u, s, cls) => el('div', { class: `kpi ${cls || ''}` }, el('span', { class: 'kpi-l', text: l }), el('span', { class: 'kpi-v' }, v, el('small', { text: u })), el('span', { class: 'kpi-s', text: s }));
  host.append(
    k('Surcoût de la variante', sign(R.delta), '€ HT', `${sign(R.delta / R.a1 * 100, 1)} % du coût de la tour`),
    k('Par logement de la tour A2', fmt(R.delta / n2), '€ HT', `${fmt(R.delta / D.tours.A2.shab)} € HT par m² habitable`),
    k('Énergie économisée', fmt(R.gain), '€/an', 'TTC, année 1 simulée'),
    k('Bilan énergie − entretien', sign(R.net), '€/an', R.net < 0 ? 'La variante coûte plus cher à exploiter' : 'La variante coûte moins cher à exploiter', R.net < 0 ? 'is-neg' : 'is-pos'),
    k('CO₂ évité en exploitation', fmt(R.co2 / 1000, 1), 't/an', 'Chaleur du réseau peu carbonée'));
}

function renderChanges() {
  const host = bind('changes'); host.textContent = '';
  const c = { modifie: 0, ajoute: 0, supprime: 0, identique: 0 };
  for (const L of S.D.lots) for (const l of L.lignes) if (c[l.ecart] != null) c[l.ecart]++;
  const q = S.D.quantites.filter((x) => x.A1 !== x.A2).length;
  const box = (n, l, t) => el('div', { class: 'chg' }, el('span', { class: 'chg-n', text: n }), el('span', { class: 'chg-l', text: l }), el('span', { class: 'chg-t', text: t }));
  host.append(box(c.ajoute, 'solutions ajoutées', 'ITE, eau chaude solaire'), box(c.modifie, 'solutions modifiées', 'Fondations, toiture, menuiseries, émission, comptage, ventilation'),
    box(c.supprime, 'solution supprimée', 'Doublage intérieur des façades'), box(q, 'quantités différentes', `sur ${S.D.quantites.length} lignes comparées`));
}

function renderAttention(R) {
  const host = bind('attention'); host.textContent = '';
  S.D.attention.forEach((a, i) => {
    let txt = a.texte;
    if (i === 0) txt = `La variante économise ${fmt(R.gain)} € TTC d'énergie par an pour un surcoût de travaux estimé à ${fmt(R.delta)} € HT. Avec l'entretien supplémentaire (${fmt(R.maint)} €/an, hypothèses), le bilan annuel est de ${sign(R.net)} €. Elle se justifie par la RE2020, le confort et la qualité de l'air, pas par le coût d'usage.`;
    host.append(el('div', { class: `warn warn-${a.niveau}` }, icon(a.niveau === 'info' ? 'i-info' : 'i-alert'), el('div', {}, el('strong', { text: a.titre }), el('p', { text: txt }))));
  });
}

function renderLots() {
  const host = bind('lots'); host.textContent = '';
  host.classList.toggle('lots-diff', S.lots === 'diff');
  for (const L of S.D.lots) {
    const same = L.lignes.every((l) => l.ecart === 'identique');
    const art = el('article', { class: `lot ${same ? 'is-same' : ''}` }, el('div', { class: 'lot-head' }, el('span', { class: 'lot-code', text: L.lot }), el('span', { class: 'lot-name', text: L.nom })));
    for (const l of L.lignes) {
      art.append(el('div', { class: `lot-row ${l.ecart === 'identique' ? 'is-same' : ''}` },
        el('span', { class: 'lot-theme', text: l.theme }),
        el('div', { class: 'lot-cell', 'data-t': 'A1' }, el('span', { class: 'who', text: 'Tour A1 — DCE' }), l.A1),
        el('div', { class: 'lot-cell', 'data-t': 'A2' }, el('span', { class: 'who', text: 'Tour A2 — variante' }), l.A2),
        el('span', { class: `ecart ecart-${l.ecart}`, text: ECART[l.ecart] }),
        el('span', { class: 'lot-src', text: l.src.map((s) => S.D.sources[s]?.titre).filter(Boolean).join(' · ') })));
    }
    host.append(art);
  }
}

function renderQteFilter() {
  const host = bind('qte-filter'); host.textContent = '';
  const groups = ['Tout', ...new Set(S.D.quantites.map((q) => q.groupe))];
  for (const g of groups) host.append(el('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(S.qgrp === g), onclick: () => { S.qgrp = g; renderQteFilter(); renderQuantites(); } }, g));
  host.append(el('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(S.qdiff), onclick: () => { S.qdiff = !S.qdiff; renderQteFilter(); renderQuantites(); } }, 'Écarts seulement'));
}

function renderQuantites() {
  const host = bind('quantites'); host.textContent = '';
  const tbl = el('table', { class: `cmp-table cmp-qte ${S.qdiff ? 'qte-only-diff' : ''}` });
  tbl.append(el('thead', {}, el('tr', {}, el('th', { text: 'Ouvrage ou équipement' }), el('th', { text: 'Unité' }), el('th', { class: 'n', text: 'Tour A1' }), el('th', { class: 'n', text: 'Tour A2' }), el('th', { class: 'n', text: 'Écart' }))));
  const tb = el('tbody');
  let prev = null;
  for (const q of S.D.quantites) {
    if (S.qgrp !== 'Tout' && q.groupe !== S.qgrp) continue;
    if (q.groupe !== prev && S.qgrp === 'Tout') tb.append(el('tr', { class: 'grp' }, el('th', { colspan: 5, text: q.groupe })));
    prev = q.groupe;
    const d = q.unite === 'm³' ? 1 : 0;
    const same = q.A1 === q.A2;
    const dif = q.A1 != null && q.A2 != null ? q.A2 - q.A1 : null;
    tb.append(el('tr', { class: same ? 'is-same' : '' },
      el('td', {}, el('span', { class: 'item', text: q.item }), q.note ? el('span', { class: 'qnote', text: q.note }) : null),
      el('td', { class: 'unit', text: q.unite }),
      el('td', { class: 'n', 'data-l': `Tour A1, ${q.unite}` }, el('div', { class: 'val' }, el('b', { text: fmt(q.A1, d) }), fiab(q.f1))),
      el('td', { class: 'n', 'data-l': `Tour A2, ${q.unite}` }, el('div', { class: 'val' }, el('b', { text: fmt(q.A2, d) }), fiab(q.f2))),
      el('td', { class: `n dif ${same ? '' : 'is-diff'}`, 'data-l': 'Écart', text: same ? '=' : sign(dif, d) })));
  }
  tbl.append(tb);
  host.append(el('div', { class: 'table-wrap' }, tbl));
}

function renderCouts(R) {
  const C = S.D.couts;
  // graphique
  const rows = C.postes.map((p) => ({ label: p.poste.length > 46 ? p.poste.slice(0, 44) + '…' : p.poste, value: R.montant[p.id],
    tip: () => `<b>${p.poste}</b><br>${fmt(p.qte, p.unite === 'm³' ? 1 : 0)} ${p.unite} × ${fmt(pu(p))} € = <b>${sign(R.montant[p.id])} € HT</b><br><span>${S.D.fiab[p.fiab]}${p.note ? ' — ' + p.note : ''}</span>` }))
    .sort((a, b) => b.value - a.value);
  divergingBars(bind('couts-chart'), rows, { unit: '€', aria: 'Écart de coût par poste de la variante, en euros hors taxes' });
  bind('couts-sub').textContent = `Total ${sign(R.delta)} € HT, soit ${sign(R.delta / R.a1 * 100, 1)} % du coût actualisé de la tour (${fmt(R.a1)} € HT)`;
  // postes (champs conservés pendant la saisie)
  const tbl = bind('postes');
  if (!tbl.childElementCount) {
    tbl.append(el('thead', {}, el('tr', {}, el('th', { text: 'Lot' }), el('th', { text: 'Poste' }), el('th', { class: 'n', text: 'Quantité' }), el('th', { class: 'n', text: 'Prix unitaire € HT' }), el('th', { class: 'n', text: 'Montant € HT' }), el('th', { text: 'Origine' }))));
    const tb = el('tbody');
    for (const p of C.postes) {
      const inp = el('input', { type: 'number', step: Math.abs(p.pu) >= 500 ? 50 : 1, value: pu(p), inputmode: 'decimal', 'aria-label': `Prix unitaire : ${p.poste}`, class: S.pu[p.id] != null ? 'is-changed' : '',
        oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { S.pu[p.id] = v; e.target.classList.toggle('is-changed', v !== p.pu); save(); update(); } } });
      const src = p.src.map((s) => S.D.sources[s]).filter(Boolean);
      tb.append(el('tr', {},
        el('td', { text: p.lot === '616F' ? '616' : p.lot }),
        el('td', {}, el('span', { class: 'item', text: p.poste }), el('span', { class: 'qnote', text: [p.note, ...src.map((s) => s.titre)].filter(Boolean).join(' — ') })),
        el('td', { class: 'n', text: `${fmt(p.qte, p.unite === 'm³' ? 1 : 0)} ${p.unite}` }),
        el('td', { class: 'n' }, inp, el('span', { class: 'range', text: `${fmt(p.min)} à ${fmt(p.max)} €` })),
        el('td', { class: 'n', 'data-m': p.id }),
        el('td', {}, fiab(p.fiab))));
    }
    tbl.append(tb, el('tfoot', {}, el('tr', {}, el('td'), el('td', { text: 'Total des écarts de la variante' }), el('td'), el('td'), el('td', { class: 'n', 'data-m': 'total' }), el('td'))));
  }
  for (const p of C.postes) { const c = $(`[data-m="${p.id}"]`, tbl); c.textContent = sign(R.montant[p.id]); c.classList.toggle('neg', R.montant[p.id] < 0); }
  $('[data-m="total"]', tbl).textContent = sign(R.delta);
  // budget
  const bt = bind('budget'); bt.textContent = '';
  bt.append(el('thead', {}, el('tr', {}, el('th', { text: 'Lot' }), el('th', { text: 'Intitulé' }), el('th', { class: 'n', text: 'Tour A1, 2020' }), el('th', { class: 'n', text: `Tour A1, 2026 (× ${fmt(R.coef, 3)})` }), el('th', { class: 'n', text: 'Écart variante' }), el('th', { class: 'n', text: 'Tour A2, 2026' }))));
  const tb = el('tbody');
  for (const b of C.budget) {
    const a = b.A1_2020 * R.coef, dl = R.byLot[b.lot] || 0;
    tb.append(el('tr', {}, el('td', { text: b.lot === '616F' ? '616' : b.lot }), el('td', { text: b.nom }), el('td', { class: 'n', text: fmt(b.A1_2020) }), el('td', { class: 'n', text: fmt(a) }), el('td', { class: 'n', text: dl ? sign(dl) : '—' }), el('td', { class: 'n', text: fmt(a + dl) })));
  }
  const tot = C.budget.reduce((s, b) => s + b.A1_2020, 0);
  tb.append(el('tr', { class: 'tot' }, el('td'), el('td', { text: 'Total' }), el('td', { class: 'n', text: fmt(tot) }), el('td', { class: 'n', text: fmt(R.a1) }), el('td', { class: 'n', text: sign(R.delta) }), el('td', { class: 'n', text: fmt(R.a2) })));
  bt.append(tb, el('caption', { style: { captionSide: 'bottom', textAlign: 'left', padding: '10px 12px', fontSize: '12.5px', color: 'var(--ardoise)' } },
    `${C.note} Index BT01 : ${fmt(C.bt01.base, 1)} (${C.bt01.base_mois}) → ${fmt(C.bt01.actuel, 1)} (${C.bt01.actuel_mois}). La colonne « tour A1 » du budget vaut 50 % de chaque lot, VRD et parking compris.`));
  // pistes
  const pt = bind('pistes');
  if (!pt.childElementCount) {
    pt.append(el('thead', {}, el('tr', {}, el('th', { text: 'Piste' }), el('th', { class: 'n', text: 'Quantité' }), el('th', { class: 'n', text: 'Prix unitaire' }), el('th', { class: 'n', text: 'Ordre de grandeur' }), el('th', { text: 'Origine' }))));
    const tb2 = el('tbody');
    for (const p of C.pistes) tb2.append(el('tr', {}, el('td', {}, el('span', { class: 'item', text: p.poste }), el('span', { class: 'qnote', text: p.note })),
      el('td', { class: 'n', text: `${fmt(p.qte)} ${p.unite}` }), el('td', { class: 'n', text: `${fmt(p.pu)} €` }), el('td', { class: 'n', text: `${sign(p.qte * p.pu)} €` }), el('td', {}, fiab(p.fiab))));
    pt.append(tb2);
  }
}

function renderPrixForm() {
  const form = bind('prix-form');
  if (form.childElementCount) return;
  const E = S.D.exploitation;
  const f = (k, step, label, hint) => el('label', {}, el('span', {}, label, ' ', el('small', { text: hint })),
    el('input', { type: 'number', step, value: prix(k), inputmode: 'decimal', oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { S.prix[k] = v; save(); update(); } } }));
  form.append(
    f('prix_chaleur', 0.01, 'Chaleur du réseau, € TTC/MWh', '(prix moyen 2023)'),
    f('prix_elec', 0.0001, 'Électricité, € TTC/kWh', '(tarif réglementé Base)'),
    f('co2_chaleur', 0.001, 'CO₂ de la chaleur, kg/kWh', '(réseau 3324C)'),
    f('co2_elec', 0.001, 'CO₂ de l\'électricité, kg/kWh', '(hypothèse)'));
  form.append(el('p', { class: 'cmp-hint', style: { margin: '2px 0 0', fontWeight: 400 }, text: E.note }));
}

function renderExploitation(R) {
  const E = S.D.exploitation, T = E.tours;
  const per = (z, k) => T[z][k] / T[z].shab;
  const rows = [
    ['Chauffage livré aux logements', 'chauffage'], ['Eau chaude livrée', 'ecs'], ['Chaleur achetée au réseau', 'reseau'],
    ['Production solaire', 'solaire'], ['Pertes de distribution', 'pertes'], ['Électricité de ventilation', 'ventilation'],
  ].map(([label, k]) => ({ label, a1: per('A1', k), a2: per('A2', k) }));
  const comm = (z) => (T[z].ascenseurs + T[z].eclairage + T[z].auxiliaires) / T[z].shab;
  rows.push({ label: 'Électricité des autres communs', a1: comm('A1'), a2: comm('A2') });
  groupedBars(bind('conso-chart'), rows, { unit: 'kWh/m²', aria: 'Consommations par mètre carré habitable, tours A1 et A2' });
  divergingBars(bind('gains-chart'), R.elems.map((x) => ({ label: x.label, value: x.net,
    tip: () => `<b>${x.label}</b><br>Énergie : ${sign(x.energie)} €/an<br>Entretien : ${sign(-x.entretien)} €/an<br><b>Bilan : ${sign(x.net)} €/an</b>` })), { unit: '€/an', aria: 'Bilan annuel de chaque élément de la variante', left: '← coûte plus', right: 'rapporte →' });
  // tableau par élément
  const gt = bind('gains'); gt.textContent = '';
  gt.append(el('thead', {}, el('tr', {}, el('th', { text: 'Élément' }), el('th', { class: 'n', text: 'Travaux € HT' }), el('th', { class: 'n', text: 'Énergie €/an' }), el('th', { class: 'n', text: 'Entretien €/an' }), el('th', { class: 'n', text: 'Bilan €/an' }), el('th', { class: 'n', text: 'CO₂ évité kg/an' }), el('th', { class: 'n', text: 'Retour simple' }))));
  const tb = el('tbody');
  for (const x of R.elems) {
    const g = E.gains.find((y) => y.id === x.gain);
    tb.append(el('tr', {},
      el('td', {}, el('span', { class: 'item', text: x.label }), g && g.note ? el('span', { class: 'qnote', text: g.note }) : null),
      el('td', { class: 'n', text: sign(x.capex) }), el('td', { class: 'n', text: sign(x.energie) }), el('td', { class: 'n', text: sign(-x.entretien) }),
      el('td', { class: 'n', style: { fontWeight: 700 }, text: sign(x.net) }), el('td', { class: 'n', text: sign(x.co2) }),
      el('td', { class: 'n', text: x.energie === 0 ? 'sans objet' : x.retour ? `${fmt(x.retour)} ans` : 'jamais' })));
  }
  tb.append(el('tr', { class: 'tot' }, el('td', { text: 'Variante complète' }), el('td', { class: 'n', text: sign(R.delta) }), el('td', { class: 'n', text: sign(R.gain) }), el('td', { class: 'n', text: sign(-R.maint) }),
    el('td', { class: 'n', text: sign(R.net) }), el('td', { class: 'n', text: sign(R.co2) }), el('td', { class: 'n', text: R.net > 0 ? `${fmt(R.delta / R.net)} ans` : 'jamais' })));
  gt.append(tb, el('caption', { style: { captionSide: 'bottom', textAlign: 'left', padding: '10px 12px', fontSize: '12.5px', color: 'var(--ardoise)' } },
    'Gain d\'énergie calculé comme dans le jumeau : écart de chauffage par m² ramené à la surface de A2, majoré des pertes de distribution ; ITE et double flux se partagent cet écart selon le calage (−12 % puis −20 %). Retour simple = travaux ÷ bilan annuel, sans évolution des prix. Énergie en TTC, travaux et entretien en HT.'));
  // entretien (champs conservés)
  const mtb = bind('maint');
  if (!mtb.childElementCount) {
    mtb.append(el('thead', {}, el('tr', {}, el('th', { text: 'Poste' }), el('th', { class: 'n', text: 'Tour A1, € HT/an' }), el('th', { class: 'n', text: 'Tour A2, € HT/an' }), el('th', { class: 'n', text: 'Écart' }))));
    const tb2 = el('tbody');
    for (const m of E.maintenance) {
      const inp = (z) => el('input', { type: 'number', step: 50, value: mt(m, z), inputmode: 'decimal', 'aria-label': `${m.poste}, tour ${z}`,
        oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { S.maint[m.id] = { ...(S.maint[m.id] || {}), [z]: v }; save(); update(); } } });
      tb2.append(el('tr', {}, el('td', {}, el('span', { class: 'item', text: m.poste }), el('span', { class: 'qnote', text: m.note })), el('td', { class: 'n' }, inp('A1')), el('td', { class: 'n' }, inp('A2')), el('td', { class: 'n', 'data-dm': m.id })));
    }
    mtb.append(tb2);
  }
  for (const m of E.maintenance) $(`[data-dm="${m.id}"]`, mtb).textContent = sign(R.dm[m.id]);
}

function renderCarbone(R) {
  const host = bind('carbone'); host.textContent = '';
  const E = S.D.exploitation, T = E.tours;
  const co2 = (z) => T[z].reseau * prix('co2_chaleur') + (T[z].ventilation + T[z].ascenseurs + T[z].eclairage + T[z].auxiliaires) * prix('co2_elec');
  const c1 = co2('A1'), c2 = co2('A2');
  const cons = E.construction.find((c) => c.valeur != null);
  const box = (t, v, u, s) => el('div', { class: 'co2' }, el('span', { class: 't', text: t }), el('span', { class: 'big' }, v, el('small', { text: u })), el('span', { class: 's', text: s }));
  host.append(el('div', { class: 'co2-grid' },
    box('Tour A1, chaleur + communs', fmt(c1 / T.A1.shab, 2), 'kgCO₂e/m².an', `${fmt(c1 / 1000, 1)} t par an`),
    box('Tour A2, chaleur + communs', fmt(c2 / T.A2.shab, 2), 'kgCO₂e/m².an', `${fmt(c2 / 1000, 1)} t par an`),
    box('Évité par la variante', fmt(R.co2 / 1000, 2), 't/an', `soit ${fmt(R.co2 / 1000 * 50)} t sur 50 ans`),
    box('Béton bas carbone', fmt(Math.abs(cons.valeur), 1), 't évitées', 'Une seule fois, à la construction (hypothèse)')));
  const t = el('table', { class: 'cmp-table' });
  t.append(el('thead', {}, el('tr', {}, el('th', { text: 'Carbone de construction de la variante' }), el('th', { class: 'n', text: 'Valeur' }), el('th', { text: 'Origine' }))));
  const tb = el('tbody');
  for (const c of E.construction) tb.append(el('tr', {}, el('td', {}, el('span', { class: 'item', text: c.poste }), el('span', { class: 'qnote', text: c.note })),
    el('td', { class: 'n', text: c.valeur != null ? `${sign(c.valeur, 1)} t` : 'à chiffrer' }), el('td', {}, fiab(c.fiab))));
  t.append(tb);
  host.append(el('div', { class: 'table-wrap' }, t),
    el('p', { class: 'cmp-hint', style: { fontWeight: 400, marginTop: '12px', maxWidth: '72ch' } },
      `Le double flux augmente les émissions d'exploitation (${sign(-R.gCo2.df)} kg/an) : l'électricité de ses ventilateurs émet plus que la chaleur qu'il récupère, au contenu CO₂ du réseau. Le bilan carbone complet relève de l'ACV RE2020 (indicateurs Ic construction et Ic énergie), à produire avec les FDES et PEP des produits retenus.`));
}

function renderSources() {
  const host = bind('sources'); host.textContent = '';
  const D = S.D;
  host.append(el('h3', { class: 'sub', text: 'Origine des valeurs' }));
  const leg = el('ul', { class: 'legend' });
  const desc = { maquette: 'Mesuré dans la maquette (surface, volume, nombre).', cctp: 'Pièce du marché ou tableau des surfaces.', cctp_nm: 'Prévu au CCTP mais absent de la maquette : compté quand même.', variante: 'Modélisé par le groupe dans la maquette (tour A2).', calcul: 'Dérivé de la géométrie de la maquette.', estime: 'Dénombré par pièce et par typologie (plans CVC des logements types).', cite: 'Ratio de prix publié, source citée.', hypothese: 'Valeur de travail à confirmer.' };
  for (const [k, t] of Object.entries(desc)) leg.append(el('li', {}, fiab(k), el('span', { text: t })));
  host.append(leg);
  host.append(el('h3', { class: 'sub', text: 'Méthode' }));
  host.append(el('div', { class: 'method' },
    el('p', { text: 'Tour A1 : les équipements de chauffage, ventilation et eau chaude prévus au CCTP 502-503-504 sont comptés même lorsqu\'ils ne sont pas modélisés. Tour A2 : ce sont les éléments de la variante modélisés par le groupe, complétés par le CCTP pour ce qui ne change pas.' }),
    el('p', { text: 'Les dénombrements par pièce suivent les plans CVC des logements types appliqués aux typologies de chaque tour :' })));
  const tt = el('table', { class: 'cmp-table typo-table' });
  tt.append(el('thead', {}, el('tr', {}, el('th', { text: 'Typologie' }), el('th', { text: 'Pièces' }), el('th', { class: 'n', text: 'Émetteurs' }), el('th', { class: 'n', text: 'Bouches' }), el('th', { class: 'n', text: 'A1 / A2' }))));
  const tb = el('tbody');
  for (const [k, t] of Object.entries(D.typologies)) tb.append(el('tr', {}, el('td', { class: 'item', text: k }), el('td', { text: t.pieces }), el('td', { class: 'n', text: t.pp + t.eau }), el('td', { class: 'n', text: t.bouches }),
    el('td', { class: 'n', text: `${D.tours.A1.typologies[k] || 0} / ${D.tours.A2.typologies[k] || 0}` })));
  tt.append(tb);
  host.append(el('div', { class: 'table-wrap' }, tt));
  host.append(el('h3', { class: 'sub', text: 'Sources' }));
  const ul = el('ul', { class: 'src-list' });
  for (const s of Object.values(D.sources)) ul.append(el('li', {}, el('strong', { text: s.titre }), el('span', { text: s.ref }), s.url ? el('a', { href: s.url, target: s.url.startsWith('http') ? '_blank' : null, rel: 'noopener', text: s.url.replace(/^https?:\/\//, '') }) : null));
  host.append(ul);
}

function update() {
  const R = compute();
  renderKpis(R);
  renderAttention(R);
  renderCouts(R);
  renderExploitation(R);
  renderCarbone(R);
}

function wireNav() {
  const links = $$('.secnav a');
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { links.forEach((a) => a.removeAttribute('aria-current')); map.get(e.target.id)?.setAttribute('aria-current', 'true'); }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const id of map.keys()) { const s = document.getElementById(id); if (s) io.observe(s); }
}

async function main() {
  const res = await fetch('../data/comparatif/comparatif.json', { cache: 'no-cache' });
  S.D = await res.json();
  restore();
  bind('gen-date').textContent = new Date(S.D.genere + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  renderTowers();
  renderDocs();
  renderChanges();
  renderLots();
  renderQteFilter();
  renderQuantites();
  renderPrixForm();
  renderSources();
  update();
  wireNav();
  $$('[data-lots]').forEach((b) => b.addEventListener('click', () => {
    S.lots = b.dataset.lots;
    $$('[data-lots]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderLots();
  }));
  $('[data-act="reset-couts"]').addEventListener('click', () => {
    S.pu = {}; S.maint = {}; S.prix = {}; save();
    bind('postes').textContent = ''; bind('maint').textContent = ''; bind('prix-form').textContent = '';
    renderPrixForm(); update();
  });
  let w = window.innerWidth, t = 0;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - w) < 8) return;   // la barre d'adresse mobile ne compte pas
    w = window.innerWidth; clearTimeout(t); t = setTimeout(update, 150);
  });
  document.addEventListener('scroll', hideTip, { passive: true });
}

main().catch((e) => {
  console.error(e);
  bind('kpis').append(el('p', { class: 'warn', text: 'Le comparatif n\'a pas pu être chargé. Rechargez la page.' }));
});
