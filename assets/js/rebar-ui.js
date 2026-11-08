// Affichage du plan de ferraillage d'exemple : vignette, fenêtre d'agrandissement, téléchargement SVG et impression (PDF).
import { rebarSvg } from './ferraillage.js';

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const ico = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ico'); s.innerHTML = `<use href="#${id}"/>`; return s; };
const fileName = (d) => `Ferraillage_EXEMPLE_FICTIF_${d.ref}.svg`;

export function downloadRebar(d) {
  const blob = new Blob([rebarSvg(d.ferraillage, d)], { type: 'image/svg+xml' });
  const a = h('a', { href: URL.createObjectURL(blob), download: fileName(d) });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function printRebar(d) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ferraillage ${d.reference} — exemple fictif</title>
<style>@page{size:A4 landscape;margin:8mm}html,body{margin:0;background:#fff}svg{width:100%;height:auto;display:block}</style></head>
<body>${rebarSvg(d.ferraillage, d)}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
  w.document.close();
  return true;
}
function dialog() {
  let dlg = document.getElementById('dlg-rebar');
  if (dlg) return dlg;
  dlg = h('dialog', { class: 'dlg dlg-wide', id: 'dlg-rebar', 'aria-labelledby': 'dlg-rebar-t' },
    h('div', { class: 'dlg-body rebar-body' },
      h('header', {},
        h('h2', { id: 'dlg-rebar-t', text: 'Plan de ferraillage — exemple fictif' }),
        h('div', { class: 'pdf-actions' },
          h('button', { class: 'btn btn-line', type: 'button', 'data-rb': 'svg' }, ico('i-download'), 'SVG'),
          h('button', { class: 'btn btn-line', type: 'button', 'data-rb': 'print' }, ico('i-download'), 'Imprimer ou PDF'),
          h('button', { class: 'x', type: 'button', 'aria-label': 'Fermer', onclick: () => dlg.close() }, ico('i-close')))),
      h('p', { class: 'rebar-warn', 'data-rb': 'warn' }),
      h('div', { class: 'rebar-frame', 'data-rb': 'frame' })));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  return dlg;
}
export function openRebar(d, { modal = true } = {}) {
  const dlg = dialog();
  dlg.querySelector('#dlg-rebar-t').textContent = `Plan de ferraillage ${d.reference} — exemple fictif`;
  dlg.querySelector('[data-rb="warn"]').textContent = d.ferraillage.avertissement;
  dlg.querySelector('[data-rb="frame"]').innerHTML = rebarSvg(d.ferraillage, d);
  dlg.querySelector('[data-rb="svg"]').onclick = () => downloadRebar(d);
  dlg.querySelector('[data-rb="print"]').onclick = () => { if (!printRebar(d)) downloadRebar(d); };
  if (!dlg.open) { if (modal) dlg.showModal(); else dlg.show(); }
  return dlg;
}
export function closeRebar() { const d = document.getElementById('dlg-rebar'); if (d?.open) d.close(); }

// Encart pour la fiche : vignette + chiffres clés + boutons
export function rebarCard(d, fiabTag) {
  const f = d.ferraillage;
  const nf = (v, n = 0) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: n, minimumFractionDigits: n });
  const thumb = h('button', { class: 'rebar-thumb', type: 'button', 'aria-label': 'Agrandir le plan de ferraillage', onclick: () => openRebar(d) });
  thumb.innerHTML = rebarSvg(f, d);
  return h('div', { class: 'rebar-card' },
    thumb,
    h('div', { class: 'rebar-info' },
      h('h3', { class: 'sub' }, 'Plan de ferraillage ', fiabTag ? fiabTag('fictif') : null),
      h('p', { text: `Exemple dessiné à partir des dimensions de la maquette : ${f.bars.length} repères d'armatures, ${nf(f.poids_kg)} kg d'acier, soit ${f.ratio_kg_m3} kg par m³ de béton.` }),
      h('p', { class: 'rebar-warn', text: f.avertissement }),
      h('div', { class: 'rebar-act' },
        h('button', { class: 'btn btn-ink', type: 'button', onclick: () => openRebar(d) }, ico('i-open'), 'Voir le plan'),
        h('button', { class: 'btn btn-line', type: 'button', onclick: () => downloadRebar(d) }, ico('i-download'), 'SVG'),
        h('button', { class: 'btn btn-line', type: 'button', onclick: () => { if (!printRebar(d)) downloadRebar(d); } }, ico('i-download'), 'PDF'))));
}
