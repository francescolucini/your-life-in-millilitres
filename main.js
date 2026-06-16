import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { RGBELoader } from './vendor/RGBELoader.js';

// =====================================================================
// MODEL / NUMBERS  (Delft student day — see sidebar for sources)
// =====================================================================
const ML_PER_HOUR = TOTAL_ML_per_hour();
function TOTAL_ML_per_hour() { return 330 / 24; } // 13.75 ml/h
const TOTAL_ML = 330;
const OBLIGATIONS = [
  { label: 'Sleeping',           ml: 110 },
  { label: 'Working / studying', ml: 96  },
  { label: 'Commuting',          ml: 14  },
  { label: 'Cooking & cleaning', ml: 21  },
];
const FREE_ML = TOTAL_ML - OBLIGATIONS.reduce((s, o) => s + o.ml, 0); // 89

// =====================================================================
// LAYOUT CONSTANTS
// =====================================================================
const BASE = { w: 1.75, h: 2.7, d: 1.1 };
const FRONT_Z = BASE.d / 2;
const TANK = { r: 0.32, h: 1.5 };
const TANK_BOTTOM_Y = BASE.h + 0.05;
const TANK_INNER_BOTTOM = TANK_BOTTOM_Y + 0.05;
const TANK_INNER_H = TANK.h - 0.12;
const GLASS = { rTop: 0.21, rBot: 0.165, h: 0.72, innerTop: 0.19, innerBot: 0.15, innerH: 0.66 };
const GLASS_BASE_Y = 0.12;
const GLASS_X = 0;
const GLASS_Z = FRONT_Z + 0.18;
const GLASS_FLOOR_Y = GLASS_BASE_Y + 0.04;
const SPOUT_TIP_Y = 0.9;

// =====================================================================
// STATE
// =====================================================================
const state = {
  phase: 'idle',          // idle | input | draining | pour_ready | pouring | done
  age: 22,
  screenHours: 5.0,
  tankMl: TOTAL_ML,
  glassMl: 0,
  queue: [],
  step: null,
  done: [],               // [{label, ml}]
  freeReached: false,
  resultRemaining: 0,
  isHolding: false,
  dragging: null,
  time: 0,
};

// =====================================================================
// THREE SETUP
// =====================================================================
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Background: the IDE Kafee plaza at TU Delft — blurred, rotated, and
// cover-cropped to the viewport so it never stretches (esp. portrait mobile)
const bgImg = new Image();
let bgReady = false;
function buildBackground() {
  if (!bgReady) return;
  const aspect = Math.max(stage.clientWidth / Math.max(stage.clientHeight, 1), 0.05);
  const CW = 1280, CH = Math.max(1, Math.round(CW / aspect));
  const bc = document.createElement('canvas'); bc.width = CW; bc.height = CH;
  const bx = bc.getContext('2d');
  bx.filter = 'blur(44px)';
  // "cover" fit: fill the canvas while preserving aspect, plus extra so the
  // slight rotation and the blur kernel never expose empty edges
  const cover = Math.max(CW / bgImg.width, CH / bgImg.height) * 1.2;
  const dw = bgImg.width * cover, dh = bgImg.height * cover;
  bx.translate(CW / 2, CH / 2);
  bx.rotate(-0.055);
  bx.drawImage(bgImg, -dw / 2, -dh / 2, dw, dh);
  const tex = new THREE.CanvasTexture(bc);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (scene.background && scene.background.isTexture) scene.background.dispose();
  scene.background = tex;
}
bgImg.onload = () => { bgReady = true; buildBackground(); };
bgImg.src = './assets/delft.jpeg';

const camera = new THREE.PerspectiveCamera(33, stage.clientWidth / stage.clientHeight, 0.1, 100);
const CAM_BASE = new THREE.Vector3(0.9, 2.0, 9.5);
const CAM_TARGET = new THREE.Vector3(0, 2.05, 0);
function frameMachine() {
  const aspect = (isFinite(camera.aspect) && camera.aspect > 0.05) ? camera.aspect : 1;
  const vFOV = THREE.MathUtils.degToRad(camera.fov);
  const distH = (4.7 / 2) / Math.tan(vFOV / 2);
  const distW = (2.2 / 2) / Math.tan(vFOV / 2) / aspect;
  const dist = Math.min(Math.max(distH, distW) + 0.5, 16);
  CAM_BASE.set(dist * 0.12, 2.1, dist);
}
frameMachine();
camera.position.copy(CAM_BASE);
camera.lookAt(CAM_TARGET);

// Environment reflections (no external HDRI needed)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // fallback until the photo loads
// Reflections + ambient from the actual surroundings (the Delft IDE plaza) for coherence
new THREE.TextureLoader().load('./assets/delft.jpeg', (t) => {
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  scene.environment = pmrem.fromEquirectangular(t).texture;
});

// Lights
scene.add(new THREE.HemisphereLight(0xb8cfe0, 0xb39a7a, 0.55));
const key = new THREE.DirectionalLight(0xc8daf0, 2.2);
key.position.set(12, 2.8, 0.3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 30;
key.shadow.camera.left = -5; key.shadow.camera.right = 5;
key.shadow.camera.top = 6; key.shadow.camera.bottom = -1.5;
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xe8d8c0, 0.5);
rim.position.set(-4, 5, -5);
scene.add(rim);
const tankGlow = new THREE.PointLight(0xffcf6b, 45, 11, 2);
tankGlow.position.set(0, 3.4, -0.6);
scene.add(tankGlow);
const nicheLight = new THREE.PointLight(0xffe8c8, 0.5, 2.6, 2);
nicheLight.position.set(0, 1.0, FRONT_Z - 0.04);
scene.add(nicheLight);

// Ground
// Light-oak tabletop with bevelled edges
const tableTex = makeTableTextures();
const table = new THREE.Mesh(
  new RoundedBoxGeometry(7.5, 0.14, 3.2, 6, 0.06),
  new THREE.MeshStandardMaterial({
    map: tableTex.color,
    roughnessMap: tableTex.rough,
    roughness: 0.62,
    metalness: 0,
    bumpMap: tableTex.bump,
    bumpScale: 0.008,
    envMapIntensity: 0.5,
  })
);
table.position.set(0, -0.072, 0.45);
table.receiveShadow = true;
scene.add(table);

