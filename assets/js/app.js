// Passeport numérique d'ouvrage : rendu de la page à partir de data/o/<REF>.json, data/commun.json et des données de suivi.
import * as api from './backend.js';
import { renderEnergieFiche } from './energie-fiche.js';
import { rebarCard } from './rebar-ui.js';

const REF = (document.body.dataset.ref || new URLSearchParams(location.search).get('r') || '').trim();
const CFG = window.PASSEPORT_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const bind = (k) => $$(`[data-bind="${k}"]`);

const S = {
  data: null,
  user: null,
  role: null,          // 'editeur' | 'lecteur' | null
  live: null,          // état Supabase
  mode: 'offline',     // 'live' | 'offline' | 'error'
  viewer: null,
  noteFilter: 'tout',
  fieldTarget: null
};

// ---------- utilitaires ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function icon(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(ns, 'use'); u.setAttribute('href', '#' + id); s.append(u); return s;
}
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function parseDate(s) { if (!s) return null; const d = new Date(s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d) ? null : d; }
function fmtDate(s, short = false) {
  const d = parseDate(s); if (!d) return '';
  return short ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateTime(s) {
  const d = parseDate(s); if (!d) return '';
  return `${fmtDate(s)} à ${String(d.getHours()).padStart(2, '0')} h ${String(d.getMinutes()).padStart(2, '0')}`;
}
function today() { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }
function isoToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function relDays(n) {
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  return n > 0 ? `dans ${n} jours` : `il y a ${-n} jours`;
}
let toastTimer = 0;
function toast(msg, kind = '') {
  const t = $('.toast'); t.textContent = msg; t.dataset.kind = kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}
function errMsg(e) {
  const m = e?.message || String(e);
  if (/row-level security|permission|not allowed|violates/i.test(m)) return "Action refusée : votre compte n'a pas le droit de modifier ce passeport.";
  return m;
}

// ---------- fiabilité ----------
function fiabTag(f, extraTitle) {
  const def = S.data.fiabilites[f] || { label: f, aide: '' };
  return el('span', { class: `fiab fiab-${f}`, title: [def.aide, extraTitle].filter(Boolean).join(' ') }, def.label);
}
function renderLegend() {
  const ul = bind('legend')[0]; ul.textContent = '';
  for (const k of ['verifie', 'modele', 'estime', 'conflit', 'fictif', 'nd', 'saisi']) {
    const d = S.data.fiabilites[k];
    ul.append(el('li', {}, fiabTag(k), el('span', { text: d.aide })));
  }
}

// ---------- champs saisis (surcharges) ----------
function champs() {
  const m = new Map();
  for (const c of S.live?.champs || []) m.set(c.cle, c);
  return m;
}
function override(key) { return champs().get(key) || null; }

// ---------- statut ----------
function statuses() { return S.data.statuts; }
function currentStatusKey() { return S.live?.ouvrage?.statut || S.data.scenario.statut; }
function liveRow() { return S.mode === 'live' && Boolean(S.live?.ouvrage); }
function statusIndex(k) { return statuses().findIndex(s => s.cle === k); }
function statusDef(k) { return statuses().find(s => s.cle === k) || { cle: k, label: k, phase: 'achat' }; }
function lastUpdate() {
  if (S.live?.ouvrage) {
    const ev = S.live.evenements?.[0];
    const a = parseDate(S.live.ouvrage.maj_le), b = ev ? parseDate(ev.cree_le) : null;
    if (b && (!a || b > a)) return { at: ev.cree_le, by: ev.auteur };
    return { at: S.live.ouvrage.maj_le, by: S.live.ouvrage.maj_par };
  }
  return { at: S.data.scenario.maj_le, by: S.data.scenario.maj_par, fictif: true };
}

function jalons() {
  return S.data.planning.jalons.map(j => {
    const o = { ...j, saisi: {} };
    for (const k of ['contractuelle', 'previsionnelle', 'reelle']) {
      const ov = override(`jalon.${j.cle}.${k}`);
      if (ov) { o[k] = ov.valeur; o.saisi[k] = ov; }
    }
    return o;
  });
}

function renderHero() {
  const d = S.data;
  bind('reference').forEach(n => { n.textContent = d.reference; });
  bind('designation')[0].textContent = d.designation;
  bind('context').forEach(n => { n.textContent = d.contexte || ''; });

  const key = currentStatusKey();
  const idx = statusIndex(key);
  const def = statusDef(key);
  const pill = bind('status-pill')[0];
  pill.textContent = def.label;
  pill.dataset.status = key;
  pill.classList.toggle('is-fictif', !liveRow());

  const ol = bind('steps')[0]; ol.textContent = '';
  statuses().forEach((s, i) => {
    ol.append(el('li', {
      class: i < idx ? 'done' : i === idx ? 'current' : 'todo',
      dataset: { status: s.cle, phase: s.phase },
      title: s.label,
      'aria-current': i === idx ? 'step' : null
    }, el('span', { class: 'vh', text: `${i + 1}. ${s.label}${i === idx ? ' (actuel)' : i < idx ? ' (fait)' : ''}` })));
  });
  const pct = Math.round(((idx + 1) / statuses().length) * 100);
  const lu = lastUpdate();
  const meta = bind('status-meta')[0]; meta.textContent = '';
  meta.append(
    el('span', { class: 'pct' }, el('b', { text: `${pct} %` }), ` d'avancement, étape ${idx + 1} sur ${statuses().length}`),
    el('span', { class: 'upd' }, `Mis à jour le ${fmtDateTime(lu.at)}`, lu.by ? ` par ${lu.by}` : '')
  );

  // prochaine échéance
  const next = bind('next')[0]; next.textContent = '';
  const upcoming = jalons().filter(j => !j.reelle && j.previsionnelle).sort((a, b) => parseDate(a.previsionnelle) - parseDate(b.previsionnelle))[0];
  if (upcoming) {
    const dd = daysBetween(today(), parseDate(upcoming.previsionnelle));
    const isSaisi = upcoming.saisi.previsionnelle;
    next.className = 'next' + (dd < 0 ? ' late' : '');
    next.append(
      el('span', { class: 'next-label' }, 'Prochaine échéance'),
      el('span', { class: 'next-date' }, fmtDate(upcoming.previsionnelle)),
      el('span', { class: 'next-what' }, upcoming.label, el('span', { class: 'next-rel' }, dd < 0 ? `en retard, prévue ${relDays(dd)}` : relDays(dd))),
      fiabTag(isSaisi ? 'saisi' : upcoming.fiab)
    );
  } else {
    next.className = 'next done';
    next.append(el('span', { class: 'next-label' }, 'Prochaine échéance'), el('span', { class: 'next-what' }, 'Aucune : tous les jalons ont une date réelle.'));
  }
}

// ---------- fiches de données ----------
function row(section, r, opts = {}) {
  const key = `${section}.${r.cle}`;
  const ov = override(key);
  const fiab = ov ? 'saisi' : r.fiab;
  const val = ov ? ov.valeur : r.valeur;
  const dd = el('dd', {});
  dd.append(el('span', { class: 'val' + (val ? '' : ' is-nd') }, val || 'Information non disponible'));
  if (r.detail && !ov) dd.append(el('span', { class: 'detail', text: r.detail }));
  const src = el('span', { class: 'src' }, fiabTag(fiab));
  if (ov) src.append(el('span', { class: 'src-item' }, `${ov.source || 'Source non précisée'}, ${ov.auteur || ''} le ${fmtDate(ov.maj_le)}`));
  else for (const s of r.sources || []) src.append(el('span', { class: 'src-item', text: s }));
  dd.append(src);
  const wrap = el('div', { class: `row fiab-row-${fiab}` }, el('dt', { text: r.label }), dd);
  if (opts.editable && S.role === 'editeur') {
    wrap.append(el('button', { class: 'row-edit', type: 'button', title: `Mettre à jour : ${r.label}`, onclick: () => openField(key, r.label, val) }, icon('i-edit'), el('span', { class: 'vh', text: 'Modifier' })));
  }
  return wrap;
}

function renderIdentite() {
  const d = S.data;
  const w = bind('warnings')[0]; w.textContent = '';
  for (const a of d.avertissements) {
    w.append(el('aside', { class: `warn warn-${a.type}` }, icon('i-alert'), el('div', {}, el('strong', { text: a.titre }), el('p', { text: a.texte }))));
  }
  const dl = bind('identite')[0]; dl.textContent = '';
  for (const r of d.identite) dl.append(row('identite', r, { editable: !['reference', 'identifiants'].includes(r.cle) }));
}

const PLAN_ALL = { A1: 'Tour entière', A2: 'Tour entière', LT: 'Tour entière', PARK: 'Parking entier', FOND: 'Toutes les fondations', EXT: 'Tout le site' };
function passportHref(slug) { return slug === 'A2-PM106' ? '../A2-PM106/' : `../o/?r=${encodeURIComponent(slug)}`; }
async function renderLocalisation() {
  const L = S.data.localisation;
  bind('loc-resume')[0].textContent = L.resume;
  const alt = bind('loc-alt')[0]; alt.textContent = '';
  alt.append(
    el('div', {}, el('dt', { text: 'Pied' }), el('dd', {}, `${L.ngf_pied.toFixed(2).replace('.', ',')} NGF`)),
    el('div', {}, el('dt', { text: 'Tête' }), el('dd', {}, `${L.ngf_tete.toFixed(2).replace('.', ',')} NGF`))
  );
  const ul = bind('voisins')[0]; ul.textContent = '';
  if (!L.voisins.length) ul.append(el('li', { class: 'empty', text: 'Aucun ouvrage repéré à proximité dans la maquette.' }));
  for (const v of L.voisins) {
    const name = v.slug ? el('a', { href: passportHref(v.slug), text: v.ref }) : el('strong', { text: v.ref });
    ul.append(el('li', {}, el('span', { class: 'nb-role', text: v.role }), name, el('span', { class: 'nb-txt', text: v.texte })));
  }
  const src = bind('loc-src')[0]; src.textContent = '';
  src.append(fiabTag(L.fiab), ...L.sources.map(s => el('span', { class: 'src-item', text: s })));
  bind('plan-all').forEach(b => { b.textContent = PLAN_ALL[S.data.zone] || 'Plan entier'; });

  const host = bind('plan')[0];
  try {
    const txt = await (await fetch(L.plan)).text();
    host.innerHTML = txt;
    const svg = host.querySelector('svg');
    const full = svg.getAttribute('viewBox');
    const scale = Number(svg.dataset.scale) || 30;
    const NS = 'http://www.w3.org/2000/svg';
    const tg = svg.querySelector(`[data-id="${L.cible}"]`);
    let crop = full;
    if (tg) {
      tg.classList.add('is-target');
      const b = tg.getBBox();
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      const w = Math.max(11 * scale, b.width + 4 * scale), h = Math.max(10 * scale, b.height + 4 * scale);
      crop = `${(cx - w / 2).toFixed(1)} ${(cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
      const ring = document.createElementNS(NS, 'ellipse');
      ring.setAttribute('class', 'pl-ring');
      ring.setAttribute('cx', cx); ring.setAttribute('cy', cy);
      ring.setAttribute('rx', Math.max(b.width / 2 + 0.6 * scale, scale)); ring.setAttribute('ry', Math.max(b.height / 2 + 0.6 * scale, scale));
      svg.append(ring);
      const lab = document.createElementNS(NS, 'text');
      lab.setAttribute('class', 'pl-tlab'); lab.setAttribute('x', cx); lab.setAttribute('y', cy - Math.max(b.height / 2 + 0.6 * scale, scale) - 6);
      lab.setAttribute('text-anchor', 'middle'); lab.textContent = S.data.reference;
      svg.append(lab);
      // étiquettes des ouvrages proches
      const lim = Math.max(w, h) * 0.55;
      const placed = [[cx, cy - Math.max(b.height / 2 + 0.6 * scale, scale) - 6]];
      for (const g of svg.querySelectorAll('.pl-els > g')) {
        if (g === tg) continue;
        const bb = g.getBBox();
        const gx = bb.x + bb.width / 2, gy = bb.y + bb.height / 2;
        if (Math.abs(gx - cx) > lim || Math.abs(gy - cy) > lim || bb.width * bb.height < 4) continue;
        if (!/^k-(w|st|f)$/.test(g.getAttribute('class'))) continue;
        const name = (g.dataset.i || '').replace(/^A[12] /, '');
        if (!name || name.startsWith('Sans identifiant')) continue;
        if (placed.some(([px, py]) => Math.abs(px - gx) < 34 && Math.abs(py - gy) < 11)) continue;
        placed.push([gx, gy]);
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('class', 'pl-lab'); t.setAttribute('x', gx); t.setAttribute('y', gy + 3);
        t.textContent = name;
        svg.append(t);
      }
    } else {
      host.append(el('p', { class: 'plan-miss', text: "Cet ouvrage n'apparaît pas dans la coupe du plan (pas de géométrie exportable)." }));
    }
    svg.setAttribute('viewBox', crop);
    svg.addEventListener('click', (e) => {
      const g = e.target.closest('.pl-els > g');
      if (!g || g === tg || !g.dataset.r) return;
      location.href = passportHref(g.dataset.r);
    });
    for (const g of svg.querySelectorAll('.pl-els > g')) {
      const t = document.createElementNS(NS, 'title');
      t.textContent = g === tg ? `${S.data.reference} (cet ouvrage)` : `${g.dataset.i} — ouvrir son passeport`;
      g.prepend(t);
    }
    $$('[data-plan]').forEach(b => b.addEventListener('click', () => {
      $$('[data-plan]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      svg.setAttribute('viewBox', b.dataset.plan === 'tour' ? full : crop);
      svg.classList.toggle('is-full', b.dataset.plan === 'tour');
    }));
  } catch (e) {
    console.warn(e);
    host.textContent = 'Plan indisponible.';
  }
}

// ---------- documents ----------
function isMember() { return S.role === 'editeur' || S.role === 'lecteur'; }
function renderDocuments() {
  const host = bind('documents')[0]; host.textContent = '';
  const docs = [...S.data.documents];
  for (const ld of S.live?.documents || []) {
    docs.push({ id: 'live-' + ld.id, categorie: ld.categorie || 'Autres documents', titre: ld.titre, ref: ld.ref_doc, fichier: ld.chemin, acces: 'prive', fiab: 'saisi', note: `Ajouté par ${ld.ajoute_par || 'un éditeur'} le ${fmtDate(ld.cree_le)}`, live: true });
  }
  if (S.data.ferraillage) host.append(rebarCard(S.data, fiabTag));
  const present = docs.filter(d => d.fiab !== 'nd');
  const missing = docs.filter(d => d.fiab === 'nd');
  const cats = [];
  for (const d of present) if (!cats.includes(d.categorie)) cats.push(d.categorie);
  for (const c of cats) {
    const g = el('div', { class: 'doc-group' }, el('h3', { class: 'sub', text: c }));
    const ul = el('ul', { class: 'docs' });
    for (const d of present.filter(x => x.categorie === c)) ul.append(docItem(d));
    g.append(ul); host.append(g);
  }
  if (missing.length) {
    const g = el('div', { class: 'doc-group is-missing' }, el('h3', { class: 'sub' }, 'Absents du dossier ', fiabTag('nd')));
    const ul = el('ul', { class: 'docs' });
    for (const d of missing) ul.append(docItem(S.data.ferraillage && d.id === 'nd_ferraillage' ? { ...d, note: "Aucun plan d'exécution dans le DCE. Un exemple fictif est proposé en haut de cette rubrique." } : d, true));
    g.append(ul); host.append(g);
  }
  $$('[data-action="add-doc"]').forEach(b => { b.hidden = S.role !== 'editeur'; });
}
function docItem(d, compact = false) {
  const meta = [d.ref, d.indice && d.indice !== '—' ? `ind. ${d.indice}` : null, d.phase].filter(Boolean);
  const li = el('li', { class: `doc fiab-row-${d.fiab}` },
    el('span', { class: 'doc-ico' }, icon(d.fiab === 'nd' ? 'i-alert' : 'i-doc')),
    el('div', { class: 'doc-main' },
      compact ? el('span', { class: 'doc-cat', text: d.categorie }) : null,
      el('strong', { text: d.titre }),
      meta.length ? el('span', { class: 'doc-meta' }, ...meta.map(m => el('span', { text: m }))) : null,
      d.note ? el('span', { class: 'doc-note', text: d.note }) : null,
      compact ? null : el('span', { class: 'src' }, fiabTag(d.fiab))
    )
  );
  if (compact && S.role !== 'editeur') return li;
  const act = el('div', { class: 'doc-act' });
  if (d.fiab === 'nd') {
    if (S.role === 'editeur') act.append(el('button', { class: 'btn btn-line btn-s', type: 'button', onclick: () => openDocUpload(d.categorie, d.titre) }, icon('i-plus'), 'Ajouter'));
    else act.append(el('span', { class: 'doc-missing', text: 'Non disponible' }));
  } else if (d.acces === 'public') {
    act.append(
      el('button', { class: 'btn btn-line btn-s', type: 'button', onclick: () => openPdf(d.titre, d.fichier, d.fichier) }, icon('i-open'), 'Ouvrir'),
      el('a', { class: 'btn btn-quiet btn-s', href: d.fichier, download: '' }, icon('i-download'), el('span', { class: 'vh-s', text: 'Télécharger' }))
    );
  } else if (isMember() && S.mode === 'live') {
    act.append(
      el('button', { class: 'btn btn-line btn-s', type: 'button', onclick: () => openPrivate(d) }, icon('i-open'), 'Ouvrir'),
      el('button', { class: 'btn btn-quiet btn-s', type: 'button', onclick: () => downloadPrivate(d) }, icon('i-download'), el('span', { class: 'vh-s', text: 'Télécharger' }))
    );
  } else {
    act.append(el('button', { class: 'btn btn-quiet btn-s', type: 'button', onclick: () => (S.mode === 'live' ? openLogin() : toast("Les pièces du DCE sont stockées sur l'espace sécurisé, qui n'est pas encore configuré.")) }, icon('i-lock'), S.user ? 'Accès réservé' : 'Connexion requise'));
  }
  li.append(act);
  return li;
}
function docErr(e, d) {
  const m = e?.message || String(e);
  if (/not.?found|introuvable|does not exist/i.test(m)) return `Ce document n'est pas encore déposé sur l'espace sécurisé (documents/${d.fichier}).`;
  return errMsg(e);
}
async function openPrivate(d) {
  try { const url = await api.signedUrl(d.fichier); const dl = await api.signedUrl(d.fichier, true); openPdf(d.titre, url, dl); }
  catch (e) { toast(docErr(e, d), 'err'); }
}
async function downloadPrivate(d) {
  try { location.href = await api.signedUrl(d.fichier, true); } catch (e) { toast(docErr(e, d), 'err'); }
}
function openPdf(title, url, dlUrl) {
  if (window.matchMedia('(max-width: 760px)').matches) { window.open(url, '_blank', 'noopener'); return; }
  const dlg = $('#dlg-pdf');
  $('#dlg-pdf-t').textContent = title;
  bind('pdf-frame')[0].src = url;
  bind('pdf-dl')[0].href = dlUrl || url;
  bind('pdf-tab')[0].href = url;
  dlg.showModal();
}

// ---------- approvisionnement ----------
function datesTable(keys) {
  const js = jalons().filter(j => keys.includes(j.cle));
  const t = el('table', { class: 'dates' },
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Jalon' }), el('th', { scope: 'col', text: 'Contractuelle' }), el('th', { scope: 'col', text: 'Prévisionnelle' }), el('th', { scope: 'col', text: 'Réelle' }), el('th', { scope: 'col', text: 'Fiabilité' })))
  );
  const tb = el('tbody');
  for (const j of js) {
    const cell = (k) => {
      const td = el('td', {}, j[k] ? fmtDate(j[k]) : el('span', { class: 'is-nd', text: k === 'reelle' ? 'À venir' : 'Non disponible' }));
      if (S.role === 'editeur' && k !== 'contractuelle') td.append(el('button', { class: 'cell-edit', type: 'button', title: `Mettre à jour la date ${k === 'reelle' ? 'réelle' : 'prévisionnelle'} : ${j.label}`, onclick: () => openField(`jalon.${j.cle}.${k}`, `${j.label} — date ${k === 'reelle' ? 'réelle' : 'prévisionnelle'}`, j[k] || isoToday(), 'date') }, icon('i-edit')));
      return td;
    };
    const anySaisi = Object.keys(j.saisi).length > 0;
    tb.append(el('tr', { class: `fiab-row-${anySaisi ? 'saisi' : j.fiab}` }, el('th', { scope: 'row', text: j.label }), cell('contractuelle'), cell('previsionnelle'), cell('reelle'), el('td', {}, fiabTag(anySaisi ? 'saisi' : j.fiab))));
  }
  t.append(tb);
  return el('div', { class: 'table-wrap' }, t);
}
function renderAppro() {
  const dl = bind('appro')[0]; dl.textContent = '';
  for (const r of S.data.approvisionnement) dl.append(row('appro', r, { editable: true }));
  const host = bind('appro-dates')[0]; host.textContent = '';
  host.append(datesTable(['commande', 'livraison']));
}

// ---------- planning ----------
function renderPlanning() {
  const js = jalons();
  const all = js.flatMap(j => ['contractuelle', 'previsionnelle', 'reelle'].map(k => parseDate(j[k])).filter(Boolean));
  all.push(today());
  const t0 = new Date(Math.min(...all) - 4 * 86400000), t1 = new Date(Math.max(...all) + 4 * 86400000);
  const span = t1 - t0;
  const pos = (d) => `${(((d - t0) / span) * 100).toFixed(2)}%`;

  const host = bind('timeline')[0]; host.textContent = '';
  const axis = el('div', { class: 'tl-axis', 'aria-hidden': 'true' });
  // repères de semaine
  const w = new Date(t0); w.setDate(w.getDate() + ((8 - w.getDay()) % 7)); // lundi suivant
  for (let d = new Date(w); d < t1; d.setDate(d.getDate() + 7)) {
    axis.append(el('span', { class: 'tl-tick', style: `left:${pos(d)}` }, fmtDate(d.toISOString().slice(0, 10), true)));
  }
  host.append(el('div', { class: 'tl-row tl-head' }, el('span'), axis));

  const curIdx = statusIndex(currentStatusKey());
  const common = js.every(j => j.fiab === js[0].fiab) ? js[0].fiab : null;
    const note = $('.tl-note', host.parentElement);
  if (note) note.remove();
  if (common) host.before(el('p', { class: 'tl-note' }, fiabTag(common), common === 'fictif' ? 'Toutes les dates de cette frise appartiennent au scénario de démonstration, sauf celles marquées « Saisi ».' : ''));
  for (const j of js) {
    const track = el('div', { class: 'tl-track' });
    const c = parseDate(j.contractuelle), p = parseDate(j.previsionnelle), r = parseDate(j.reelle);
    const ref = r || p;
    if (c && ref) {
      const a = Math.min(c, ref), b = Math.max(c, ref);
      const late = ref > c;
      track.append(el('span', { class: 'tl-drift ' + (late ? 'late' : 'early'), style: `left:${pos(new Date(a))};width:calc(${pos(new Date(b))} - ${pos(new Date(a))})` }));
    }
    if (c) track.append(el('i', { class: 'dk dk-c', style: `left:${pos(c)}`, title: `Contractuelle : ${fmtDate(j.contractuelle)}` }));
    if (p) track.append(el('i', { class: 'dk dk-p', style: `left:${pos(p)}`, title: `Prévisionnelle : ${fmtDate(j.previsionnelle)}` }));
    if (r) track.append(el('i', { class: 'dk dk-r', style: `left:${pos(r)}`, title: `Réelle : ${fmtDate(j.reelle)}`, dataset: { phase: statusDef(j.statut || 'commande').phase } }));
    const done = Boolean(r) || (j.statut && statusIndex(j.statut) <= curIdx);
    let ecart = '';
    if (c && ref) {
      const n = daysBetween(c, ref);
      ecart = n === 0 ? 'à la date contractuelle' : n > 0 ? `${n} j de retard` : `${-n} j d'avance`;
    }
    const dates = el('span', { class: 'tl-dates' },
      j.contractuelle ? el('span', {}, el('i', { class: 'dk dk-c' }), fmtDate(j.contractuelle, true)) : null,
      j.previsionnelle ? el('span', {}, el('i', { class: 'dk dk-p' }), fmtDate(j.previsionnelle, true)) : null,
      j.reelle ? el('span', {}, el('i', { class: 'dk dk-r' }), fmtDate(j.reelle, true)) : el('span', { class: 'is-nd' }, 'réelle à venir'),
      ecart ? el('span', { class: 'tl-ecart', text: ecart }) : null
    );
    const anySaisi = Object.keys(j.saisi).length > 0;
    host.append(el('div', { class: `tl-row fiab-row-${anySaisi ? 'saisi' : j.fiab} ${done ? 'is-done' : ''}` },
      el('div', { class: 'tl-label' }, el('strong', { text: j.label }), dates, anySaisi || !common ? fiabTag(anySaisi ? 'saisi' : j.fiab) : null),
      track));
  }
  const tl = today();
  if (tl >= t0 && tl <= t1) host.append(el('div', { class: 'tl-today', style: `--x:${((tl - t0) / span).toFixed(4)}` }, el('span', {}, "Aujourd'hui")));

  const dl = bind('plan-infos')[0]; dl.textContent = '';
  for (const r of S.data.planning.infos) dl.append(row('planning', r, { editable: true }));

  const D = S.data.planning.dependances;
  const deps = bind('deps')[0]; deps.textContent = '';
  deps.append(el('h3', { class: 'sub' }, 'Dépendances avec les autres ouvrages ', fiabTag(D.fiab)));
  const grid = el('div', { class: 'deps-grid' });
  for (const [k, lab] of [['avant', 'Avant la pose'], ['pendant', 'En même temps'], ['apres', 'Après la pose']]) {
    grid.append(el('div', {}, el('h4', { text: lab }), el('ul', {}, ...D[k].map(x => el('li', { text: x })))));
  }
  deps.append(grid);

  const ck = bind('controles')[0]; ck.textContent = '';
  ck.append(el('h3', { class: 'sub' }, 'Points de contrôle avant pose ', fiabTag(S.data.planning.controles_fiab)));
  const ul = el('ul', { class: 'checklist' });
  S.data.planning.controles.forEach((c, i) => {
    const ov = override(`controle.${i}`);
    const on = ov?.valeur === 'ok';
    const cb = el('input', { type: 'checkbox', checked: on, disabled: S.role !== 'editeur', onchange: async (e) => {
      try { await ensureRow(); await api.setField(REF, `controle.${i}`, e.target.checked ? 'ok' : 'a_faire', 'Contrôle avant pose'); toast(e.target.checked ? 'Contrôle validé.' : 'Contrôle remis à faire.'); await refresh(); }
      catch (err) { e.target.checked = !e.target.checked; toast(errMsg(err), 'err'); }
    } });
    ul.append(el('li', {}, el('label', {}, cb, el('span', { text: c }), ov ? el('small', { text: `${on ? 'Validé' : 'À faire'} par ${ov.auteur || 'un éditeur'} le ${fmtDate(ov.maj_le)}` }) : null)));
  });
  ck.append(ul);
}

// ---------- suivi ----------
function fieldLabel(cle) {
  const [sec, k, sub] = String(cle).split('.');
  const find = (arr) => arr.find(r => r.cle === k)?.label;
  if (sec === 'identite') return find(S.data.identite) || k;
  if (sec === 'appro') return find(S.data.approvisionnement) || k;
  if (sec === 'planning') return find(S.data.planning.infos) || k;
  if (sec === 'jalon') {
    const j = S.data.planning.jalons.find(x => x.cle === k);
    return `${j?.label || k}, date ${sub === 'reelle' ? 'réelle' : sub === 'previsionnelle' ? 'prévisionnelle' : 'contractuelle'}`;
  }
  if (sec === 'controle') return `Contrôle « ${S.data.planning.controles[+k] || k} »`;
  return cle;
}
function fieldValue(cle, v) {
  if (v == null) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  if (String(cle).startsWith('controle.')) return v === 'ok' ? 'validé' : 'à faire';
  return v;
}
function splitChamp(e) {
  const c = e.commentaire || '';
  const i = c.indexOf(' (source : ');
  return i < 0 ? { cle: c, source: null } : { cle: c.slice(0, i), source: c.slice(i + 11).replace(/\)$/, '') };
}
function evLabel(e) {
  const sd = (k) => statusDef(k).label;
  switch (e.type) {
    case 'statut': return el('span', {}, 'Statut : ', e.ancien ? `${sd(e.ancien)} → ` : '', el('strong', { text: sd(e.nouveau) }));
    case 'note_remarque': return el('span', {}, 'Remarque ajoutée : ', e.nouveau);
    case 'note_observation': return el('span', {}, 'Observation ajoutée : ', e.nouveau);
    case 'note_reserve': return el('span', {}, 'Réserve ajoutée : ', e.nouveau);
    case 'reserve_levee': return el('span', {}, 'Réserve levée : ', e.nouveau);
    case 'reserve_rouverte': return el('span', {}, 'Réserve rouverte : ', e.nouveau);
    case 'photo': return el('span', {}, 'Photo ajoutée', e.nouveau ? ` : ${e.nouveau}` : '');
    case 'champ': {
      const { cle } = splitChamp(e);
      return el('span', {}, `${fieldLabel(cle)} : `, e.ancien ? `${fieldValue(cle, e.ancien)} → ` : '', el('strong', { text: fieldValue(cle, e.nouveau) }));
    }
    case 'document': return el('span', {}, 'Document ajouté : ', e.nouveau);
    default: return el('span', { text: e.nouveau || e.type });
  }
}
function renderSuivi() {
  const online = S.mode === 'live';
  const live = liveRow();
  bind('suivi-intro')[0].textContent = live
    ? "Suivi en direct : les mises à jour des éditeurs s'affichent sans recharger la page."
    : online
      ? "Le suivi en ligne de cet ouvrage n'a pas encore commencé : le scénario de démonstration est affiché. Il démarre à la première mise à jour d'un éditeur."
    : S.mode === 'error'
      ? "Le service de suivi ne répond pas. Affichage du scénario de démonstration enregistré dans le passeport."
      : "Suivi en direct non configuré. Affichage du scénario de démonstration enregistré dans le passeport.";
  const lv = bind('live')[0];
  lv.textContent = online ? 'En direct' : 'Hors ligne';
  lv.dataset.on = online ? '1' : '0';

  const cur = statusIndex(currentStatusKey());
  const track = bind('track')[0]; track.textContent = '';
  const evs = live ? S.live.evenements : S.data.scenario.evenements;
  statuses().forEach((s, i) => {
    const ev = [...evs].filter(e => e.type === 'statut' && e.nouveau === s.cle).sort((a, b) => parseDate(b.cree_le) - parseDate(a.cree_le))[0];
    track.append(el('li', { class: i < cur ? 'done' : i === cur ? 'current' : 'todo', dataset: { status: s.cle, phase: s.phase }, 'aria-current': i === cur ? 'step' : null },
      el('span', { class: 'tk-dot' }, i < cur ? icon('i-check') : null),
      el('span', { class: 'tk-label', text: s.label }),
      ev ? el('span', { class: 'tk-date' + (ev.fictif ? ' is-fictif' : ''), text: fmtDate(ev.cree_le) }) : null));
  });

  const editor = S.role === 'editeur' && online;
  $$('[data-action="change-status"]').forEach(b => { b.hidden = !editor; });
  $$('[data-action="add-note"]').forEach(b => { b.hidden = !editor; });
  $$('[data-action="add-photo"]').forEach(b => { b.hidden = !editor; });

  // notes
  const notes = live ? S.live.notes : S.data.scenario.notes;
  const ul = bind('notes')[0]; ul.textContent = '';
  const shown = notes.filter(n => S.noteFilter === 'tout' || n.type === S.noteFilter);
  if (!shown.length) ul.append(el('li', { class: 'empty', text: S.noteFilter === 'tout' ? 'Aucune note. Les éditeurs peuvent ajouter remarques, observations et réserves.' : 'Aucune note de ce type.' }));
  const TYPES = { remarque: 'Remarque', observation: 'Observation', reserve: 'Réserve' };
  for (const n of shown) {
    const li = el('li', { class: `note note-${n.type}${n.fictif ? ' is-fictif' : ''}${n.levee ? ' is-levee' : ''}` },
      el('span', { class: 'note-type' }, TYPES[n.type] || n.type, n.type === 'reserve' ? (n.levee ? ' levée' : ' en cours') : ''),
      el('p', { text: n.texte }),
      el('span', { class: 'note-meta' }, `${n.auteur || 'Inconnu'}, ${fmtDateTime(n.cree_le)}`, n.fictif ? fiabTag('fictif') : null));
    if (editor && live && n.type === 'reserve' && n.id) {
      li.append(el('button', { class: 'btn btn-quiet btn-s', type: 'button', onclick: async () => {
        try { await api.setNoteLevee(n.id, !n.levee); toast(n.levee ? 'Réserve rouverte.' : 'Réserve levée.'); await refresh(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, n.levee ? 'Rouvrir la réserve' : 'Lever la réserve'));
    }
    ul.append(li);
  }

  // photos
  const ph = bind('photos')[0]; ph.textContent = '';
  const photos = live ? S.live.photos : [];
  if (!photos.length) ph.append(el('p', { class: 'empty', text: editor ? 'Aucune photo. Ajoutez la première depuis votre téléphone.' : "Aucune photo de l'ouvrage pour l'instant." }));
  for (const p of photos) {
    const url = api.photoUrl(p.chemin);
    ph.append(el('figure', {}, el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: url, alt: p.legende || `Photo de ${S.data.reference}`, loading: 'lazy' })),
      el('figcaption', {}, p.legende ? el('span', { text: p.legende }) : null, el('small', { text: `${p.auteur || ''}, ${fmtDate(p.cree_le)}` }))));
  }

  // historique
  const hist = bind('history')[0]; hist.textContent = '';
  let items;
  if (live) items = S.live.evenements;
  else items = [...S.data.scenario.evenements, ...S.data.scenario.notes.map(n => ({ type: 'note_' + n.type, nouveau: n.texte, cree_le: n.cree_le, auteur: n.auteur, fictif: n.fictif }))]
    .sort((a, b) => parseDate(b.cree_le) - parseDate(a.cree_le));
  if (!items.length) hist.append(el('li', { class: 'empty', text: 'Aucune modification enregistrée.' }));
  for (const e of items) {
    hist.append(el('li', { class: e.fictif ? 'is-fictif' : '' },
      el('time', { datetime: e.cree_le, text: fmtDateTime(e.cree_le) }),
      evLabel(e),
      e.type === 'statut' && e.commentaire ? el('span', { class: 'h-com', text: e.commentaire }) : null,
      e.type === 'champ' && splitChamp(e).source ? el('span', { class: 'h-com', text: `Source : ${splitChamp(e).source}` }) : null,
      el('span', { class: 'h-by' }, e.auteur || '', e.fictif ? fiabTag('fictif') : null)));
  }

  const lu = lastUpdate();
  bind('foot-maj')[0].textContent = `Dernière mise à jour du suivi : ${fmtDateTime(lu.at)}${lu.by ? ` (${lu.by})` : ''}. Données de référence du ${fmtDate(S.data.donnees_maj)}.`;
}

// ---------- démarrage du suivi en ligne d'un ouvrage ----------
async function ensureRow() {
  if (liveRow()) return;
  const sc = S.data.scenario;
  const evs = (sc.evenements || []).filter(e => e.type === 'statut').map(e => ({ ancien: e.ancien, nouveau: e.nouveau, commentaire: e.commentaire, cree_le: e.cree_le }));
  await api.initOuvrage(REF, sc.statut, sc.maj_le, evs);
  S.live = await api.loadState(REF);
}

// ---------- dialogues ----------
function openLogin() {
  const dlg = $('#dlg-login');
  if (!api.configured()) { toast("La connexion sera disponible une fois l'espace de suivi configuré."); return; }
  $('[data-login="out"]', dlg).hidden = Boolean(S.user);
  $('[data-login="in"]', dlg).hidden = !S.user;
  if (S.user) {
    const r = S.role === 'editeur' ? 'éditeur : vous pouvez modifier le suivi' : S.role === 'lecteur' ? 'lecteur : vous pouvez ouvrir les plans' : "non autorisé : votre adresse n'est pas dans la liste des membres, l'accès reste en lecture seule";
    bind('who')[0].textContent = `Connecté avec ${S.user.email}. Rôle ${r}.`;
  }
  dlg.showModal();
}
function openField(key, label, current, type = 'text') {
  S.fieldTarget = key;
  const dlg = $('#dlg-field');
  bind('field-label')[0].textContent = label;
  const inp = $('input[name="valeur"]', dlg);
  inp.type = type; inp.value = current || '';
  $('input[name="source"]', dlg).value = '';
  dlg.showModal();
}
function openDocUpload(cat, titre) {
  const dlg = $('#dlg-doc');
  const sel = $('select[name="categorie"]', dlg); sel.textContent = '';
  const cats = [...new Set(S.data.documents.map(d => d.categorie))];
  for (const c of cats) sel.append(el('option', { value: c, text: c, selected: c === cat }));
  $('input[name="titre"]', dlg).value = titre || '';
  dlg.showModal();
}
function openStatus() {
  const dlg = $('#dlg-status');
  const fs = bind('status-choices')[0];
  $$('label', fs).forEach(n => n.remove());
  const cur = currentStatusKey();
  for (const s of statuses()) {
    fs.append(el('label', { class: 'choice', dataset: { status: s.cle, phase: s.phase } },
      el('input', { type: 'radio', name: 'statut', value: s.cle, checked: s.cle === cur }), el('span', { text: s.label })));
  }
  dlg.showModal();
}

function wireDialogs() {
  $$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach(d => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  $('#dlg-pdf').addEventListener('close', () => { bind('pdf-frame')[0].src = 'about:blank'; });

  $('[data-form="login"]').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'send') return;
    e.preventDefault();
    const email = e.target.email.value.trim();
    try { await api.signIn(email); e.target.closest('dialog').close(); toast(`Lien envoyé à ${email}. Ouvrez-le sur cet appareil.`); }
    catch (err) { toast(errMsg(err), 'err'); }
  });
  $('[data-action="logout"]').addEventListener('click', async () => { await api.signOut(); $('#dlg-login').close(); toast('Vous êtes déconnecté.'); });

  $('[data-form="status"]').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const f = e.target; const st = f.statut.value; const com = f.commentaire.value.trim();
    if (st === currentStatusKey()) { f.closest('dialog').close(); return; }
    try {
      await ensureRow();
      await api.changeStatus(REF, st, com);
      // la date réelle du jalon lié au nouveau statut est renseignée si elle manque
      for (const j of jalons().filter(x => x.statut === st && !x.reelle)) {
        await api.setField(REF, `jalon.${j.cle}.reelle`, isoToday(), `Changement de statut du ${fmtDate(isoToday())}`);
      }
      f.reset(); f.closest('dialog').close();
      toast(`Statut enregistré : ${statusDef(st).label}.`);
      await refresh();
    } catch (err) { toast(errMsg(err), 'err'); }
  });

  $('[data-form="note"]').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const f = e.target;
    try { await ensureRow(); await api.addNote(REF, f.type.value, f.texte.value.trim()); f.reset(); f.closest('dialog').close(); toast('Note ajoutée.'); await refresh(); }
    catch (err) { toast(errMsg(err), 'err'); }
  });

  $('[data-form="field"]').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const f = e.target;
    try { await ensureRow(); await api.setField(REF, S.fieldTarget, f.valeur.value.trim(), f.source.value.trim()); f.closest('dialog').close(); toast('Information mise à jour.'); await refresh(); }
    catch (err) { toast(errMsg(err), 'err'); }
  });

  $('[data-form="doc"]').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const f = e.target; const file = f.fichier.files[0];
    if (!file) return;
    try {
      toast('Téléversement en cours…');
      await ensureRow();
      await api.uploadDocument(REF, file, { categorie: f.categorie.value, titre: f.titre.value.trim(), ref_doc: f.ref_doc.value.trim() || null });
      f.reset(); f.closest('dialog').close(); toast('Document ajouté.'); await refresh();
    } catch (err) { toast(errMsg(err), 'err'); }
  });

  const photoInput = $('[data-action="add-photo"] input');
  let pendingPhoto = null;
  photoInput.addEventListener('change', () => {
    pendingPhoto = photoInput.files[0] || null;
    photoInput.value = '';
    if (!pendingPhoto) return;
    const img = bind('photo-preview')[0];
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(pendingPhoto);
    $('#dlg-photo').showModal();
  });
  $('[data-form="photo"]').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save' || !pendingPhoto) return;
    e.preventDefault();
    const f = e.target;
    try { toast('Envoi de la photo…'); await ensureRow(); await api.uploadPhoto(REF, pendingPhoto, f.legende.value.trim()); f.reset(); f.closest('dialog').close(); pendingPhoto = null; toast('Photo ajoutée.'); await refresh(); }
    catch (err) { toast(errMsg(err), 'err'); }
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'change-status') openStatus();
    else if (act === 'add-note') $('#dlg-note').showModal();
    else if (act === 'add-doc') openDocUpload();
    else if (act === 'qr') openQr();
    else if (act === 'focus3d') { $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'center' }); S.viewer?.focus(); }
    else if (act === 'isoler3d') { $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'center' }); S.viewer?.setMode('isoler'); }
  });

  function openQr() {
    bind('qr-url')[0].textContent = REF === 'A2-PM106' ? canonicalUrl() : (CFG.siteUrl || location.origin + '/');
    $('#dlg-qr').showModal();
  }

  $('#btn-login').addEventListener('click', openLogin);
  $('#btn-qr').addEventListener('click', openQr);

  $$('[data-filter]').forEach(b => b.addEventListener('click', () => {
    S.noteFilter = b.dataset.filter;
    $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderSuivi();
  }));
}
function canonicalUrl() {
  if (S.data?.url) return S.data.url;
  const base = CFG.siteUrl ? (CFG.siteUrl.endsWith('/') ? CFG.siteUrl : CFG.siteUrl + '/') : location.origin + '/';
  return REF === 'A2-PM106' ? base + 'A2-PM106/' : `${base}o/?r=${encodeURIComponent(REF)}`;
}
function setupQr() {
  // Deux QR codes seulement : celui d'A2 PM 106 et celui du projet (maquette 3D), utilisé pour les autres ouvrages.
  const single = REF === 'A2-PM106';
  const f = single ? 'A2-PM106' : 'Projet-Fontbelleau';
  $('#dlg-qr-t').textContent = single ? "QR code de l'ouvrage" : 'QR code du projet';
  bind('qr-img').forEach(i => { i.src = `../qr/${f}.svg`; i.alt = single ? `QR code menant au passeport ${S.data.reference}` : 'QR code menant à la maquette du projet'; });
  bind('qr-png').forEach(a => { a.href = `../qr/${f}.png`; });
  bind('qr-svg').forEach(a => { a.href = `../qr/${f}.svg`; });
  bind('qr-label').forEach(a => { a.href = `../qr/Etiquette_${f}.pdf`; });
  bind('qr-note').forEach(p => { p.hidden = single; p.textContent = single ? '' : `${S.data.reference} n'a pas de QR code individuel. Le QR du projet ouvre la maquette 3D : touchez l'ouvrage pour retrouver ce passeport.`; });
  $$('[data-action="qr"]').forEach(b => { b.hidden = !single; });
}

