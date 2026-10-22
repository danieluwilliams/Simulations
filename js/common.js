// Shared constants, GLSL snippets and the swell model used by both the GPU and the CPU.
import * as THREE from 'three';

export const SUN_ELEVATION = 27;          // degrees above horizon
export const SUN_AZIMUTH = 180;            // facing -Z at start
const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, phi, theta).normalize();
// sun direction after refraction into water (Snell, n = 1.333)
export const SUN_DIR_WATER = (() => {
  const i = SUN_DIR.clone().negate();
  const n = new THREE.Vector3(0, 1, 0);
  const eta = 1 / 1.333;
  const cosi = -n.dot(i);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  const t = i.multiplyScalar(eta).add(n.multiplyScalar(eta * cosi - Math.sqrt(k)));
  return t.negate().normalize(); // pointing up toward the sun, below water
})();

// Diffuse attenuation of clear open-ocean water (per metre), R, G, B — a three-channel summary of the spectral
// model below, kept for anything that wants a single coefficient per channel.
export const KD = new THREE.Vector3(0.40, 0.046, 0.025);

// ---------------------------------------------------------------- light in the water column (Beer–Lambert)
// Sunlight is split into 11 bands across the visible spectrum, each one attenuated with depth as E(d) = E0·e^(−Kd·d)
// with the diffuse attenuation coefficient Kd of clear oceanic water (Jerlov type I, ~0.03 mg/m³ chlorophyll), then
// folded back into linear sRGB through the CIE 1931 observer. Summing the bands, rather than giving each RGB channel
// one coefficient, is what makes the colours go in the order a diver sees: deep red (650–680 nm) is gone within a
// few metres, orange and yellow (575–600 nm) by about 30 m, green by about 100 m, leaving one narrow band of blue
// around 470 nm. Columns: Kd (1/m), then that band's share of the R, G and B channels of white sunlight.
const BANDS = [
  [0.046, 0.00765, 0, 0.07686],    // 410 nm violet
  [0.033, 0.03024, 0, 0.46499],    // 440
  [0.0255, 0, 0.01081, 0.38471],   // 470 blue: the last light left
  [0.034, 0, 0.1502, 0.07344],     // 500 cyan
  [0.052, 0, 0.29773, 0],          // 525 green
  [0.068, 0, 0.30951, 0],          // 550
  [0.098, 0.20336, 0.18997, 0],    // 575 yellow
  [0.245, 0.35048, 0.04178, 0],    // 600 orange
  [0.32, 0.28011, 0, 0],           // 625
  [0.37, 0.11262, 0, 0],           // 650 red
  [0.47, 0.01556, 0, 0],           // 680
];
const lumOf = (r, g, b) => r * 0.15 + g * 0.55 + b * 0.3;   // the weighting the exposure system uses
// the physical light reaching depth d (m), relative to the surface, per channel
export function waterTransmission(d, out = new THREE.Vector3()) {
  d = Math.max(d, 0);
  let r = 0, g = 0, b = 0;
  for (const [k, wr, wg, wb] of BANDS) { const t = Math.exp(-k * d); r += wr * t; g += wg * t; b += wb * t; }
  return out.set(r, g, b);
}
// Below ~150 m the eye's adaptation runs out (main.js caps the exposure gain there), and the physical light keeps
// falling by 1/40 every 150 m. A dark-adapted diver still sees a deep-blue twilight down to the bottom of the
// mesopelagic, so from there the light is followed perceptually instead: the hue stays what the water leaves (blue),
// the brightness eases off as (1 − u)³ and reaches exactly zero at 3,000 ft. Below that, total darkness: only lamps
// and living things make light.
export const TWILIGHT_END = 914.4;   // 3,000 ft
const t0 = new THREE.Vector3();
export const TWILIGHT_START = (() => {
  let lo = 20, hi = 400;   // where the eye's adaptation runs out: physical luminance 0.0044
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2, t = waterTransmission(m, t0); if (lumOf(t.x, t.y, t.z) > 0.0044) lo = m; else hi = m; }
  return lo;
})();
const LUM0 = (() => { const t = waterTransmission(TWILIGHT_START, t0); return lumOf(t.x, t.y, t.z); })();
// the daylight that reaches depth d (m) as the scene is lit by it: physical to 150 m, deep-blue twilight to 3,000 ft
export function waterLight(d, out = new THREE.Vector3()) {
  waterTransmission(d, out);
  if (d <= TWILIGHT_START) return out;
  const u = (d - TWILIGHT_START) / (TWILIGHT_END - TWILIGHT_START);
  if (u >= 1) return out.set(0, 0, 0);
  const lum = lumOf(out.x, out.y, out.z);
  return lum > 0 ? out.multiplyScalar((LUM0 * (1 - u) ** 3) / lum) : out.set(0, 0, 0);
}
// ln of waterLight, clamped: −60 stands for none at all
export const LN_DARK = -60;
export function lnWaterLight(d, out = new THREE.Vector3()) {
  waterLight(d, out);
  return out.set(...out.toArray().map((v) => (v > 1e-26 ? Math.max(Math.log(v), LN_DARK) : LN_DARK)));
}
// The same curve on the GPU: a 1D lookup of ln(waterLight) from 0 to 960 m, so every fragment can be lit by the light
// at its own depth rather than the camera's (a reef floor 20 m below you is bluer and dimmer than the water you are in),
// and the volumetric in-scatter can follow depth exactly. Stored as half floats; linear filtering between texels is
// exact for an exponential, which is why ln is stored.
export const SEEN_LUT_DEPTH = 960, SEEN_LUT_SIZE = 1024;
export const SEEN_LUT = (() => {
  const data = new Uint16Array(SEEN_LUT_SIZE * 4), v = new THREE.Vector3();
  for (let i = 0; i < SEEN_LUT_SIZE; i++) {
    lnWaterLight((i / (SEEN_LUT_SIZE - 1)) * SEEN_LUT_DEPTH, v);
    data.set([v.x, v.y, v.z, 0].map((x) => THREE.DataUtils.toHalfFloat(x)), i * 4);
  }
  const tex = new THREE.DataTexture(data, SEEN_LUT_SIZE, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
})();
export const GLSL_SEEN = `
uniform sampler2D uSeenLUT;
vec3 lnSeen(float d){ return texture2D(uSeenLUT, vec2(clamp(d / ${SEEN_LUT_DEPTH.toFixed(1)}, 0.0, 1.0) * ${((SEEN_LUT_SIZE - 1) / SEEN_LUT_SIZE).toFixed(6)} + ${(0.5 / SEEN_LUT_SIZE).toFixed(6)}, 0.5)).rgb; }
vec3 seenAt(float d){ vec3 v = lnSeen(d); return exp(v) * step(vec3(${LN_DARK + 1}.0), v); }   // exactly 0 below 3,000 ft
`;
// Light arriving at the sea surface relative to the afternoon the session starts in, kept current by the day
// cycle in main.js: everything lit by the water column (snow, bubbles, fish) scales with it.
export const DAY = { light: new THREE.Vector3(1, 1, 1), night: 0, elevation: 24 };

export const SEAFLOOR_DEPTH = 3800;
export const TRENCH_DEPTH = 10935;

// Where the wrecks came to rest: origin (x, z), heading, how far the hull sank into the mud, roll (about the
// ship's length) and pitch. pad = [aft x, fore x, half-width, local height]: the seafloor is kept below that
// height inside the hull so sediment never pokes up through the lowest deck.
export const WRECK_SITES = [
  { id: 'liner', x: 30, z: -60, yaw: 0.35, sink: 5.5, roll: 0, pitch: -0.025, pad: [-3, 93, 14.4, 4.4] },
  { id: 'galleon', x: -150, z: 30, yaw: 2.1, sink: 2.2, roll: 0.12, pitch: 0, pad: [1, 40, 5.4, 0.9] },
  { id: 'submarine', x: 120, z: 110, yaw: -0.8, sink: 2.0, roll: 0.06, pitch: 0.02, pad: [17, 73, 4.0, 1.5] },
  { id: 'freighter', x: -60, z: -230, yaw: 0.6, sink: 3.0, roll: -0.05, pitch: 0.012, pad: [5, 114, 10.4, 1.4] },
  { id: 'trawler', x: -30, z: 175, yaw: -2.5, sink: 1.0, roll: 0.32, pitch: 0, pad: [3, 31, 4.1, 0.1] },
];

// Depth zones for the HUD and the gauge.
export const ZONES = [
  { name: 'Sunlight zone · epipelagic', from: 0, jump: 12 },
  { name: 'Twilight zone · mesopelagic', from: 200, jump: 350 },
  { name: 'Midnight zone · bathypelagic', from: 1000, jump: 1400 },
  { name: 'Abyssal zone · abyssopelagic', from: 3000, jump: 3740 },
  { name: 'Hadal zone · trench', from: 6000, jump: 6100 },
];

// ---------------------------------------------------------------- swell
// Gerstner waves: [wavelength m, amplitude m, direction deg, steepness]. A long swell from one quarter, a wind sea
// spread around the wind, and chop; steepness peaks in the wind sea where real crests are sharpest. (Σ Q·k·A stays
// well under 1, so crests sharpen without looping over.)
const W = [
  [128, 0.5, 6, 0.55], [88, 0.42, 24, 0.65], [66, 0.34, -14, 0.75],
  [47, 0.38, 38, 0.9], [35, 0.29, -28, 0.95], [26, 0.22, 10, 1.0], [19.5, 0.16, 52, 1.0], [14.5, 0.115, -44, 0.95],
  [10.5, 0.078, 26, 0.85], [7.8, 0.055, -64, 0.75], [5.7, 0.036, 74, 0.65], [4.1, 0.023, -18, 0.55],
  [3.0, 0.014, 46, 0.45], [2.1, 0.009, -80, 0.35],
];
export const WAVES = W.map(([L, A, d, q]) => {
  const k = (2 * Math.PI) / L;
  const a = THREE.MathUtils.degToRad(d);
  return { L, A, k, dx: Math.cos(a), dz: Math.sin(a), q, w: Math.sqrt(9.81 * k) };
});

// Sea state: the evening breeze dies away after sunset and the sea lies down for the night. amp scales every wave
// (kept current by main.js so the GPU surface and the sub's bobbing agree); calm is 0 by day, 1 at night.
export const SEA = { amp: 1, calm: 0 };

// CPU sea height at (x, z) — ignores the small horizontal Gerstner shift (good to a few cm)
export function seaHeight(x, z, t) {
  let h = 0;
  for (const w of WAVES) h += w.A * Math.sin(w.k * (w.dx * x + w.dz * z) - w.w * t);
  return h * SEA.amp;
}

export const GLSL_WAVES = `
const int NW = ${WAVES.length};
const vec4 WV[NW] = vec4[NW](${WAVES.map((w) => `vec4(${w.dx.toFixed(5)},${w.dz.toFixed(5)},${w.k.toFixed(5)},${w.A.toFixed(5)})`).join(',')});
const vec2 WQ[NW] = vec2[NW](${WAVES.map((w) => `vec2(${w.q.toFixed(3)},${w.w.toFixed(5)})`).join(',')});
`;

export const GLSL_NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i+vec3(0,0,0)), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
// classic trig-warp water caustic, returns ~0..1.5
float caustic(vec2 p, float t){
  p = mod(p, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = .005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n+1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0/length(vec2(p.x / (sin(i.x+tt)/inten), p.y / (cos(i.y+tt)/inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

// Light reaching depth d (metres) relative to the surface, per channel (the spectral model, with the twilight).
export function lightAtDepth(d, out = new THREE.Vector3()) {
  return waterLight(d, out);
}

// Small deterministic RNG so the ocean is the same every visit.
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
