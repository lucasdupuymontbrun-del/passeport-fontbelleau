// Plan de ferraillage d'EXEMPLE (fictif), dessiné à partir du bloc « ferraillage » d'une fiche (tools/build_ferraillage_4d.py).
// Ce n'est pas un plan d'exécution : le dessin le dit en filigrane, dans le titre et dans le cartouche.
const COL = { 1: '#c2410c', 2: '#1d4ed8', 3: '#047857', 4: '#7c3aed', 5: '#be185d' };
const W = 1000, H = 707;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (v, n = 2) => Number(v).toFixed(n).replace('.', ',');
const TYPE_LABEL = { premur: 'Prémur', premur_mince: 'Prémur mince', voile: 'Voile', poteau: 'Poteau', poteau_rond: 'Poteau circulaire',
  poutre: 'Poutre', pieu: 'Pieu', dalle: 'Dalle', massif: 'Massif sur pieux' };

function fit(w, h, box) {
  const k = Math.min(box.w / w, box.h / h);
  const ox = box.x + (box.w - w * k) / 2, oy = box.y + (box.h - h * k) / 2;
  return { k, X: (x) => ox + x * k, Y: (y) => oy + (h - y) * k, w: w * k, h: h * k, ox, oy };
}
function every(n, maxDraw) { return Math.max(1, Math.ceil(n / maxDraw)); }
function dimH(x1, x2, y, txt) {
  return `<g class="fd"><path d="M${x1},${y}H${x2}M${x1},${y - 5}V${y + 5}M${x2},${y - 5}V${y + 5}"/><text x="${(x1 + x2) / 2}" y="${y - 6}" text-anchor="middle">${esc(txt)}</text></g>`;
}
function dimV(x, y1, y2, txt) {
  const m = (y1 + y2) / 2;
  return `<g class="fd"><path d="M${x},${y1}V${y2}M${x - 5},${y1}H${x + 5}M${x - 5},${y2}H${x + 5}"/><text x="${x - 8}" y="${m}" text-anchor="middle" transform="rotate(-90 ${x - 8} ${m})">${esc(txt)}</text></g>`;
}
function tag(rep, x, y) {
  return `<g class="ftag"><circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="${COL[rep] || '#333'}" stroke-width="1.6"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" fill="${COL[rep] || '#333'}">${esc(rep)}</text></g>`;
}
const line = (x1, y1, x2, y2, rep, extra = '') => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${COL[rep]}" ${extra}/>`;

