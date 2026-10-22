// Species catalogue for the open water column, sunlit surface to hadal trench.
import * as THREE from 'three';
import { GeoBuilder, fishGeometry, bellGeometry, tentacleGeometry, squidGeometry, rayGeometry, turtleGeometry, C, v3, ZERO } from './builders.js';
import { patch } from './materials.js';

const HIGH_QUALITY = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /nvidia|geforce|rtx|radeon rx|apple m\d/i.test(r);
  } catch { return false; }
})();
// wet animal skin: physical material with a clear-coat film (and thin-film iridescence on silvery fish)
const solid = (o = {}, p = {}) => patch(new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: o.rough ?? 0.45, metalness: o.metal ?? 0, side: THREE.DoubleSide, emissive: 0x000000,
  clearcoat: o.coat ?? 0.6, clearcoatRoughness: o.coatRough ?? 0.25,
  // thin-film iridescence and sheen are only enabled on capable GPUs (they are costly on integrated graphics)
  iridescence: HIGH_QUALITY ? (o.irid ?? 0) : 0, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520],
  sheen: HIGH_QUALITY ? (o.sheen ?? 0) : 0, sheenColor: new THREE.Color(0x88aacc), sheenRoughness: 0.5,
}), { glow: true, ...p });
const silver = { rough: 0.22, metal: 0.8, irid: 0.7, coat: 0.4 };
const glassy = (color, opacity, p = {}, extra = {}) => patch(new THREE.MeshStandardMaterial({
  color, vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, roughness: 0.15, metalness: 0.0, emissive: 0x000000, ...extra,
}), { glow: true, causMul: 0.6, ...p });

const swim = (len, freq = 6, amp = 0.06, wave = 1.0, vertical = false) => ({ amp: amp * len, freq, waveLen: wave * len, start: len * 0.5, vertical });

// ---------------------------------------------------------------- epipelagic
function sardine() {
  const geo = fishGeometry({ len: 1, height: 0.2, width: 0.11, headExp: 0.55, tailExp: 1.05, back: 0x23485a, belly: 0xe3e8ea, fin: 0x8fa0a8, shade: 0.12, eye: 0.045, eyeT: 0.08,
    pattern: (t, phi, c, s) => { if (s > 0.15 && s < 0.4 && Math.cos(phi) > 0) c.offsetHSL(0, 0, 0.0); if (t > 0.15 && t < 0.6 && Math.abs(s - 0.35) < 0.05) c.multiplyScalar(0.5); },
    dorsal: [[0.36, 0.48, 0.1, 0.05]], pectoral: [0.2, 0.12, 0.3, 0.6], caudal: { len: 0.18, h: 0.16, fork: 0.55 } });
  return { name: 'Pacific sardine', parts: [{ geo, mat: solid(silver, { swim: swim(1, 14, 0.09, 0.9), bump: 'scales', bumpAmp: 0.6 }) }],
    count: 1600, depth: [3, 140], box: 240, vbox: 150, size: [0.17, 0.24], speed: [0.8, 1.6], motion: 'mill', schools: 5, schoolRadius: [5, 9] };
}

function tuna() {
  const geo = fishGeometry({ len: 1, height: 0.26, width: 0.19, headExp: 0.5, tailExp: 1.35, back: 0x14213a, belly: 0xc9d0d6, fin: 0x2a3550, shade: 0.02, eye: 0.03,
    pattern: (t, phi, c, s) => { if (s > -0.2 && s < 0.1 && t > 0.2 && t < 0.8) c.lerp(new THREE.Color(0x8aa4b8), 0.25); },
    dorsal: [[0.28, 0.38, 0.12, 0.05], [0.52, 0.6, 0.1, 0.06]], anal: [[0.56, 0.62, 0.09, 0.06]], pectoral: [0.22, 0.18, 0.15, 0.7], caudal: { len: 0.26, h: 0.3, fork: 0.75 }, ped: 0.035 });
  return { name: 'Bluefin tuna', parts: [{ geo, mat: solid({ ...silver, metal: 0.55, irid: 0.4 }, { swim: swim(1, 4, 0.035, 1.2), bump: 'scales', bumpFreq: 1.6, bumpAmp: 0.4 }) }],
    count: 14, depth: [5, 260], box: 300, vbox: 200, size: [1.6, 2.4], speed: [3, 4.5], motion: 'polar', schools: 2, schoolRadius: [6, 9] };
}

function reefShark(big = false) {
  const geo = fishGeometry({ len: 1, height: big ? 0.23 : 0.17, width: big ? 0.2 : 0.15, headExp: big ? 0.42 : 0.36, tailExp: 1.05, back: big ? 0x5d666e : 0x66707a, belly: 0xe2e1dc, fin: big ? 0x50585f : 0x5b646d,
    shade: big ? 0.18 : 0.05, eye: 0.012, eyeT: 0.08, eyePhi: 0.25, flatBelly: 0.8,
    pattern: (t, phi, c, s) => { if (!big && t > 0.92) c.multiplyScalar(0.55); c.multiplyScalar(0.92 + Math.random() * 0.1); },
    dorsal: [[0.3, 0.44, big ? 0.17 : 0.15, 0.12], [0.69, 0.73, 0.04, 0.02]], anal: [[0.7, 0.74, 0.035, 0.02]],
    pectoral: [0.27, big ? 0.24 : 0.22, 0.32, 0.85], caudal: { len: big ? 0.25 : 0.3, h: big ? 0.3 : 0.28, fork: 0.32, lower: big ? 0.85 : 0.55 } });
  return { name: big ? 'Great white shark' : 'Grey reef shark', parts: [{ geo, mat: solid({ rough: 0.5, coat: 0.5, coatRough: 0.35 }, { swim: swim(1, big ? 1.4 : 2.0, 0.06, 1.1), detail: 'skin', bump: 'skin', bumpAmp: 0.6 }) }],
    count: big ? 1 : 8, depth: big ? [10, 280] : [4, 320], box: big ? 380 : 230, vbox: big ? 260 : 160, size: big ? [4.6, 5.2] : [1.8, 2.6], speed: big ? [1.2, 1.6] : [0.9, 1.5], motion: 'cruise', turn: 0.5 };
}

