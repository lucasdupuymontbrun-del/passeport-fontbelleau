// Maquette du projet : exploration 3D de tous les ouvrages, résumé au toucher, puis fiche complète.
import * as api from './backend.js';
import { createViewer } from './viewer.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CFG = window.PASSEPORT_CONFIG || {};
const S = { rows: [], byId: new Map(), byRef: new Map(), commun: null, live: new Map(), viewer: null, zone: 'ALL', cut: null, current: null };

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
  const q = (k) => $(`[data-p="${k}"]`, p);
  if (!row) {
    q('context').textContent = el3d?.kind || 'Élément de la maquette';
    q('reference').textContent = 'Sans passeport';
    q('designation').textContent = "Cet élément n'a pas de passeport : c'est un sous-élément (par exemple un panneau de mur-rideau) ou il n'a pas d'identifiant dans la maquette.";
    q('pill').hidden = true; q('fiab').textContent = ''; q('facts').textContent = '';
    q('open').hidden = true; q('focus').hidden = true;
    p.hidden = false;
    return;
  }
  q('pill').hidden = false; q('open').hidden = false; q('focus').hidden = false;
  q('context').textContent = `${ZONE_LABEL[row.zone] || ''} · ${row.etage}`;
  q('reference').textContent = row.reference;
  q('designation').textContent = row.designation;
  const st = statusOf(row);
  const pill = q('pill');
  pill.textContent = statusDef(st.cle).label; pill.dataset.status = st.cle; pill.classList.toggle('is-fictif', !st.live);
  q('fiab').textContent = '';
  q('fiab').append(st.live ? el('span', { class: 'fiab fiab-saisi', title: 'Statut mis à jour en ligne par un éditeur.' }, 'Suivi en ligne') : fiab('fictif'));
  q('open').href = passportHref(row.ref);
  const facts = q('facts'); facts.textContent = '';
  const add = (dt, dd) => facts.append(el('div', {}, el('dt', { text: dt }), el('dd', {}, dd)));
  add('Catégorie', S.commun.familles[row.famille] || row.famille);
  add('Zone', ZONE_LABEL[row.zone] || row.zone);
  add('Étage', row.etage);
  p.hidden = false;
  try {
    const d = await (await fetch(`data/o/${encodeURIComponent(row.ref)}.json`)).json();
    if (S.current !== row) return;
    const js = (d.planning?.jalons || []).filter(j => !j.reelle && j.previsionnelle).sort((a, b) => a.previsionnelle.localeCompare(b.previsionnelle));
    if (js[0]) add('Prochaine échéance', el('span', {}, `${js[0].label} : ${fmtDate(js[0].previsionnelle)} `, fiab(js[0].fiab || 'fictif')));
    else add('Prochaine échéance', 'Aucune : tous les jalons ont une date réelle.');
    const lot = d.identite?.find(r => r.cle === 'lot');
    if (lot?.valeur) add('Lot', lot.valeur);
    if (d.avertissements?.length) add('À noter', d.avertissements.map(a => a.titre).join(' · '));
  } catch (e) { /* le résumé reste utilisable sans la fiche */ }
}
function hidePanel() { $('#ex-panel').hidden = true; S.current = null; S.viewer?.clearSelection(); }

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