// ---------- navigation de rubriques ----------
function wireSecNav() {
  const links = $$('.secnav a');
  const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) {
      links.forEach(a => a.removeAttribute('aria-current'));
      const a = map.get(e.target.id); if (a) { a.setAttribute('aria-current', 'true'); a.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main .sec').forEach(s => io.observe(s));
}

// ---------- vue 3D ----------
function startViewer() {
  const host = $('#viewer');
  const go = async () => {
    try {
      const { createViewer } = await import('./viewer.js');
      S.viewer = await createViewer(host, {
        base: '../model/',
        targetId: S.data.localisation.cible,
        zone: S.data.zone,
        label: S.data.reference,
        linkFor: (slug) => passportHref(slug),
        onMode: (m) => { host.dataset.mode = m; $$('.viewer-tools [data-mode]', host).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m))); }
      });
    } catch (e) {
      console.error(e);
      const st = $('[data-v="status"]', host);
      st.hidden = false;
      st.textContent = "La vue 3D n'a pas pu se charger sur cet appareil. Le plan de repérage reste disponible dans la rubrique Localisation.";
    }
  };
  $$('.viewer-tools [data-mode]', host).forEach(b => b.addEventListener('click', () => S.viewer?.setMode(b.dataset.mode)));
  $('[data-v-action="replay"]', host).addEventListener('click', () => S.viewer?.replay());
  $('[data-v-action="fullscreen"]', host).addEventListener('click', () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (host.requestFullscreen) host.requestFullscreen().catch(() => host.classList.toggle('is-max'));
    else host.classList.toggle('is-max');
  });
  ('requestIdleCallback' in window ? requestIdleCallback : (f) => setTimeout(f, 60))(go);
}