function humpback() {
  const geo = fishGeometry({ len: 1, height: 0.19, width: 0.2, headExp: 0.4, tailExp: 1.35, wHeadExp: 0.35, back: 0x1d2024, belly: 0xb9bcbe, fin: 0x22262a, shade: 0.35, eye: 0.006, eyeT: 0.2, eyePhi: 0.0,
    pattern: (t, phi, c, s) => { if (s < -0.3 && t < 0.45) c.lerp(new THREE.Color(0x3a3d40), Math.max(0, Math.sin(phi * 30)) * 0.5); if (Math.random() < 0.02) c.set(0x9a9a92); },
    dorsal: [[0.64, 0.7, 0.025, 0.03]], pectoral: [0.27, 0.33, 0.45, 0.95], caudal: { len: 0.12, h: 0.18, fork: 0.25, horizontal: true }, ped: 0.04, yShift: (t) => -0.04 * (1 - t) });
  return { name: 'Humpback whale', parts: [{ geo, mat: solid({ rough: 0.5, coat: 0.7 }, { swim: swim(1, 0.7, 0.05, 1.3, true), detail: 'skin', bump: ['skin', 'grooves'], bumpFreq: 0.5, mottle: true }) }],
    count: 1, depth: [18, 110], box: 520, vbox: 220, size: [13, 15], speed: [1.6, 2], motion: 'cruise', turn: 0.15 };
}

function manta() {
  return { name: 'Giant manta ray', parts: [{ geo: rayGeometry({ span: 1, chord: 0.42, tail: 0.4 }), mat: solid({ rough: 0.5, coat: 0.6 }, { flap: { amp: 0.16, freq: 1.1, span: 0.5 }, detail: 'skin', bump: 'skin', bumpFreq: 0.6, bumpAmp: 0.5 }) }],
    count: 2, depth: [6, 130], box: 300, vbox: 160, size: [4.5, 6], speed: [1, 1.4], motion: 'cruise', turn: 0.3 };
}

function turtle() {
  return { name: 'Green sea turtle', parts: [{ geo: turtleGeometry(), mat: solid({ rough: 0.55, coat: 0.7 }, { flap: { amp: 0.35, freq: 1.4, span: 0.85 }, bump: 'skin', bumpFreq: 0.8 }) }],
    count: 3, depth: [2, 70], box: 220, vbox: 120, size: [0.9, 1.2], speed: [0.5, 0.8], motion: 'cruise', turn: 0.4 };
}

function moonJelly() {
  const bell = bellGeometry({ radius: 0.5, height: 0.28, color: 0xdfe9f2 });
  const b = new GeoBuilder();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10 * Math.PI * 1.4 - 0.7; pts.push(v3(Math.cos(a) * 0.17 + Math.cos(a + t) * 0.09, 0.12, Math.sin(a) * 0.17 + Math.sin(a + t) * 0.09)); }
    b.tube(pts, () => 0.025, C(0xd8a0c4), 6);
  }
  const gonads = b.build();
  const tent = tentacleGeometry({ count: 90, radius: 0.5, length: 0.25, thick: 0.004, color: 0xe6eef6, y0: -0.05 });
  const arms = tentacleGeometry({ count: 4, radius: 0.05, length: 0.5, thick: 0.03, color: 0xe8e8f2, frill: 0.02 });
  const pulse = { amp: 0.12, freq: 2.2 };
  return { name: 'Moon jellyfish', parts: [
    { geo: bell, mat: glassy(0xffffff, 0.32, { pulse }, { emissive: 0x0b1620 }) },
    { geo: gonads, mat: glassy(0xffffff, 0.65, { pulse }) },
    { geo: tent, mat: glassy(0xffffff, 0.35, { pulse, sway: true }) },
    { geo: arms, mat: glassy(0xffffff, 0.4, { sway: true }) },
  ], count: 70, depth: [2, 180], box: 130, vbox: 110, size: [0.25, 0.4], speed: [0.05, 0.12], motion: 'drift' };
}

function seaNettle() {
  const bell = bellGeometry({ radius: 0.5, height: 0.36, color: 0xc7652c, glowFn: () => ZERO });
  const tent = tentacleGeometry({ count: 24, radius: 0.48, length: 4.5, thick: 0.006, color: 0x9e3f20 });
  const arms = tentacleGeometry({ count: 4, radius: 0.08, length: 2.2, thick: 0.05, color: 0xf0d6c0, frill: 0.06 });
  const pulse = { amp: 0.1, freq: 1.4 };
  return { name: 'Pacific sea nettle', parts: [
    { geo: bell, mat: glassy(0xffffff, 0.75, { pulse }) },
    { geo: tent, mat: glassy(0xffffff, 0.6, { sway: true }) },
    { geo: arms, mat: glassy(0xffffff, 0.55, { sway: true }) },
  ], count: 16, depth: [5, 220], box: 150, vbox: 140, size: [0.35, 0.6], speed: [0.05, 0.1], motion: 'drift' };
}

// ---------------------------------------------------------------- mesopelagic
function lanternfish() {
  const geo = fishGeometry({ len: 1, height: 0.2, width: 0.11, headExp: 0.4, back: 0x1a2028, belly: 0x9aa6b0, fin: 0x30383e, eye: 0.07, eyeT: 0.1,
    photophores: (t, phi, s) => (s < -0.55 && t > 0.15 && t < 0.85 && Math.sin(t * 60) > 0.6 ? new THREE.Color(0.6, 1.6, 3.4) : ZERO),
    dorsal: [[0.4, 0.5, 0.08, 0.04]], caudal: { len: 0.18, h: 0.16, fork: 0.45 } });
  return { name: 'Lanternfish', parts: [{ geo, mat: solid({ ...silver, metal: 0.6 }, { swim: swim(1, 12, 0.08), bump: 'scales', bumpAmp: 0.5 }) }],
    count: 900, depth: [220, 1100], box: 140, vbox: 120, size: [0.1, 0.15], speed: [0.4, 0.8], motion: 'mill', schools: 4, schoolRadius: [4, 7] };
}

