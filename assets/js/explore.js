// Maquette du projet : exploration 3D de tous les ouvrages, résumé au toucher, puis fiche complète.
import * as api from './backend.js';
import { createViewer } from './viewer.js';
import { openRebar, closeRebar } from './rebar-ui.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CFG = window.PASSEPORT_CONFIG || {};
const S = { rows: [], byId: new Map(), byRef: new Map(), commun: null, live: new Map(), viewer: null, zone: 'ALL', cut: null, current: null,
  view: 'maquette', day: 0, today: 0, dmin: 0, dmax: 1, epoch: new Date('2026-01-01T12:00:00'), order: [], fiche: null, playing: false, tour: null, tourI: 0 };

// ---------- 4D : couleurs par statut (vert = posé, orange = sur le chantier, teintes pâles = pas encore sur le chantier)
const COLORS = {
  a_commander: { hex: 0x9aa3a8, m: 'ghost' }, commande: { hex: 0x3e6a96, m: 'ghost' }, fabrication: { hex: 0x6a4ba0, m: 'ghost' },
  pret: { hex: 0x6a4ba0, m: 'ghost' }, livre: { hex: 0xe08a2e, m: 'solid' }, attente_pose: { hex: 0xe08a2e, m: 'solid' },
  pose_en_cours: { hex: 0xe08a2e, m: 'solid' }, pose: { hex: 0x7cc79a, m: 'solid' }, receptionne: { hex: 0x22764a, m: 'solid' }
};
const PHASES = [
  ['À commander', ['a_commander'], '#9aa3a8'], ['Commandé', ['commande'], '#3e6a96'], ['En usine', ['fabrication', 'pret'], '#6a4ba0'],
  ['Sur le chantier', ['livre', 'attente_pose', 'pose_en_cours'], '#e08a2e'], ['Posé', ['pose'], '#7cc79a'], ['Réceptionné', ['receptionne'], '#22764a']
];
const dayOf = (d) => Math.round((d - S.epoch) / 86400000);
const dateOf = (n) => new Date(S.epoch.getTime() + n * 86400000);
function statusAt(row, D) {
  const l = S.live.get(row.ref);
  if (l && D >= S.today) return l.statut;
  let st = 'a_commander', best = -1;
  (row.dates || []).forEach((d, i) => { if (d != null && d <= D && i > best) { best = i; st = S.order[i]; } });
  return st;
}