// ---------- vues principales
function elevationWall(f, box) {
  const t = fit(f.L, f.H, box);
  let s = `<rect class="fc" x="${t.X(0)}" y="${t.Y(f.H)}" width="${t.w}" height="${t.h}"/>`;
  const c = 0.03;
  for (const b of f.bars.filter(b => b.vue === 'elevation' || (f.type !== 'premur' && b.dir))) {
    if (b.dir === 'v') {
      const ends = b.rep === '3' && f.type !== 'premur' ? [c, f.L - c] : null;
      const n = ends ? 2 : Math.max(2, Math.round(f.L / (b.esp || 0.2)) + 1);
      const step = every(n, 70);
      const top = b.forme === 'attente' ? f.H + 0.35 : f.H - c;
      for (let i = 0; i < n; i += step) {
        const x = ends ? ends[i] : c + (f.L - 2 * c) * (i / (n - 1));
        s += line(t.X(x), t.Y(c), t.X(x), t.Y(Math.min(top, f.H - c)), b.rep, b.forme === 'raidisseur' ? 'stroke-width="2.2" stroke-dasharray="6 3"' : '');
        if (top > f.H) s += line(t.X(x), t.Y(f.H - c), t.X(x), t.Y(top), b.rep, 'stroke-dasharray="4 3"');
      }
      s += tag(b.rep, t.X(ends ? c : f.L * (0.2 + 0.12 * Number(b.rep))), t.Y(f.H) - 16);
    } else if (b.dir === 'h') {
      const rows = b.rep === '4' && f.type !== 'premur' ? [f.H - c] : null;
      const n = rows ? 1 : Math.max(2, Math.round(f.H / (b.esp || 0.2)) + 1);
      const step = every(n, 50);
      for (let i = 0; i < n; i += step) {
        const y = rows ? rows[0] : c + (f.H - 2 * c) * (i / (n - 1));
        s += line(t.X(c), t.Y(y), t.X(f.L - c), t.Y(y), b.rep, rows ? 'stroke-width="2.4"' : '');
      }
      s += tag(b.rep, t.X(f.L) + 16, t.Y(rows ? f.H - c : f.H * 0.35));
    }
  }
  s += dimH(t.X(0), t.X(f.L), t.Y(0) + 22, `${f2(f.L)} m`) + dimV(t.X(0) - 22, t.Y(f.H), t.Y(0), `${f2(f.H)} m`);
  return { svg: s, title: 'Élévation' };
}
function elevationColumn(f, box, round) {
  const b = round ? f.D : f.b;
  const t = fit(Math.max(b, f.H * 0.18), f.H, box);
  const x0 = (Math.max(b, f.H * 0.18) - b) / 2, c = 0.03;
  let s = `<rect class="fc" x="${t.X(x0)}" y="${t.Y(f.H)}" width="${b * t.k}" height="${t.h}"/>`;
  const L = f.bars[0];
  for (const x of [x0 + c + 0.01, x0 + b - c - 0.01]) {
    s += line(t.X(x), t.Y(0), t.X(x), t.Y(f.H), '1', 'stroke-width="2.2"');
    s += line(t.X(x), t.Y(f.H), t.X(x), t.Y(f.H + 0.5), '1', 'stroke-width="2.2" stroke-dasharray="4 3"');
  }
  const n = Math.round(f.H / 0.15);
  for (let i = 1; i < n; i += every(n, 60)) s += line(t.X(x0 + c), t.Y(i * 0.15), t.X(x0 + b - c), t.Y(i * 0.15), '2');
  s += tag('1', t.X(x0 + b) + 18, t.Y(f.H * 0.7)) + tag('2', t.X(x0 + b) + 18, t.Y(f.H * 0.4));
  s += dimV(t.X(x0) - 22, t.Y(f.H), t.Y(0), `${f2(f.H)} m`);
  return { svg: s, title: 'Élévation' + (L ? '' : '') };
}
function elevationBeam(f, box) {
  const t = fit(f.L, Math.max(f.h, f.L * 0.12), box);
  const y0 = (Math.max(f.h, f.L * 0.12) - f.h) / 2, c = 0.03;
  let s = `<rect class="fc" x="${t.X(0)}" y="${t.Y(y0 + f.h)}" width="${t.w}" height="${f.h * t.k}"/>`;
  s += line(t.X(-0.2), t.Y(y0 + c + 0.01), t.X(f.L + 0.2), t.Y(y0 + c + 0.01), '1', 'stroke-width="2.6"');
  s += line(t.X(-0.2), t.Y(y0 + f.h - c - 0.01), t.X(f.L + 0.2), t.Y(y0 + f.h - c - 0.01), '2', 'stroke-width="2"');
  const n = Math.round(f.L / 0.2);
  for (let i = 1; i < n; i += every(n, 70)) s += line(t.X(i * 0.2), t.Y(y0 + c), t.X(i * 0.2), t.Y(y0 + f.h - c), '3');
  if (f.bars.find(b => b.rep === '4')) s += line(t.X(c), t.Y(y0 + f.h / 2), t.X(f.L - c), t.Y(y0 + f.h / 2), '4', 'stroke-dasharray="8 4"');
  s += tag('1', t.X(f.L * 0.25), t.Y(y0) + 16) + tag('2', t.X(f.L * 0.25), t.Y(y0 + f.h) - 16) + tag('3', t.X(f.L * 0.6), t.Y(y0 + f.h) - 16);
  s += dimH(t.X(0), t.X(f.L), t.Y(y0) + 40, `${f2(f.L)} m`);
  return { svg: s, title: 'Élévation' };
}
function elevationPile(f, box) {
  const ww = Math.max(f.D, f.H * 0.16);
  const t = fit(ww, f.H, box);
  const x0 = (ww - f.D) / 2, c = 0.07;
  let s = `<rect class="fc" x="${t.X(x0)}" y="${t.Y(f.H)}" width="${f.D * t.k}" height="${t.h}"/>`;
  for (const x of [x0 + c, x0 + f.D - c]) {
    s += line(t.X(x), t.Y(0.1), t.X(x), t.Y(f.H), '1', 'stroke-width="2.2"');
    s += line(t.X(x), t.Y(f.H), t.X(x), t.Y(f.H + 0.8), '1', 'stroke-width="2.2" stroke-dasharray="4 3"');
  }
  let d = `M${t.X(x0 + c)},${t.Y(0.1)}`;
  for (let y = 0.1, k = 0; y < f.H; y += 0.1, k++) d += `L${t.X(k % 2 ? x0 + c : x0 + f.D - c)},${t.Y(y + 0.1)}`;
  s += `<path d="${d}" fill="none" stroke="${COL[2]}" stroke-width="1"/>`;
  s += tag('1', t.X(x0 + f.D) + 18, t.Y(f.H * 0.75)) + tag('2', t.X(x0 + f.D) + 18, t.Y(f.H * 0.4));
  s += dimV(t.X(x0) - 22, t.Y(f.H), t.Y(0), `${f2(f.H)} m`);
  return { svg: s, title: 'Élévation' };
}
function planSlab(f, box) {
  const t = fit(f.A, f.B, box), c = 0.03;
  let s = `<rect class="fc" x="${t.X(0)}" y="${t.Y(f.B)}" width="${t.w}" height="${t.h}"/>`;
  for (const b of f.bars.filter(b => b.vue === 'plan')) {
    const along = b.dir === 'x';
    const span = along ? f.B : f.A;
    const n = Math.max(2, Math.round(span / b.esp) + 1);
    const step = every(n, 26);
    const dash = Number(b.rep) >= 3 ? 'stroke-dasharray="7 4"' : '';
    for (let i = 0; i < n; i += step) {
      const v = c + (span - 2 * c) * (i / (n - 1));
      s += along ? line(t.X(c), t.Y(v), t.X(f.A - c), t.Y(v), b.rep, dash) : line(t.X(v), t.Y(c), t.X(v), t.Y(f.B - c), b.rep, dash);
    }
  }
  s += tag('1', t.X(f.A) + 16, t.Y(f.B * 0.3)) + tag('2', t.X(f.A * 0.3), t.Y(0) + 16) + tag('3', t.X(f.A) + 16, t.Y(f.B * 0.7)) + tag('4', t.X(f.A * 0.7), t.Y(0) + 16);
  s += dimH(t.X(0), t.X(f.A), t.Y(0) + 38, `${f2(f.A)} m`) + dimV(t.X(0) - 22, t.Y(f.B), t.Y(0), `${f2(f.B)} m`);
  return { svg: s, title: f.type === 'dalle' ? 'Plan (emprise simplifiée)' : 'Plan' };
}

