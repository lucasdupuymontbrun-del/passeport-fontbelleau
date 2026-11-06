// Scène 3D de nuit du jumeau énergétique : maquette de Fontbelleau, logements lumineux, fenêtres allumées, halo.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { EffectComposer } from '../vendor/pp/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/pp/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/pp/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/pp/postprocessing/OutputPass.js';

const STOREY = 2.79;
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function fetchGeometry(base) {
  const man = await (await fetch(base + 'site.json')).json();
  let buf = null;
  try {
    const r = await fetch(base + 'site.bin.gz');
    if (r.ok) {
      const raw = await r.arrayBuffer();
      const h = new Uint8Array(raw, 0, 2);
      if (h[0] === 0x1f && h[1] === 0x8b) {
        if ('DecompressionStream' in window) buf = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      } else buf = raw;
    }
  } catch (e) { buf = null; }
  if (!buf) buf = await (await fetch(base + 'site.bin')).arrayBuffer();
  return { man, buf };
}

// Revit (m, z vers le haut) → three (y vers le haut)
const toThree = (x, y, z) => [x, z, -y];

function gradientTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#05080b'); gr.addColorStop(0.55, '#0b1218'); gr.addColorStop(0.82, '#16202a'); gr.addColorStop(1, '#2a2620');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const CLIP_VERT_PARS = '#include <clipping_planes_pars_vertex>';
const CLIP_VERT = '#include <clipping_planes_vertex>';
const CLIP_FRAG_PARS = '#include <clipping_planes_pars_fragment>';
const CLIP_FRAG = '#include <clipping_planes_fragment>';

// Volumes des logements : un seul maillage, couleur et intensité lues dans une texture (1 texel par logement)
function sectorMaterial(tex, n) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uN: { value: n }, uSel: { value: -1 }, uTime: { value: 0 }, uHover: { value: -1 } },
    vertexShader: `
      attribute float aLog;
      varying vec3 vN; varying vec3 vV; varying float vLog; varying float vH;
      ${CLIP_VERT_PARS}
      void main(){
        vLog = aLog; vH = position.y;
        vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        ${CLIP_VERT}
      }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform float uN; uniform float uSel; uniform float uTime; uniform float uHover;
      varying vec3 vN; varying vec3 vV; varying float vLog; varying float vH;
      ${CLIP_FRAG_PARS}
      void main(){
        ${CLIP_FRAG}
        vec4 c = texture2D(uTex, vec2((vLog + 0.5) / uN, 0.5));
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float k = c.a;
        float sel = step(abs(vLog - uSel), 0.1);
        float hov = step(abs(vLog - uHover), 0.1);
        float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
        vec3 col = c.rgb * (0.05 + 0.30 * k + 0.55 * fr * (0.3 + k));
        col += vec3(1.0, 0.24, 0.55) * sel * (0.25 + 0.7 * fr) * pulse;
        col += vec3(1.0) * hov * 0.06;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, clipping: true,
  });
}

// Vitrages : couleur du logement desservi (attribut aLog), communs en lumière chaude faible
function glassMaterial(tex, n) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uN: { value: n } },
    vertexShader: `
      attribute float aLog; varying float vLog;
      ${CLIP_VERT_PARS}
      void main(){
        vLog = aLog;
        vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mvPosition;
        ${CLIP_VERT}
      }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform float uN; varying float vLog;
      ${CLIP_FRAG_PARS}
      void main(){
        ${CLIP_FRAG}
        vec3 col;
        if (vLog < 0.0) { col = vec3(0.55, 0.42, 0.25) * 0.35; }
        else {
          vec4 c = texture2D(uTex, vec2((vLog + 0.5) / uN, 0.5));
          col = c.rgb * (0.05 + 0.25 * c.a + 1.05 * c.a * c.a * c.a);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide, clipping: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
}

function groundMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uC1: { value: new THREE.Vector2(0, 0) }, uC2: { value: new THREE.Vector2(0, 0) } },
    vertexShader: `varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec2 uC1; uniform vec2 uC2; varying vec2 vP;
      float grid(vec2 p, float s){ vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main(){
        vec2 mid = (uC1 + uC2) * 0.5;
        float d = length(vP - mid);
        float fade = smoothstep(150.0, 20.0, d);
        float g = grid(vP, 5.0) * 0.55 + grid(vP, 25.0) * 0.6;
        vec3 base = vec3(0.028, 0.040, 0.050);
        vec3 col = base + vec3(0.10, 0.15, 0.19) * g * fade * 0.55;
        float glow = exp(-pow(length(vP - uC1) / 22.0, 2.0)) + exp(-pow(length(vP - uC2) / 22.0, 2.0));
        col += vec3(0.85, 0.55, 0.25) * glow * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }`,
    extensions: { derivatives: true },
  });
}