function hatchetfish() {
  const geo = fishGeometry({ len: 1, height: 0.62, width: 0.08, headExp: 0.35, tailExp: 1.6, back: 0x5b6670, belly: 0xe6eef2, fin: 0x9aa4ac, eye: 0.12, eyeT: 0.12, eyePhi: 0.6, eyeColor: 0x1a2a30,
    yShift: (t) => -0.15 * Math.sin(t * Math.PI) ,
    photophores: (t, phi, s) => (s < -0.8 && t > 0.1 && t < 0.7 && Math.sin(t * 45) > 0.3 ? new THREE.Color(0.4, 1.2, 3) : ZERO),
    dorsal: [[0.45, 0.55, 0.1, 0.03]], caudal: { len: 0.18, h: 0.14, fork: 0.4 } });
  return { name: 'Silver hatchetfish', parts: [{ geo, mat: solid({ rough: 0.12, metal: 0.95, irid: 0.9, coat: 0.3 }, { swim: swim(1, 6, 0.04) }) }],
    count: 160, depth: [200, 1000], box: 110, vbox: 110, size: [0.08, 0.12], speed: [0.2, 0.4], motion: 'cruise', turn: 1.2 };
}

function humboldt() {
  const geo = squidGeometry({ len: 1, mantle: 0.52, radius: 0.07, color: 0x8e2a22, under: 0xd59a8a, arms: 8, armLen: 0.3, tentacles: true, tentLen: 0.42, eye: 0.5, eyeColor: 0x0a0a0a });
  return { name: 'Humboldt squid', parts: [{ geo, mat: solid({ rough: 0.35, coat: 0.8, sheen: 0.4 }, { swim: swim(1, 2.5, 0.02), glowPulse: 3.5, detail: 'skin', bump: 'skin', bumpFreq: 1.5, bumpAmp: 0.4 }) }],
    count: 18, depth: [200, 750], box: 200, vbox: 150, size: [1.2, 1.7], speed: [1.5, 2.6], motion: 'polar', schools: 2, schoolRadius: [5, 8] };
}

function combJelly() {
  const b = new GeoBuilder();
  b.sphere(v3(0, 0, 0), 0.5, C(0xe9f2ff), ZERO, 16, v3(0.75, 1, 0.75));
  const body = b.build();
  const r = new GeoBuilder();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 24; i++) { const ph = 0.25 + (i / 24) * (Math.PI - 0.5); pts.push(v3(Math.sin(ph) * Math.cos(a) * 0.385, Math.cos(ph) * 0.5, Math.sin(ph) * Math.sin(a) * 0.385)); }
    r.tube(pts, () => 0.018, C(0xffffff), 4, (t) => new THREE.Color().setHSL((t * 2.5 + k * 0.13) % 1, 1, 0.5).multiplyScalar(5));
  }
  return { name: 'Comb jelly', parts: [
    { geo: body, mat: glassy(0xffffff, 0.18) },
    { geo: r.build(), mat: glassy(0xffffff, 0.9, { glowPulse: 9 }) },
  ], count: 45, depth: [80, 1600], box: 110, vbox: 120, size: [0.08, 0.2], speed: [0.05, 0.15], motion: 'drift' };
}

function atolla() {
  const bell = bellGeometry({ radius: 0.5, height: 0.16, color: 0x5e0a12, lumps: 3, glowFn: (v) => (v > 0.45 && v < 0.75 ? new THREE.Color(0.6, 1.6, 6) : ZERO) });
  const tent = tentacleGeometry({ count: 22, radius: 0.5, length: 0.9, thick: 0.006, color: 0x3a0a10 });
  return { name: 'Atolla jellyfish', parts: [
    { geo: bell, mat: glassy(0xffffff, 0.92, { pulse: { amp: 0.08, freq: 1.2 }, glowSpin: 3.2 }) },
    { geo: tent, mat: glassy(0xffffff, 0.7, { sway: true }) },
  ], count: 30, depth: [500, 3200], box: 120, vbox: 120, size: [0.15, 0.3], speed: [0.05, 0.1], motion: 'drift' };
}

function crownJelly() {
  const b = new GeoBuilder();
  b.lathe((v) => [0.36 * Math.sin(v * Math.PI * 0.5) * (1 + 0.1 * Math.sin(v * 30)), 0.9 * (1 - v)], 18, C(0x4b0b26), 24, 'y', null,
    (v, u) => (Math.sin(u * Math.PI * 24) > 0.85 && v > 0.6 ? new THREE.Color(0.5, 1, 4) : ZERO));
  const tent = tentacleGeometry({ count: 12, radius: 0.35, length: 0.7, thick: 0.03, color: 0x5a1430, y0: 0.0 });
  return { name: 'Crown jellyfish', parts: [
    { geo: b.build(), mat: glassy(0xffffff, 0.88, { pulse: { amp: 0.05, freq: 1 }, glowPulse: 2 }) },
    { geo: tent, mat: glassy(0xffffff, 0.8, { sway: true }) },
  ], count: 22, depth: [400, 2600], box: 120, vbox: 120, size: [0.12, 0.2], speed: [0.05, 0.1], motion: 'drift' };
}

function siphonophore() {
  // a colonial chain tens of metres long: stem + swimming bells + glowing lures
  const b = new GeoBuilder();
  const pts = [];
  for (let i = 0; i <= 160; i++) { const t = i / 160; pts.push(v3(-t * 30, Math.sin(t * 9) * 1.4, Math.cos(t * 6) * 1.6)); }
  b.tube(pts, () => 0.012, C(0xf4e6ff), 4, (t) => (Math.sin(t * 400) > 0.97 ? new THREE.Color(0.6, 1.5, 4) : ZERO));
  for (let i = 0; i < 160; i += 4) {
    const p = pts[i];
    b.sphere(p.clone().add(v3(0, -0.12, 0)), 0.09, C(0xffe6f6), Math.random() < 0.3 ? new THREE.Color(1.2, 0.5, 2.5) : ZERO, 6);
  }
  for (let i = 0; i < 6; i++) b.sphere(v3(0.15 + i * 0.12, 0, 0), 0.12, C(0xffffff), ZERO, 8, v3(1, 0.8, 0.8));
  return { name: 'Giant siphonophore', parts: [{ geo: b.build(), mat: glassy(0xffffff, 0.45, { sway: true, glowPulse: 1.5 }) }],
    count: 4, depth: [300, 2200], box: 220, vbox: 200, size: [1, 1], speed: [0.05, 0.08], motion: 'cruise', turn: 0.05 };
}