// =====================================================================
// MATERIALS
// =====================================================================
const brushedTex = makeBrushedTexture();
const matMetalDark = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 0.9, roughness: 0.55, roughnessMap: brushedTex, bumpMap: brushedTex, bumpScale: 0.004, envMapIntensity: 1.1 });
const matMetalTrim = new THREE.MeshStandardMaterial({ color: 0x9298a1, metalness: 1.0, roughness: 0.4, roughnessMap: brushedTex, bumpMap: brushedTex, bumpScale: 0.003, envMapIntensity: 1.2 });
const matAccent = new THREE.MeshStandardMaterial({ color: 0xe8a317, metalness: 0.5, roughness: 0.35, emissive: 0x3a2400, emissiveIntensity: 0.4 });
const matGlass = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, metalness: 0, roughness: 0.06, transmission: 1.0,
  ior: 1.5, thickness: 0.5, transparent: true, envMapIntensity: 1.7,
});
const matBeer = new THREE.MeshPhysicalMaterial({
  vertexColors: true, color: 0xffffff, metalness: 0.0, roughness: 0.05,
  transmission: 0.93, ior: 1.34, thickness: 0.28,
  attenuationColor: new THREE.Color(0xb8711a), attenuationDistance: 0.6,
  transparent: true, clearcoat: 0.15, clearcoatRoughness: 0.12,
  emissive: 0x3a2200, emissiveIntensity: 0.05,
});
matBeer.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
    float beerFres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 2.0);
    totalEmissiveRadiance += vec3(0.95, 0.52, 0.16) * beerFres * 1.4;`
  );
};
const matStream = new THREE.MeshStandardMaterial({ color: 0xe8be52, metalness: 0, roughness: 0.35, emissive: 0x8a5a18, emissiveIntensity: 0.25 });
const matFoam = new THREE.MeshStandardMaterial({ color: 0xfaf5e8, roughness: 0.95, metalness: 0 });
const matFoamTop = new THREE.MeshStandardMaterial({ color: 0xfcf8ee, roughness: 0.92, metalness: 0 });
// Transparent plastic cup (festival-style) — softer/cheaper than glass
const scratchTex = makeScratchTexture();
const matPlastic = new THREE.MeshPhysicalMaterial({ color: 0xe4e6e8, metalness: 0, roughness: 0.52, roughnessMap: scratchTex, bumpMap: scratchTex, bumpScale: 0.006, transmission: 0, transparent: true, opacity: 0.36, ior: 1.42, clearcoat: 0, depthWrite: false, envMapIntensity: 0.4 });
// Beer poured into the cup — opaque amber so it reads clearly (no transmission flicker)
const matBeerGlass = new THREE.MeshStandardMaterial({ color: 0xdca238, metalness: 0, roughness: 0.25, emissive: 0x7a4200, emissiveIntensity: 0.4 });

// Beer gradient (darker amber at bottom, golden at top) baked into vertex colors
function applyBeerGradient(geo) {
  geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y, span = Math.max(geo.boundingBox.max.y - minY, 1e-4);
  const pos = geo.attributes.position, n = pos.count;
  const colors = new Float32Array(n * 3);
  const cBot = new THREE.Color(0xb87420), cTop = new THREE.Color(0xdda946), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = (pos.getY(i) - minY) / span;
    c.copy(cBot).lerp(cTop, t * t * 0.9 + t * 0.1);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
// Soft round sprite for carbonation bubbles
function makeBubbleTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,232,0.95)');
  g.addColorStop(0.45, 'rgba(255,243,205,0.35)');
  g.addColorStop(1, 'rgba(255,243,205,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function roughenGeometry(geo, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const f = 1 + (Math.random() - 0.5) * amt;
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
  }
  p.needsUpdate = true; geo.computeVertexNormals();
}
function makeDropletTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
  const x = cv.getContext('2d'); x.clearRect(0, 0, 512, 512);
  for (let i = 0; i < 240; i++) {
    const r = 1 + Math.random() * 4, px = Math.random() * 512, py = Math.random() * 512;
    const a = 0.12 + Math.random() * 0.4;
    const g = x.createRadialGradient(px, py, 0, px, py, r * 2.2);
    g.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    g.addColorStop(0.5, 'rgba(220,232,240,' + (a * 0.5) + ')');
    g.addColorStop(1, 'rgba(220,232,240,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r * 2.2, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); return t;
}
function makeTableTextures() {
  const W = 1024, H = 1024;

  // --- Color: light oak, base tone + horizontal grain (along the table's long axis) ---
  const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
  const cx = cc.getContext('2d');
  const baseG = cx.createLinearGradient(0, 0, 0, H);
  baseG.addColorStop(0, '#d8bf95');
  baseG.addColorStop(0.5, '#c6a673');
  baseG.addColorStop(1, '#d2b88a');
  cx.fillStyle = baseG; cx.fillRect(0, 0, W, H);

  // grain streaks running along U (so they follow the table's length once mapped)
  for (let i = 0; i < 340; i++) {
    const y0 = Math.random() * H;
    const lineW = 0.5 + Math.random() * 2.4;
    const alpha = 0.05 + Math.random() * 0.22;
    cx.strokeStyle = Math.random() < 0.55
      ? `rgba(72, 44, 22, ${alpha})`
      : `rgba(232, 210, 175, ${alpha * 0.7})`;
    cx.lineWidth = lineW;
    cx.beginPath();
    let yy = y0; cx.moveTo(0, yy);
    const wob = 0.35 + Math.random() * 1.3;
    for (let x = 0; x <= W; x += 6) {
      yy += (Math.random() - 0.5) * wob;
      cx.lineTo(x, yy);
    }
    cx.stroke();
  }

  // a few knots
  for (let i = 0; i < 4; i++) {
    const kx = Math.random() * W, ky = Math.random() * H;
    const rad = 14 + Math.random() * 34;
    const g = cx.createRadialGradient(kx, ky, 0, kx, ky, rad);
    g.addColorStop(0, 'rgba(48, 28, 14, 0.78)');
    g.addColorStop(0.45, 'rgba(96, 60, 30, 0.45)');
    g.addColorStop(1, 'rgba(150, 110, 70, 0)');
    cx.fillStyle = g; cx.beginPath(); cx.arc(kx, ky, rad, 0, 7); cx.fill();
    cx.strokeStyle = 'rgba(60, 36, 18, 0.4)'; cx.lineWidth = 1;
    cx.beginPath(); cx.arc(kx, ky, rad * 0.55, 0, 7); cx.stroke();
  }

  // micro-noise so the finish doesn't read as plastic
  {
    const img = cx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      d[i]   = Math.max(0, Math.min(255, d[i]   + n));
      d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
      d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
    }
    cx.putImageData(img, 0, 0);
  }

  // --- Derive bump + roughness from color luminance ---
  const src = cx.getImageData(0, 0, W, H).data;

  const bc = document.createElement('canvas'); bc.width = W; bc.height = H;
  const bx = bc.getContext('2d');
  const bImg = bx.createImageData(W, H), bd = bImg.data;

  const rc = document.createElement('canvas'); rc.width = W; rc.height = H;
  const rx = rc.getContext('2d');
  const rImg = rx.createImageData(W, H), rd = rImg.data;

  for (let i = 0; i < src.length; i += 4) {
    const lum = 0.299 * src[i] + 0.587 * src[i+1] + 0.114 * src[i+2];
    bd[i] = bd[i+1] = bd[i+2] = lum; bd[i+3] = 255;
    const r = 135 + (255 - lum) * 0.35; // darker grain → rougher finish
    rd[i] = rd[i+1] = rd[i+2] = Math.min(255, r); rd[i+3] = 255;
  }
  bx.putImageData(bImg, 0, 0);
  rx.putImageData(rImg, 0, 0);

  const mk = (canvas, sRGB) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 1);
    t.colorSpace = sRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };

  return { color: mk(cc, true), bump: mk(bc, false), rough: mk(rc, false) };
}
function makeBrushedTexture() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 1024;
  const x = cv.getContext('2d');
  x.fillStyle = '#7c7c7c'; x.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 5000; i++) {
    const y = Math.random() * 1024;
    const g = 96 + Math.floor(Math.random() * 80);
    x.strokeStyle = 'rgba(' + g + ',' + g + ',' + g + ',0.5)';
    x.lineWidth = 0.5 + Math.random() * 1.2;
    x.beginPath(); x.moveTo(0, y); x.lineTo(1024, y); x.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
function makeScratchTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
  const x = cv.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 350; i++) {
    const sx = Math.random() * 512, sy = Math.random() * 512;
    const ex = sx + (Math.random() - 0.5) * 70, ey = sy + (Math.random() - 0.5) * 70;
    x.strokeStyle = `rgba(185,185,185,${0.08 + Math.random() * 0.22})`;
    x.lineWidth = 0.3 + Math.random() * 0.7;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(ex, ey); x.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const sx = Math.random() * 512, sy = Math.random() * 512;
    const ex = sx + (Math.random() - 0.5) * 35, ey = sy + (Math.random() - 0.5) * 35;
    x.strokeStyle = 'rgba(210,210,210,0.35)';
    x.lineWidth = 0.6 + Math.random() * 1.4;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(ex, ey); x.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3);
  t.colorSpace = THREE.NoColorSpace; return t;
}
const matDarkPanel = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0.3, roughness: 0.6 });

// =====================================================================
// BUILD MACHINE
// =====================================================================
const machine = new THREE.Group();
scene.add(machine);

// --- Base cabinet ---
// The body is recessed at the front by NICHE_DEPTH; a 4-piece frame rebuilds
// the front face around the dispense opening, so there's a real alcove.
const NICHE_DEPTH = 0.16;
const NICHE = { w: 0.92, y: 0.75, h: 1.30 }; // opening
const NICHE_X = NICHE.w / 2;                 // ±0.46
const NICHE_TOP = NICHE.y + NICHE.h / 2;     // 1.40
const NICHE_BOT = NICHE.y - NICHE.h / 2;     // 0.10
const bodyDepth = BASE.d - NICHE_DEPTH;
const base = new THREE.Mesh(new RoundedBoxGeometry(BASE.w, BASE.h, bodyDepth, 6, 0.08), matMetalDark);
base.position.set(0, BASE.h / 2, -NICHE_DEPTH / 2);
machine.add(base);

// Front frame (4 slabs) — leaves the niche opening as a hole through to the recessed body
const frameZ = FRONT_Z - NICHE_DEPTH / 2;
function frameSlab(w, h, x, y) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, NICHE_DEPTH, 4, 0.03), matMetalDark);
  m.position.set(x, y, frameZ);
  machine.add(m);
  return m;
}
const sideW = (BASE.w / 2 - NICHE_X);
frameSlab(sideW, BASE.h, -(NICHE_X + sideW / 2), BASE.h / 2);          // left
frameSlab(sideW, BASE.h,  (NICHE_X + sideW / 2), BASE.h / 2);          // right
frameSlab(NICHE.w, BASE.h - NICHE_TOP, 0, (NICHE_TOP + BASE.h) / 2);   // top
frameSlab(NICHE.w, NICHE_BOT, 0, NICHE_BOT / 2);                       // bottom

// Dark recessed back wall of the alcove
const matNiche = new THREE.MeshStandardMaterial({ color: 0x15181e, metalness: 0.7, roughness: 0.55, roughnessMap: brushedTex, bumpMap: brushedTex, bumpScale: 0.003, envMapIntensity: 0.3 });
const nicheBack = new THREE.Mesh(new THREE.PlaneGeometry(NICHE.w, NICHE.h), matNiche);
nicheBack.position.set(0, NICHE.y, FRONT_Z - NICHE_DEPTH + 0.004);
machine.add(nicheBack);

// Accent strip near top of base (sits on the frame face)
const strip = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.05, 0.06, 3, 0.02), matAccent);
strip.position.set(0, BASE.h - 0.02, FRONT_Z - 0.01);
machine.add(strip);

// --- Tank cradle ring on top of base ---
const cradle = new THREE.Mesh(new THREE.CylinderGeometry(TANK.r + 0.08, TANK.r + 0.12, 0.12, 48), matMetalTrim);
cradle.position.set(0, BASE.h + 0.04, 0);
machine.add(cradle);

// --- Transparent tank ---
const tankGlassMesh = new THREE.Mesh(new THREE.CylinderGeometry(TANK.r, TANK.r, TANK.h, 64, 1, true), matGlass);
tankGlassMesh.position.set(0, TANK_BOTTOM_Y + TANK.h / 2, 0);
machine.add(tankGlassMesh);
// tank metal cap
const cap = new THREE.Mesh(new THREE.CylinderGeometry(TANK.r + 0.06, TANK.r + 0.06, 0.14, 48), matMetalTrim);
cap.position.set(0, TANK_BOTTOM_Y + TANK.h + 0.02, 0);
machine.add(cap);
const capKnob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), matAccent);
capKnob.position.set(0, TANK_BOTTOM_Y + TANK.h + 0.13, 0);
machine.add(capKnob);

// Condensation droplets on the tank glass
const dropletTex = makeDropletTexture();
const condensation = new THREE.Mesh(
  new THREE.CylinderGeometry(TANK.r + 0.004, TANK.r + 0.004, TANK.h * 0.94, 64, 1, true),
  new THREE.MeshStandardMaterial({ map: dropletTex, alphaMap: dropletTex, transparent: true, opacity: 0.35, roughness: 0.4, metalness: 0, depthWrite: false })
);
condensation.position.set(0, TANK_BOTTOM_Y + TANK.h / 2, 0);
condensation.renderOrder = 6;
machine.add(condensation);

// --- Beer inside tank ---
const BEER_R = TANK.r - 0.05;
const beerGeo = new THREE.CylinderGeometry(BEER_R, BEER_R, TANK_INNER_H, 48);
beerGeo.translate(0, TANK_INNER_H / 2, 0); // pivot at bottom
applyBeerGradient(beerGeo);
const beer = new THREE.Mesh(beerGeo, matBeer);
beer.position.y = TANK_INNER_BOTTOM;
machine.add(beer);

// Backlight panel hidden behind the beer so transmission glows (instead of sampling black bg)
const backGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(0.46, TANK_INNER_H),
  new THREE.MeshBasicMaterial({ color: 0xd9a050 })
);
backGlow.position.set(0, TANK_INNER_BOTTOM + TANK_INNER_H / 2, -0.30);
machine.add(backGlow);

// Foam residue rings left on tank wall as beer drops
const matFoamRing = new THREE.MeshStandardMaterial({ color: 0xf5edd6, roughness: 1.0, metalness: 0, transparent: true, opacity: 0.4, depthWrite: false });
const foamRingFracs = [0.88, 0.72, 0.55, 0.38, 0.22];
const foamRings = foamRingFracs.map(frac => {
  const y = TANK_INNER_BOTTOM + TANK_INNER_H * frac;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(BEER_R + 0.01, 0.008, 8, 48),
    matFoamRing
  );
  ring.position.set(0, y, 0);
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  machine.add(ring);
  return { mesh: ring, frac };
});

// Foam head: skirt (dips into beer, no gap) + single dome (no visible layers)
const beerFoam = new THREE.Group();
const foamSkirt = new THREE.Mesh(new THREE.CylinderGeometry(BEER_R + 0.02, BEER_R, 0.09, 40), matFoam);
foamSkirt.position.y = -0.03; // overlaps the beer surface so no see-through band
const foamDome = new THREE.Mesh(
  new THREE.SphereGeometry(BEER_R + 0.02, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.5),
  matFoamTop
);
roughenGeometry(foamDome.geometry, 0.04);
foamDome.scale.y = 0.6;
foamDome.position.y = 0.012;
const foamDomeBase = foamDome.geometry.attributes.position.array.slice();
beerFoam.add(foamSkirt, foamDome);
machine.add(beerFoam);

// Carbonation bubbles rising through the beer column
const BUBBLES = 90, BUBBLE_R = 0.20;
const bubblePos = new Float32Array(BUBBLES * 3), bubbleSpd = new Float32Array(BUBBLES);
function seedBubble(i, y) {
  const r = BUBBLE_R * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
  bubblePos[i * 3] = Math.cos(a) * r; bubblePos[i * 3 + 1] = y; bubblePos[i * 3 + 2] = Math.sin(a) * r;
  bubbleSpd[i] = 0.12 + Math.random() * 0.34;
}
for (let i = 0; i < BUBBLES; i++) seedBubble(i, Math.random() * TANK_INNER_H);
const bubbleGeo = new THREE.BufferGeometry();
bubbleGeo.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
const bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({
  size: 0.045, map: makeBubbleTexture(), transparent: true, opacity: 0.7,
  depthTest: false, depthWrite: false, sizeAttenuation: true,
}));
bubbles.position.set(0, TANK_INNER_BOTTOM, 0);
bubbles.renderOrder = 12;
machine.add(bubbles);
function updateBubbles(dt) {
  const f = THREE.MathUtils.clamp(state.tankMl / TOTAL_ML, 0, 1);
  if (f <= 0.02) { bubbles.visible = false; return; }
  bubbles.visible = true;
  const surf = TANK_INNER_H * f - 0.02;
  for (let i = 0; i < BUBBLES; i++) {
    bubblePos[i * 3 + 1] += bubbleSpd[i] * dt;
    if (bubblePos[i * 3 + 1] > surf) seedBubble(i, 0.02 + Math.random() * 0.05);
  }
  bubbleGeo.attributes.position.needsUpdate = true;
}

// --- Screen ---
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 1024; screenCanvas.height = 768;
const sctx = screenCanvas.getContext('2d');
const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
const SCREEN_W = 1.25, SCREEN_H = SCREEN_W * 768 / 1024;
const screenMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
  new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false })
);
screenMesh.position.set(0, 2.0, FRONT_Z + 0.05);
machine.add(screenMesh);
// screen bezel
const bezel = new THREE.Mesh(new RoundedBoxGeometry(SCREEN_W + 0.12, SCREEN_H + 0.12, 0.06, 4, 0.03), matMetalTrim);
bezel.position.set(0, 2.0, FRONT_Z - 0.005);
machine.add(bezel);

// --- Tap (bar tap with lever) ---
const tap = new THREE.Group();
machine.add(tap);
const tapBody = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.32, 24), matMetalTrim);
tapBody.position.set(0, 1.03, FRONT_Z + 0.12);
tap.add(tapBody);
const tapElbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 16), matMetalTrim);
tapElbow.position.set(0, 1.16, FRONT_Z + 0.12);
tap.add(tapElbow);
const tapSpout = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.2, 24), matMetalTrim);
tapSpout.position.set(0, SPOUT_TIP_Y + 0.1, FRONT_Z + 0.18);
tap.add(tapSpout);
// lever (grabbable)
const leverPivot = new THREE.Group();
leverPivot.position.set(0, 1.17, FRONT_Z + 0.12);
tap.add(leverPivot);
const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.24, 20), matMetalTrim);
lever.position.set(0, 0.12, 0);
leverPivot.add(lever);
const matRubber = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.9, metalness: 0 });
const leverKnob = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.22, 6, 16), matRubber);
leverKnob.position.set(0, 0.32, 0);
leverPivot.add(leverKnob);
// invisible, enlarged hit target so the tap is easy to grab (esp. on touch)
const leverHit = new THREE.Mesh(
  new THREE.BoxGeometry(0.22, 0.5, 0.22),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
);
leverHit.position.set(0, 0.26, 0);
leverPivot.add(leverHit);

// --- Drinking glass ---
const glassMesh = new THREE.Mesh(new THREE.CylinderGeometry(GLASS.rTop, GLASS.rBot, GLASS.h, 48, 1, true), matPlastic);
glassMesh.position.set(GLASS_X, GLASS_BASE_Y + GLASS.h / 2, GLASS_Z);
machine.add(glassMesh);
const glassBottom = new THREE.Mesh(new THREE.CylinderGeometry(GLASS.rBot, GLASS.rBot * 0.96, 0.03, 48), matPlastic);
glassBottom.position.set(GLASS_X, GLASS_BASE_Y + 0.015, GLASS_Z);
machine.add(glassBottom);
// beer in glass — geometry rebuilt each frame to follow the tapered glass shape
const matBeerInGlass = new THREE.MeshStandardMaterial({
  color: 0x8a5c18, metalness: 0, roughness: 0.12,
  transparent: true, opacity: 0.62,
  emissive: 0x3a1e00, emissiveIntensity: 0.35,
});
const glassBeerGeo = new THREE.CylinderGeometry(GLASS.innerBot, GLASS.innerBot - 0.003, 0.001, 40);
glassBeerGeo.translate(0, 0.0005, 0);
const glassBeer = new THREE.Mesh(glassBeerGeo, matBeerInGlass);
glassBeer.position.set(GLASS_X, GLASS_FLOOR_Y, GLASS_Z);
machine.add(glassBeer);
// backlight for glass beer transmission
const glassBackGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(0.28, GLASS.innerH),
  new THREE.MeshBasicMaterial({ color: 0xd9a050 })
);
glassBackGlow.position.set(GLASS_X, GLASS_FLOOR_Y + GLASS.innerH / 2, GLASS_Z - 0.16);
glassBackGlow.visible = false;
machine.add(glassBackGlow);
const glassFoam = new THREE.Group();
const GFOAM_R = GLASS.innerTop - 0.004; // built at the widest radius, scaled down per frame
const gFoamDome = new THREE.Mesh(
  new THREE.SphereGeometry(GFOAM_R, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
  matFoamTop
);
roughenGeometry(gFoamDome.geometry, 0.04);
gFoamDome.scale.y = 0.22;
const gFoamDomeBase = gFoamDome.geometry.attributes.position.array.slice();
const gFoamCap = new THREE.Mesh(new THREE.CircleGeometry(GFOAM_R, 28), matFoam);
gFoamCap.rotation.x = -Math.PI / 2;
glassFoam.add(gFoamDome, gFoamCap);
glassFoam.position.set(GLASS_X, GLASS_FLOOR_Y, GLASS_Z);
machine.add(glassFoam);
// carbonation bubbles in glass
const GLASS_BUBBLES = 35;
const glassBubblePos = new Float32Array(GLASS_BUBBLES * 3), glassBubbleSpd = new Float32Array(GLASS_BUBBLES);
const bubbleTex = makeBubbleTexture();
function seedGlassBubble(i, y) {
  const r = 0.10 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
  glassBubblePos[i * 3] = Math.cos(a) * r; glassBubblePos[i * 3 + 1] = y; glassBubblePos[i * 3 + 2] = Math.sin(a) * r;
  glassBubbleSpd[i] = 0.06 + Math.random() * 0.18;
}
for (let i = 0; i < GLASS_BUBBLES; i++) seedGlassBubble(i, Math.random() * GLASS.innerH * 0.4);
const glassBubbleGeo = new THREE.BufferGeometry();
glassBubbleGeo.setAttribute('position', new THREE.BufferAttribute(glassBubblePos, 3));
const glassBubbles = new THREE.Points(glassBubbleGeo, new THREE.PointsMaterial({
  size: 0.028, map: bubbleTex, transparent: true, opacity: 0.55,
  depthTest: false, depthWrite: false, sizeAttenuation: true,
}));
glassBubbles.position.set(GLASS_X, GLASS_FLOOR_Y, GLASS_Z);
glassBubbles.renderOrder = 12;
glassBubbles.visible = false;
machine.add(glassBubbles);
// glass tray
const tray = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.04, 0.34, 3, 0.02), matMetalTrim);
tray.position.set(0, GLASS_BASE_Y - 0.02, FRONT_Z + 0.14);
machine.add(tray);

// --- Pour stream (thicker, with foamy sheath) ---
const pourStream = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 1, 14), matStream);
pourStream.position.set(GLASS_X, 0.6, GLASS_Z);
pourStream.visible = false;
const matStreamFoam = new THREE.MeshStandardMaterial({ color: 0xf5edd6, metalness: 0, roughness: 0.8, transparent: true, opacity: 0.45 });
const pourFoam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 1, 12), matStreamFoam);
pourFoam.position.set(GLASS_X, 0.6, GLASS_Z);
pourFoam.visible = false;
machine.add(pourStream);
machine.add(pourFoam);

// =====================================================================
// MICRO DETAILS
// =====================================================================
const matScrew = new THREE.MeshStandardMaterial({ color: 0x6a6f78, metalness: 1.0, roughness: 0.38 });
const matVent = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.6 });
const matSlat = new THREE.MeshStandardMaterial({ color: 0x4a4e56, metalness: 1.0, roughness: 0.42 });

// Corner screws on the front panel (head + slot)
function addScrew(x, y) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.012, 20), matScrew);
  head.rotation.x = Math.PI / 2;
  g.add(head);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.006, 0.005), matMetalDark);
  slot.position.z = 0.007; slot.rotation.z = Math.PI / 4;
  g.add(slot);
  g.position.set(x, y, FRONT_Z + 0.004);
  machine.add(g);
}
addScrew(-0.76, 0.18); addScrew(0.76, 0.18); addScrew(-0.76, 2.52); addScrew(0.76, 2.52);

// Engraved brand monogram between screen and niche
const logoCanvas = document.createElement('canvas'); logoCanvas.width = 1024; logoCanvas.height = 96;
const lx = logoCanvas.getContext('2d');
lx.fillStyle = '#41454d'; lx.font = '600 40px "Helvetica Neue", Arial, sans-serif';
lx.textAlign = 'center'; lx.textBaseline = 'middle';
lx.fillText('Behavioural design', 512, 52);
const logoTex = new THREE.CanvasTexture(logoCanvas); logoTex.colorSpace = THREE.SRGBColorSpace;
const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.056), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true }));
logo.position.set(0, 2.585, FRONT_Z + 0.006);
machine.add(logo);


// Cooling vents on the visible (right) side
for (let i = 0; i < 6; i++) {
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.5), matVent);
  v.position.set(BASE.w / 2 + 0.001, 0.55 + i * 0.085, -0.02);
  machine.add(v);
}

// Drip-tray grille slats under the glass
for (let i = 0; i < 7; i++) {
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.018), matSlat);
  s.position.set(GLASS_X, GLASS_BASE_Y - 0.004, FRONT_Z + 0.055 + i * 0.034);
  machine.add(s);
}

// Soft contact shadow grounding the machine on the table
const csCv = document.createElement('canvas'); csCv.width = 256; csCv.height = 256;
const cc = csCv.getContext('2d');
const cg = cc.createRadialGradient(128, 128, 12, 128, 128, 128);
cg.addColorStop(0, 'rgba(0,0,0,0.5)'); cg.addColorStop(0.55, 'rgba(0,0,0,0.22)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
cc.fillStyle = cg; cc.fillRect(0, 0, 256, 256);
const csTex = new THREE.CanvasTexture(csCv);
const contactShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(2.7, 1.9),
  new THREE.MeshBasicMaterial({ map: csTex, transparent: true, depthWrite: false })
);
contactShadow.rotation.x = -Math.PI / 2;
contactShadow.position.set(0, 0.004, 0.06);
machine.add(contactShadow);

// =====================================================================
// VISUAL UPDATERS
// =====================================================================
function setTankLevel(ml) {
  const f = THREE.MathUtils.clamp(ml / TOTAL_ML, 0, 1);
  beer.scale.y = Math.max(f, 0.0001);
  const top = TANK_INNER_BOTTOM + TANK_INNER_H * f;
  beerFoam.position.y = top;
  beerFoam.visible = f > 0.015;
  beer.visible = f > 0.002;
  backGlow.scale.y = Math.max(f, 0.0001);
  backGlow.position.y = TANK_INNER_BOTTOM + TANK_INNER_H * f / 2;
  backGlow.visible = f > 0.01;
  for (const ring of foamRings) ring.mesh.visible = f < ring.frac && f > 0.01;
}
function glassFillHeight(ml) {
  // 330 ml maps to a full glass; 89 ml → ~27% (just under a third)
  return THREE.MathUtils.clamp((ml / TOTAL_ML) * GLASS.innerH, 0, GLASS.innerH);
}
let lastGlassMl = -1;
function setGlassLevel(ml) {
  const h = glassFillHeight(ml);
  if (ml > 0.2) {
    glassBeer.visible = true;
    // rebuild the tapered beer column only when the level actually changed
    if (Math.abs(ml - lastGlassMl) > 0.05) {
      const fillFrac = THREE.MathUtils.clamp(h / GLASS.innerH, 0.001, 1);
      const rTop = GLASS.innerBot + (GLASS.innerTop - GLASS.innerBot) * fillFrac - 0.003;
      const rBot = GLASS.innerBot - 0.003;
      glassBeer.geometry.dispose();
      const hh = Math.max(h, 0.001);
      const geo = new THREE.CylinderGeometry(rTop, rBot, hh, 40);
      geo.translate(0, hh / 2, 0);
      glassBeer.geometry = geo;
      lastGlassMl = ml;
    }
  } else {
    glassBeer.visible = false;
    lastGlassMl = -1;
  }
  const top = GLASS_FLOOR_Y + h;
  glassFoam.position.y = top;
  glassFoam.visible = ml > 1;
  // foam widens to match the glass wall at the current fill height
  const fillFrac2 = THREE.MathUtils.clamp(h / GLASS.innerH, 0, 1);
  const rTopFoam = GLASS.innerBot + (GLASS.innerTop - GLASS.innerBot) * fillFrac2 - 0.003;
  const foamScale = rTopFoam / GFOAM_R;
  glassFoam.scale.set(foamScale, 1, foamScale);
  glassBackGlow.visible = ml > 1;
  glassBackGlow.scale.y = Math.max(h / GLASS.innerH, 0.0001);
  glassBackGlow.position.y = GLASS_FLOOR_Y + h / 2;
}
function updateGlassBubbles(dt) {
  if (state.glassMl <= 1) { glassBubbles.visible = false; return; }
  glassBubbles.visible = true;
  const h = glassFillHeight(state.glassMl);
  for (let i = 0; i < GLASS_BUBBLES; i++) {
    glassBubblePos[i * 3 + 1] += glassBubbleSpd[i] * dt;
    if (glassBubblePos[i * 3 + 1] > h - 0.02) seedGlassBubble(i, 0.01 + Math.random() * 0.03);
  }
  glassBubbleGeo.attributes.position.needsUpdate = true;
}
function updatePourStream() {
  const pouring = state.phase === 'pouring' && state.isHolding && state.tankMl > 0.05;
  pourStream.visible = pouring;
  pourFoam.visible = pouring;
  if (pouring) {
    const gTop = GLASS_FLOOR_Y + glassFillHeight(state.glassMl);
    const top = SPOUT_TIP_Y;
    const h = Math.max(top - gTop, 0.02);
    pourStream.scale.y = h;
    pourStream.position.y = gTop + h / 2;
    pourFoam.scale.y = h;
    pourFoam.position.y = gTop + h / 2;
  }
}

// =====================================================================
// SCREEN UI (2D canvas drawn onto the machine's screen)
// =====================================================================
const C = { w: 1024, h: 768 };
const UI = {
  ageSlider: { x: 200, y: 300, w: 624 },
  slider:    { x: 200, y: 520, w: 624 },
  start:     { x: 312, y: 624, w: 400, h: 96 },
  restart:   { x: 312, y: 640, w: 400, h: 80 },
};

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function bg() {
  const g = sctx.createLinearGradient(0, 0, 0, C.h);
  g.addColorStop(0, '#0e0f13');
  g.addColorStop(1, '#050506');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, C.w, C.h);
}
function center(text, y, size, color, weight = '700') {
  sctx.fillStyle = color;
  sctx.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText(text, C.w / 2, y);
}

function drawScreen() {
  bg();
  const t = state.time;
  if (state.phase === 'idle') {
    center('YOUR LIFE', 250, 92, '#e8e6e0');
    center('IN MILLILITRES', 340, 72, '#e8a317');
    center('330 ml. The same for everyone.', 440, 30, '#8a8780', '400');
    const pulse = 0.55 + 0.45 * Math.sin(t * 3);
    sctx.globalAlpha = pulse;
    center('TOUCH TO START', 600, 40, '#e8e6e0');
    sctx.globalAlpha = 1;
  } else if (state.phase === 'input') {
    center('SET YOURSELF UP', 96, 34, '#8a8780', '600');
    center('YOUR AGE', 196, 28, '#8a8780', '600');
    drawSlider(UI.ageSlider, (state.age - 16) / 64, String(state.age));
    center('DAILY SCREEN TIME', 416, 28, '#8a8780', '600');
    const ml = Math.round(state.screenHours * ML_PER_HOUR);
    drawSlider(UI.slider, state.screenHours / 12, `${state.screenHours.toFixed(1)} h  ·  ${ml} ml`);
    drawRectBtn(UI.start, 'START');
  } else if (state.phase === 'draining') {
    center('YOUR LIFE', 80, 26, '#8a8780', '600');
    center(`${Math.round(state.tankMl)} ml`, 170, 120, '#e8a317');
    // done list
    sctx.textAlign = 'left'; sctx.textBaseline = 'alphabetic';
    let y = 300;
    for (const d of state.done) {
      sctx.font = '400 30px "Helvetica Neue", Arial, sans-serif';
      sctx.fillStyle = d.free ? '#e8a317' : '#8a8780';
      sctx.fillText(d.free ? 'Free time' : d.label, 200, y);
      sctx.textAlign = 'right';
      sctx.fillStyle = d.free ? '#e8a317' : '#cfcdc7';
      sctx.fillText(d.free ? `${d.value} ml` : `−${d.ml} ml`, 824, y);
      sctx.textAlign = 'left';
      y += 50;
    }
    // current
    if (state.step) {
      sctx.font = '700 34px "Helvetica Neue", Arial, sans-serif';
      sctx.fillStyle = '#e8e6e0';
      const lbl = state.step.kind === 'free' ? 'Free time' : (state.step.kind === 'screen' ? 'Screen time' : state.step.label);
      sctx.fillText(lbl, 200, y + 6);
      sctx.textAlign = 'right';
      sctx.fillStyle = '#e8a317';
      const sub = state.step.kind === 'free' ? `${state.step.value} ml` : `−${state.step.ml} ml`;
      sctx.fillText(sub, 824, y + 6);
      sctx.textAlign = 'left';
    }
  } else if (state.phase === 'pour_ready' || state.phase === 'pouring') {
    const rem = Math.round(state.phase === 'pouring' ? state.glassMl : state.resultRemaining);
    center(state.resultRemaining <= 0 ? 'NOTHING LEFT' : 'POUR YOUR BEER', 200, 56, '#e8a317');
    center(`${rem} ml`, 360, 130, '#e8e6e0');
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    sctx.globalAlpha = pulse;
    center(state.isHolding ? 'KEEP HOLDING…' : 'HOLD THE TAP ↓', 560, 36, '#8a8780', '600');
    sctx.globalAlpha = 1;
  } else if (state.phase === 'done') {
    const rem = Math.round(state.resultRemaining);
    if (rem <= 0) {
      center('0 ml.', 220, 110, '#e8a317');
      center('Your phone drank all of it.', 360, 38, '#e8e6e0', '600');
    } else {
      center(`${rem} ml`, 210, 120, '#e8a317');
      center('of free time left to spend', 330, 36, '#e8e6e0', '600');
      center('with your friends and family.', 380, 36, '#e8e6e0', '600');
    }
    center('Drink it wisely.', 500, 40, '#8a8780', '400');
    drawRectBtn(UI.restart, 'RESTART');
  }
  screenTex.needsUpdate = true;
}

function drawCircleBtn(b, label) {
  sctx.fillStyle = '#1a1c22';
  sctx.strokeStyle = '#3b4150'; sctx.lineWidth = 3;
  sctx.beginPath(); sctx.arc(b.cx, b.cy, b.r, 0, 7); sctx.fill(); sctx.stroke();
  center(label, b.cy, 52, '#e8e6e0');
}
function drawRectBtn(b, label) {
  rr(sctx, b.x, b.y, b.w, b.h, 16);
  sctx.fillStyle = '#e8a317'; sctx.fill();
  sctx.fillStyle = '#0a0a0a';
  sctx.font = '700 40px "Helvetica Neue", Arial, sans-serif';
  sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
  sctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
}
function drawSlider(b, frac, valueText) {
  sctx.strokeStyle = '#2a2c33'; sctx.lineWidth = 10; sctx.lineCap = 'round';
  sctx.beginPath(); sctx.moveTo(b.x, b.y); sctx.lineTo(b.x + b.w, b.y); sctx.stroke();
  const kx = b.x + b.w * THREE.MathUtils.clamp(frac, 0, 1);
  sctx.strokeStyle = '#e8a317';
  sctx.beginPath(); sctx.moveTo(b.x, b.y); sctx.lineTo(kx, b.y); sctx.stroke();
  sctx.fillStyle = '#e8a317'; sctx.beginPath(); sctx.arc(kx, b.y, 22, 0, 7); sctx.fill();
  center(valueText, b.y - 54, 40, '#e8e6e0', '700');
}

// =====================================================================
// FLOW
// =====================================================================
function startDraining() {
  state.done = [];
  state.queue = [];
  state.freeReached = false;
  let lvl = TOTAL_ML;
  for (const o of OBLIGATIONS) {
    state.queue.push({ kind: 'obligation', label: o.label, ml: o.ml, from: lvl, to: lvl - o.ml, dur: 2.4, t: 0 });
    lvl -= o.ml;
  }
  state.queue.push({ kind: 'free', value: lvl, from: lvl, to: lvl, dur: 1.8, t: 0 });
  const screenMl = Math.round(state.screenHours * ML_PER_HOUR);
  const rem = Math.max(0, lvl - screenMl);
  state.queue.push({ kind: 'screen', label: 'Screen time', ml: screenMl, from: lvl, to: rem, dur: 2.6, t: 0 });
  state.resultRemaining = rem;
  state.phase = 'draining';
  nextStep();
}
function nextStep() {
  if (state.step) {
    if (state.step.kind === 'free') {
      state.done.push({ free: true, value: state.step.value });
      state.freeReached = true;
    } else if (state.step.kind === 'screen') {
      state.done.push({ label: 'Screen time', ml: state.step.ml });
    } else {
      state.done.push({ label: state.step.label, ml: state.step.ml });
    }
  }
  if (state.queue.length === 0) {
    state.tankMl = state.resultRemaining;
    state.phase = 'pour_ready';
    state.step = null;
    return;
  }
  state.step = state.queue.shift();
  state.step.t = 0;
}
function resetMachine() {
  state.phase = 'idle';
  state.tankMl = TOTAL_ML;
  state.glassMl = 0;
  state.done = [];
  state.step = null;
  state.queue = [];
  state.isHolding = false;
}

// =====================================================================
// UPDATE LOOP
// =====================================================================
function update(dt) {
  state.time += dt;
  if (state.phase === 'draining' && state.step) {
    state.step.t += dt;
    const k = THREE.MathUtils.clamp(state.step.t / state.step.dur, 0, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOut
    state.tankMl = THREE.MathUtils.lerp(state.step.from, state.step.to, e);
    if (k >= 1) nextStep();
  }
  if (state.phase === 'pouring' && state.isHolding) {
    if (state.resultRemaining <= 0 || state.tankMl <= 0.05) {
      state.glassMl = state.resultRemaining;
      state.tankMl = Math.max(0, state.tankMl);
      state.phase = 'done';
    } else {
      const d = Math.min(20 * dt, state.tankMl, state.resultRemaining - state.glassMl);
      state.tankMl -= d;
      state.glassMl += d;
      if (state.glassMl >= state.resultRemaining - 0.05) {
        state.glassMl = state.resultRemaining;
        state.phase = 'done';
      }
    }
  }
  // lever tilt
  const targetTilt = (state.phase === 'pouring' && state.isHolding) ? 0.55 : 0;
  leverPivot.rotation.x = THREE.MathUtils.lerp(leverPivot.rotation.x, targetTilt, 0.18);
  // visuals
  setTankLevel(state.tankMl);
  setGlassLevel(state.glassMl);
  updatePourStream();
  updateBubbles(dt);
  updateGlassBubbles(dt);
  // foam undulation (waves across the head)
  const fpos = foamDome.geometry.attributes.position;
  for (let i = 0; i < fpos.count; i++) {
    const bx = foamDomeBase[i * 3], by = foamDomeBase[i * 3 + 1], bz = foamDomeBase[i * 3 + 2];
    fpos.setXYZ(i, bx, by + Math.sin(state.time * 1.8 + bx * 10 + bz * 8) * 0.02 + Math.sin(state.time * 1.1 + bz * 13) * 0.012, bz);
  }
  fpos.needsUpdate = true;
  beerFoam.rotation.y = state.time * 0.12;
  // glass foam undulation
  if (glassFoam.visible) {
    const gfp = gFoamDome.geometry.attributes.position;
    for (let i = 0; i < gfp.count; i++) {
      const gbx = gFoamDomeBase[i * 3], gby = gFoamDomeBase[i * 3 + 1], gbz = gFoamDomeBase[i * 3 + 2];
      gfp.setXYZ(i, gbx, gby + Math.sin(state.time * 2.4 + gbx * 14 + gbz * 11) * 0.03 + Math.sin(state.time * 1.6 + gbz * 16) * 0.018, gbz);
    }
    gfp.needsUpdate = true;
  }
  // subtle camera parallax
  camera.position.lerp(CAM_BASE, 0.06);
  camera.lookAt(CAM_TARGET);
  drawScreen();
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  update(clock.getDelta());
  renderer.render(scene, camera);
});

// =====================================================================
// INTERACTION
// =====================================================================
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointer = { px: 0, py: 0 };

function setNDC(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  pointer.px = ndc.x; pointer.py = ndc.y;
}
function hitScreen() {
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(screenMesh, false)[0];
  if (!hit || !hit.uv) return null;
  return { x: hit.uv.x * C.w, y: (1 - hit.uv.y) * C.h };
}
function hitLever() {
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects([lever, leverKnob, leverHit], false).length > 0;
}
function inCircle(p, b) { return Math.hypot(p.x - b.cx, p.y - b.cy) <= b.r + 8; }
function inRect(p, b) { return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; }
function onSliderB(p, b) { return p.x >= b.x - 30 && p.x <= b.x + b.w + 30 && Math.abs(p.y - b.y) <= 44; }
function setSliderFrom(p) {
  const b = UI.slider;
  const f = THREE.MathUtils.clamp((p.x - b.x) / b.w, 0, 1);
  state.screenHours = Math.round(f * 12 / 0.5) * 0.5;
}
function setAgeFrom(p) {
  const b = UI.ageSlider;
  const f = THREE.MathUtils.clamp((p.x - b.x) / b.w, 0, 1);
  state.age = Math.round(16 + f * 64);
}

function onDown(ev) {
  ev.preventDefault();
  try { el.setPointerCapture(ev.pointerId); } catch (e) {}
  setNDC(ev);
  if (state.phase === 'idle') { state.phase = 'input'; return; }
  if (state.phase === 'input') {
    const p = hitScreen();
    if (!p) return;
    if (inRect(p, UI.start)) { startDraining(); return; }
    if (onSliderB(p, UI.ageSlider)) { state.dragging = 'age'; setAgeFrom(p); return; }
    if (onSliderB(p, UI.slider)) { state.dragging = 'screen'; setSliderFrom(p); return; }
    return;
  }
  if (state.phase === 'pour_ready' || state.phase === 'pouring') {
    if (hitLever()) { state.isHolding = true; if (state.phase === 'pour_ready') state.phase = 'pouring'; }
    return;
  }
  if (state.phase === 'done') {
    const p = hitScreen();
    if (p && inRect(p, UI.restart)) resetMachine();
  }
}
function onMove(ev) {
  if (state.dragging || state.isHolding) ev.preventDefault();
  setNDC(ev);
  if (state.dragging) {
    const p = hitScreen();
    if (p) { if (state.dragging === 'age') setAgeFrom(p); else setSliderFrom(p); }
  }
}
function onUp() {
  state.dragging = null;
  state.isHolding = false;
}

const el = renderer.domElement;
el.style.touchAction = 'none';
el.addEventListener('pointerdown', onDown, { passive: false });
el.addEventListener('pointermove', onMove, { passive: false });
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);
// block the long-press selection / callout that hijacks touch on mobile
el.addEventListener('contextmenu', (e) => e.preventDefault());

// =====================================================================
// RESIZE
// =====================================================================
function onResize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  frameMachine();
  camera.position.copy(CAM_BASE);
  buildBackground();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// shadows: cabinet & metal cast onto the table (glass/beer skipped to avoid fake solid shadows)
machine.traverse((o) => {
  if (o.isMesh && o.material && o.material.isMeshStandardMaterial && !o.material.transparent) o.castShadow = true;
});

// init
setTankLevel(state.tankMl);
setGlassLevel(state.glassMl);
drawScreen();

// debug hook
window.YLM = { state, screenCanvas, machine, camera, scene, renderer, screenMesh, leverPivot, startDraining, resetMachine, update };
