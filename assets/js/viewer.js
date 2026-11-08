// Visionneuse 3D du passeport : géométrie de toute la maquette Revit (model/site.json + site.bin),
// l'ouvrage ciblé est retrouvé par son identifiant d'élément Revit.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

const KIND = {
  floors: { color: 0xa7b2b9, opacity: 1 }, walls: { color: 0x91a3af, opacity: 1 }, frame: { color: 0x7d8e9a, opacity: 1 },
  stairs: { color: 0x8b959c, opacity: 1 }, rail: { color: 0x6d7880, opacity: 1 }, openings: { color: 0xa6c3d5, opacity: 0.55 },
  generic: { color: 0xb8b0a3, opacity: 1 }, vmc: { color: 0x9aa6ae, opacity: 1 }
};
const FIXED = {
  topo: { color: 0xd3d8cc, opacity: 1 }, found: { color: 0xb5babb, opacity: 0.95 }, parking: { color: 0xc5c9c8, opacity: 1 },
  ext: { color: 0xc8c2b4, opacity: 1 }, lt: { color: 0xd9cdb8, opacity: 1 }
};
const NOISY_KINDS = ['openings', 'generic', 'rail'];
const LABELS = { floors: 'Dalle', walls: 'Mur', frame: 'Poutre ou poteau', stairs: 'Escalier', rail: 'Garde-corps', openings: 'Menuiserie',
  generic: 'Équipement de façade', vmc: 'Colonne de ventilation', topo: 'Terrain', found: 'Fondation', parking: 'Parking', ext: 'Aménagement extérieur', lt: 'Logement témoin' };
const PINK = new THREE.Color(0xd1126f);

function styleOf(name) {
  if (FIXED[name]) return { ...FIXED[name], kind: name };
  const k = name.split('_')[1];
  return { ...(KIND[k] || { color: 0xaaaaaa, opacity: 1 }), kind: k };
}
function zoneGroups(zone, names) {
  if (zone === 'A1') return names.filter(n => n.startsWith('a1_'));
  if (zone === 'A2') return names.filter(n => n.startsWith('a2_'));
  if (zone === 'LT') return names.filter(n => n.startsWith('a1_') || n === 'lt');
  if (zone === 'PARK') return ['parking'];
  if (zone === 'FOND') return ['found'];
  if (zone === 'EXT') return ['ext'];
  if (zone === 'ALL') return names.filter(n => n !== 'topo');
  return [];
}
function reduceMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function fetchGeometry(base) {
  const man = await (await fetch(base + 'site.json')).json();
  let buf = null;
  try {
    const r = await fetch(base + 'site.bin.gz');
    if (r.ok) {
      const raw = await r.arrayBuffer();
      const head = new Uint8Array(raw, 0, 2);
      if (head[0] === 0x1f && head[1] === 0x8b) {
        if ('DecompressionStream' in window) {
          const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
          buf = await new Response(ds).arrayBuffer();
        }
      } else {
        buf = raw; // déjà décompressé par le serveur
      }
    }
  } catch (e) { buf = null; }
  if (!buf) buf = await (await fetch(base + 'site.bin')).arrayBuffer();
  return { man, buf };
}