// ---------- données dynamiques ----------
async function refresh() {
  if (!api.configured()) { S.mode = 'offline'; S.live = null; renderDynamic(); return; }
  try {
    S.live = await api.loadState(REF);
    S.mode = 'live';
  } catch (e) {
    console.warn(e);
    S.mode = 'error'; S.live = null;
  }
  renderDynamic();
}
function renderDynamic() {
  renderHero();
  renderIdentite();
  renderDocuments();
  renderAppro();
  renderPlanning();
  renderSuivi();
}
async function refreshUser(user) {
  S.user = user;
  S.role = user ? await api.role(user) : null;
  bind('login-label')[0].textContent = user ? (S.role === 'editeur' ? 'Éditeur' : S.role === 'lecteur' ? 'Lecteur' : 'Connecté') : 'Se connecter';
  $('#btn-login').dataset.state = user ? 'in' : 'out';
}

// ---------- données de référence ----------
function expand(rec, commun) {
  const d = { ...rec };
  d.fiabilites = rec.fiabilites || commun.fiabilites;
  d.statuts = rec.statuts || commun.statuts;
  d.projet = rec.projet || commun.projet;
  d.documents = (rec.documents || []).map(x => (x.titre ? x : { ...(commun.documents[x.id] || { titre: x.id, categorie: 'Autres documents', fiab: 'nd' }), ...x }));
  d.avertissements = rec.avertissements || [];
  return d;
}
function personalize() {
  const d = S.data;
  const zl = { A1: 'Tour A1', A2: 'Tour A2', LT: 'Tour A1', PARK: 'Parking', FOND: 'Fondations', EXT: 'Extérieurs' }[d.zone] || 'Zone';
  bind('v-zone').forEach(n => { n.textContent = zl; });
  const et = d.etage === 'RDC' ? 'RDC' : d.etage;
  bind('v-coupe').forEach(n => { n.textContent = ['PARK', 'FOND', 'EXT'].includes(d.zone) ? 'Coupe' : `Coupe ${et}`; });
  bind('v-label').forEach(n => { n.textContent = d.reference; });
  bind('plan-caption').forEach(n => {
    n.textContent = (['A1', 'A2', 'LT'].includes(d.zone) ? 'Coupe horizontale à 1,20 m au-dessus du plancher, générée depuis la maquette.' : 'Coupe horizontale de chaque élément à mi-hauteur, générée depuis la maquette.') + ' Nord du projet vers le haut. Touchez un ouvrage pour ouvrir son passeport.';
  });
}