// Hauteur des planchers bruts (m au-dessus de 37,89 NGF), d'après les niveaux de la maquette (tour A2 ; tour A1 à +5 cm).
const FLOORS = { RDC: 0, 'R+1': 5.58, 'R+2': 8.37, 'R+3': 11.16, 'R+4': 13.95, 'R+5': 16.74, 'R+6': 19.53, 'R+7': 22.32, 'R+8': 25.11, 'R+9': 27.90, Toiture: 30.67 };
const ZONE_LABEL = { A1: 'Tour A1', A2: 'Tour A2', LT: 'Logement témoin A1.31', PARK: 'Parking R-1', FOND: 'Fondations', EXT: 'Aménagements extérieurs' };
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function fmtDate(s) { const d = new Date(s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d) ? '' : `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`; }
function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function passportHref(ref) { return ref === 'A2-PM106' ? 'A2-PM106/' : `o/?r=${encodeURIComponent(ref)}`; }
let toastT = 0;
function toast(msg) { const t = $('.toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4200); }
function statusOf(row) {
  const l = S.live.get(row.ref);
  return l ? { cle: l.statut, live: true, maj: l.maj_le } : { cle: row.statut, live: false };
}
function statusDef(k) { return S.commun.statuts.find(s => s.cle === k) || { cle: k, label: k }; }
function fiab(k) {
  const d = S.commun.fiabilites[k] || { label: k, aide: '' };
  return el('span', { class: `fiab fiab-${k}`, title: d.aide }, d.label);
}

// ---------- résumé
async function showPanel(row, el3d) {
  const p = $('#ex-panel');
  S.current = row;
  const tok = S.panelTok = (S.panelTok || 0) + 1;
  const q = (k) => $(`[data-p="${k}"]`, p);
  if (!row) {
    q('context').textContent = el3d?.kind || 'Élément de la maquette';
    q('reference').textContent = 'Sans passeport';
    q('designation').textContent = "Cet élément n'a pas de passeport : c'est un sous-élément (par exemple un panneau de mur-rideau) ou il n'a pas d'identifiant dans la maquette.";
    q('pill').hidden = true; q('fiab').textContent = ''; q('facts').textContent = '';
    q('open').hidden = true; q('focus').hidden = true; q('rebar').hidden = true;
    p.hidden = false;
    return;
  }
  q('pill').hidden = false; q('open').hidden = false; q('focus').hidden = false; q('rebar').hidden = true;
  q('context').textContent = `${ZONE_LABEL[row.zone] || ''} · ${row.etage}`;
  q('reference').textContent = row.reference;
  q('designation').textContent = row.designation;
  const st = S.view === 'avancement' ? { cle: statusAt(row, S.day), live: Boolean(S.live.get(row.ref)) && S.day >= S.today } : statusOf(row);
  const pill = q('pill');
  pill.textContent = statusDef(st.cle).label + (S.view === 'avancement' && S.day !== S.today ? ` au ${fmtDate(dateOf(S.day).toISOString())}` : ''); pill.dataset.status = st.cle; pill.classList.toggle('is-fictif', !st.live);
  q('fiab').textContent = '';
  q('fiab').append(st.live ? el('span', { class: 'fiab fiab-saisi', title: 'Statut mis à jour en ligne par un éditeur.' }, 'Suivi en ligne') : fiab('fictif'));
  q('open').href = passportHref(row.ref);
  const facts = q('facts'); facts.textContent = '';
  const add = (dt, dd) => facts.append(el('div', {}, el('dt', { text: dt }), el('dd', {}, dd)));
  add('Catégorie', S.commun.familles[row.famille] || row.famille);
  add('Zone', ZONE_LABEL[row.zone] || row.zone);
  add('Étage', row.etage);
  if (S.view === 'thermique') thermoFacts(row, add);
  p.hidden = false;
  try {
    const d = await (await fetch(`data/o/${encodeURIComponent(row.ref)}.json`)).json();
    if (S.current !== row || S.panelTok !== tok) return;
    S.fiche = d;
    if (d.ferraillage) { q('rebar').hidden = false; q('rebar').onclick = () => openRebar(d); }
    const js = (d.planning?.jalons || []).filter(j => !j.reelle && j.previsionnelle).sort((a, b) => a.previsionnelle.localeCompare(b.previsionnelle));
    if (js[0]) add('Prochaine échéance', el('span', {}, `${js[0].label} : ${fmtDate(js[0].previsionnelle)} `, fiab(js[0].fiab || 'fictif')));
    else add('Prochaine échéance', 'Aucune : tous les jalons ont une date réelle.');
    const lot = d.identite?.find(r => r.cle === 'lot');
    if (lot?.valeur) add('Lot', lot.valeur);
    if (d.avertissements?.length) add('À noter', d.avertissements.map(a => a.titre).join(' · '));
  } catch (e) { /* le résumé reste utilisable sans la fiche */ }
}
function hidePanel() { $('#ex-panel').hidden = true; S.current = null; S.fiche = null; S.viewer?.clearSelection(); }

// ---------- 4D
let paintRaf = 0;
function paint() {
  if (S.view !== 'avancement' || !S.viewer) return;
  cancelAnimationFrame(paintRaf);
  paintRaf = requestAnimationFrame(() => {
    S.viewer.setStatusView((e) => { const r = S.byId.get(e.id); return r ? COLORS[statusAt(r, S.day)] : null; });
    renderDash();
    if (S.current) showPanel(S.current);
  });
}
// ---------- vue « performance thermique » : chaque paroi prend la couleur de son coefficient U
// U du DCE (tour A1) ou de la variante (tour A2) ; pour les planchers et toitures, U calculé depuis R (+ Rsi + Rse + dalle béton ≈ 0,10)
const TH = [
  { k: 'u1', label: 'U ≤ 0,17 W/m².K : très isolé', css: '#1b7a4e' },
  { k: 'u2', label: 'U de 0,17 à 0,22', css: '#6dbb85' },
  { k: 'u3', label: 'U de 0,22 à 0,30', css: '#f0a43a' },
  { k: 'pont', label: 'Pont thermique : jonction balcon-façade sans rupteur', css: '#d03b3b' },
  { k: 'uw', label: 'Fenêtre : Uw absent du DCE', css: '#8fa9c8' },
  { k: 'equip', label: 'Équipement de la variante', css: '#6a4ba0' },
];
const TH_PROFIL = {
  facade_A1: { u: 0.27 }, lt_doublage: { u: 0.27 }, facade_A2: { u: 0.21 }, ite_A2: { u: 0.21 },
  plancher_bas: { u: 1 / (6.3 + 0.21 + 0.1) }, toiture_A1: { u: 1 / (5.4 + 0.14 + 0.1) }, toiture_A2: { u: 1 / (5.45 + 0.14 + 0.1) }, parking_ph: { u: 1 / (3.7 + 0.21 + 0.1) },
  balcon: { k: 'pont' }, menuiserie_A1: { k: 'uw' }, menuiserie_A2: { k: 'uw' }, hall: { k: 'uw' }, extracteur: { k: 'equip' }, capteur: { k: 'equip' },
};
function thClass(prof) {
  const t = TH_PROFIL[prof];
  if (!t) return null;
  return t.k || (t.u <= 0.17 ? 'u1' : t.u <= 0.22 ? 'u2' : 'u3');
}
// laissés en gris dans cette vue (choix du groupe, 10/11/2026) : dalle haute du parking et balcons ;
// le pont thermique des balcons est montré par un trait rouge à la jonction avec la façade (viewer.setMarks)
const thGris = (ref, prof) => prof === 'parking_ph' || prof === 'balcon';
function loadThermo() {
  if (!S.thermoP) S.thermoP = fetch('data/energie/ouvrages.json').then(r => r.json()).then(d => (S.thermo = d));
  return S.thermoP;
}
let thermoRaf = 0;
async function paintThermo() {
  const T = await loadThermo();
  if (S.view !== 'thermique' || !S.viewer) return;
  cancelAnimationFrame(thermoRaf);
  thermoRaf = requestAnimationFrame(() => {
    const css = Object.fromEntries(TH.map(c => [c.k, c.css]));
    const n = {}, seen = new Set(), ponts = new Set();
    S.viewer.setStatusView((e) => {
      const r = S.byId.get(e.id), o = r && T.ouvrages[r.ref];
      if (o && o.p === 'balcon') { ponts.add(e.id); if (!seen.has(r.ref)) { seen.add(r.ref); n.pont = (n.pont || 0) + 1; } }
      const k = o && !thGris(r.ref, o.p) && thClass(o.p);
      if (!k) return null;
      if (!seen.has(r.ref)) { seen.add(r.ref); n[k] = (n[k] || 0) + 1; }
      return { hex: parseInt(css[k].slice(1), 16), m: 'solid' };
    });
    S.viewer.setMarks?.(ponts, parseInt(css.pont.slice(1), 16));
    const lg = $('[data-bind="th-legend"]'); lg.textContent = '';
    for (const c of TH) lg.append(el('li', {}, el('i', { class: c.k === 'pont' ? 'is-line' : null, style: `background:${c.css}` }), `${c.label} (${n[c.k] || 0})`));
    lg.append(el('li', {}, el('i', { class: 'is-ghost', style: 'background:#b9bfc2' }), 'Intérieur ou hors du volume chauffé, dalle haute du parking, balcons'));
  });
}
function thermoFacts(row, add) {
  const T = S.thermo, o = T && T.ouvrages[row.ref], pr = o && T.profils[o.p];
  if (!pr || o.p === 'parking_ph') return;
  const t = TH_PROFIL[o.p];
  add('Rôle thermique', pr.titre);
  if (t && t.u && !(pr.lignes || []).some(l => /^Coefficient U/.test(l.label))) add('Coefficient U (calculé depuis R)', `≈ ${t.u.toFixed(2).replace('.', ',')} W/m².K`);
  for (const l of pr.lignes || []) {
    if (!/^(Coefficient|Résistance|Isolant|Isolation|Composition|Pont thermique|Vitrage|Pset IFC)/.test(l.label)) continue;
    add(l.label, l.valeur || 'Non fourni au DCE : renvoyé à l\'étude thermique, absente du dossier');
  }
}

function setView(v) {
  S.view = v;
  $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('[data-bind="time"]').hidden = v !== 'avancement';
  $('[data-bind="dash"]').hidden = v !== 'avancement';
  $('[data-bind="thermo"]').hidden = v !== 'thermique';
  if (v === 'avancement') paint();
  else if (v === 'thermique') { stop(); loadThermo().then(() => { paintThermo(); if (S.current) showPanel(S.current); }); }
  else { stop(); S.viewer?.setStatusView(null); if (S.current) showPanel(S.current); }
  if (v !== 'thermique') S.viewer?.setMarks?.(null);
}
function setDay(n) {
  S.day = Math.max(S.dmin, Math.min(S.dmax, Math.round(n)));
  $('#ex-day').value = S.day;
  $('[data-bind="date"]').textContent = fmtDate(dateOf(S.day).toISOString()) + (S.day === S.today ? ' (aujourd\'hui)' : '');
  paint();
}
function play(until) {
  if (S.playing) { stop(); return; }
  if (S.day >= S.dmax) setDay(S.dmin);
  S.playing = true;
  $('[data-act="play"]').innerHTML = '<svg class="ico"><use href="#i-pause"/></svg>';
  const end = until ?? S.dmax;
  let last = performance.now(), acc = S.day;
  const tick = (now) => {
    if (!S.playing) return;
    acc += (now - last) / 1000 * 36; last = now;
    setDay(Math.min(acc, end));
    if (acc >= end) { stop(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function stop() {
  S.playing = false;
  const b = $('[data-act="play"]'); if (b) b.innerHTML = '<svg class="ico"><use href="#i-play"/></svg>';
}
function renderDash() {
  const D = S.day, cnt = {}, zone = {}, wk = { livraisons: 0, poses: 0 };
  const iL = S.order.indexOf('livre'), iP = S.order.indexOf('pose_en_cours');
  for (const r of S.rows) {
    const st = statusAt(r, D);
    cnt[st] = (cnt[st] || 0) + 1;
    const z = r.zone === 'LT' ? 'A1' : r.zone;
    zone[z] = zone[z] || [0, 0]; zone[z][1]++;
    if (st === 'pose' || st === 'receptionne') zone[z][0]++;
    const dl = r.dates?.[iL], dp = r.dates?.[iP];
    if (dl != null && dl >= D && dl < D + 7) wk.livraisons++;
    if (dp != null && dp >= D && dp < D + 7) wk.poses++;
  }
  const done = (cnt.pose || 0) + (cnt.receptionne || 0);
  $('[data-bind="dash-date"]').textContent = fmtDate(dateOf(D).toISOString());
  $('[data-bind="dash-pct"]').textContent = `${Math.round(done / S.rows.length * 100)} %`;
  const src = $('[data-bind="dash-src"]'); src.textContent = '';
  src.append(fiab('fictif'), el('span', { class: 'ex-src', text: S.live.size && D >= S.today ? ` Scénario de démonstration, et ${S.live.size} ouvrage(s) suivi(s) en ligne.` : ' Scénario de démonstration.' }));
  const zb = $('[data-bind="dash-zones"]'); zb.textContent = '';
  for (const [z, lab] of [['FOND', 'Fondations'], ['PARK', 'Parking'], ['A1', 'Tour A1'], ['A2', 'Tour A2'], ['EXT', 'Extérieurs']]) {
    const [a, b] = zone[z] || [0, 0]; const p = b ? Math.round(a / b * 100) : 0;
    zb.append(el('div', { class: 'ex-zbar' }, el('span', { text: lab }), el('i', {}, el('b', { style: `width:${p}%` })), el('em', { text: `${p} %` })));
  }
  const ph = $('[data-bind="dash-phases"]'); ph.textContent = '';
  for (const [lab, keys, col] of PHASES) {
    const n = keys.reduce((s2, k) => s2 + (cnt[k] || 0), 0);
    ph.append(el('div', { class: 'ex-ph' }, el('i', { style: `background:${col}` }), el('span', { text: lab }), el('strong', { text: n.toLocaleString('fr-FR') })));
  }
  $('[data-bind="dash-week"]').textContent = `Dans les 7 jours : ${wk.livraisons} livraison${wk.livraisons > 1 ? 's' : ''} et ${wk.poses} mise${wk.poses > 1 ? 's' : ''} en œuvre prévue${wk.poses > 1 ? 's' : ''}.`;
  const lg = $('[data-bind="legend"]'); lg.textContent = '';
  for (const [lab, keys, col] of PHASES) lg.append(el('li', {}, el('i', { style: `background:${col}`, class: keys.some(k => COLORS[k].m === 'ghost') ? 'is-ghost' : '' }), lab));
}
function setupTime() {
  let lo = Infinity, hi = -Infinity;
  for (const r of S.rows) for (const d of r.dates || []) if (d != null) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
  S.dmin = Math.max(lo - 14, dayOf(new Date('2026-04-01T12:00:00')));
  S.dmax = Math.min(hi + 14, dayOf(new Date('2027-12-31T12:00:00')));
  S.today = Math.max(S.dmin, Math.min(S.dmax, dayOf(new Date())));
  const inp = $('#ex-day'); inp.min = S.dmin; inp.max = S.dmax;
  const tk = $('[data-bind="ticks"]'); tk.textContent = '';
  const MO = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  for (let d = new Date(dateOf(S.dmin).getFullYear(), dateOf(S.dmin).getMonth() + 1, 1, 12); dayOf(d) <= S.dmax; d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12)) {
    const p = (dayOf(d) - S.dmin) / (S.dmax - S.dmin) * 100;
    tk.append(el('span', { class: d.getMonth() % 3 ? 'is-minor' : '', style: `left:${p}%`, text: d.getMonth() === 0 ? `${MO[0]} ${d.getFullYear()}` : MO[d.getMonth()] }));
  }
  const tp = (S.today - S.dmin) / (S.dmax - S.dmin) * 100;
  tk.append(el('span', { class: 'is-today', style: `left:${tp}%`, title: "Aujourd'hui" }));
  inp.addEventListener('input', () => { stop(); setDay(Number(inp.value)); });
  $('[data-act="play"]').addEventListener('click', () => play());
  $('[data-act="today"]').addEventListener('click', () => { stop(); setDay(S.today); });
  S.day = S.today;
  setDay(S.today);
}

// ---------- présentation pour l'oral
function tourSteps() {
  const pm = S.byRef.get('A2-PM106');
  const pct = () => { const done = S.rows.filter(r => ['pose', 'receptionne'].includes(statusAt(r, S.today))).length; return Math.round(done / S.rows.length * 100); };
  const nb = S.rows.length.toLocaleString('fr-FR');
  const withRebar = S.nbRebar;
  const fiche = pm && { label: 'Ouvrir la fiche d\'A2 PM 106', href: 'A2-PM106/' };
  return [
    { t: `Une maquette, ${nb} ouvrages`,
      p: `Toute la maquette Revit du groupe est en ligne : les deux tours, le parking, les fondations et les abords. Chaque élément a sa fiche. Un seul QR code, affiché à l'entrée du chantier, ouvre cette vue sur le téléphone.`,
      m: 'Toute la maquette Revit est en ligne : tours, parking, fondations, abords. Chaque élément a sa fiche, et un seul QR code ouvre cette vue sur le téléphone.',
      go: () => { closeRebar(); hidePanel(); setView('maquette'); setZone('ALL', { silent: true }); S.viewer?.replay(); } },
    pm && { t: 'Retrouver un ouvrage en quelques secondes',
      p: 'On tape sa référence, ou on le touche dans la 3D. La maquette se coupe à son étage, le met en rose et affiche son résumé : statut, prochaine échéance, lot. Ici, le prémur A2 PM 106 du noyau de la tour A2.',
      m: 'On tape une référence ou on touche la 3D : la maquette se coupe à l\'étage et met l\'ouvrage en rose. Ici, le prémur A2 PM 106 de la tour A2.', obj: pm,
      go: () => { closeRebar(); setView('maquette'); $('#ex-search').value = 'A2 PM 106'; selectRow(pm); } },
    pm && { t: 'La fiche de chaque ouvrage',
      p: "Un bouton ouvre la fiche complète : identité tirée de la maquette, plans du DCE, approvisionnement, planning et suivi de chantier. Chaque information indique sa source et sa fiabilité ; ce qui est inventé pour la démonstration est hachuré « Fictif ».",
      m: 'La fiche complète réunit identité, plans du DCE, approvisionnement, planning et suivi. Chaque information indique sa source ; ce qui est inventé est hachuré « Fictif ».', obj: pm, cta: fiche,
      go: () => { closeRebar(); if (S.current !== pm) selectRow(pm); $('[data-p="open"]').classList.add('is-pulse'); setTimeout(() => $('[data-p="open"]').classList.remove('is-pulse'), 2600); } },
    pm && { rebar: true, t: 'Du modèle au plan de ferraillage',
      p: `Pour les ${withRebar.toLocaleString('fr-FR')} ouvrages en béton, le site dessine un plan de ferraillage d'exemple avec les vraies dimensions de la maquette : élévation, coupe, nomenclature, poids d'acier. C'est un exemple fictif, pas un plan d'exécution : aucun calcul de structure n'est fait.`,
      m: `Pour ${withRebar.toLocaleString('fr-FR')} ouvrages en béton, un plan de ferraillage d'exemple est dessiné avec les dimensions de la maquette. Exemple fictif : aucun calcul de structure.`,
      go: async () => { if (S.current !== pm) selectRow(pm); const d = S.fiche || await (await fetch('data/o/A2-PM106.json')).json(); if (S.tour) openRebar(d, { modal: false }); } },
    { t: 'Le chantier aujourd\'hui',
      p: `Chaque ouvrage prend la couleur de son statut. Vert : posé ; orange : sur le chantier ; teintes pâles : commandé, en fabrication ou à commander. Aujourd'hui, ${pct()} % des ouvrages sont posés. Le tableau sous la maquette donne l'avancement par zone et les livraisons de la semaine.`,
      m: `Chaque ouvrage prend la couleur de son statut : vert posé, orange sur le chantier, pâle commandé ou en usine. Aujourd'hui, ${pct()} % des ouvrages sont posés.`,
      go: () => { closeRebar(); hidePanel(); setZone('ALL', { silent: true }); S.viewer?.setFilter('ALL', null); S.viewer?.clearSelection(); S.viewer?.overview?.(); setView('avancement'); setDay(S.today); } },
    { t: 'Le chantier en 4D',
      p: "Le curseur fait avancer le temps : fondations au printemps 2026, parking l'été, puis les tours étage par étage, au rythme d'un niveau toutes les deux semaines, et le second œuvre derrière. Le planning est un scénario de démonstration, le DCE n'en contient pas.",
      m: 'Le curseur fait avancer le temps : fondations, parking, puis les tours étage par étage, un niveau toutes les deux semaines. Planning de démonstration.',
      go: () => { closeRebar(); hidePanel(); S.viewer?.clearSelection(); S.viewer?.overview?.(); setView('avancement'); stop(); setDay(S.dmin); setTimeout(() => { if (S.tour) play(); }, 400); } },
    pm && { t: 'Le suivi depuis le chantier',
      p: "Un éditeur connecté change le statut, ajoute une photo ou une réserve depuis son téléphone ; l'historique garde qui a fait quoi et quand. A2 PM 106 est déjà suivi en ligne : son statut vient de la base de données, pas du scénario.",
      m: 'Depuis son téléphone, un éditeur change le statut, ajoute une photo ou une réserve ; l\'historique garde qui a fait quoi. A2 PM 106 est déjà suivi en ligne.', obj: pm, cta: fiche && { ...fiche, label: 'Voir le suivi d\'A2 PM 106' },
      go: () => { stop(); setView('avancement'); setDay(S.today); selectRow(pm); } },
    { t: 'La performance thermique dans la maquette',
      p: "Chaque paroi prend la couleur de son coefficient U, tiré du DCE pour la tour A1 et calculé pour la variante de la tour A2. Isolée par l'extérieur, la tour A2 passe de l'orange au vert. Les traits rouges marquent les ponts thermiques, là où les balcons traversent la façade sans rupteur. Un clic donne la valeur, sa source et la propriété IFC correspondante.",
      m: 'Chaque paroi prend la couleur de son coefficient U : la tour A2, isolée par l\'extérieur, passe de l\'orange au vert ; les traits rouges marquent les ponts thermiques des balcons.',
      go: () => { closeRebar(); stop(); hidePanel(); $('#ex-search').value = ''; setZone('ALL', { silent: true }); S.viewer?.setFilter('ALL', null); S.viewer?.clearSelection(); S.viewer?.overview?.(); setView('thermique'); } },
    { t: 'Après la livraison : le jumeau énergétique',
      p: "Les mêmes tours, une fois habitées. Le jumeau énergétique éclaire chaque logement selon sa consommation, signale les anomalies et compare la tour A1 du DCE à la variante A2 du groupe. Il a son propre site, relié à celui-ci par la barre du haut.",
      m: 'Une fois les tours habitées, le jumeau énergétique suit la consommation de chaque logement et compare A1 et A2. Il a son propre site.',
      cta: { label: 'Lancer la présentation du jumeau', href: 'https://lucasdupuymontbrun-del.github.io/jumeau-fontbelleau/?presentation' },
      go: () => { closeRebar(); stop(); hidePanel(); $('#ex-search').value = ''; setView('maquette'); setZone('ALL', { silent: true }); S.viewer?.setFilter('ALL', null); S.viewer?.clearSelection(); S.viewer?.overview?.(); } },
  ].filter(Boolean);
}
const compactQ = matchMedia('(max-width: 700px), (max-height: 500px)');
function tourShow(i, rerun = true) {
  const st = S.tour; if (!st) return;
  S.tourI = Math.max(0, Math.min(st.length - 1, i));
  const s0 = st[S.tourI];
  const small = compactQ.matches;
  $('[data-bind="tour-n"]').textContent = `${small ? '' : 'Étape '}${S.tourI + 1} / ${st.length}`;
  $('[data-bind="tour-t"]').textContent = s0.t;
  $('[data-bind="tour-p"]').textContent = (small && s0.m) || s0.p;
  const obj = $('[data-bind="tour-obj"]');
  obj.hidden = !s0.obj;
  if (s0.obj) {
    const stt = S.view === 'avancement' ? statusAt(s0.obj, S.day) : statusOf(s0.obj).cle;
    obj.textContent = '';
    obj.append(el('strong', { text: s0.obj.reference }), el('span', { text: ` · ${statusDef(stt).label}` }));
  }
  const cta = $('[data-bind="tour-cta"]');
  cta.hidden = !s0.cta;
  if (s0.cta) { cta.href = s0.cta.href; $('span', cta).textContent = s0.cta.label; }
  $('.tour-extra').hidden = !s0.obj && !s0.cta;
  const dots = $('[data-bind="tour-dots"]'); dots.textContent = '';
  st.forEach((_, k) => dots.append(el('i', { class: k === S.tourI ? 'is-on' : '' })));
  $('[data-act="tour-prev"]').disabled = S.tourI === 0;
  $('[data-act="tour-next"]').textContent = S.tourI === st.length - 1 ? 'Terminer' : 'Suivant';
  document.body.classList.toggle('tour-rebar', Boolean(s0.rebar));
  if (rerun) {
    s0.go();
    // le statut affiché dépend de la vue réglée par go()
    if (s0.obj) setTimeout(() => S.tour && S.tourI === st.indexOf(s0) && tourShow(S.tourI, false), 60);
  }
}
function tourStart() {
  S.tour = tourSteps();
  $('[data-bind="tour"]').hidden = false; document.body.classList.add('in-tour');
  if (compactQ.matches) window.scrollTo(0, 0);
  else $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  tourShow(0);
}
function tourEnd() {
  stop(); closeRebar();
  $('[data-bind="tour"]').hidden = true; document.body.classList.remove('in-tour');
  S.tour = null; document.body.classList.remove('tour-rebar');
}
function wireTourTouch() {
  const card = $('.tour');
  // hauteur de la carte, pour placer la 3D au-dessus sur téléphone
  new ResizeObserver(() => document.documentElement.style.setProperty('--tour-h', `${Math.ceil(card.getBoundingClientRect().height)}px`)).observe(card);
  compactQ.addEventListener('change', () => { if (S.tour) tourShow(S.tourI, false); });
  let x0 = null, y0 = 0;
  card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (x0 == null || !S.tour) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) { if (S.tourI < S.tour.length - 1) tourShow(S.tourI + 1); } else tourShow(S.tourI - 1);
  });
}

// ---------- filtres
function setZone(z, opts = {}) {
  S.zone = z;
  $$('[data-zone]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.zone === z)));
  const sel = $('#ex-storey');
  sel.disabled = !['A1', 'A2'].includes(z);
  if (sel.disabled) sel.value = '';
  S.cut = null;
  if (!opts.silent) S.viewer?.setFilter(z, null);
}
function setStorey(st) {
  const z = S.zone;
  S.cut = st ? FLOORS[st] + (z === 'A1' ? 0.05 : 0) + 1.3 : null;
  S.viewer?.setFilter(z, S.cut);
}
function selectRow(row, fly = true) {
  if (!row) return;
  const z = row.zone === 'LT' ? 'LT' : row.zone;
  if (S.zone !== 'ALL' && S.zone !== z && !(S.zone === 'A1' && z === 'LT')) { setZone('ALL', { silent: true }); S.viewer?.setFilter('ALL', null); }
  if (['FOND', 'LT'].includes(z) && S.zone === 'ALL') { setZone(z === 'LT' ? 'A1' : 'FOND', { silent: true }); S.viewer?.setFilter(z, z === 'LT' ? FLOORS['R+3'] + 1.35 : null); }
  const hit = S.viewer?.select(row.revit, fly);
  if (!hit) toast(`${row.reference} n'a pas de géométrie dans la maquette 3D ; son résumé reste disponible.`);
  showPanel(row, hit);
  const u = new URL(location.href); u.searchParams.set('o', row.ref); history.replaceState(null, '', u);
}

// ---------- recherche
function search(qs) {
  const q = norm(qs);
  if (q.length < 2) return [];
  const toks = q.split(' ');
  const out = [];
  for (const r of S.rows) {
    if (toks.every(t => r._k.includes(t))) { out.push(r); if (out.length >= 12) break; }
  }
  return out;
}
function wireSearch() {
  const inp = $('#ex-search'), ul = $('#ex-results');
  let items = [], idx = -1;
  const close = () => { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); idx = -1; };
  const render = () => {
    ul.textContent = '';
    if (!items.length) { ul.append(el('li', { class: 'empty', text: inp.value.trim().length < 2 ? 'Tapez au moins deux caractères.' : 'Aucun ouvrage trouvé.' })); }
    items.forEach((r, i) => ul.append(el('li', { role: 'option', 'aria-selected': String(i === idx), onmousedown: (e) => { e.preventDefault(); pick(r); } },
      el('strong', { text: r.reference }), el('span', { text: `${r.designation} — ${ZONE_LABEL[r.zone] || r.zone}, ${r.etage}` }))));
    ul.hidden = false; inp.setAttribute('aria-expanded', 'true');
  };
  const pick = (r) => { inp.value = r.reference; close(); inp.blur(); selectRow(r); };
  inp.addEventListener('input', () => { items = search(inp.value); idx = -1; render(); });
  inp.addEventListener('focus', () => { if (inp.value) { items = search(inp.value); render(); } });
  inp.addEventListener('blur', () => setTimeout(close, 120));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { const r = items[Math.max(0, idx)]; if (r) pick(r); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
}

async function main() {
  const [ix, cm] = await Promise.all([fetch('data/index.json').then(r => r.json()), fetch('data/commun.json').then(r => r.json())]);
  S.commun = cm;
  const C = ix.colonnes;
  S.rows = ix.ouvrages.map(a => { const o = {}; C.forEach((c, i) => { o[c] = a[i]; }); o._k = norm(`${o.reference} ${o.ref} ${o.designation} ${o.etage} ${ZONE_LABEL[o.zone] || ''} ${cm.familles[o.famille] || ''}`); return o; });
  S.rows.sort((a, b) => a.reference.localeCompare(b.reference, 'fr', { numeric: true }));
  for (const r of S.rows) { S.byId.set(r.revit, r); S.byRef.set(r.ref, r); }
  const sel = $('#ex-storey');
  for (const s of Object.keys(FLOORS)) sel.append(el('option', { value: s, text: s }));

  const host = $('#viewer');
  try {
    S.viewer = await createViewer(host, {
      base: 'model/', explore: true, label: 'Projet',
      onPick: (e) => { if (!e) { hidePanel(); return; } showPanel(S.byId.get(e.id), e); }
    });
  } catch (e) {
    console.error(e);
    const st = $('[data-v="status"]', host); st.hidden = false;
    st.textContent = "La vue 3D n'a pas pu se charger sur cet appareil. Utilisez la recherche pour ouvrir un passeport.";
  }
  $$('[data-zone]').forEach(b => b.addEventListener('click', () => { hidePanel(); setZone(b.dataset.zone); }));
  sel.addEventListener('change', () => setStorey(sel.value));
  $('[data-close-panel]').addEventListener('click', hidePanel);
  $('[data-p="focus"]').addEventListener('click', () => { if (S.current) S.viewer?.select(S.current.revit, true); });
  $('[data-v-action="reset"]', host).addEventListener('click', () => { hidePanel(); setZone('ALL'); });
  $('[data-v-action="replay"]', host).addEventListener('click', () => { hidePanel(); setZone('ALL', { silent: true }); S.viewer?.replay(); });
  $('[data-v-action="fullscreen"]', host).addEventListener('click', () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (host.requestFullscreen) host.requestFullscreen().catch(() => host.classList.toggle('is-max')); else host.classList.toggle('is-max');
  });
  wireSearch();
  S.order = ix.statuts_4d || [];
  S.nbRebar = ix.nb_ferraillage || 0;
  if (S.order.length) setupTime(); else $$('[data-view="avancement"]').forEach(b => { b.hidden = true; });
  $$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('[data-act="tour"]').addEventListener('click', () => (S.tour ? tourEnd() : tourStart()));
  $('[data-act="tour-close"]').addEventListener('click', tourEnd);
  wireTourTouch();
  $('[data-act="tour-prev"]').addEventListener('click', () => tourShow(S.tourI - 1));
  $('[data-act="tour-next"]').addEventListener('click', () => { if (S.tourI >= S.tour.length - 1) tourEnd(); else tourShow(S.tourI + 1); });
  document.addEventListener('keydown', (e) => {
    if (!S.tour || e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); if (S.tourI < S.tour.length - 1) tourShow(S.tourI + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); tourShow(S.tourI - 1); }
    else if (e.key === 'Escape') tourEnd();
  });
  if (new URLSearchParams(location.search).has('presentation')) setTimeout(tourStart, 3400);

  const qr = $('#dlg-qr');
  $('[data-bind="qr-url"]', qr).textContent = CFG.siteUrl || location.origin + location.pathname;
  $('#btn-qr').addEventListener('click', () => qr.showModal());
  $$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  qr.addEventListener('click', (e) => { if (e.target === qr) qr.close(); });

  const pre = new URLSearchParams(location.search).get('o');
  if (pre && S.byRef.has(pre)) setTimeout(() => selectRow(S.byRef.get(pre)), 3200);

  if (api.configured()) {
    await new Promise(r => (window.supabase ? r() : window.addEventListener('load', r, { once: true })));
    try { for (const o of await api.listStatuts()) S.live.set(o.ref, o); if (S.current) showPanel(S.current); }
    catch (e) { console.warn('Statuts en ligne indisponibles', e); }
  }
}
main().catch((e) => { console.error(e); document.body.prepend(el('p', { class: 'fatal', text: "La maquette n'a pas pu se charger. Vérifiez la connexion puis rechargez la page." })); });