function sectorGeometry(logs, centers, floor0) {
  const pos = [], aLog = [];
  const push = (p, k) => { pos.push(...p); aLog.push(k); };
  logs.forEach((l, k) => {
    const c = centers[l.tour];
    const gap = 0.55, r0 = 5.55, r1 = 12.62;
    let a0 = l.a0 + gap, a1 = l.a1 - gap;
    const z0 = floor0[l.tour] + (l.etage - 1) * STOREY + 0.06, z1 = z0 + 2.34;
    const segs = Math.max(4, Math.ceil((a1 - a0) / 3));
    const P = (r, a, z) => { const t = a * Math.PI / 180; return toThree(c[0] + r * Math.cos(t), c[1] + r * Math.sin(t), z); };
    const quad = (A, B, C, D) => { push(A, k); push(B, k); push(C, k); push(A, k); push(C, k); push(D, k); };
    for (let i = 0; i < segs; i++) {
      const ta = a0 + (a1 - a0) * i / segs, tb = a0 + (a1 - a0) * (i + 1) / segs;
      quad(P(r0, ta, z1), P(r1, ta, z1), P(r1, tb, z1), P(r0, tb, z1));
      quad(P(r0, ta, z0), P(r0, tb, z0), P(r1, tb, z0), P(r1, ta, z0));
      quad(P(r1, ta, z0), P(r1, tb, z0), P(r1, tb, z1), P(r1, ta, z1));
      quad(P(r0, ta, z0), P(r0, ta, z1), P(r0, tb, z1), P(r0, tb, z0));
    }
    quad(P(r0, a0, z0), P(r1, a0, z0), P(r1, a0, z1), P(r0, a0, z1));
    quad(P(r0, a1, z0), P(r0, a1, z1), P(r1, a1, z1), P(r1, a1, z0));
    l._center = new THREE.Vector3(...P((r0 + r1) / 2, (a0 + a1) / 2, z0 + 1.2));
    l._top = new THREE.Vector3(...P(r1 + 0.6, (a0 + a1) / 2, z1));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLog', new THREE.Float32BufferAttribute(aLog, 1));
  g.computeVertexNormals();
  return g;
}

function sectorOutline(l, centers, floor0) {
  const c = centers[l.tour];
  const r0 = 5.5, r1 = 12.68, a0 = l.a0 + 0.3, a1 = l.a1 - 0.3;
  const z0 = floor0[l.tour] + (l.etage - 1) * STOREY + 0.03, z1 = z0 + 2.5;
  const P = (r, a, z) => { const t = a * Math.PI / 180; return new THREE.Vector3(...toThree(c[0] + r * Math.cos(t), c[1] + r * Math.sin(t), z)); };
  const pts = [];
  const arc = (r, z) => { const s = Math.max(6, Math.ceil((a1 - a0) / 2)); for (let i = 0; i < s; i++) { pts.push(P(r, a0 + (a1 - a0) * i / s, z), P(r, a0 + (a1 - a0) * (i + 1) / s, z)); } };
  for (const z of [z0, z1]) { arc(r0, z); arc(r1, z); pts.push(P(r0, a0, z), P(r1, a0, z), P(r0, a1, z), P(r1, a1, z)); }
  for (const [r, a] of [[r0, a0], [r1, a0], [r0, a1], [r1, a1]]) pts.push(P(r, a, z0), P(r, a, z1));
  return new THREE.BufferGeometry().setFromPoints(pts);
}

export async function createTwin(container, opts) {
  const { logements, centers, floor0, elementLog, onPick, onHover, onFrame, onReady } = opts;
  const ui = { canvas: container.querySelector('[data-v="canvas"]'), status: container.querySelector('[data-v="status"]') };
  const setStatus = (t) => { if (ui.status) { ui.status.textContent = t || ''; ui.status.hidden = !t; } };
  setStatus('Chargement de la maquette');
  const { man, buf } = await fetchGeometry(opts.base || '../model/');
  setStatus('Allumage des logements');

  const N = logements.length;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.localClippingEnabled = true;
  ui.canvas.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Vue 3D de nuit des deux tours : chaque logement est éclairé selon sa consommation. Faites glisser pour tourner, pincez ou utilisez la molette pour zoomer, touchez un logement pour son détail.');

  const scene = new THREE.Scene();
  scene.background = gradientTexture();
  scene.fog = new THREE.FogExp2(0x0b1218, 0.0062);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 2500);
  scene.add(new THREE.HemisphereLight(0x3a5068, 0x07090b, 0.9));
  const moon = new THREE.DirectionalLight(0xa9c2ff, 1.1); moon.position.set(-60, 90, 40); scene.add(moon);
  const warm = new THREE.DirectionalLight(0xffb37a, 0.18); warm.position.set(50, 10, -60); scene.add(warm);

  const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
  const clips = [cut];

  // texture des logements : rgb = couleur, a = intensité (0–1)
  const texData = new Uint8Array(N * 4);
  const tex = new THREE.DataTexture(texData, N, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;

  // ---------- maquette
  const C = { A1: centers.A1, A2: centers.A2 };
  const groups = {};
  const DARK = {
    walls: 0x1c252d, floors: 0x161d23, frame: 0x1a2229, stairs: 0x182027, rail: 0x2a3945, generic: 0x202b34,
    parking: 0x10161b, ext: 0x0e1418, lt: 0x2a2620,
  };
  const idToRef = new Map();
  for (const g of man.groups) {
    if (g.name === 'found' || g.name === 'topo') continue;
    const i16 = new Int16Array(buf, g.byteOffset, g.byteLength / 2);
    const pos = new Float32Array(i16.length);
    for (let k = 0; k < i16.length; k += 3) { pos[k] = i16[k] / 100; pos[k + 1] = i16[k + 2] / 100; pos[k + 2] = -i16[k + 1] / 100; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const kind = g.name.includes('_') ? g.name.split('_')[1] : g.name;
    let mat;
    if (kind === 'openings') {
      const al = new Float32Array(pos.length / 3).fill(-1);
      for (const [rid, s, n, , ref] of g.elements) {
        const li = elementLog.get(ref);
        if (li == null) continue;
        al.fill(li, s * 3, (s + n) * 3);
      }
      geo.setAttribute('aLog', new THREE.BufferAttribute(al, 1));
      mat = glassMaterial(tex, N);
      mat.clippingPlanes = clips;
    } else {
      geo.computeVertexNormals();
      mat = new THREE.MeshStandardMaterial({ color: DARK[kind] ?? 0x1e262d, roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide,
        clippingPlanes: ['parking', 'ext'].includes(g.name) ? [] : clips, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    }
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = g.name;
    mesh.userData.elements = g.elements;
    for (const e of g.elements) idToRef.set(e[0], { g: g.name, s: e[1], n: e[2], ref: e[4] });
    scene.add(mesh);
    groups[g.name] = mesh;
  }
  if (groups.lt) groups.lt.visible = false;

  // sol
  const ground = new THREE.Mesh(new THREE.CircleGeometry(420, 96), groundMaterial());
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  const c1 = toThree(C.A1[0], C.A1[1], 0), c2 = toThree(C.A2[0], C.A2[1], 0);
  ground.material.uniforms.uC1.value.set(c1[0], c1[2]); ground.material.uniforms.uC2.value.set(c2[0], c2[2]);
  scene.add(ground);

  // anneaux des planchers (lecture des étages)
  const rings = new THREE.Group(); scene.add(rings);
  const ringMat = new THREE.LineBasicMaterial({ color: 0x5b7180, transparent: true, opacity: 0.45, clippingPlanes: clips });
  const ringSel = new THREE.LineBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.95 });
  const ringByFloor = {};
  for (const z of ['A1', 'A2']) {
    for (let n = 1; n <= 10; n++) {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const t = i / 128 * Math.PI * 2;
        pts.push(new THREE.Vector3(...toThree(C[z][0] + 13.12 * Math.cos(t), C[z][1] + 13.12 * Math.sin(t), floor0[z] + (n - 1) * STOREY - 0.02)));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat);
      rings.add(line);
      ringByFloor[`${z}-${n}`] = line;
    }
  }

  // logements
  const secGeo = sectorGeometry(logements, C, floor0);
  const secMat = sectorMaterial(tex, N);
  secMat.clippingPlanes = clips;
  const sectors = new THREE.Mesh(secGeo, secMat);
  sectors.renderOrder = 5;
  scene.add(sectors);
  const triLog = secGeo.attributes.aLog.array; // un aLog par sommet ; 3 sommets par triangle

  // surbrillance d'un équipement (CTA, capteurs) ou d'une sous-station
  const markGroup = new THREE.Group(); scene.add(markGroup);
  function elementBox(revitId) {
    const e = idToRef.get(revitId); if (!e) return null;
    const p = groups[e.g].geometry.attributes.position.array;
    const b = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let k = e.s * 9; k < (e.s + e.n) * 9; k += 3) b.expandByPoint(v.set(p[k], p[k + 1], p[k + 2]));
    return b;
  }

  // ---------- caméra
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 12; controls.maxDistance = 420; controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotateSpeed = 0.35;
  if (coarse) {
    // sur téléphone : un doigt vertical fait défiler la page, un doigt horizontal fait tourner, deux doigts zooment
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    renderer.domElement.style.touchAction = 'pan-y';
  }
  const mid = new THREE.Vector3((c1[0] + c2[0]) / 2, 14, (c1[2] + c2[2]) / 2);
  const towerC = { A1: new THREE.Vector3(c1[0], 15, c1[2]), A2: new THREE.Vector3(c2[0], 15, c2[2]) };
  const VIEWS = {
    ALL: { t: mid.clone(), p: mid.clone().add(new THREE.Vector3(92, 46, 84)) },
    A1: { t: towerC.A1.clone(), p: towerC.A1.clone().add(new THREE.Vector3(52, 24, 44)) },
    A2: { t: towerC.A2.clone(), p: towerC.A2.clone().add(new THREE.Vector3(52, 24, 44)) },
  };
  let tween = null;
  function flyTo(p, t, ms = 1100) {
    if (reduceMotion()) { camera.position.copy(p); controls.target.copy(t); controls.update(); return; }
    tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: p.clone(), t1: t.clone(), s: performance.now(), d: ms };
  }
  camera.position.copy(VIEWS.ALL.p).add(new THREE.Vector3(120, 90, 140));
  controls.target.copy(VIEWS.ALL.t);

  // ---------- post-traitement : halo des fenêtres et des logements
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.42, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const inset = { l: 0, r: 0 };
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w / (coarse ? 3 : 2), h / (coarse ? 3 : 2));
    camera.aspect = w / h;
    const shift = (inset.l - inset.r) / 2;
    if (shift) camera.setViewOffset(w, h, -shift, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  let lastSize = '';
  new ResizeObserver(() => { const k = `${container.clientWidth}x${container.clientHeight}`; if (k !== lastSize) { lastSize = k; resize(); } }).observe(container);
  resize();
  let onScreen = true;
  new IntersectionObserver((e) => { onScreen = e[0].isIntersecting; }, { threshold: 0.02 }).observe(container);

  // ---------- état
  const state = { floor: 0, tower: 'ALL', plan: false, sel: -1, hover: -1, idle: 0, lastInteract: performance.now() };
  function interacted() { state.lastInteract = performance.now(); controls.autoRotate = false; }
  controls.addEventListener('start', () => { interacted(); tween = null; });

  function applyCut() {
    if (state.floor > 0) {
      const z = Math.min(floor0.A1, floor0.A2) + state.floor * STOREY - 0.33;
      cut.constant = z;
    } else cut.constant = 1000;
    for (const [k, line] of Object.entries(ringByFloor)) {
      const n = +k.split('-')[1];
      line.material = (state.floor && n === state.floor) ? ringSel : ringMat;
    }
  }
  function frame(tower = state.tower, plan = state.plan) {
    const v = VIEWS[tower] || VIEWS.ALL;
    if (plan) {
      const t = (tower === 'ALL' ? mid : towerC[tower]).clone();
      t.y = (state.floor ? floor0.A2 + (state.floor - 1) * STOREY : 15);
      const h = tower === 'ALL' ? 150 : 68;
      flyTo(new THREE.Vector3(t.x + 0.01, t.y + h, t.z + (tower === 'ALL' ? 22 : 10)), t);
    } else if (state.floor) {
      const t = v.t.clone(); t.y = floor0.A2 + (state.floor - 1) * STOREY + 1;
      flyTo(t.clone().add(new THREE.Vector3(v.p.x - v.t.x, (tower === 'ALL' ? 52 : 34), v.p.z - v.t.z).multiplyScalar(0.9)), t);
    } else flyTo(v.p, v.t);
  }

  // ---------- sélection, survol
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let outline = null;
  function pickAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(sectors, false);
    for (const h of hits) {
      if (state.floor && h.point.y > cut.constant) continue;
      const li = triLog[h.face.a];
      const l = logements[li];
      if (state.floor && l.etage !== state.floor) continue;
      if (state.tower !== 'ALL' && l.tour !== state.tower) continue;
      return li;
    }
    return -1;
  }
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; interacted(); });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const li = pickAt(e);
    onPick?.(li >= 0 ? logements[li].id : null);
  });
  let hoverT = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const now = performance.now(); if (now - hoverT < 40) return; hoverT = now;
    const li = pickAt(e);
    if (li !== state.hover) { state.hover = li; secMat.uniforms.uHover.value = li; }
    const r = renderer.domElement.getBoundingClientRect();
    onHover?.(li >= 0 ? logements[li].id : null, e.clientX - r.left, e.clientY - r.top);
  });
  renderer.domElement.addEventListener('pointerleave', () => { state.hover = -1; secMat.uniforms.uHover.value = -1; onHover?.(null); });

  function select(id, fly = true) {
    if (outline) { scene.remove(outline); outline.geometry.dispose(); outline = null; }
    const li = id ? logements.findIndex(l => l.id === id) : -1;
    state.sel = li; secMat.uniforms.uSel.value = li;
    if (li < 0) return;
    const l = logements[li];
    outline = new THREE.LineSegments(sectorOutline(l, C, floor0), new THREE.LineBasicMaterial({ color: 0xff3d8b, transparent: true, opacity: 1, depthTest: false }));
    outline.renderOrder = 10;
    scene.add(outline);
    if (fly) {
      const t = l._center.clone().lerp(new THREE.Vector3(towerC[l.tour].x, l._center.y, towerC[l.tour].z), 0.45);
      const dir = l._top.clone().sub(towerC[l.tour]).setY(0).normalize();
      const p = t.clone().add(dir.multiplyScalar(state.plan ? 4 : 78)).add(new THREE.Vector3(0, state.plan ? 70 : 10, 0));
      if (!state.plan) flyTo(p, t, 1100);
      interacted();
    }
  }
  function focusPoint(v, dist = 34) {
    const d = camera.position.clone().sub(v).setY(0).normalize();
    flyTo(v.clone().add(d.multiplyScalar(dist)).add(new THREE.Vector3(0, dist * 0.55, 0)), v, 1000);
    interacted();
  }
  function markElement(revitId) {
    markGroup.clear();
    if (!revitId) return null;
    const b = elementBox(revitId); if (!b) return null;
    const box = new THREE.Box3Helper(b.expandByScalar(0.35), 0xff3d8b); box.material.transparent = true;
    markGroup.add(box);
    return b.getCenter(new THREE.Vector3());
  }

  // ---------- boucle
  const clock = new THREE.Clock();
  const v3 = new THREE.Vector3();
  let first = true;
  function project(vec) {
    v3.copy(vec).project(camera);
    const r = renderer.domElement;
    const behind = v3.z > 1;
    if (state.floor && vec.y > cut.constant + 0.5) return null;
    return { x: (v3.x * 0.5 + 0.5) * r.clientWidth, y: (-v3.y * 0.5 + 0.5) * r.clientHeight, hidden: behind };
  }
  function loop() {
    requestAnimationFrame(loop);
    if (!first && (!onScreen || document.hidden)) return;
    const t = clock.getElapsedTime();
    secMat.uniforms.uTime.value = t;
    if (tween) {
      const k = Math.min(1, (performance.now() - tween.s) / tween.d), e = ease(k);
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
      if (k >= 1) tween = null;
    }
    if (!reduceMotion() && !tween && performance.now() - state.lastInteract > 14000 && !state.plan) controls.autoRotate = true;
    if (outline) outline.material.opacity = 0.65 + 0.35 * Math.sin(t * 4);
    controls.update();
    composer.render();
    onFrame?.(project);
    if (first) { first = false; setStatus(''); onReady?.(); }
  }
  // entrée en scène
  flyTo(VIEWS.ALL.p, VIEWS.ALL.t, reduceMotion() ? 0 : 2600);
  loop();

  return {
    setColors(arr) { texData.set(arr); tex.needsUpdate = true; },
    setInsets(l, r) { if (l === inset.l && r === inset.r) return; inset.l = l; inset.r = r; resize(); },
    setFloor(n, fly = true) { state.floor = n; applyCut(); if (fly) frame(); interacted(); },
    setTower(z) { state.tower = z; frame(); interacted(); },
    setPlan(on) { state.plan = on; controls.autoRotate = false; frame(); interacted(); },
    reset() { state.plan = false; frame('ALL', false); interacted(); },
    select, focusPoint, markElement,
    towerBase(z) { return new THREE.Vector3(towerC[z].x, 1.2, towerC[z].z); },
    roofOf(z) { return new THREE.Vector3(towerC[z].x, 32.5, towerC[z].z); },
    logementPoint(id) { const l = logements.find(x => x.id === id); return l ? l._top.clone() : null; },
    get state() { return state; },
    fullscreen() {
      const el = container.closest('.twin') || container;
      if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.();
    },
  };
}