function barreleye() {
  const body = fishGeometry({ len: 1, height: 0.22, width: 0.14, headExp: 0.3, back: 0x2e2a26, belly: 0x6b5f52, fin: 0x5a5048, eye: 0.0001, pectoral: [0.25, 0.25, 0.1, 0.9], dorsal: [[0.45, 0.6, 0.06, 0.02]], caudal: { len: 0.12, h: 0.1, fork: 0.1 } });
  const dome = new GeoBuilder();
  dome.sphere(v3(0.3, 0.1, 0), 0.13, C(0xe8f6ff), ZERO, 14, v3(1.4, 0.9, 0.9));
  const eyes = new GeoBuilder();
  for (const s of [-1, 1]) eyes.tube([v3(0.24, 0.08, s * 0.03), v3(0.32, 0.17, s * 0.03)], () => 0.028, C(0x2f8a3a), 8, () => new THREE.Color(0.4, 2.2, 0.5));
  return { name: 'Barreleye', parts: [
    { geo: body, mat: solid({ rough: 0.5 }, { swim: swim(1, 2, 0.02) }) },
    { geo: eyes.build(), mat: solid({ rough: 0.1 }) },
    { geo: dome.build(), mat: glassy(0xffffff, 0.16) },
  ], count: 16, depth: [600, 820], box: 90, vbox: 90, size: [0.2, 0.3], speed: [0.05, 0.12], motion: 'cruise', turn: 0.6 };
}

function giantSquid() {
  const geo = squidGeometry({ len: 1, mantle: 0.24, radius: 0.04, color: 0xa13c2a, under: 0xe0b0a0, arms: 8, armLen: 0.22, tentacles: true, tentLen: 0.72, eye: 0.6, eyeColor: 0x0a0a0a, spread: 0.15 });
  return { name: 'Giant squid', parts: [{ geo, mat: solid({ rough: 0.35, coat: 0.8, sheen: 0.4 }, { swim: swim(1, 0.8, 0.01), detail: 'skin', bump: 'skin', bumpFreq: 0.6 }) }],
    count: 1, depth: [380, 1100], box: 260, vbox: 220, size: [11, 13], speed: [0.4, 0.7], motion: 'cruise', turn: 0.3 };
}

function spermWhale() {
  const geo = fishGeometry({ len: 1, height: 0.2, width: 0.18, headExp: 0.08, tailExp: 1.25, square: 1.5, back: 0x34373a, belly: 0x55585a, fin: 0x2e3134, shade: 0.4, eye: 0.005, eyeT: 0.3, eyePhi: -0.2,
    pattern: (t, phi, c) => { c.multiplyScalar(0.85 + Math.random() * 0.25); }, dorsal: [[0.6, 0.66, 0.02, 0.02]], pectoral: [0.33, 0.07, 0.3, 0.9], caudal: { len: 0.1, h: 0.17, fork: 0.25, horizontal: true }, ped: 0.04 });
  return { name: 'Sperm whale', parts: [{ geo, mat: solid({ rough: 0.6, coat: 0.5 }, { swim: swim(1, 0.6, 0.05, 1.3, true), detail: 'skin', bump: 'skin', bumpFreq: 0.35, bumpAmp: 1.4, mottle: true }) }],
    count: 1, depth: [300, 2000], box: 420, vbox: 300, size: [14, 16], speed: [1.5, 2], motion: 'cruise', turn: 0.2 };
}

// ---------------------------------------------------------------- bathypelagic
function anglerfish() {
  const geo = fishGeometry({ len: 1, height: 0.62, width: 0.5, headExp: 0.28, tailExp: 1.7, back: 0x15110f, belly: 0x231d19, fin: 0x1a1512, shade: 0, eye: 0.02, eyeT: 0.12, eyePhi: 0.8,
    pattern: (t, phi, c, s) => { if (t < 0.12 && Math.abs(Math.cos(phi)) > 0.2 && Math.abs(s) < 0.15) c.set(0x050302); c.multiplyScalar(0.8 + Math.random() * 0.4); },
    dorsal: [[0.6, 0.7, 0.08, 0.03]], anal: [[0.62, 0.7, 0.08, 0.03]], pectoral: [0.45, 0.1, 0.2, 0.8], caudal: { len: 0.2, h: 0.14, fork: 0.0 } });
  const extra = new GeoBuilder();
  // fangs along both jaws
  for (let i = 0; i < 22; i++) {
    const a = (i / 21 - 0.5) * Math.PI * 0.9;
    const up = i % 2 === 0 ? 1 : -1;
    const base = v3(0.47 - Math.abs(a) * 0.05, up * 0.015, Math.sin(a) * 0.17);
    extra.tube([base, base.clone().add(v3(0.02, -up * (0.07 + Math.random() * 0.06), 0))], (t) => 0.008 * (1 - t), C(0xd8d4c6), 4);
  }
  // illicium + glowing esca
  const lure = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; lure.push(v3(0.3 + Math.sin(t * 2.2) * 0.32, 0.3 + Math.sin(t * Math.PI) * 0.22 - t * 0.05, 0)); }
  extra.tube(lure, () => 0.008, C(0x1c1612), 4);
  extra.sphere(lure[12], 0.035, C(0xbff4ff), new THREE.Color(3, 9, 12), 10);
  return { name: 'Humpback anglerfish', parts: [
    { geo, mat: solid({ rough: 0.7, coat: 0.3 }, { swim: swim(1, 1.5, 0.03), detail: 'skin', bump: 'skin', bumpFreq: 2, bumpAmp: 1.2 }) },
    { geo: extra.build(), mat: solid({ rough: 0.2 }) },
  ], count: 14, depth: [1000, 3600], box: 100, vbox: 100, size: [0.35, 0.6], speed: [0.05, 0.15], motion: 'cruise', turn: 0.4 };
}