// ---------- coupes
function sectionRect(b, h, box, bars, opts = {}) {
  const t = fit(b, h, box), c = opts.c || 0.03;
  let s = `<rect class="fc" x="${t.X(0)}" y="${t.Y(h)}" width="${t.w}" height="${t.h}"/>`;
  if (opts.skins) {
    s += `<rect class="fskin" x="${t.X(0)}" y="${t.Y(h)}" width="${opts.skins * t.k}" height="${t.h}"/><rect class="fskin" x="${t.X(b - opts.skins)}" y="${t.Y(h)}" width="${opts.skins * t.k}" height="${t.h}"/>`;
  }
  if (opts.frame) s += `<rect x="${t.X(c)}" y="${t.Y(h - c)}" width="${(b - 2 * c) * t.k}" height="${(h - 2 * c) * t.k}" fill="none" stroke="${COL[opts.frame]}" stroke-width="1.6" rx="3"/>`;
  for (const [x, y, rep, r] of bars) s += `<circle cx="${t.X(x)}" cy="${t.Y(y)}" r="${r || 4}" fill="${COL[rep]}"/>`;
  s += dimH(t.X(0), t.X(b), t.Y(0) + 20, `${f2(b * 100, 0)} cm`) + dimV(t.X(0) - 18, t.Y(h), t.Y(0), `${f2(h * 100, 0)} cm`);
  return s;
}
function sectionView(f, box) {
  const c = 0.03;
  if (f.type === 'voile' || f.type === 'premur_mince' || f.type === 'premur') {
    const len = Math.min(1.2, f.L), ep = f.ep, pts = [];
    if (f.type === 'premur') {
      for (let x = 0.075; x < len; x += 0.15) { pts.push([x, 0.03, '1', 3], [x, ep - 0.03, '1', 3]); }
      for (let x = 0.1; x < len; x += 0.2) pts.push([x, ep / 2, '4', 4]);
      let s = sectionRect(len, ep, box, pts, { skins: f.peau });
      return { svg: s, title: 'Coupe horizontale (1 m de long)', note: 'Peaux préfabriquées hachurées ; remplissage au centre.' };
    }
    const two = ep >= 0.16;
    for (let x = 0.1; x < len; x += 0.2) { if (two) { pts.push([x, c + 0.01, '1'], [x, ep - c - 0.01, '1']); } else pts.push([x, ep / 2, '1']); }
    return { svg: sectionRect(len, ep, box, pts), title: 'Coupe horizontale (1 m de long)' };
  }
  if (f.type === 'poteau' || f.type === 'poutre') {
    const b = f.b, h = f.h;
    const n = f.bars[0].nb, pts = [];
    if (f.type === 'poutre') {
      const ninf = f.bars[0].nb, nsup = f.bars[1].nb;
      for (let i = 0; i < ninf; i++) pts.push([c + 0.02 + (b - 2 * c - 0.04) * (ninf === 1 ? 0.5 : i / (ninf - 1)), c + 0.02, '1', 5]);
      for (let i = 0; i < nsup; i++) pts.push([c + 0.02 + (b - 2 * c - 0.04) * (nsup === 1 ? 0.5 : i / (nsup - 1)), h - c - 0.02, '2', 4]);
      if (f.bars.find(x => x.rep === '4')) { const k = f.bars.find(x => x.rep === '4').nb / 2; for (let i = 1; i <= k; i++) { const y = h * i / (k + 1); pts.push([c + 0.02, y, '4', 3], [b - c - 0.02, y, '4', 3]); } }
      return { svg: sectionRect(b, h, box, pts, { frame: '3' }), title: 'Coupe transversale' };
    }
    const per = Math.max(1, Math.round((n - 4) / 4));
    const side = (a, z) => { const o = []; for (let i = 0; i <= per; i++) o.push(a + (z - a) * (i / per)); return o; };
    const xs = side(c + 0.02, b - c - 0.02), ys = side(c + 0.02, h - c - 0.02);
    const set = new Set();
    for (const x of xs) for (const y of [ys[0], ys[ys.length - 1]]) set.add(`${x},${y}`);
    for (const y of ys) for (const x of [xs[0], xs[xs.length - 1]]) set.add(`${x},${y}`);
    for (const k of set) { const [x, y] = k.split(',').map(Number); pts.push([x, y, '1', 5]); }
    return { svg: sectionRect(b, h, box, pts, { frame: '2' }), title: 'Coupe transversale' };
  }
  if (f.type === 'poteau_rond' || f.type === 'pieu') {
    const D = f.D, cc = f.type === 'pieu' ? 0.07 : 0.03, t = fit(D, D, box), n = f.bars[0].nb, r0 = D / 2;
    let s = `<circle class="fc" cx="${t.X(r0)}" cy="${t.Y(r0)}" r="${r0 * t.k}"/><circle cx="${t.X(r0)}" cy="${t.Y(r0)}" r="${(r0 - cc) * t.k}" fill="none" stroke="${COL[2]}" stroke-width="1.6"/>`;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; s += `<circle cx="${t.X(r0 + Math.cos(a) * (r0 - cc - 0.015))}" cy="${t.Y(r0 + Math.sin(a) * (r0 - cc - 0.015))}" r="5" fill="${COL[1]}"/>`; }
    s += dimH(t.X(0), t.X(D), t.Y(0) + 20, `Ø ${f2(D * 100, 0)} cm`);
    return { svg: s, title: 'Coupe transversale' };
  }
  if (f.type === 'dalle' || f.type === 'massif') {
    const len = Math.min(1.2, f.A), ep = f.ep, pts = [];
    const [b1, , b3] = [f.bars[0], f.bars[1], f.bars[2]];
    for (let x = b1.esp / 2; x < len; x += b1.esp) pts.push([x, c + 0.012, '1', 4]);
    for (let x = b3.esp / 2; x < len; x += b3.esp) pts.push([x, ep - c - 0.012, '3', 3.5]);
    let s = sectionRect(len, ep, box, pts);
    const t = fit(len, ep, box);
    s += line(t.X(c), t.Y(c + 0.028), t.X(len - c), t.Y(c + 0.028), '2') + line(t.X(c), t.Y(ep - c - 0.028), t.X(len - c), t.Y(ep - c - 0.028), '4', 'stroke-dasharray="7 4"');
    return { svg: s, title: 'Coupe (1 m de large)' };
  }
  return { svg: '', title: '' };
}

