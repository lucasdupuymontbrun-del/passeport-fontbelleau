// Volet « Énergie » du passeport d'ouvrage : données thermiques de l'ouvrage (DCE, maquette) et logement desservi (jumeau).
const FIAB = {
  verifie: { label: 'Vérifié', aide: 'Confirmé par une pièce du marché (CCTP).' },
  modele: { label: 'Maquette', aide: 'Lu dans la maquette Revit, y compris la variante RE2020 de la tour A2.' },
  estime: { label: 'Estimation', aide: 'Calculé à partir d\'hypothèses indiquées.' },
  cite: { label: 'Étude citée', aide: 'Valeur de l\'étude thermique RT 2012, reprise d\'une synthèse du DCE ; la pièce originale n\'est pas dans le dossier.' },
  hypothese: { label: 'Hypothèse', aide: 'Hypothèse de démonstration, à confirmer par l\'étude énergétique.' },
  fictif: { label: 'Fictif', aide: 'Donnée de démonstration inventée pour le scénario.' },
  nd: { label: 'Non disponible', aide: 'Information introuvable dans les documents du projet.' },
};
const ROLE = { enveloppe: 'Enveloppe thermique', pont: 'Pont thermique', interne: 'Intérieur du volume chauffé', equipement: 'Équipement énergétique', carbone: 'Carbone de construction', hors_logement: 'Parties communes', sans: 'Sans rôle thermique' };

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const tag = (f) => { const d = FIAB[f] || { label: f, aide: '' }; return el('span', { class: `fiab fiab-${f}`, title: d.aide }, d.label); };
const nf = (d = 0) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export async function renderEnergieFiche(ref, host) {
  if (!host) return;
  let O, L;
  try {
    [O, L] = await Promise.all([fetch('../data/energie/ouvrages.json').then(r => r.json()), fetch('../data/energie/logements.json').then(r => r.json())]);
  } catch (e) { host.textContent = 'Les données énergétiques n\'ont pas pu se charger.'; return; }
  host.textContent = '';
  const rec = O.ouvrages[ref];
  const prof = rec && O.profils[rec.p];
  if (!prof) { host.append(el('p', { class: 'muted', text: 'Aucune donnée énergétique pour cet ouvrage.' })); return; }
  const dl = el('dl', { class: 'sheet' });
  dl.append(el('div', { class: 'row' }, el('dt', { text: 'Rôle thermique' }), el('dd', {}, el('span', { class: 'val', text: `${ROLE[prof.role] || prof.role} — ${prof.titre}` }))));
  for (const r of prof.lignes) {
    const dd = el('dd', {}, el('span', { class: 'val' + (r.valeur ? '' : ' is-nd'), text: r.valeur || 'Information non disponible' }));
    if (r.detail) dd.append(el('span', { class: 'detail', text: r.detail }));
    const src = el('span', { class: 'src' }, tag(r.fiab));
    for (const s of r.src || []) src.append(el('span', { class: 'src-item', text: O.sources[s] || s }));
    dd.append(src);
    dl.append(el('div', { class: `row fiab-row-${r.fiab}` }, el('dt', { text: r.label }), dd));
  }
  host.append(dl);
  // logement(s) desservi(s)
  const ids = rec.l || [];
  if (ids.length) {
    const byId = new Map(L.logements.map(l => [l.id, l]));
    const box = el('div', { class: 'en-logts' });
    box.append(el('h3', { class: 'sub', text: ids.length > 1 ? 'Logements de part et d\'autre' : 'Logement desservi' }));
    for (const id of ids) {
      const l = byId.get(id); if (!l) continue;
      const ch = l.an.chauffage / l.shab, ref = l.an.ref_chauffage / l.shab;
      const ec = ref > 0 ? (l.an.chauffage / l.an.ref_chauffage - 1) * 100 : 0;
      box.append(el('a', { class: 'en-logt', href: `https://lucasdupuymontbrun-del.github.io/jumeau-fontbelleau/?l=${encodeURIComponent(id)}` },
        el('span', { class: 'en-id', text: id }),
        el('span', { class: 'en-meta', text: `${l.typo} · ${nf(2).format(l.shab)} m² · R+${l.etage} · façade ${l.orient}` }),
        el('span', { class: 'en-val' }, `Chauffage ${nf(1).format(ch)} kWh/m².an `, el('b', { text: `(${ec > 0 ? '+' : ''}${nf(0).format(ec)} % vs comparables)` })),
        el('span', { class: 'fiab fiab-fictif', text: 'Fictif' }),
        el('span', { class: 'en-go', text: 'Voir dans le jumeau énergétique →' })));
    }
    host.append(box);
  } else {
    host.append(el('p', { class: 'en-note', text: 'Cet ouvrage ne borde aucun logement en particulier (noyau, parties communes ou hors volume chauffé).' }));
  }
  host.append(el('p', { class: 'en-note' }, 'Ces propriétés alimentent les Pset IFC de l\'ouvrage (ISO 16739) et le ', el('a', { href: 'https://lucasdupuymontbrun-del.github.io/jumeau-fontbelleau/', text: 'jumeau énergétique' }), ' du projet.'));
}