function gulper() {
  const b = new GeoBuilder();
  const body = [];
  for (let i = 0; i <= 50; i++) { const t = i / 50; body.push(v3(-t * 1.0, Math.sin(t * 7) * 0.02 * t, 0)); }
  b.tube(body, (t) => 0.035 * Math.pow(1 - t, 1.6) + 0.002, C(0x0d0b0a), 6, (t) => (t > 0.97 ? new THREE.Color(5, 1.2, 2.5) : ZERO));
  // the enormous hinged mouth: two jaws and a dark pouch
  b.lathe((v) => [0.02 + v * 0.13, v * 0.28], 8, C(0x110d0c), 16, 'x', (v) => new THREE.Color(0x110d0c).multiplyScalar(v > 0.95 ? 0.4 : 1));
  for (const s of [-1, 1]) b.sphere(v3(0.04, 0.035, s * 0.025), 0.008, C(0x2a2a2a));
  return { name: 'Gulper eel', parts: [{ geo: b.build(), mat: solid({ rough: 0.3 }, { swim: swim(1, 2.2, 0.08, 0.6) }) }],
    count: 10, depth: [1000, 3200], box: 100, vbox: 110, size: [0.9, 1.6], speed: [0.1, 0.3], motion: 'cruise', turn: 0.4 };
}

function vampireSquid() {
  const geo = squidGeometry({ len: 1, mantle: 0.45, radius: 0.13, color: 0x3d0a12, under: 0x5a1620, arms: 8, armLen: 0.35, finLen: 0.3, finW: 1.6, eye: 0.38, eyeColor: 0x3a6aa8, eyeGlow: 0x2a4aa0, web: 0.9, webColor: 0x2a060c, armGlow: 0x4aa0ff, spread: 0.1 });
  return { name: 'Vampire squid', parts: [{ geo, mat: solid({ rough: 0.5, coat: 0.6, sheen: 0.5 }, { swim: swim(1, 1.2, 0.02), glowPulse: 1.6, bump: 'skin', bumpFreq: 2 }) }],
    count: 12, depth: [600, 1200], box: 100, vbox: 100, size: [0.25, 0.32], speed: [0.05, 0.15], motion: 'cruise', turn: 0.7 };
}

function dragonfish() {
  const geo = fishGeometry({ len: 1, height: 0.1, width: 0.07, headExp: 0.25, tailExp: 0.7, back: 0x0b0a0c, belly: 0x141216, fin: 0x0b0a0c, shade: 0, eye: 0.03, eyeT: 0.05,
    photophores: (t, phi, s) => (Math.abs(s + 0.65) < 0.12 && Math.sin(t * 90) > 0.6 && t > 0.08 ? new THREE.Color(0.8, 1.4, 4) : (t < 0.06 && s > -0.1 && s < 0.25 && Math.cos(phi) > 0 ? new THREE.Color(3, 1, 0.6) : ZERO)),
    dorsal: [[0.84, 0.9, 0.05, 0.02]], anal: [[0.84, 0.9, 0.05, 0.02]], caudal: { len: 0.08, h: 0.06, fork: 0.3 } });
  const fangs = new GeoBuilder();
  for (let i = 0; i < 6; i++) { const z = (i - 2.5) * 0.012; fangs.tube([v3(0.48, 0.01, z), v3(0.5, -0.06 - (i % 2) * 0.03, z)], (t) => 0.004 * (1 - t), C(0xf2efe2), 3); }
  const barbel = [];
  for (let i = 0; i <= 10; i++) barbel.push(v3(0.42 - i * 0.05, -0.05 - i * 0.025, 0));
  fangs.tube(barbel, () => 0.003, C(0x1a1a1a), 3);
  fangs.sphere(barbel[10], 0.012, C(0xffffff), new THREE.Color(4, 3, 8), 6);
  return { name: 'Black dragonfish', parts: [{ geo, mat: solid({ rough: 0.25 }, { swim: swim(1, 3, 0.06, 0.6) }) }, { geo: fangs.build(), mat: solid({ rough: 0.2 }) }],
    count: 22, depth: [400, 2600], box: 100, vbox: 110, size: [0.3, 0.45], speed: [0.1, 0.3], motion: 'cruise', turn: 0.6 };
}

function deepstaria() {
  const bell = bellGeometry({ radius: 0.5, height: 0.55, color: 0xf2d8b8, segs: 40, glowFn: () => ZERO });
  return { name: 'Deepstaria jellyfish', parts: [{ geo: bell, mat: glassy(0xffffff, 0.22, { pulse: { amp: 0.06, freq: 0.4 } }, { emissive: 0x050302 }) }],
    count: 3, depth: [700, 1800], box: 150, vbox: 150, size: [1.2, 1.8], speed: [0.03, 0.05], motion: 'drift' };
}

function dumbo() {
  const b = new GeoBuilder();
  const pink = C(0xd99aa0);
  b.sphere(v3(0, 0.12, 0), 0.22, pink, ZERO, 16, v3(0.9, 1.1, 0.9));
  for (const s of [-1, 1]) {
    b.patch(v3(0.0, 0.2, s * 0.17), v3(-0.06, 0.2, s * 0.17), v3(-0.1, 0.32, s * 0.36), v3(0.04, 0.34, s * 0.34), pink, 4);
    b.sphere(v3(0.12, 0.08, s * 0.1), 0.035, C(0x111111));
  }
  b.lathe((v) => [0.12 + v * 0.38, -v * 0.24 + 0.02], 6, C(0xe8b4b4), 24);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2; const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(v3(Math.cos(a) * (0.12 + t * 0.4), -t * 0.32, Math.sin(a) * (0.12 + t * 0.4))); }
    b.tube(pts, (t) => 0.03 * (1 - t * 0.7), C(0xf0c4c0), 5);
  }
  return { name: 'Dumbo octopus', parts: [{ geo: b.build(), mat: solid({ rough: 0.4, coat: 0.7, sheen: 0.6 }, { pulse: { amp: 0.06, freq: 1.6 }, detail: 'skin', bump: 'skin', bumpFreq: 2.5 }) }],
    count: 12, depth: [2600, 4300], box: 110, vbox: 80, size: [0.3, 0.5], speed: [0.05, 0.12], motion: 'drift' };
}