export function rebarSvg(f, meta = {}) {
  const main = { x: 70, y: 86, w: 520, h: 470 };
  const sec = { x: 690, y: 96, w: 250, h: 170 };
  let mv;
  if (['voile', 'premur', 'premur_mince'].includes(f.type)) mv = elevationWall(f, main);
  else if (f.type === 'poteau') mv = elevationColumn(f, main, false);
  else if (f.type === 'poteau_rond') mv = elevationColumn(f, main, true);
  else if (f.type === 'poutre') mv = elevationBeam(f, main);
  else if (f.type === 'pieu') mv = elevationPile(f, main);
  else mv = planSlab(f, main);
  const sv = sectionView(f, sec);
  // nomenclature
  let ty = 340;
  let tab = `<text class="fh" x="660" y="${ty - 18}">Nomenclature des aciers (B500B)</text>`;
  tab += `<g class="ftab"><text x="660" y="${ty}">Rep.</text><text x="690" y="${ty}">Nb</text><text x="724" y="${ty}">Ø</text><text x="818" y="${ty}" text-anchor="end">L. unit.</text><text x="888" y="${ty}" text-anchor="end">L. totale</text><text x="960" y="${ty}" text-anchor="end">Poids</text></g>`;
  tab += `<path d="M660,${ty + 6}H962" class="frule"/>`;
  for (const b of f.bars) {
    ty += 20;
    tab += `<g class="ftab">${tag(b.rep, 668, ty - 4)}<text x="690" y="${ty}">${b.nb}</text><text x="724" y="${ty}">HA${b.d}</text><text x="818" y="${ty}" text-anchor="end">${f2(b.l)} m</text><text x="888" y="${ty}" text-anchor="end">${f2(b.nb * b.l, 1)} m</text><text x="960" y="${ty}" text-anchor="end">${f2(b.kg, 1)} kg</text></g>`;
  }
  ty += 10;
  tab += `<path d="M660,${ty}H962" class="frule"/>`;
  ty += 20;
  tab += `<g class="ftab ftot"><text x="660" y="${ty}">Total</text><text x="960" y="${ty}" text-anchor="end">${f2(f.poids_kg, 1)} kg</text></g>`;
  ty += 18;
  tab += `<g class="ftab"><text x="660" y="${ty}">Ratio</text><text x="960" y="${ty}" text-anchor="end">${f.ratio_kg_m3 ?? '—'} kg/m³ (béton ${f2(f.volume_m3, 2)} m³)</text></g>`;
  let ly = ty + 26;
  let legend = '';
  for (const b of f.bars) {
    if (ly > 600) break;
    const txt = `${b.role}${b.esp && b.forme !== 'spire' ? `, e = ${f2(b.esp * 100, 0)} cm` : ''}`;
    const cut = txt.length > 50 ? txt.lastIndexOf(' ', 50) : -1;
    const l1 = cut > 0 ? txt.slice(0, cut) : txt, l2 = cut > 0 ? txt.slice(cut + 1) : '';
    legend += `<g class="fleg">${tag(b.rep, 668, ly - 4)}<text x="684" y="${ly}">${esc(l1)}</text>${l2 ? `<text x="684" y="${ly + 13}">${esc(l2)}</text>` : ''}</g>`;
    ly += l2 ? 30 : 17;
  }
  const date = new Date().toLocaleDateString('fr-FR');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="rebar" role="img" aria-label="Plan de ferraillage d'exemple fictif de ${esc(meta.reference)}">
<style>
.rebar text{font-family:Archivo,'Segoe UI',Arial,sans-serif;font-size:12px;fill:#1f262b}
.rebar .fc{fill:#eef0ee;stroke:#1f262b;stroke-width:1.4}
.rebar .fskin{fill:url(#hatch);stroke:none}
.rebar .fd path{stroke:#55616a;stroke-width:1;fill:none}.rebar .fd text{font-size:11px;fill:#55616a}
.rebar line{stroke-width:1.2;stroke-linecap:round}
.rebar .ftag text{font-size:10.5px;font-weight:700}
.rebar .fh{font-size:13px;font-weight:700}.rebar .ftot text{font-weight:700}
.rebar .frule{stroke:#9aa3a8;stroke-width:1}
.rebar .fleg text{font-size:11px}
.rebar .fwm{font-size:84px;font-weight:800;fill:#d1126f;opacity:.10;letter-spacing:4px}
.rebar .fcart text{font-size:11px}.rebar .fcart .ft{font-size:15px;font-weight:800}.rebar .fcart .fr{fill:#d1126f;font-weight:800}
</style>
<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#dfe3e0"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9aa3a8" stroke-width="1.4"/></pattern></defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="#fff" stroke="#1f262b"/>
<text class="fh" x="${main.x}" y="64">${esc(mv.title)}</text>
${mv.svg}
<text class="fh" x="${sec.x - 30}" y="64">${esc(sv.title)}</text>
${sv.svg}
${sv.note ? `<text x="${sec.x - 30}" y="${sec.y + sec.h + 34}" font-size="11">${esc(sv.note)}</text>` : ''}
${tab}
${legend}
<text class="fwm" x="${W / 2}" y="${H / 2 + 20}" text-anchor="middle" transform="rotate(-22 ${W / 2} ${H / 2})">EXEMPLE FICTIF</text>
<g class="fcart"><path d="M0,622H${W}M640,622V${H}M820,622V${H}" stroke="#1f262b"/>
<text class="ft" x="14" y="646">PLAN DE FERRAILLAGE — ${esc(meta.reference || '')}</text>
<text x="14" y="666">${esc(TYPE_LABEL[f.type] || '')} · ${esc(meta.designation || '')}</text>
<text x="14" y="684">${esc(meta.contexte || '')} · Dimensions issues de la maquette Revit MQT-FONTBELLEAU-G4 · enrobage ${f.enrobage_cm} cm</text>
<text class="fr" x="14" y="700">EXEMPLE FICTIF — NE PAS UTILISER POUR L'EXÉCUTION (aucun calcul de structure)</text>
<text x="652" y="646">Veck Construction</text><text x="652" y="664">Démonstrateur ESCT</text><text x="652" y="682">Échelle indicative</text>
<text x="832" y="646">Indice : EX</text><text x="832" y="664">Édité le ${esc(date)}</text><text x="832" y="682">Domaine de Fontbelleau</text></g>
</svg>`;
}