// Convertit une plage de triangles Int16 (cm, repère Revit) en Float32 (m, repère three : y vers le haut).
function toFloat(i16, out, o) {
  for (let k = 0; k < i16.length; k += 3) {
    out[o + k] = i16[k] / 100;
    out[o + k + 1] = i16[k + 2] / 100;
    out[o + k + 2] = -i16[k + 1] / 100;
  }
}
function makeGeo(pos) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}
function elementBoxes(geo, elements) {
  const p = geo.attributes.position.array;
  for (const e of elements) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = e.s * 9, b = (e.s + e.n) * 9; k < b; k += 3) {
      for (let j = 0; j < 3; j++) {
        const v = p[k + j];
        if (v < min[j]) min[j] = v;
        if (v > max[j]) max[j] = v;
      }
    }
    e.box = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
  }
}
function subsetGeometry(geo, elements) {
  const src = geo.attributes.position.array;
  let total = 0;
  for (const e of elements) total += e.n * 9;
  const out = new Float32Array(total);
  let o = 0;
  for (const e of elements) { out.set(src.subarray(e.s * 9, (e.s + e.n) * 9), o); o += e.n * 9; }
  return makeGeo(out);
}
// Hauteur de coupe : au-dessus d'un élément mince (dalle), juste sous la tête d'un élément haut (mur, poteau)
function cutFor(b) {
  const h = b.max.y - b.min.y;
  return h < 0.6 ? b.max.y + 0.6 : b.max.y - Math.min(0.3, h * 0.25);
}
function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export async function createViewer(container, opts = {}) {
  const base = opts.base || '../model/';
  const explore = Boolean(opts.explore);
  const targetId = explore ? 0 : (Number(opts.targetId) || 0);
  const zone = explore ? 'ALL' : (opts.zone || 'A2');
  const ui = {
    status: container.querySelector('[data-v="status"]'),
    label: container.querySelector('[data-v="label"]'),
    tip: container.querySelector('[data-v="tip"]'),
    needle: container.querySelector('[data-v="needle"]'),
    canvasHost: container.querySelector('[data-v="canvas"]')
  };
  const setStatus = (txt) => { if (!ui.status) return; ui.status.textContent = txt || ''; ui.status.hidden = !txt; };

  setStatus('Chargement de la maquette');
  const { man, buf } = await fetchGeometry(base);
  setStatus('Construction du modèle');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.matchMedia?.('(pointer: coarse)').matches ? 1.5 : 2));
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  ui.canvasHost.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', `Vue 3D du projet, ${opts.label || 'ouvrage'} en surbrillance : faites glisser pour tourner, pincez ou utilisez la molette pour zoomer.`);
  renderer.domElement.setAttribute('role', 'img');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.2, 3000);
  scene.add(new THREE.HemisphereLight(0xf4f6f8, 0x8a8f86, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.35); sun.position.set(40, 70, 25); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe7ef, 0.45); fill.position.set(-50, 30, -40); scene.add(fill);

  const buildPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 400);
  const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 400);

  // Repérage de l'ouvrage ciblé dans les groupes
  let tGroup = null, tEl = null;
  for (const g of man.groups) {
    for (const e of g.elements) if (e[0] === targetId) { tGroup = g.name; tEl = e; break; }
    if (tGroup) break;
  }

  const groups = {};
  let targetGeo = null;
  for (const g of man.groups) {
    const i16 = new Int16Array(buf, g.byteOffset, g.byteLength / 2);
    let els = g.elements.map(e => ({ id: e[0], s: e[1], n: e[2], i: e[3], r: e[4], g: g.name }));
    let pos;
    if (g.name === tGroup) {
      const s = tEl[1] * 9, n = tEl[2] * 9;
      const tpos = new Float32Array(n); toFloat(i16.subarray(s, s + n), tpos, 0);
      targetGeo = makeGeo(tpos);
      pos = new Float32Array(i16.length - n);
      toFloat(i16.subarray(0, s), pos, 0);
      toFloat(i16.subarray(s + n), pos, s);
      els = els.filter(e => e.id !== targetId).map(e => (e.s > tEl[1] ? { ...e, s: e.s - tEl[2] } : e));
    } else {
      pos = new Float32Array(i16.length); toFloat(i16, pos, 0);
    }
    const geo = makeGeo(pos);
    const st = styleOf(g.name);
    const mat = new THREE.MeshStandardMaterial({
      color: st.color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
      transparent: true, opacity: st.opacity, depthWrite: st.opacity >= 0.99,
      clippingPlanes: g.name === 'topo' ? [] : [buildPlane, sectionPlane],
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = g.name;
    mesh.userData = { elements: els, style: st };
    if (els.length) elementBoxes(geo, els);
    scene.add(mesh);
    groups[g.name] = mesh;
  }
  const names = Object.keys(groups);
  const ZG = zoneGroups(zone, names);
  const otherTower = names.filter(n => (zone === 'A2' ? n.startsWith('a1_') : (zone === 'A1' || zone === 'LT') ? n.startsWith('a2_') : false));
  const defaultHidden = (n) => (n === 'found' && zone !== 'FOND') || (n === 'lt' && zone !== 'LT');

  // Boîtes de zone et de site
  const zoneBox = new THREE.Box3();
  for (const n of ZG) if (groups[n]) zoneBox.union(groups[n].geometry.boundingBox);
  if (targetGeo) zoneBox.union(targetGeo.boundingBox);
  const siteBox = new THREE.Box3();
  for (const n of names) if (n !== 'topo') siteBox.union(groups[n].geometry.boundingBox);
  const zc = zoneBox.getCenter(new THREE.Vector3());
  const zs = Math.max(zoneBox.max.x - zoneBox.min.x, zoneBox.max.z - zoneBox.min.z);
  const isTower = ['A1', 'A2', 'LT'].includes(zone);

  // Ouvrage ciblé
  const tBox = targetGeo ? targetGeo.boundingBox.clone() : new THREE.Box3(zc.clone(), zc.clone());
  const tCenter = tBox.getCenter(new THREE.Vector3());
  const tSize = Math.max(0.5, tBox.max.x - tBox.min.x, tBox.max.y - tBox.min.y, tBox.max.z - tBox.min.z);
  const tHeight = tBox.max.y - tBox.min.y;
  let target = null, edges = null, xray = null, pin = null;
  if (targetGeo) {
    target = new THREE.Mesh(targetGeo, new THREE.MeshStandardMaterial({ color: PINK, emissive: PINK.clone(), emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide, clippingPlanes: [buildPlane] }));
    target.renderOrder = 20;
    target.userData = { elements: [{ id: targetId, s: 0, n: tEl[2], i: opts.label, r: null, g: tGroup, target: true }] };
    scene.add(target);
    edges = new THREE.LineSegments(new THREE.EdgesGeometry(targetGeo, 20), new THREE.LineBasicMaterial({ color: PINK, depthTest: false, transparent: true, opacity: 0.95 }));
    edges.renderOrder = 30; scene.add(edges);
    xray = new THREE.Mesh(targetGeo, new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide }));
    xray.renderOrder = 25; scene.add(xray);
    const pinTop = Math.max(zoneBox.max.y + 4, tBox.max.y + 6);
    pin = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * Math.max(1, zs / 40), 0.05 * Math.max(1, zs / 40), pinTop - tBox.max.y, 8),
      new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.75, depthTest: false }));
    pin.position.set(tCenter.x, (pinTop + tBox.max.y) / 2, tCenter.z);
    pin.renderOrder = 26; scene.add(pin);
  } else {
    setStatus('');
  }
  const showTarget = (on) => { for (const o of [edges, xray, pin]) if (o) o.visible = on; };

  // Sol autour de la zone (mode « zone seule »)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(zs * 0.75 + 8, 72), new THREE.MeshStandardMaterial({ color: 0xd2d7d1, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(zc.x, Math.min(-0.05, zoneBox.min.y - 0.05), zc.z);
  ground.visible = false;
  scene.add(ground);

  // Ouvrages voisins, pour le mode « Isoler »
  const R = Math.max(4.6, tSize * 0.9);
  const need = tHeight < 0.6 ? -0.05 : Math.min(1.0, tHeight * 0.4);
  const coreGroup = new THREE.Group();
  const isNoisyTarget = tGroup && NOISY_KINDS.includes(styleOf(tGroup).kind);
  for (const n of ZG) {
    const m = groups[n];
    if (!m) continue;
    if (NOISY_KINDS.includes(m.userData.style.kind) && !(isNoisyTarget && n === tGroup)) continue;
    const els = m.userData.elements.filter(e => {
      if (!e.box) return false;
      const vo = Math.min(e.box.max.y, tBox.max.y) - Math.max(e.box.min.y, tBox.min.y);
      if (vo < need) return false;
      const c = e.box.getCenter(new THREE.Vector3());
      const dx = Math.max(0, Math.abs(c.x - tCenter.x) - (e.box.max.x - e.box.min.x) / 2);
      const dz = Math.max(0, Math.abs(c.z - tCenter.z) - (e.box.max.z - e.box.min.z) / 2);
      return Math.hypot(dx, dz) < R;
    });
    if (!els.length) continue;
    const g = subsetGeometry(m.geometry, els);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8d9ea9, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    let s = 0;
    mesh.userData = { elements: els.map(e => { const o = { ...e, s }; s += e.n; return o; }), style: m.userData.style };
    coreGroup.add(mesh);
  }
  const patch = new THREE.Mesh(new THREE.CircleGeometry(R + 1.2, 48), new THREE.MeshStandardMaterial({ color: 0xc9cfcc, roughness: 1, transparent: true, opacity: 0.7, depthWrite: false }));
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(tCenter.x, tBox.min.y - 0.01, tCenter.z);
  coreGroup.add(patch);
  coreGroup.visible = false;
  scene.add(coreGroup);

  // Caméra et contrôles
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1.5;
  controls.maxDistance = 600;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    // téléphone : un doigt vertical fait défiler la page, horizontal fait tourner, deux doigts zooment
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    renderer.domElement.style.touchAction = 'pan-y';
  }

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const sc = siteBox.getCenter(new THREE.Vector3());
  const siteSize = Math.max(siteBox.max.x - siteBox.min.x, siteBox.max.z - siteBox.min.z);
  const secZ = cutFor(tBox);
  const below = tBox.max.y < 1.5;
  const VIEWS = {};
  VIEWS.situation = { look: V(sc.x, 6, sc.z) };
  VIEWS.situation.pos = VIEWS.situation.look.clone().add(V(68, 42, 56).normalize().multiplyScalar(siteSize * 0.95));
  if (isTower) {
    VIEWS.zone = { look: V(zc.x, zoneBox.min.y + (zoneBox.max.y - zoneBox.min.y) * 0.4, zc.z) };
    VIEWS.zone.pos = VIEWS.zone.look.clone().add(V(46, 24, 54).normalize().multiplyScalar(Math.max(zs * 2.3, (zoneBox.max.y - zoneBox.min.y) * 2.2)));
    const look = zc.clone().lerp(tCenter, 0.5); look.y = secZ - 2.8;
    VIEWS.coupe = { look, pos: look.clone().add(V(9.7, 18.2, 17.7).multiplyScalar(1.25)) };
  } else {
    VIEWS.zone = { look: V(zc.x, zoneBox.min.y, zc.z) };
    VIEWS.zone.pos = VIEWS.zone.look.clone().add(V(0.5, 0.75, 0.6).normalize().multiplyScalar(zs * 1.05));
    const look = V(tCenter.x, secZ - 2.8, tCenter.z);
    VIEWS.coupe = { look, pos: look.clone().add(V(9.7, 18.2, 17.7).multiplyScalar(Math.max(1.6, tSize / 6))) };
  }
  const k = Math.max(1, tSize / 3);
  VIEWS.ouvrage = { pos: tCenter.clone().add(V(6.5, 5.5, 8).multiplyScalar(k)), look: tCenter.clone().add(V(0, -0.6 * k, 0)) };
  camera.position.copy(VIEWS.situation.pos);
  controls.target.copy(VIEWS.situation.look);

  let camTween = null;
  function flyTo(view, ms = 1400) {
    const v = VIEWS[view] || view;
    if (reduceMotion() || ms === 0) { camera.position.copy(v.pos); controls.target.copy(v.look); controls.update(); return; }
    camTween = { t0: performance.now(), ms, p0: camera.position.clone(), l0: controls.target.clone(), p1: v.pos.clone(), l1: v.look.clone() };
  }
  const opTweens = new Map();
  function setOpacity(mesh, value, ms = 600) {
    const mat = mesh.material;
    if (reduceMotion() || ms === 0) { mat.opacity = value; mat.depthWrite = value >= 0.99; return; }
    opTweens.set(mesh, { t0: performance.now(), ms, from: mat.opacity, to: value });
  }

  let mode = 'coupe';
  function applyMode(m, o = {}) {
    mode = m;
    const ms = o.instant ? 0 : 650;
    const fly = o.noFly ? null : (o.instant ? 0 : 1300);
    sectionPlane.constant = 400;
    coreGroup.visible = false;
    ground.visible = false;
    for (const n of names) {
      groups[n].visible = !defaultHidden(n);
      setOpacity(groups[n], groups[n].userData.style.opacity, ms);
    }
    if (m === 'situation') {
      for (const n of otherTower) setOpacity(groups[n], Math.min(0.5, groups[n].userData.style.opacity), ms);
      if (fly !== null) flyTo('situation', fly);
    } else if (m === 'tour') {
      for (const n of names) if (!ZG.includes(n)) groups[n].visible = false;
      ground.visible = isTower;
      for (const n of ZG) {
        const st = groups[n].userData.style;
        if (NOISY_KINDS.includes(st.kind) && n !== tGroup) { groups[n].visible = false; continue; }
        setOpacity(groups[n], st.kind === 'floors' ? 0.06 : st.kind === 'walls' ? 0.14 : n === 'parking' || n === 'found' || n === 'ext' ? 0.22 : 0.1, ms);
      }
      if (fly !== null) flyTo('zone', fly);
    } else if (m === 'isoler') {
      for (const n of names) groups[n].visible = false;
      coreGroup.visible = true;
      if (fly !== null) flyTo('ouvrage', fly);
    } else if (m === 'coupe') {
      for (const n of otherTower) groups[n].visible = false;
      if (below && groups.topo) groups.topo.visible = false;
      if (zone === 'FOND' && groups.found) groups.found.visible = true;
      sectionPlane.constant = secZ;
      if (fly !== null) flyTo('coupe', fly);
    }
    syncStatus();
    opts.onMode?.(m);
  }

  // Séquence d'apparition : la maquette se construit, puis l'ouvrage s'allume.
  let intro = null;
  const buildFrom = Math.min(-4, siteBox.min.y - 1), buildTo = siteBox.max.y + 4;
  function replay() {
    if (reduceMotion()) { buildPlane.constant = 400; showTarget(true); applyMode(explore ? 'situation' : 'coupe', { instant: true }); return; }
    for (const n of names) { groups[n].material.opacity = groups[n].userData.style.opacity; groups[n].visible = !defaultHidden(n); }
    if (zone === 'FOND' && groups.topo) groups.topo.visible = false;
    coreGroup.visible = false;
    sectionPlane.constant = 400;
    buildPlane.constant = buildFrom;
    showTarget(false);
    camera.position.copy(VIEWS.situation.pos);
    controls.target.copy(VIEWS.situation.look);
    intro = { t0: performance.now() };
  }

  // Identification de l'élément touché
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!downAt) return;
    const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]);
    downAt = null;
    if (moved > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const pickables = [target, ...names.map(n => groups[n]).filter(m => m.visible && m.material.opacity > 0.3 && m.name !== 'topo'), ...(coreGroup.visible ? coreGroup.children : []),
      ...Object.values(statusMeshes).flatMap(o => [o.solid, o.ghost]).filter(m => m && m.visible)].filter(Boolean);
    const hits = ray.intersectObjects(pickables, false).filter(h => h.object.visible);
    // ignore ce qui est au-dessus du plan de coupe
    const hit = hits.find(h => h.object === target || -h.point.y + sectionPlane.constant > 0);
    if (!hit || !hit.object.userData.elements) { hideTip(); if (explore) { clearSel(); opts.onPick?.(null); } return; }
    const els = hit.object.userData.elements;
    const f = hit.faceIndex;
    let lo = 0, hi = els.length - 1, found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (els[mid].s > f) hi = mid - 1;
      else if (els[mid].s + els[mid].n <= f) lo = mid + 1;
      else { found = els[mid]; break; }
    }
    if (explore) { if (found) select(found.id, false); opts.onPick?.(found); return; }
    showTip(found, ev.clientX - r.left, ev.clientY - r.top);
    opts.onPick?.(found);
  });
  function showTip(e, x, y) {
    if (!ui.tip) return;
    if (!e) { hideTip(); return; }
    ui.tip.textContent = '';
    const b = document.createElement('strong');
    b.textContent = e.target ? (opts.label || 'Cet ouvrage') : (e.i || 'Élément sans passeport');
    const s = document.createElement('span');
    s.textContent = e.target ? 'Cet ouvrage' : (LABELS[styleOf(e.g).kind] || '');
    ui.tip.append(b, s);
    if (!e.target && e.r && opts.linkFor) {
      const a = document.createElement('a');
      a.href = opts.linkFor(e.r);
      a.textContent = 'Ouvrir son passeport';
      ui.tip.append(a);
    }
    ui.tip.style.left = Math.round(x) + 'px';
    ui.tip.style.top = Math.round(y) + 'px';
    ui.tip.dataset.target = e.target ? '1' : '';
    ui.tip.hidden = false;
  }
  function hideTip() { if (ui.tip) ui.tip.hidden = true; }

  function resize() {
    const w = ui.canvasHost.clientWidth, h = ui.canvasHost.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(ui.canvasHost);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 });
  io.observe(container);

  const tmp = new THREE.Vector3();
  const labelAnchor = new THREE.Vector3(tCenter.x, tBox.max.y + 0.35, tCenter.z);
  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    if (intro) {
      const t = (now - intro.t0) / 1000;
      const dur = 2.6;
      buildPlane.constant = buildFrom + ease(Math.min(1, t / dur)) * (buildTo - buildFrom);
      if (t > dur && !intro.lit) {
        intro.lit = true;
        showTarget(true);
        if (explore) { applyMode('situation', { noFly: true }); }
        else { applyMode('coupe', { noFly: true }); flyTo('coupe', 1800); }
      }
      if (t > dur + 0.1) { buildPlane.constant = 400; intro = null; }
    }
    if (camTween) {
      const kk = Math.min(1, (now - camTween.t0) / camTween.ms);
      const e = ease(kk);
      camera.position.lerpVectors(camTween.p0, camTween.p1, e);
      controls.target.lerpVectors(camTween.l0, camTween.l1, e);
      if (kk >= 1) camTween = null;
    }
    for (const [mesh, tw] of opTweens) {
      const kk = Math.min(1, (now - tw.t0) / tw.ms);
      mesh.material.opacity = tw.from + (tw.to - tw.from) * ease(kk);
      mesh.material.depthWrite = mesh.material.opacity >= 0.99;
      if (kk >= 1) opTweens.delete(mesh);
    }
    if (target && !reduceMotion()) {
      const p = 0.5 + 0.5 * Math.sin(now / 420);
      target.material.emissiveIntensity = 0.25 + 0.45 * p;
      xray.material.opacity = 0.16 + 0.22 * p;
    }
    controls.update();
    renderer.render(scene, camera);
    if (ui.label) {
      tmp.copy(labelAnchor).project(camera);
      const w = ui.canvasHost.clientWidth, h = ui.canvasHost.clientHeight;
      const onScreen = target && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 && edges.visible;
      ui.label.hidden = !onScreen;
      if (onScreen) ui.label.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`;
    }
    if (ui.needle) {
      camera.getWorldDirection(tmp);
      const az = Math.atan2(tmp.x, -tmp.z);
      ui.needle.style.transform = `rotate(${(-az * 180 / Math.PI).toFixed(1)}deg)`;
    }
  }
  setStatus(targetGeo || explore ? '' : "Cet ouvrage n'a pas de géométrie exportable : vue du projet sans surbrillance.");
  raf = requestAnimationFrame(frame);
  replay();

  // ---- exploration : sélection d'un ouvrage, filtres par zone et coupe par étage
  let sel = null;
  function clearSel() {
    if (!sel) return;
    scene.remove(sel.mesh, sel.edges);
    sel.mesh.geometry.dispose(); sel.edges.geometry.dispose();
    sel = null;
  }
  function viewFor(box, tower) {
    const c = box.getCenter(new THREE.Vector3());
    const sx = Math.max(box.max.x - box.min.x, box.max.z - box.min.z), h = box.max.y - box.min.y;
    if (tower) {
      const look = V(c.x, box.min.y + h * 0.4, c.z);
      return { look, pos: look.clone().add(V(46, 24, 54).normalize().multiplyScalar(Math.max(sx * 2.3, h * 2.2))) };
    }
    const look = V(c.x, box.min.y, c.z);
    return { look, pos: look.clone().add(V(0.5, 0.75, 0.6).normalize().multiplyScalar(Math.max(12, sx * 1.05))) };
  }
  function select(id, fly = true) {
    if (intro) { intro = null; buildPlane.constant = 400; applyMode('situation', { noFly: true }); }
    for (const n of names) {
      const m = groups[n];
      const e = m.userData.elements.find(x => x.id === id);
      if (!e) continue;
      clearSel();
      const g = subsetGeometry(m.geometry, [e]);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: PINK, emissive: PINK.clone(), emissiveIntensity: 0.45, roughness: 0.6, side: THREE.DoubleSide, clippingPlanes: [sectionPlane] }));
      mesh.renderOrder = 20;
      const ed = new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), new THREE.LineBasicMaterial({ color: PINK, depthTest: false, transparent: true, opacity: 0.95 }));
      ed.renderOrder = 30;
      scene.add(mesh, ed);
      sel = { mesh, edges: ed, e };
      if (fly && e.box) {
        // coupe juste au-dessus de l'ouvrage pour le voir depuis le haut, comme dans sa fiche
        const c = e.box.getCenter(new THREE.Vector3());
        const sz = Math.max(e.box.max.x - e.box.min.x, e.box.max.y - e.box.min.y, e.box.max.z - e.box.min.z);
        const h = e.box.max.y - e.box.min.y;
        const kind = styleOf(n).kind;
        const inside = !['topo', 'ext'].includes(n) && kind !== 'generic' && kind !== 'rail';
        sectionPlane.constant = inside ? cutFor(e.box) : 400;
        const kk = Math.max(0.8, sz / 6);
        const look = c.clone(); look.y = Math.min(c.y, sectionPlane.constant - 1);
        flyTo({ pos: look.clone().add(V(9.7, 18.2, 17.7).multiplyScalar(kk)), look }, 1300);
      }
      return { ...e, kind: LABELS[styleOf(n).kind] || '' };
    }
    return null;
  }
  // ---- vue « avancement » (4D) : chaque élément prend la couleur de son statut
  let statusOn = false, currentShow = null;
  const statusMeshes = {}, statusSig = {}, colorCache = new Map();
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, clippingPlanes: [buildPlane, sectionPlane],
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.13, depthWrite: false,
    clippingPlanes: [buildPlane, sectionPlane] });
  function lin(hex) {
    let c = colorCache.get(hex);
    if (!c) { const k = new THREE.Color(hex); c = [k.r, k.g, k.b]; colorCache.set(hex, c); }
    return c;
  }
  function colored(src, list, mat) {
    if (!list.length) return null;
    const P = src.attributes.position.array, N = src.attributes.normal.array;
    let tot = 0; for (const [e] of list) tot += e.n * 9;
    const pos = new Float32Array(tot), nor = new Float32Array(tot), col = new Float32Array(tot);
    let o = 0, s0 = 0;
    const els = [];
    for (const [e, c] of list) {
      const a = e.s * 9, b = (e.s + e.n) * 9;
      pos.set(P.subarray(a, b), o); nor.set(N.subarray(a, b), o);
      for (let k = o; k < o + (b - a); k += 3) { col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2]; }
      els.push({ ...e, s: s0 }); s0 += e.n; o += b - a;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat);
    m.userData = { elements: els };
    scene.add(m);
    return m;
  }
  function shown(n) { return (currentShow || names.filter(x => x !== 'found' && x !== 'lt')).includes(n); }
  function syncStatus() {
    if (!statusOn) return;
    for (const n of names) {
      if (n === 'topo') continue;
      groups[n].visible = false;
      const o = statusMeshes[n];
      if (o) { if (o.solid) o.solid.visible = shown(n); if (o.ghost) o.ghost.visible = shown(n); }
    }
  }
  // fn(element) -> { hex, m: 'solid' | 'ghost' } ou null (élément sans passeport : fantôme gris)
  function setStatusView(fn) {
    if (!fn) {
      statusOn = false;
      for (const n of Object.keys(statusMeshes)) {
        for (const k of ['solid', 'ghost']) { const m = statusMeshes[n][k]; if (m) { scene.remove(m); m.geometry.dispose(); } }
        delete statusMeshes[n]; delete statusSig[n];
      }
      for (const n of names) groups[n].visible = shown(n) || (n === 'topo' && sectionPlane.constant > 300 && !currentShow) || (n === 'topo' && currentShow && currentShow.length > 8 && sectionPlane.constant > 300);
      return;
    }
    if (intro) { intro = null; buildPlane.constant = 400; showTarget(true); }
    statusOn = true;
    for (const n of names) {
      if (n === 'topo') continue;
      const m = groups[n];
      const solid = [], ghost = [];
      let sig = '';
      for (const e of m.userData.elements) {
        const r = fn(e);
        const hex = r ? r.hex : 0xb9bfc2, mode = r ? r.m : 'ghost';
        sig += (mode === 'solid' ? 'S' : 'G') + hex.toString(36);
        (mode === 'solid' ? solid : ghost).push([e, lin(hex)]);
      }
      if (statusSig[n] === sig && statusMeshes[n]) continue;
      statusSig[n] = sig;
      const old = statusMeshes[n];
      if (old) for (const k of ['solid', 'ghost']) if (old[k]) { scene.remove(old[k]); old[k].geometry.dispose(); }
      statusMeshes[n] = { solid: colored(m.geometry, solid, solidMat), ghost: colored(m.geometry, ghost, ghostMat) };
    }
    syncStatus();
  }

  function setFilter(z, cut) {
    if (intro) { intro = null; buildPlane.constant = 400; }
    const show = z === 'ALL' ? names.filter(n => n !== 'found' && n !== 'lt') : zoneGroups(z, names);
    for (const n of names) { groups[n].visible = show.includes(n) || (n === 'topo' && z === 'ALL' && cut == null); setOpacity(groups[n], groups[n].userData.style.opacity, 0); }
    sectionPlane.constant = cut == null ? 400 : cut;
    currentShow = show;
    syncStatus();
    const tower = ['A1', 'A2', 'LT'].includes(z);
    const box = new THREE.Box3();
    for (const n of show) if (groups[n] && (!tower || /_floors$/.test(n))) box.union(groups[n].geometry.boundingBox);
    if (z === 'ALL' && cut == null) { flyTo('situation', 1100); return; }
    if (box.isEmpty()) return;
    if (cut != null) {
      const c = box.getCenter(new THREE.Vector3());
      const look = V(c.x, cut - 2.8, c.z);
      const sx = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      flyTo({ look, pos: look.clone().add(V(9.7, 18.2, 17.7).multiplyScalar(sx / 24)) }, 1100);
    } else flyTo(viewFor(box, tower), 1100);
  }

  return {
    select,
    setStatusView,
    clearSelection: clearSel,
    setFilter,
    setMode: (m) => applyMode(m),
    replay,
    focus: () => { showTarget(true); applyMode('coupe'); },
    hasTarget: Boolean(targetGeo),
    get mode() { return mode; },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); }
  };
}