// ---------------------------------------------------------------- hadal
function snailfish() {
  const geo = fishGeometry({ len: 1, height: 0.22, width: 0.18, headExp: 0.3, tailExp: 0.8, back: 0xe7c2c0, belly: 0xf2dcd8, fin: 0xf0d0d0, shade: 0.2, eye: 0.02, eyeT: 0.1, ped: 0.02,
    dorsal: [[0.3, 0.92, 0.06, 0.0]], anal: [[0.4, 0.92, 0.05, 0.0]], pectoral: [0.2, 0.2, 0.3, 0.6], caudal: { len: 0.08, h: 0.06, fork: 0 } });
  return { name: 'Hadal snailfish', parts: [{ geo, mat: glassy(0xffffff, 0.72, { swim: swim(1, 2, 0.05, 0.8) }, { roughness: 0.3, emissive: 0x060202 }) }],
    count: 30, depth: [6000, 8400], box: 90, vbox: 70, size: [0.2, 0.3], speed: [0.05, 0.2], motion: 'cruise', turn: 0.7 };
}

function amphipod() {
  const b = new GeoBuilder();
  for (let i = 0; i < 9; i++) b.sphere(v3(0.4 - i * 0.1, Math.sin(i / 8 * Math.PI) * 0.06, 0), 0.09 - Math.abs(i - 3) * 0.008, C(0xf0eadc), ZERO, 8, v3(0.7, 1, 0.9));
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) b.tube([v3(0.3 - i * 0.09, -0.05, s * 0.05), v3(0.32 - i * 0.09, -0.2, s * 0.14)], () => 0.008, C(0xe8dcc8), 3);
  b.tube([v3(0.48, 0.05, 0), v3(0.75, 0.15, 0.06)], () => 0.006, C(0xe8dcc8), 3);
  return { name: 'Supergiant amphipod', parts: [{ geo: b.build(), mat: solid({ rough: 0.35 }, { swim: swim(1, 6, 0.03, 0.5) }) }],
    count: 260, depth: [5500, 10900], box: 80, vbox: 60, size: [0.12, 0.3], speed: [0.1, 0.3], motion: 'mill', schools: 3, schoolRadius: [2, 5] };
}

// ---------------------------------------------------------------- big open-ocean animals
function blueWhale() {
  const geo = fishGeometry({ len: 1, height: 0.105, width: 0.115, headExp: 0.42, wHeadExp: 0.32, tailExp: 1.5, ped: 0.03, back: 0x4a5f6e, belly: 0x86929a, fin: 0x45596a,
    shade: 0.25, eye: 0.004, eyeT: 0.17, eyePhi: -0.05, segU: 90, segV: 36, yShift: (t) => -0.02 * (1 - t),
    pattern: (t, phi, c) => { c.multiplyScalar(0.9 + Math.random() * 0.15); },
    dorsal: [[0.76, 0.79, 0.012, 0.02]], pectoral: [0.24, 0.09, 0.35, 0.85], caudal: { len: 0.07, h: 0.12, fork: 0.2, horizontal: true } });
  return { name: 'Blue whale', parts: [{ geo, mat: solid({ rough: 0.45, coat: 0.8, coatRough: 0.2 }, { swim: swim(1, 0.45, 0.04, 1.4, true), bump: ['skin', 'grooves'], bumpFreq: 0.4, mottle: true }) }],
    count: 2, depth: [20, 260], box: 620, vbox: 260, size: [24, 29], speed: [1.8, 2.4], motion: 'cruise', turn: 0.1 };
}

function whaleShark() {
  const geo = fishGeometry({ len: 1, height: 0.19, width: 0.22, headExp: 0.22, wHeadExp: 0.18, tailExp: 1.2, square: 1.3, flatBelly: 0.7, back: 0x34414c, belly: 0xd6d9d7, fin: 0x34414c, shade: 0.15,
    eye: 0.006, eyeT: 0.05, eyePhi: 0.05, segU: 70, segV: 34,
    dorsal: [[0.36, 0.5, 0.13, 0.09], [0.66, 0.7, 0.04, 0.02]], anal: [[0.67, 0.71, 0.035, 0.02]], pectoral: [0.26, 0.2, 0.3, 0.85], caudal: { len: 0.24, h: 0.27, fork: 0.35, lower: 0.65 } });
  return { name: 'Whale shark', parts: [{ geo, mat: solid({ rough: 0.55, coat: 0.5 }, { swim: swim(1, 0.9, 0.05, 1.1), bump: 'skin', bumpFreq: 0.5, spots: true }) }],
    count: 2, depth: [4, 220], box: 480, vbox: 220, size: [9, 12], speed: [0.9, 1.2], motion: 'cruise', turn: 0.25 };
}

function hammerhead() {
  const geo = fishGeometry({ len: 1, height: 0.16, width: 0.14, headExp: 0.4, tailExp: 1.05, back: 0x6d7266, belly: 0xe0ded6, fin: 0x63685d, shade: 0.06, eye: 0.0001, flatBelly: 0.8,
    dorsal: [[0.28, 0.4, 0.2, 0.1], [0.7, 0.74, 0.04, 0.02]], anal: [[0.69, 0.73, 0.04, 0.02]], pectoral: [0.27, 0.16, 0.25, 0.8], caudal: { len: 0.3, h: 0.3, fork: 0.3, lower: 0.5 } });
  const head = new GeoBuilder();
  head.sphere(v3(0.43, 0.0, 0), 1, C(0x6d7266), ZERO, 24, v3(0.06, 0.02, 0.14));
  for (const s of [-1, 1]) head.sphere(v3(0.43, 0.0, s * 0.138), 0.009, C(0x0a0a0a), ZERO, 8);
  const mat = solid({ rough: 0.5, coat: 0.5, coatRough: 0.35 }, { swim: swim(1, 1.9, 0.06, 1.1), bump: 'skin', bumpAmp: 0.6 });
  return { name: 'Scalloped hammerhead', parts: [{ geo, mat }, { geo: head.build(), mat }],
    count: 14, depth: [10, 320], box: 320, vbox: 160, size: [2.6, 3.4], speed: [1.0, 1.4], motion: 'polar', schools: 1, schoolRadius: [10, 14] };
}

