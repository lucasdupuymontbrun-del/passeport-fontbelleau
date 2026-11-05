// Visionneuse 3D du passeport : géométrie extraite de la maquette Revit (voir model/a2.json).
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

const STYLE = {
  topo:        { color: 0xd3d8cc, opacity: 1 },
  found:       { color: 0xb5babb, opacity: 0.9, hidden: true },
  parking:     { color: 0xc5c9c8, opacity: 1 },
  a1:          { color: 0xbfc5c4, opacity: 0.5 },
  a2_floors:   { color: 0xa7b2b9, opacity: 1 },
  a2_walls:    { color: 0x91a3af, opacity: 1 },
  a2_frame:    { color: 0x7d8e9a, opacity: 1 },
  a2_stairs:   { color: 0x8b959c, opacity: 1 },
  a2_rail:     { color: 0x6d7880, opacity: 1 },
  a2_openings: { color: 0xa6c3d5, opacity: 0.55 },
  a2_generic:  { color: 0xb8b0a3, opacity: 1 },
  target:      { color: 0xd1126f, opacity: 1 }
};
const A2 = ['a2_floors', 'a2_walls', 'a2_frame', 'a2_stairs', 'a2_rail', 'a2_openings', 'a2_generic'];
const CONTEXT = ['topo', 'parking', 'a1', 'found'];
const PINK = new THREE.Color(0xd1126f);

function reduceMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function fetchGeometry(base, onStep) {
  onStep?.('Chargement de la maquette');
  const man = await (await fetch(base + 'a2.json')).json();
  let buf = null;
  try {
    const r = await fetch(base + 'a2.bin.gz');
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
  if (!buf) buf = await (await fetch(base + 'a2.bin')).arrayBuffer();
  return { man, buf };
}

function buildGeometry(buf, grp) {
  const i16 = new Int16Array(buf, grp.byteOffset, grp.byteLength / 2);
  const pos = new Float32Array(i16.length);
  for (let k = 0; k < i16.length; k += 3) {
    pos[k] = i16[k] / 100;          // x (est)
    pos[k + 1] = i16[k + 2] / 100;  // y three = z Revit (haut)
    pos[k + 2] = -i16[k + 1] / 100; // z three = -y Revit (nord vers -z)
  }
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
    const a = e.s * 9, b = (e.s + e.n) * 9;
    for (let k = a; k < b; k += 3) {
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
  for (const e of elements) {
    out.set(src.subarray(e.s * 9, (e.s + e.n) * 9), o);
    o += e.n * 9;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export async function createViewer(container, opts = {}) {
  const base = opts.base || '../model/';
  const ui = {
    status: container.querySelector('[data-v="status"]'),
    label: container.querySelector('[data-v="label"]'),
    tip: container.querySelector('[data-v="tip"]'),
    needle: container.querySelector('[data-v="needle"]'),
    canvasHost: container.querySelector('[data-v="canvas"]')
  };
  const setStatus = (txt) => {
    if (!ui.status) return;
    ui.status.textContent = txt || '';
    ui.status.hidden = !txt;
  };

  setStatus('Préparation de la vue 3D');
  const { man, buf } = await fetchGeometry(base, setStatus);
  setStatus('Construction du modèle');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  ui.canvasHost.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Vue 3D de la tour A2 : faites glisser pour tourner, pincez ou utilisez la molette pour zoomer.');
  renderer.domElement.setAttribute('role', 'img');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.2, 2000);
  scene.add(new THREE.HemisphereLight(0xf4f6f8, 0x8a8f86, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  sun.position.set(40, 70, 25);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe7ef, 0.45);
  fill.position.set(-50, 30, -40);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 72), new THREE.MeshStandardMaterial({ color: 0xd2d7d1, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.visible = false;
  scene.add(ground);

  const buildPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 200);
  const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 400);

  const groups = {};
  for (const g of man.groups) {
    const geo = buildGeometry(buf, g);
    const st = STYLE[g.name] || { color: 0xaaaaaa, opacity: 1 };
    const mat = new THREE.MeshStandardMaterial({
      color: st.color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
      transparent: true, opacity: st.opacity, depthWrite: st.opacity >= 0.99,
      clippingPlanes: g.name === 'topo' ? [] : [buildPlane, sectionPlane],
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = g.name;
    mesh.visible = !st.hidden;
    mesh.userData = { group: g, base: st.opacity };
    if (g.elements?.length) elementBoxes(geo, g.elements);
    scene.add(mesh);
    groups[g.name] = mesh;
  }

  // Ouvrage ciblé : surbrillance, contour visible à travers les murs, repère vertical.
  const target = groups.target;
  target.material.emissive = PINK.clone();
  target.material.emissiveIntensity = 0.35;
  target.material.depthTest = true;
  target.renderOrder = 20;
  target.geometry.computeBoundingBox();
  const tBox = target.geometry.boundingBox.clone();
  const tCenter = tBox.getCenter(new THREE.Vector3());
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(target.geometry, 20),
    new THREE.LineBasicMaterial({ color: PINK, depthTest: false, transparent: true, opacity: 0.95 })
  );
  edges.renderOrder = 30;
  scene.add(edges);
  const xray = new THREE.Mesh(target.geometry, new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide }));
  xray.renderOrder = 25;
  scene.add(xray);
  const pinTop = 36;
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, pinTop - tBox.max.y, 8),
    new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.75, depthTest: false })
  );
  pin.position.set(tCenter.x, (pinTop + tBox.max.y) / 2, tCenter.z);
  pin.renderOrder = 26;
  scene.add(pin);

  // Noyau voisin, pour le mode « Isoler » : éléments du même étage autour de l'ouvrage.
  const coreEls = [];
  const R = 4.6;
  for (const name of ['a2_walls', 'a2_frame', 'a2_stairs']) {
    const m = groups[name];
    const els = m.userData.group.elements.filter(e => {
      if (!e.box) return false;
      const vOverlap = Math.min(e.box.max.y, tBox.max.y) - Math.max(e.box.min.y, tBox.min.y);
      if (vOverlap < 1.0) return false;
      const c = e.box.getCenter(new THREE.Vector3());
      const dx = Math.max(0, Math.abs(c.x - tCenter.x) - (e.box.max.x - e.box.min.x) / 2);
      const dz = Math.max(0, Math.abs(c.z - tCenter.z) - (e.box.max.z - e.box.min.z) / 2);
      return Math.hypot(dx, dz) < R;
    });
    if (els.length) coreEls.push({ mesh: m, els });
  }
  const coreGroup = new THREE.Group();
  for (const c of coreEls) {
    const g = subsetGeometry(c.mesh.geometry, c.els);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d9ea9, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    let s = 0;
    const els = c.els.map(e => { const o = { ...e, s }; s += e.n; return o; });
    mesh.userData = { group: { elements: els } };
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
  controls.minDistance = 2;
  controls.maxDistance = 260;

  const VIEWS = {
    situation: { pos: new THREE.Vector3(58, 48, 72), look: new THREE.Vector3(-10, 6, 16) },
    tour: { pos: new THREE.Vector3(46, 36, 54), look: new THREE.Vector3(0, 12, 0) },
    ouvrage: { pos: tCenter.clone().add(new THREE.Vector3(6.5, 5.5, 8)), look: tCenter.clone().add(new THREE.Vector3(0, -0.6, 0)) },
    coupe: { pos: new THREE.Vector3(9.5, 24, 16.5), look: new THREE.Vector3(-0.2, 5.8, -1.2) }
  };
  camera.position.copy(VIEWS.situation.pos);
  controls.target.copy(VIEWS.situation.look);

  // Animation de caméra
  let camTween = null;
  function flyTo(view, ms = 1400) {
    const v = VIEWS[view] || view;
    if (reduceMotion() || ms === 0) {
      camera.position.copy(v.pos); controls.target.copy(v.look); controls.update(); return;
    }
    camTween = { t0: performance.now(), ms, p0: camera.position.clone(), l0: controls.target.clone(), p1: v.pos.clone(), l1: v.look.clone() };
  }

  // Opacités animées
  const opTweens = new Map();
  function setOpacity(mesh, value, ms = 600) {
    const mat = mesh.material;
    if (reduceMotion() || ms === 0) { mat.opacity = value; mat.depthWrite = value >= 0.99; return; }
    opTweens.set(mesh, { t0: performance.now(), ms, from: mat.opacity, to: value });
  }

  let mode = 'coupe';
  const NOISY = ['a2_openings', 'a2_generic', 'a2_rail'];
  function applyMode(m, opt = {}) {
    mode = m;
    const ms = opt.instant ? 0 : 650;
    const fly = opt.noFly ? null : (opt.instant ? 0 : 1300);
    sectionPlane.constant = 400;
    coreGroup.visible = false;
    ground.visible = false;
    for (const name of CONTEXT) if (groups[name]) groups[name].visible = !STYLE[name].hidden;
    for (const name of A2) groups[name].visible = true;
    if (m === 'situation') {
      for (const name of A2) setOpacity(groups[name], STYLE[name].opacity, ms);
      setOpacity(groups.a1, STYLE.a1.opacity, ms);
      if (fly !== null) flyTo('situation', fly);
    } else if (m === 'tour') {
      for (const name of CONTEXT) groups[name].visible = false;
      ground.visible = true;
      for (const name of NOISY) groups[name].visible = false;
      for (const name of A2) if (!NOISY.includes(name)) setOpacity(groups[name], name === 'a2_floors' ? 0.06 : name === 'a2_walls' ? 0.14 : 0.1, ms);
      if (fly !== null) flyTo('tour', fly);
    } else if (m === 'isoler') {
      for (const name of CONTEXT) groups[name].visible = false;
      for (const name of A2) groups[name].visible = false;
      coreGroup.visible = true;
      if (fly !== null) flyTo('ouvrage', fly);
    } else if (m === 'coupe') {
      for (const name of CONTEXT) groups[name].visible = name === 'topo' || name === 'parking';
      for (const name of A2) setOpacity(groups[name], STYLE[name].opacity, ms);
      sectionPlane.constant = 8.6;
      if (fly !== null) flyTo('coupe', fly);
    }
    opts.onMode?.(m);
  }

  // Séquence d'apparition : la tour se construit, puis l'ouvrage s'allume.
  let intro = null;
  function replay() {
    if (reduceMotion()) {
      buildPlane.constant = 200;
      edges.visible = xray.visible = pin.visible = true;
      applyMode('coupe', { instant: true });
      return;
    }
    for (const name of A2) { groups[name].material.opacity = STYLE[name].opacity; groups[name].visible = true; }
    for (const name of CONTEXT) groups[name].visible = !STYLE[name].hidden;
    coreGroup.visible = false;
    sectionPlane.constant = 400;
    buildPlane.constant = -4;
    edges.visible = xray.visible = pin.visible = false;
    camera.position.copy(VIEWS.situation.pos);
    controls.target.copy(VIEWS.situation.look);
    intro = { t0: performance.now() };
  }

  // Interaction : identification de l'élément touché
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
    ray.params.Line = { threshold: 0.1 };
    const pickables = [target, ...A2.map(n => groups[n]).filter(m => m.visible && m.material.opacity > 0.3), ...(coreGroup.visible ? coreGroup.children : [])];
    const hit = ray.intersectObjects(pickables, false).find(h => h.object.visible);
    if (!hit) { opts.onPick?.(null); hideTip(); return; }
    const els = hit.object.userData.group?.elements || [];
    const f = hit.faceIndex;
    let lo = 0, hi = els.length - 1, found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (els[mid].s > f) hi = mid - 1;
      else if (els[mid].s + els[mid].n <= f) lo = mid + 1;
      else { found = els[mid]; break; }
    }
    if (hit.object === target) found = els[0];
    showTip(found, ev.clientX - r.left, ev.clientY - r.top, hit.object === target);
    opts.onPick?.(found);
  });

  function showTip(el, x, y, isTarget) {
    if (!ui.tip) return;
    if (!el) { hideTip(); return; }
    ui.tip.innerHTML = '';
    const b = document.createElement('strong');
    b.textContent = el.i || 'Élément sans identifiant';
    const s = document.createElement('span');
    s.textContent = isTarget ? 'Cet ouvrage' : [el.t, el.lv].filter(Boolean).join(', ');
    ui.tip.append(b, s);
    ui.tip.style.left = Math.round(x) + 'px';
    ui.tip.style.top = Math.round(y) + 'px';
    ui.tip.dataset.target = isTarget ? '1' : '';
    ui.tip.hidden = false;
  }
  function hideTip() { if (ui.tip) ui.tip.hidden = true; }

  // Taille
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

  // Pause hors écran
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
      const buildDur = 2.6;
      const k = Math.min(1, t / buildDur);
      buildPlane.constant = -4 + ease(k) * 40;
      if (t > buildDur && !intro.lit) {
        intro.lit = true;
        edges.visible = xray.visible = pin.visible = true;
        applyMode('coupe', { noFly: true });
        flyTo('coupe', 1800);
      }
      if (t > buildDur + 0.1) { buildPlane.constant = 200; intro = null; }
    }
    if (camTween) {
      const k = Math.min(1, (now - camTween.t0) / camTween.ms);
      const e = ease(k);
      camera.position.lerpVectors(camTween.p0, camTween.p1, e);
      controls.target.lerpVectors(camTween.l0, camTween.l1, e);
      if (k >= 1) camTween = null;
    }
    for (const [mesh, tw] of opTweens) {
      const k = Math.min(1, (now - tw.t0) / tw.ms);
      mesh.material.opacity = tw.from + (tw.to - tw.from) * ease(k);
      mesh.material.depthWrite = mesh.material.opacity >= 0.99;
      if (k >= 1) opTweens.delete(mesh);
    }
    if (!reduceMotion()) {
      const p = 0.5 + 0.5 * Math.sin(now / 420);
      target.material.emissiveIntensity = 0.25 + 0.45 * p;
      xray.material.opacity = 0.16 + 0.22 * p;
    }
    controls.update();
    renderer.render(scene, camera);

    // Étiquette HTML et boussole
    if (ui.label) {
      tmp.copy(labelAnchor).project(camera);
      const w = ui.canvasHost.clientWidth, h = ui.canvasHost.clientHeight;
      const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 && edges.visible;
      ui.label.hidden = !onScreen;
      if (onScreen) ui.label.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`;
    }
    if (ui.needle) {
      camera.getWorldDirection(tmp);
      const az = Math.atan2(tmp.x, -tmp.z); // 0 quand la caméra regarde le nord (-z)
      ui.needle.style.transform = `rotate(${(-az * 180 / Math.PI).toFixed(1)}deg)`;
    }
  }
  setStatus('');
  raf = requestAnimationFrame(frame);
  replay();

  return {
    setMode: (m) => applyMode(m),
    replay,
    focus: () => { edges.visible = xray.visible = pin.visible = true; applyMode('coupe'); },
    toggleFoundations: (on) => { groups.found.visible = on; },
    get mode() { return mode; },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); }
  };
}