// ---------- démarrage ----------
async function main() {
  if (!REF) { location.replace('../'); return; }
  const [res, rc] = await Promise.all([fetch(`../data/o/${encodeURIComponent(REF)}.json`, { cache: 'no-cache' }), fetch('../data/commun.json', { cache: 'no-cache' })]);
  if (!res.ok) {
    document.body.prepend(el('p', { class: 'fatal' }, `Aucun passeport ne porte la référence « ${REF} ». `, el('a', { href: '../', text: 'Rechercher un ouvrage' })));
    return;
  }
  S.data = expand(await res.json(), await rc.json());
  document.title = `${S.data.reference} — Passeport numérique · Domaine de Fontbelleau`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', `Passeport numérique de l'ouvrage ${S.data.reference} (${S.data.designation}, ${S.data.contexte}) : identité, localisation 3D, documents, approvisionnement, planning et suivi de chantier.`);
  personalize();
  setupQr();
  bind('back-maquette').forEach(a => { a.href = `../?o=${encodeURIComponent(REF)}`; });
  bind('foot-ids')[0].textContent = S.data.identite.find(r => r.cle === 'identifiants')?.detail || '';
  renderLegend();
  wireDialogs();
  wireSecNav();
  renderDynamic();
  await renderLocalisation();
  renderEnergieFiche(REF, bind('energie')[0]).then(() => { if (location.hash === '#energie') document.getElementById('energie')?.scrollIntoView(); });
  renderEnergieFiche(REF, bind('energie')[0]).then(() => { if (location.hash === '#energie') document.getElementById('energie')?.scrollIntoView(); });
  startViewer();

  if (api.configured()) {
    // le client Supabase est chargé en différé
    await new Promise(r => (window.supabase ? r() : window.addEventListener('load', r, { once: true })));
    await refreshUser(await api.currentUser());
    await refresh();
    api.onAuthChange(async (u) => { if ((u?.id || null) !== (S.user?.id || null)) { await refreshUser(u); renderDynamic(); } });
    let t = 0;
    api.subscribe(REF, () => { clearTimeout(t); t = setTimeout(refresh, 400); });
  }
  document.documentElement.classList.add('ready');
}
main().catch((e) => {
  console.error(e);
  document.body.prepend(el('p', { class: 'fatal', text: "Le passeport n'a pas pu se charger. Vérifiez la connexion puis rechargez la page." }));
});