function dolphins() {
  const geo = fishGeometry({ len: 1, height: 0.2, width: 0.19, headExp: 0.48, tailExp: 1.25, back: 0x56606a, belly: 0xdcdedf, fin: 0x4e5862, shade: 0.12, eye: 0.012, eyeT: 0.13, eyePhi: 0.05, ped: 0.04, segU: 56, segV: 30,
    dorsal: [[0.4, 0.52, 0.14, 0.11]], pectoral: [0.27, 0.12, 0.35, 0.8], caudal: { len: 0.12, h: 0.15, fork: 0.25, horizontal: true } });
  const beak = new GeoBuilder();
  beak.tube([v3(0.47, -0.015, 0), v3(0.53, -0.02, 0), v3(0.58, -0.022, 0)], (t) => 0.03 - t * 0.016, C(0x8a9298), 10);
  const mat = solid({ rough: 0.3, coat: 1.0, coatRough: 0.12 }, { swim: swim(1, 2.6, 0.06, 1.2, true), bump: 'skin', bumpFreq: 1.6, bumpAmp: 0.3 });
  return { name: 'Bottlenose dolphin', parts: [{ geo, mat }, { geo: beak.build(), mat }],
    count: 10, depth: [1, 70], box: 300, vbox: 90, size: [2.3, 2.9], speed: [3, 4], motion: 'polar', schools: 2, schoolRadius: [5, 8] };
}

function orca() {
  const black = new THREE.Color(0x0b0c0e), white = new THREE.Color(0xf1f1ee), grey = new THREE.Color(0x6c7076);
  const geo = fishGeometry({ len: 1, height: 0.23, width: 0.21, headExp: 0.4, tailExp: 1.3, back: 0x0b0c0e, belly: 0x0b0c0e, fin: 0x0b0c0e, eye: 0.007, eyeT: 0.12, eyePhi: 0.0, ped: 0.04, segU: 80, segV: 40,
    pattern: (t, phi, c, s) => {
      const side = Math.abs(Math.cos(phi));
      if (s < -0.55 && t < 0.58 && t > 0.03) c.copy(white);
      if (t > 0.55 && t < 0.78 && s < -0.05 && s > -0.75 && side > 0.3) c.copy(white);
      if (t > 0.13 && t < 0.23 && s > 0.08 && s < 0.42 && side > 0.55) c.copy(white);
      if (t > 0.42 && t < 0.56 && s > 0.78) c.copy(grey);
      if (s < -0.85 && t < 0.15) c.copy(black);
    },
    dorsal: [[0.36, 0.47, 0.24, 0.025]], pectoral: [0.24, 0.13, 0.4, 0.7], caudal: { len: 0.13, h: 0.17, fork: 0.25, horizontal: true } });
  return { name: 'Orca', parts: [{ geo, mat: solid({ rough: 0.25, coat: 1.0, coatRough: 0.1 }, { swim: swim(1, 1.6, 0.05, 1.3, true), bump: 'skin', bumpFreq: 0.8, bumpAmp: 0.3 }) }],
    count: 5, depth: [2, 240], box: 520, vbox: 200, size: [6, 8], speed: [2.4, 3], motion: 'polar', schools: 1, schoolRadius: [8, 12] };
}

function sunfish() {
  const geo = fishGeometry({ len: 1, height: 0.95, width: 0.2, headExp: 0.42, tailExp: 0.3, ped: 0.55, back: 0x8c949b, belly: 0xc6cac8, fin: 0x7e868c, shade: 0.2, eye: 0.03, eyeT: 0.12, eyePhi: 0.25,
    dorsal: [[0.62, 0.72, 0.55, 0.14]], anal: [[0.62, 0.72, 0.55, 0.14]], pectoral: [0.3, 0.08, 0.0, 0.5], caudal: { len: 0.06, h: 0.32, fork: 0 } });
  return { name: 'Ocean sunfish', parts: [{ geo, mat: solid({ rough: 0.7, coat: 0.3 }, { swim: swim(1, 1.2, 0.02, 0.5), bump: 'skin', bumpFreq: 0.9, bumpAmp: 0.8, mottle: true }) }],
    count: 3, depth: [3, 220], box: 260, vbox: 160, size: [1.6, 2.4], speed: [0.4, 0.7], motion: 'cruise', turn: 0.4 };
}

function swordfish() {
  const geo = fishGeometry({ len: 1, height: 0.16, width: 0.13, headExp: 0.45, tailExp: 1.4, back: 0x2b2a36, belly: 0xb9bdc4, fin: 0x26252f, shade: 0.05, eye: 0.03, eyeT: 0.07, ped: 0.03,
    dorsal: [[0.18, 0.27, 0.2, 0.09]], anal: [[0.7, 0.74, 0.05, 0.03]], pectoral: [0.2, 0.18, 0.5, 0.5], caudal: { len: 0.26, h: 0.32, fork: 0.85 } });
  const bill = new GeoBuilder();
  bill.tube([v3(0.46, 0.0, 0), v3(0.65, -0.002, 0), v3(0.86, -0.004, 0)], (t) => 0.022 * (1 - t * 0.9), C(0x2a2a2e), 8);
  const mat = solid({ rough: 0.3, metal: 0.4, irid: 0.5, coat: 0.6 }, { swim: swim(1, 3, 0.035, 1.2), bump: 'skin', bumpFreq: 2, bumpAmp: 0.3 });
  return { name: 'Swordfish', parts: [{ geo, mat }, { geo: bill.build(), mat }],
    count: 3, depth: [20, 650], box: 300, vbox: 250, size: [3, 4], speed: [2.2, 3], motion: 'cruise', turn: 0.3 };
}

function barracuda() {
  const geo = fishGeometry({ len: 1, height: 0.11, width: 0.08, headExp: 0.6, tailExp: 1.0, back: 0x3c4a52, belly: 0xdfe3e5, fin: 0x55626a, shade: 0.1, eye: 0.03, eyeT: 0.1,
    pattern: (t, phi, c, s) => { if (s > -0.1 && Math.sin(t * 70) > 0.55 && t > 0.2 && t < 0.85) c.multiplyScalar(0.55); },
    dorsal: [[0.36, 0.44, 0.07, 0.04], [0.62, 0.68, 0.06, 0.03]], anal: [[0.63, 0.69, 0.06, 0.03]], caudal: { len: 0.15, h: 0.13, fork: 0.6 } });
  return { name: 'Great barracuda', parts: [{ geo, mat: solid(silver, { swim: swim(1, 4, 0.04), bump: 'scales', bumpFreq: 1.4, bumpAmp: 0.4 }) }],
    count: 45, depth: [3, 120], box: 260, vbox: 120, size: [1, 1.5], speed: [0.5, 0.8], motion: 'polar', schools: 2, schoolRadius: [6, 9] };
}

function oarfish() {
  const geo = fishGeometry({ len: 1, height: 0.07, width: 0.018, headExp: 0.3, tailExp: 0.45, ped: 0.02, back: 0xb7c0c8, belly: 0xdfe4e8, fin: 0xd1323e, shade: 0.2, eye: 0.012, eyeT: 0.03, segU: 120,
    pattern: (t, phi, c, s) => { if (s > -0.3 && Math.sin(t * 160) > 0.8) c.multiplyScalar(0.55); },
    dorsal: [[0.0, 0.07, 0.14, 0.04], [0.07, 0.98, 0.045, 0.0]], caudal: { len: 0.02, h: 0.02, fork: 0 } });
  return { name: 'Giant oarfish', parts: [{ geo, mat: solid({ ...silver, metal: 0.85 }, { swim: swim(1, 1.6, 0.03, 0.22) }) }],
    count: 3, depth: [200, 1000], box: 200, vbox: 220, size: [5, 8], speed: [0.2, 0.4], motion: 'cruise', turn: 0.3 };
}

function goblinShark() {
  const geo = fishGeometry({ len: 1, height: 0.15, width: 0.12, headExp: 0.4, tailExp: 1.0, back: 0xc79a94, belly: 0xd7b2ab, fin: 0xb98c86, shade: 0.1, eye: 0.008, eyeT: 0.12,
    dorsal: [[0.42, 0.5, 0.07, 0.04], [0.6, 0.66, 0.06, 0.03]], anal: [[0.6, 0.68, 0.06, 0.03]], pectoral: [0.3, 0.12, 0.3, 0.7], caudal: { len: 0.3, h: 0.16, fork: 0.15, lower: 0.25 } });
  const x = new GeoBuilder();
  x.sphere(v3(0.55, 0.02, 0), 1, C(0xd4aaa3), ZERO, 16, v3(0.14, 0.014, 0.04));
  x.tube([v3(0.42, -0.04, 0), v3(0.5, -0.06, 0), v3(0.53, -0.05, 0)], () => 0.03, C(0xb07a74), 10);
  for (let i = 0; i < 12; i++) { const z = (i - 5.5) * 0.008; x.tube([v3(0.51, -0.045, z), v3(0.515, -0.075, z)], (t) => 0.0035 * (1 - t), C(0xf0ece0), 3); }
  const mat = solid({ rough: 0.55, coat: 0.6, sheen: 0.3 }, { swim: swim(1, 1.2, 0.05), bump: 'skin', bumpFreq: 1.2, bumpAmp: 0.6 });
  return { name: 'Goblin shark', parts: [{ geo, mat }, { geo: x.build(), mat }],
    count: 3, depth: [270, 1300], box: 140, vbox: 140, size: [3, 3.8], speed: [0.3, 0.5], motion: 'cruise', turn: 0.4 };
}

function frilledShark() {
  const geo = fishGeometry({ len: 1, height: 0.075, width: 0.07, headExp: 0.22, tailExp: 0.55, ped: 0.04, back: 0x4b3d33, belly: 0x5e4c40, fin: 0x45372e, eye: 0.012, eyeT: 0.04, segU: 80,
    dorsal: [[0.68, 0.75, 0.04, 0.02]], anal: [[0.6, 0.74, 0.04, 0.02]], pectoral: [0.18, 0.08, 0.3, 0.7], caudal: { len: 0.15, h: 0.05, fork: 0 } });
  const f = new GeoBuilder();
  for (let k = 0; k < 6; k++) {
    const xk = 0.42 - k * 0.015, pts = [];
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; const r = 0.036 + Math.sin(a * 12) * 0.005; pts.push(v3(xk + Math.sin(a * 12) * 0.004, Math.sin(a) * r, Math.cos(a) * r * 0.95)); }
    f.tube(pts, () => 0.004, C(0x8c4a3c), 4);
  }
  const mat = solid({ rough: 0.5, coat: 0.6 }, { swim: swim(1, 1.6, 0.07, 0.6), bump: 'skin', bumpFreq: 2 });
  return { name: 'Frilled shark', parts: [{ geo, mat }, { geo: f.build(), mat }],
    count: 4, depth: [500, 1500], box: 110, vbox: 120, size: [1.4, 2], speed: [0.2, 0.4], motion: 'cruise', turn: 0.5 };
}

function pyrosome() {
  const b = new GeoBuilder();
  b.lathe((v) => [0.07 * Math.min(1, Math.sin(v * Math.PI * 0.5) * 2.5) * (1 + 0.06 * Math.sin(v * 70)), (0.5 - v)], 30, C(0xf0c8d6), 18, 'x', null,
    (v, u) => (Math.sin(v * 140 + u * 40) > 0.9 ? new THREE.Color(0.5, 2.5, 3.5) : ZERO));
  return { name: 'Pyrosome', parts: [{ geo: b.build(), mat: glassy(0xffffff, 0.55, { glowPulse: 2.4 }) }],
    count: 26, depth: [60, 900], box: 140, vbox: 160, size: [0.6, 3.5], speed: [0.05, 0.12], motion: 'cruise', turn: 0.2 };
}

export function allSpecies() {
  return [sardine(), tuna(), reefShark(false), reefShark(true), humpback(), manta(), turtle(), moonJelly(), seaNettle(),
    blueWhale(), whaleShark(), hammerhead(), dolphins(), orca(), sunfish(), swordfish(), barracuda(), oarfish(), goblinShark(), frilledShark(), pyrosome(),
    lanternfish(), hatchetfish(), humboldt(), combJelly(), atolla(), crownJelly(), siphonophore(), barreleye(), giantSquid(), spermWhale(),
    anglerfish(), gulper(), vampireSquid(), dragonfish(), deepstaria(), dumbo(), snailfish(), amphipod()];
}
