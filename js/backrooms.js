// Beneath the Challenger Deep. Past the lander a perfectly square opening is cut into the hadal mud. It drops into a
// flooded backroom that has no end: catacomb corridors of charred, rusted plate and ossuary stone, streamed in around
// you however far you walk. Most of the ceiling fluorescents are dead and the rest are dying, so you will want a
// flashlight, and the flashlight is dying too. The hatch slams shut behind you at a moment of its own choosing and only
// grinds open again every three minutes. A television hangs by its cord in the first hall, showing nothing but static,
// and someone has written on the wall.
import * as THREE from 'three';
import { GeoBuilder, C, v3 } from './builders.js';
import { patch, G, ensurePhase, GLSL_TRANSP } from './materials.js';
import { photographic } from './pbr.js';
import { Kit, M } from './shipkit.js';
import { rng } from './common.js';

export const BACKROOM_HOLE = { x: 0, z: 6215 };   // 45 m past the lander, on the beacon line
const S = 4;              // grid cell (m); the shaft is exactly one cell: a 4 m square opening
const SH = S / 2;
const T = 0.5;            // plate wall thickness
const PIL = 0.72;         // stone columns at the cell corners
const ROOM_H = 3.2;       // floor to ceiling
const SHAFT_D = 4.6;      // seabed down to the hall ceiling
const CH = 6;             // cells per streamed chunk side (24 m)
const NICHE_T = 1.1, NICHE_D = 0.4;   // ossuary walls and the depth of their burial niches
const SEAL_TIME = 180;    // the hatch reopens every three minutes...
const WINDOW = 30;        // ...for half a minute
const RAD = 0.7;          // your reach when walking (collision radius)
const LIGHT_R = 8;        // how far a working tube still lights anything
const TINT = new THREE.Color(0.72, 1.0, 0.6);   // old fluorescent tubes gone sickly green

// ---------------------------------------------------------------- the endless plan
// Integer hash: every cell, wall and fitting is a pure function of its grid coordinates, so the maze is the same on
// every visit and any part of it can be rebuilt (or collided with) without storing it.
function ih(a, b, s) {
  let h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(s | 0, 83492791)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vn2(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = ih(xi, zi, s), b = ih(xi + 1, zi, s), c = ih(xi, zi + 1, s), d = ih(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// the first hall: 5 × 5 cells around the shaft, ringed by walls with five doorways out
const inHall = (i, j) => Math.abs(i) <= 2 && Math.abs(j) <= 2;
// corridors run mostly one way in each 7 × 7 district (walls parallel to them are likely, walls across them rare),
// so the plan reads as long passages that turn, branch and dead-end; now and then a pillared crypt opens up
const regionDir = (i, j) => (ih(Math.floor(i / 7), Math.floor(j / 7), 3) < 0.5 ? 0 : 1);
const openRegion = (i, j) => ih(Math.floor((i + 600) / 6), Math.floor((j + 600) / 6), 9) < 0.11;
// both mean wall probabilities sum past 1, so open floor always percolates: there is always a way on
function wallE(i, j) {   // between cell (i, j) and (i + 1, j)
  const a = inHall(i, j), b = inHall(i + 1, j);
  if (a && b) return false;
  if (a !== b) return i === 2 ? j !== -1 : j !== 1;
  if ((j === -1 && (i === 3 || i === 4)) || (j === 1 && (i === -4 || i === -5))) return false;   // clear of the doorways
  const r = ih(i, j, 1);
  if (openRegion(i, j)) return r < 0.05;
  return r < (regionDir(i, j) === 0 ? 0.24 : 0.58);
}
function wallN(i, j) {   // between cell (i, j) and (i, j + 1)
  const a = inHall(i, j), b = inHall(i, j + 1);
  if (a && b) return false;
  if (a !== b) return j === 2 ? i !== -2 && i !== 2 : i !== 1;
  if ((i === -2 || i === 2) && (j === 3 || j === 4)) return false;
  if (i === 1 && (j === -4 || j === -5)) return false;
  const r = ih(i, j, 2);
  if (openRegion(i, j)) return r < 0.05;
  return r < (regionDir(i, j) === 0 ? 0.58 : 0.24);
}
// stone column at the corner shared by cells (i, j)…(i + 1, j + 1): wherever walls meet, and at random in the open
function pillar(i, j) {
  if ((i === 0 || i === -1) && (j === 0 || j === -1)) return false;   // the shaft's own corners
  if (wallN(i, j) || wallN(i + 1, j) || wallE(i, j) || wallE(i, j + 1)) return true;
  if (inHall(i, j) && inHall(i + 1, j + 1)) return true;              // the hall's colonnade
  return ih(i, j, 5) < 0.3;
}
// burial niches: 0 for a plain plate wall, ±1 for the face that is pierced
function niche(dir, i, j) {
  if (dir === 0 && i === -3 && Math.abs(j) <= 2) return 1;            // the hall's west and south walls are ossuaries
  if (dir === 1 && j === -3 && Math.abs(i) <= 2) return 1;
  if (inHall(i, j) || inHall(i + (dir ? 0 : 1), j + (dir ? 1 : 0))) return 0;
  const r = ih(i, j, 31 + dir);
  return r < 0.06 ? -1 : r < 0.12 ? 1 : 0;
}
function fixture(i, j) {
  if (i === 0 && j === 0) return null;
  if (inHall(i, j)) {
    if (i === 1 && j === -1) return { lit: true, flick: true, seed: 0.37, along: 0, I: 1.1 };
    if (i === -2 && j === 2) return { lit: true, flick: false, seed: 0, along: 1, I: 0.5 };
    if ((i === 2 && j === 1) || (i === -1 && j === -2) || (i === 1 && j === 2) || (i === -2 && j === -1)) return { lit: false, along: (i + j) & 1, hang: i === 2 };
    return null;
  }
  if (ih(i, j, 21) > 0.5) return null;
  const lit = ih(i, j, 22) < 0.52;   // about one cell in four has a tube still (barely) working
  return { lit, flick: lit && ih(i, j, 23) < 0.4, seed: ih(i, j, 24), along: regionDir(i, j), I: 0.7 + ih(i, j, 25) * 0.6, hang: !lit && ih(i, j, 26) < 0.3 };
}

// ---------------------------------------------------------------- charring and dying-tube glow (material chain)
// Runs after patch() and photographic(): fire has blackened everything, climbing the walls in tongues and pooling
// across the ceilings, the char alligatored into blistered cells with bare rust blooming along the burn's edge. Baked
// tube light arrives per vertex (aGlow steady, aFlk = amount and seed of a flickering tube) as emissive radiance.
const FRAG_DECL = /* glsl */`
  uniform vec3 uBrOrigin, uFlkTint; uniform float uBrFloor, uBrCeil, uCharBase, uWet, uWetTop, uWeather, uMineral, uBrAmb;
  varying vec2 vFlk; varying float vWall; varying vec3 vLpos;
  float brFlick(float s){
    float cyc = 3.0 + fract(s * 7.31) * 6.0;
    float ph = fract(uTime / cyc + s);
    float rnd = hash12(vec2(floor(uTime / cyc + s), s * 113.1));
    float stutter = step(0.45, hash12(vec2(floor(uTime * 22.0), s * 57.3)));
    float on = ph < 0.14 ? stutter : (ph < 0.82 ? 1.0 : step(0.6, rnd) * stutter);
    return on * (0.88 + 0.12 * hash12(vec2(floor(uTime * 50.0), s)));
  }`;
const CHAR_CODE = /* glsl */`
  float charA = 0.0;
  {
    vec3 q = vWPos - uBrOrigin;
    float hgt = clamp((vWPos.y - uBrFloor) / 3.2, 0.0, 1.2);
    vec3 an = abs(vWNrm);
    float licks = fbm3(vec3(q.x * 0.55, q.y * 0.2 - 3.0, q.z * 0.55) + 4.0);
    float body = fbm3(q * 0.18 + 21.0);
    float down = smoothstep(0.55, 0.95, -vWNrm.y);
    charA = smoothstep(0.45, 0.75, licks + hgt * 0.42 + body * 0.25 - 0.3);
    charA = max(charA, down * smoothstep(0.3, 0.6, body + 0.25));
    charA = clamp(charA + uCharBase * (0.6 + 0.8 * body), 0.0, 1.0);
    vec2 cp = (an.y > 0.6 ? q.xz : (an.x > an.z ? q.zy : q.xy)) * 13.0;
    vec2 ci = floor(cp), cf = fract(cp);
    float f1 = 8.0, f2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 rp = o + vec2(hash12(ci + o), hash12(ci + o + 17.3)) - cf;
      float d = dot(rp, rp);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    float crack = (1.0 - smoothstep(0.0, 0.08, sqrt(f2) - sqrt(f1))) * aaFade(vec3(cp, 0.0)) * smoothstep(0.4, 0.7, fbm3(q * 0.9 + 5.0));
    vec3 charC = mix(vec3(0.03, 0.024, 0.02), vec3(0.07, 0.048, 0.034), hash12(ci) * 0.5 + body * 0.5);
    charC *= 1.0 - crack * 0.28;
    float edge = smoothstep(0.2, 0.45, charA) * (1.0 - smoothstep(0.45, 0.75, charA));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38, 0.13, 0.04) * (0.6 + 0.6 * dn2), edge * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, charC, charA * 0.93);
  }`;
// Ages of standing water at crushing depth: silt and black slime packed into every corner and along the foot and head
// of every wall (vWall is the baked distance to the nearest other wall or column), the crisp-topped scum lines where
// the water once stood still for years, and long runs of rust (on plate) or white mineral (on stone) bled down from
// the ceiling and the seams. Then the water film: everything below the wet line is darker and slick, glossy where
// it has pooled and dull where silt has settled on it (a clearcoat on the floor and columns, so the flashlight
// throws a sharp highlight off a surface that is itself rough).
const WEATHER_CODE = /* glsl */`
  float grimeA = 0.0, wetA = 0.0, slick = 0.0, poolA = 0.0;
  {
    vec3 q = vWPos - uBrOrigin;
    float hF = vWPos.y - uBrFloor, hC = uBrCeil - vWPos.y;
    float vert = 1.0 - abs(vWNrm.y);
    float nearW = 1.0 - smoothstep(0.0, 0.55, vWall);
    float n1 = fbm3(q * 1.6 + 3.0), n2 = vnoise(q * 7.0);
    float edge = max((1.0 - vert) * nearW, vert * max(max(1.0 - smoothstep(0.0, 0.5, hF), 1.0 - smoothstep(0.0, 0.35, hC)), nearW * 0.85));
    grimeA = smoothstep(0.2, 0.75, edge * (0.55 + 0.7 * n1) + n2 * 0.08) * uWeather;
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.02, 0.025, 0.018), vec3(0.07, 0.065, 0.04), n2), grimeA * 0.85);
    if (vert > 0.5) {
      vec2 cell = floor(q.xz / 24.0);
      for (int k = 0; k < 2; k++) {
        float fk = float(k);
        float lv = (k == 0 ? 0.75 : 1.95) + (hash12(cell + fk * 7.1) - 0.5) * 0.5 + (vnoise(q * 0.9 + fk) - 0.5) * 0.06;
        float present = step(0.3, hash12(cell + fk * 3.3)) * uWeather;
        float band = smoothstep(lv - 0.3, lv - 0.01, hF) * (1.0 - smoothstep(lv - 0.01, lv + 0.004, hF));
        float line = 1.0 - smoothstep(0.0, 0.018, abs(hF - lv));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.5, 0.42), band * 0.75 * present);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.18, 0.14), line * 0.65 * present);
      }
      float along = abs(vWNrm.x) > abs(vWNrm.z) ? q.z : q.x;
      float streak = fbm3(vec3(along * 5.0, q.y * 0.35, along * 0.3 + 2.0));
      float src = max(1.0 - smoothstep(0.0, 1.7, hC), step(hF, 1.62) * (1.0 - smoothstep(0.0, 1.0, 1.62 - hF)) * 0.8);
      float bleed = smoothstep(0.55, 0.8, streak + src * 0.25) * src * uWeather;
      vec3 rustC = vec3(0.36, 0.13, 0.04) * (0.7 + 0.5 * n2), minC = vec3(0.5, 0.48, 0.42) * (0.8 + 0.3 * n2);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(rustC, minC, uMineral), bleed * 0.6);
      // efflorescence: white mineral crust creeping up stone from the floor
      float crust = smoothstep(0.58, 0.8, fbm3(q * 2.3 + 5.0)) * (1.0 - smoothstep(0.0, 1.1, hF)) * uMineral * uWeather;
      diffuseColor.rgb = mix(diffuseColor.rgb, minC * 0.9, crust * 0.55);
    }
    float wetLine = uWetTop + (vnoise(q * 1.3) - 0.5) * 0.35;
    wetA = uWet * (1.0 - smoothstep(wetLine - 0.25, wetLine, hF));
    poolA = smoothstep(0.35, 0.7, fbm3(q * 0.9 + 8.0));
    slick = wetA * mix(0.45, 1.0, poolA) * (1.0 - grimeA * 0.3);
    diffuseColor.rgb *= mix(1.0, mix(0.62, 0.4, poolA), wetA);   // soaked things go dark, darkest where it has pooled
  }`;
// The tubes' light baked per vertex lands on the surface's own colour (so a lit wall shows its rust and char rather than a
// flat wash), and where a surface is wet the tube is mirrored in its water film: a tight, Fresnel-weighted Blinn
// highlight toward the vertex's strongest tube, sharper where the water has pooled.
const GLOW_SURFACE = /* glsl */`
  {
    // the dying tubes' light, plus the faintest glow that seems to come from nowhere (enough to make out the walls
    // and find your way without a flashlight, a little darker in the grimy corners); it falls on the surface's own
    // colour, with a floor so that even black char still shows
    vec3 bakedL = vGlow + uFlkTint * vFlk.x * brFlick(vFlk.y);
    vec3 lit = bakedL + uFlkTint * uBrAmb * (1.0 - grimeA * 0.5);
    totalEmissiveRadiance += lit * (0.25 + diffuseColor.rgb * 5.0);
    if (slick > 0.01) {
      vec3 Nw = normalize(vWNrm), Vw = normalize(cameraPosition - vWPos), Lw = normalize(vLpos - vWPos);
      float sh = mix(70.0, 320.0, poolA);
      float spec = pow(max(dot(Nw, normalize(Lw + Vw)), 0.0), sh) * (sh + 8.0) / 25.0;
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(Nw, Vw), 0.0), 5.0);
      totalEmissiveRadiance += bakedL * spec * fres * slick * 1.6;
    }
  }`;
function charred(mat, U, { char = 0.15, soot = true, wet = 0, wetTop = 99, weather = 1, mineral = 0 } = {}) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, renderer) => {
    prev.call(mat, sh, renderer);
    Object.assign(sh.uniforms, { uBrOrigin: U.uOrigin, uBrFloor: U.uFloor, uBrCeil: U.uCeil, uBrAmb: U.uAmb, uFlkTint: U.uTint, uCharBase: { value: char },
      uWet: { value: wet }, uWetTop: { value: wetTop }, uWeather: { value: weather }, uMineral: { value: mineral } });
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'attribute vec2 aFlk; attribute float aWall; attribute vec3 aLpos; varying vec2 vFlk; varying float vWall; varying vec3 vLpos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vFlk = aFlk; vWall = aWall; vLpos = aLpos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${FRAG_DECL}\nvoid main() {`)
      .replace('totalEmissiveRadiance += vGlow;', soot ? GLOW_SURFACE : 'totalEmissiveRadiance += vGlow + uFlkTint * vFlk.x * brFlick(vFlk.y);');
    if (soot) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', `${CHAR_CODE}\n${WEATHER_CODE}\n#include <roughnessmap_fragment>`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 1.0, charA * 0.85); metalnessFactor *= 1.0 - charA * 0.8;
          roughnessFactor = mix(roughnessFactor, mix(0.55, 0.22, poolA), wetA * 0.8);   // the roughness map of a soaked surface`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
          #ifdef USE_CLEARCOAT
            material.clearcoat = slick;   // the water film
            material.clearcoatRoughness = min(max(mix(0.3, 0.07, poolA), 0.0525) + geometryRoughness, 1.0);
          #endif`);
    }
  };
  mat.customProgramCacheKey = () => `${prevKey()}|backroom${soot ? '-char' : ''}`;
  return mat;
}

// ---------------------------------------------------------------- the writing on the wall
function drip(m, x, y, r) {
  const len = 18 + Math.pow(r(), 2.1) * 330, w = 2.5 + r() * 8.5, wob = r() * 6.28;
  for (let s = 0; s < len; s += 1.5) {
    const ww = w * (1 - 0.55 * (s / len)) * (0.85 + 0.25 * Math.sin(s * 0.06 + wob));
    m.beginPath(); m.ellipse(x + Math.sin(s * 0.013 + wob) * 1.6, y + s, ww / 2, 1.6, 0, 0, 6.2832); m.fill();
  }
  m.beginPath(); m.arc(x + Math.sin(len * 0.013 + wob) * 1.6, y + len + w * 0.25, w * 0.62, 0, 6.2832); m.fill();
}
// "!?" daubed in blood: a horror face if the font arrives, Impact if not; drips run off the underside of every stroke
async function bloodCanvas() {
  if (typeof document === 'undefined') return null;
  let font = '900 {S}px Impact, "Arial Black", sans-serif';
  try {
    const got = await Promise.race([document.fonts.load('400 160px "Creepster"', '!?'), new Promise((r) => setTimeout(() => r([]), 3000))]);
    if (got && got.length) font = '400 {S}px "Creepster", Impact, sans-serif';
  } catch { /* the fallback face is fine */ }
  const W = 1024, r = rng(616);
  const mask = document.createElement('canvas'); mask.width = mask.height = W;
  const m = mask.getContext('2d', { willReadFrequently: true });
  let size = 700;
  m.font = font.replace('{S}', size);
  size = Math.min(size, size * (W * 0.84) / Math.max(m.measureText('!?').width, 1));
  m.font = font.replace('{S}', Math.round(size));
  m.textAlign = 'center'; m.textBaseline = 'alphabetic'; m.fillStyle = '#fff';
  for (let p = 0; p < 7; p++) {   // painted with a soaked rag: several rough passes
    m.save();
    m.globalAlpha = p === 0 ? 1 : 0.45;
    m.translate(W / 2 + (r() - 0.5) * 10, W * 0.64 + (r() - 0.5) * 8);
    m.rotate((r() - 0.5) * 0.025 - 0.03);
    m.fillText('!?', 0, 0);
    m.restore();
  }
  const img = m.getImageData(0, 0, W, W).data, A = (x, y) => img[(y * W + x) * 4 + 3];
  m.globalAlpha = 1;
  let drips = 0;
  for (let n = 0; n < 420 && drips < 70; n++) {
    const x = 4 + Math.floor(r() * (W - 8));
    for (let y = 2; y < W - 4; y++) if (A(x, y) > 160 && A(x, y + 2) < 40) { if (r() < 0.22) { drip(m, x, y - 3, r); drips++; } y += 6; }
  }
  for (let n = 0; n < 300; n++) {   // spatter flung off the strokes
    const x = Math.floor(r() * W), y = Math.floor(r() * W * 0.9);
    let near = false;
    for (let q = 0; q < 6 && !near; q++) {
      const a = r() * 6.283, d = 6 + r() * 34, xx = Math.round(x + Math.cos(a) * d), yy = Math.round(y + Math.sin(a) * d);
      if (xx > 0 && yy > 0 && xx < W && yy < W && A(xx, yy) > 128) near = true;
    }
    if (near) { m.beginPath(); m.arc(x, y, 0.8 + r() * r() * 7, 0, 6.2832); m.fill(); }
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = W;
  const g = cv.getContext('2d');
  g.filter = 'blur(1.2px)'; g.drawImage(mask, 0, 0); g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  const grad = g.createLinearGradient(0, W * 0.15, 0, W);
  grad.addColorStop(0, '#8a070a'); grad.addColorStop(0.55, '#650306'); grad.addColorStop(1, '#3d0204');
  g.fillStyle = grad; g.fillRect(0, 0, W, W);
  g.globalCompositeOperation = 'source-atop';
  for (let n = 0; n < 160; n++) {   // clotted, dried patches
    g.fillStyle = `rgba(${(18 + r() * 22) | 0},0,${(r() * 4) | 0},${0.15 + r() * 0.35})`;
    g.beginPath(); g.ellipse(r() * W, r() * W, 8 + r() * 60, 6 + r() * 40, r() * 3, 0, 6.2832); g.fill();
  }
  for (let n = 0; n < 90; n++) { g.fillStyle = `rgba(175,20,18,${0.08 + r() * 0.18})`; g.fillRect(r() * W, r() * W, 1.5 + r() * 3, 20 + r() * 120); }   // wet runs
  g.globalCompositeOperation = 'destination-out';
  for (let n = 0; n < 900; n++) { g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.6})`; g.beginPath(); g.arc(r() * W, r() * W, 0.5 + r() * r() * 3.5, 0, 6.2832); g.fill(); }
  g.globalCompositeOperation = 'source-over';
  return cv;
}

// ================================================================= module
export async function createBackrooms(ctx, seafloor) {
  const { scene, camera, mods } = ctx;
  const HX = BACKROOM_HOLE.x, HZ = BACKROOM_HOLE.z;
  const SEABED = seafloor ? seafloor.heightAt(HX, HZ) : -10935;
  const CEIL = SEABED - SHAFT_D, FLOOR = CEIL - ROOM_H;
  const cx = (i) => HX + i * S, cz = (j) => HZ + j * S;
  const group = new THREE.Group();
  group.name = 'Backrooms';
  group.visible = false;
  scene.add(group);
  if (seafloor?.holeClip) seafloor.holeClip.value.set(HX, HZ, SH, 0);   // cut the opening out of the hadal mud

  // ---------------------------------------------------------------- materials
  const U = { uOrigin: { value: new THREE.Vector3(HX, FLOOR, HZ) }, uFloor: { value: FLOOR }, uCeil: { value: CEIL }, uAmb: { value: 0.14 }, uTint: { value: new THREE.Vector3(TINT.r, TINT.g, TINT.b) } };
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  // floor and columns carry a clearcoat: the water film over them, its strength and gloss set per fragment
  const wetStd = (o) => new THREE.MeshPhysicalMaterial({ vertexColors: true, clearcoat: 1, clearcoatRoughness: 0.1, ...o });
  const MATS = {
    wall: charred(photographic(patch(std({ roughness: 0.88, metalness: 0.3 }), { detail: 'rust', glow: true, bump: 'paint', bumpAmp: 2.4, dust: 0.12 }), 'rusty_metal_03', { scale: 0.55, strength: 0.75, normal: 0.85 }), U, { char: 0.12, wet: 0.4, wetTop: 0.9 }),
    stone: charred(photographic(patch(wetStd({ roughness: 0.95 }), { detail: 'limestone', glow: true, bump: 'limestone', bumpAmp: 1.6, dust: 0.3 }), 'rock_face_03', { scale: 0.45, strength: 0.7, normal: 0.8, tint: 0x9a9088 }), U, { char: 0.2, wet: 0.95, wetTop: 1.15, mineral: 1 }),
    floor: charred(photographic(patch(wetStd({ roughness: 0.96 }), { detail: 'sediment', glow: true, bump: 'sand', bumpAmp: 1.0, dust: 0.22 }), 'rock_face_03', { scale: 0.3, strength: 0.38, normal: 0.5 }), U, { char: 0.08, wet: 1, mineral: 0.4 }),
    ceil: charred(photographic(patch(std({ roughness: 0.9, metalness: 0.2 }), { detail: 'rust', glow: true, bump: 'plates', bumpAmp: 1.4 }), 'rusty_metal_03', { scale: 0.5, strength: 0.55, normal: 0.6 }), U, { char: 0.42, weather: 0.6 }),
    lamp: charred(patch(std({ roughness: 0.45, metalness: 0.1 }), { glow: true }), U, { soot: false }),
    bone: patch(std({ roughness: 0.75 }), { detail: 'bone', glow: true, dust: 0.45 }),
    leather: patch(std({ roughness: 0.85 }), { glow: true, dust: 0.4 }),
    shell: patch(std({ roughness: 0.55, metalness: 0.1 }), { detail: 'sediment', glow: true, dust: 0.3 }),
  };
  const CHAINED = new Set(['wall', 'stone', 'floor', 'ceil', 'lamp']);
  const WALL_C = C(0x4a3426), STONE_C = C(0x5a5048), BEAM_C = C(0x2e241e), HOUSING_C = C(0x3a3630), PIPE_C = C(0x3b2a20), BONE_C = C(0x9c8a6c);
  const ceilCol = (x, z) => new THREE.Color(0.2, 0.17, 0.15).multiplyScalar(0.75 + 0.4 * vn2(x * 0.4, z * 0.4, 12));
  const floorCol = (x, z) => new THREE.Color(0.25, 0.22, 0.19).multiplyScalar(0.7 + 0.45 * vn2(x * 0.35, z * 0.35, 7) + 0.15 * vn2(x * 1.3, z * 1.3, 8));

  const canvas = await bloodCanvas();
  const bloodTex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (bloodTex) { bloodTex.colorSpace = THREE.SRGBColorSpace; bloodTex.anisotropy = 8; }
  const bloodMat = new THREE.MeshStandardMaterial({ map: bloodTex, transparent: true, depthWrite: false, roughness: 0.58, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, alphaTest: 0.03,
    emissive: 0xff1410, emissiveMap: bloodTex, emissiveIntensity: 0 });   // the faintest glint, so it is there in the dark
  const bloodGeo = new THREE.PlaneGeometry(1, 1);

  // ---------------------------------------------------------------- baked tube light
  // does a wall stand between a and b? (walk the grid lines the segment crosses)
  function blocked(ax, az, bx, bz) {
    const gx0 = (ax - HX) / S, gz0 = (az - HZ) / S, gx1 = (bx - HX) / S, gz1 = (bz - HZ) / S;
    let lo = Math.min(gx0, gx1), hi = Math.max(gx0, gx1);
    for (let k = Math.ceil(lo - 0.5); k + 0.5 < hi; k++) {
      if (k + 0.5 <= lo) continue;
      const t = (k + 0.5 - gx0) / (gx1 - gx0);
      if (wallE(k, Math.round(gz0 + t * (gz1 - gz0)))) return true;
    }
    lo = Math.min(gz0, gz1); hi = Math.max(gz0, gz1);
    for (let k = Math.ceil(lo - 0.5); k + 0.5 < hi; k++) {
      if (k + 0.5 <= lo) continue;
      const t = (k + 0.5 - gz0) / (gz1 - gz0);
      if (wallN(Math.round(gx0 + t * (gx1 - gx0)), k)) return true;
    }
    return false;
  }
  function lightsAround(i0, j0, i1, j1) {
    const out = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const f = fixture(i, j);
      if (f?.lit) out.push({ x: cx(i), y: CEIL - 0.15, z: cz(j), I: f.I, flick: f.flick, seed: f.seed });
    }
    return out;
  }
  // the solid footprint of a cell's walls and corner column (as built, not padded for collision)
  function geomBoxes(i, j, out) {
    const x = cx(i), z = cz(j);
    if (wallE(i, j)) { const t = (niche(0, i, j) ? NICHE_T : T) / 2; out.push(x + SH - t, z - SH, x + SH + t, z + SH); }
    if (wallN(i, j)) { const t = (niche(1, i, j) ? NICHE_T : T) / 2; out.push(x - SH, z + SH - t, x + SH, z + SH + t); }
    if (pillar(i, j)) { const h = PIL / 2; out.push(x + SH - h, z + SH - h, x + SH + h, z + SH + h); }
  }
  // distance across the floor plan from a point to the nearest wall or column other than the one it lies on: what
  // the grime in corners and along the foot of the walls is measured by (linear across a 1 m quad, so it interpolates
  // well per vertex)
  const boxCache = new Map();
  function wallDistance(x, z, horizontal) {
    const ci = Math.round((x - HX) / S), cj = Math.round((z - HZ) / S), key = ci * 100003 + cj;
    let list = boxCache.get(key);
    if (!list) {
      list = [];
      for (let i = ci - 2; i <= ci + 1; i++) for (let j = cj - 2; j <= cj + 1; j++) geomBoxes(i, j, list);
      boxCache.set(key, list);
    }
    let best = 9;   // squared
    for (let b = 0; b < list.length; b += 4) {
      let dx = list[b] - x; if (dx < 0) { dx = x - list[b + 2]; if (dx < 0) dx = 0; }
      let dz = list[b + 1] - z; if (dz < 0) { dz = z - list[b + 3]; if (dz < 0) dz = 0; }
      const d2 = dx * dx + dz * dz;
      if (!horizontal && d2 < 0.0009) continue;   // a wall's own face is not a corner
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }
  const sstep = (x, a, b) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  function bake(geo, lights) {
    const P = geo.attributes.position.array, Nn = geo.attributes.normal.array, n = geo.attributes.position.count;
    const glow = geo.attributes.aGlow ? geo.attributes.aGlow.array : new Float32Array(n * 3);
    const flk = new Float32Array(n * 2), wall = new Float32Array(n), lpos = new Float32Array(n * 3), R2 = LIGHT_R * LIGHT_R;
    // only the tubes that can reach this piece of geometry at all
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const near = lights.filter((L) => L.x > bb.min.x - LIGHT_R && L.x < bb.max.x + LIGHT_R && L.z > bb.min.z - LIGHT_R && L.z < bb.max.z + LIGHT_R && L.y > bb.min.y - LIGHT_R && L.y < bb.max.y + LIGHT_R);
    const tr = TINT.r, tg = TINT.g, tb = TINT.b;
    for (let v = 0; v < n; v++) {
      const o = v * 3, px = P[o], py = P[o + 1], pz = P[o + 2], nx = Nn[o], ny = Nn[o + 1], nz = Nn[o + 2];
      wall[v] = py > CEIL + 0.05 ? 3 : wallDistance(px + nx * 0.005, pz + nz * 0.005, ny > 0.5 || ny < -0.5);
      let best = 0, top = 0;
      lpos[o] = px; lpos[o + 1] = py + 10; lpos[o + 2] = pz;
      for (let l = 0; l < near.length; l++) {
        const L = near[l], dx = L.x - px;
        if (dx > LIGHT_R || dx < -LIGHT_R) continue;
        const dz = L.z - pz;
        if (dz > LIGHT_R || dz < -LIGHT_R) continue;
        const dy = L.y - py, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R2) continue;
        const d = Math.sqrt(d2) + 1e-4, ndl = (nx * dx + ny * dy + nz * dz) / d;
        if (ndl < -0.3) continue;
        const a = 2.5 * L.I * ((ndl > 0 ? ndl : 0) * 0.85 + 0.12 * sstep(ndl, -0.3, 0.2)) / (1 + d2 * 0.55) * (1 - sstep(d, LIGHT_R * 0.55, LIGHT_R));
        if (a < 0.003 || blocked(px + nx * 0.06, pz + nz * 0.06, L.x, L.z)) continue;
        if (a > top) { top = a; lpos[o] = L.x; lpos[o + 1] = L.y; lpos[o + 2] = L.z; }
        if (L.flick) { flk[v * 2] += a; if (a > best) { best = a; flk[v * 2 + 1] = L.seed; } }
        else { glow[o] += a * tr; glow[o + 1] += a * tg; glow[o + 2] += a * tb; }
      }
    }
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3));
    geo.setAttribute('aFlk', new THREE.BufferAttribute(flk, 2));
    geo.setAttribute('aWall', new THREE.BufferAttribute(wall, 1));
    geo.setAttribute('aLpos', new THREE.BufferAttribute(lpos, 3));
    if (boxCache.size > 4000) boxCache.clear();
  }
  function lampGlow(geo, ranges) {
    const glow = geo.attributes.aGlow.array, flk = new Float32Array(geo.attributes.position.count * 2);
    for (const { start, end, f } of ranges) {
      if (!f.lit) continue;
      for (let v = start; v < end; v++) {
        if (f.flick) { flk[v * 2] = 16 * f.I; flk[v * 2 + 1] = f.seed; glow[v * 3] = TINT.r * 0.15; glow[v * 3 + 1] = TINT.g * 0.15; glow[v * 3 + 2] = TINT.b * 0.15; }
        else { glow[v * 3] = TINT.r * 16 * f.I; glow[v * 3 + 1] = TINT.g * 16 * f.I; glow[v * 3 + 2] = TINT.b * 16 * f.I; }
      }
    }
    geo.attributes.aGlow.needsUpdate = true;
    geo.setAttribute('aFlk', new THREE.BufferAttribute(flk, 2));
    geo.setAttribute('aWall', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(3), 1));
  }
  function kitToGroup(k, lights, lampRanges = [], g = new THREE.Group()) {
    for (const [key, b] of Object.entries(k.parts)) {
      if (!b.pos.length) continue;
      const geo = ensurePhase(b.build());
      if (key === 'lamp') lampGlow(geo, lampRanges);
      else if (CHAINED.has(key)) bake(geo, lights);
      const mesh = new THREE.Mesh(geo, MATS[key] ?? MATS.wall);
      mesh.castShadow = key === 'wall' || key === 'stone' || key === 'shell';
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }
  function decal(g, x, y, z, rotY, size) {
    if (!bloodTex) return;
    const m = new THREE.Mesh(bloodGeo, bloodMat);
    m.position.set(x, y, z); m.rotation.y = rotY; m.scale.setScalar(size);
    m.userData.shared = true;
    m.receiveShadow = true;
    g.add(m);
  }

  // ---------------------------------------------------------------- dressing one cell
  const o1 = { res: 1, collide: false };
  function wallSegment(k, g, dir, i, j) {
    // dir 0: the east edge (a wall along z at x = c); dir 1: the north edge (a wall along x at z = c)
    const c = dir ? cz(j) + SH : cx(i) + SH, mid = dir ? cx(i) : cz(j);
    const a0 = mid - SH + PIL / 2, a1 = mid + SH - PIL / 2;
    const side = niche(dir, i, j);
    const col = (side ? STONE_C : WALL_C).clone().multiplyScalar(0.8 + ih(i, j, 33 + dir) * 0.4);
    const wall = (mat, cc, t, holes) => (dir ? k.wallX(mat, a0, a1, FLOOR, CEIL, cc, t, holes, col, o1) : k.wallZ(mat, a0, a1, FLOOR, CEIL, cc, t, holes, col, o1));
    if (side) {
      // an ossuary wall: three tiers of burial niches, the dead pushed into them
      const holes = [];
      for (const [y0, y1] of [[0.4, 0.95], [1.3, 1.85], [2.2, 2.72]]) for (const s of [-1, 1]) holes.push([mid + s * 0.8 - 0.6, mid + s * 0.8 + 0.6, FLOOR + y0, FLOOR + y1]);
      wall('stone', c - side * NICHE_D / 2, NICHE_T - NICHE_D, []);
      wall('stone', c + side * (NICHE_T / 2 - NICHE_D / 2), NICHE_D, holes);
      holes.forEach((h, n) => { if (ih(i * 7 + n, j, 71 + dir) < 0.62) ossuary(k, dir, side, h, c, (i * 92821) ^ (j * 68917) ^ (n * 131 + dir)); });
      return;
    }
    wall('wall', c, T, []);
    // a riveted seam band and a skirting of heavier plate
    for (const y of [FLOOR + 0.05, FLOOR + 1.62]) for (const s of [-1, 1]) {
      const f = c + s * (T / 2 + 0.02);
      if (dir) k.box('wall', a0, y, f - 0.025, a1, y + (y > FLOOR + 1 ? 0.1 : 0.32), f + 0.025, col.clone().multiplyScalar(0.8), o1);
      else k.box('wall', f - 0.025, y, a0, f + 0.025, y + (y > FLOOR + 1 ? 0.1 : 0.32), a1, col.clone().multiplyScalar(0.8), o1);
    }
    if (ih(i, j, 51 + dir) < 0.22) {   // a corroded pipe run under the ceiling
      const s = ih(i, j, 53 + dir) < 0.5 ? -1 : 1, off = c + s * (T / 2 + 0.27), y = CEIL - 0.24;
      const A = dir ? v3(a0 - 0.3, y, off) : v3(off, y, a0 - 0.3), B = dir ? v3(a1 + 0.3, y, off) : v3(off, y, a1 + 0.3);
      k.cyl('wall', A, B, 0.075, PIPE_C, { seg: 10, collide: false });
      for (const t of [0.25, 0.75]) {
        const p = A.clone().lerp(B, t);
        if (dir) k.box('wall', p.x - 0.03, y - 0.03, c + s * T / 2, p.x + 0.03, y + 0.03, off, BEAM_C, o1);
        else k.box('wall', c + s * T / 2, y - 0.03, p.z - 0.03, off, y + 0.03, p.z + 0.03, BEAM_C, o1);
      }
    }
    if (ih(i, j, 41 + dir) < 0.006) {   // it has been written down here before
      const s = ih(i, j, 43 + dir) < 0.5 ? -1 : 1, f = c + s * (T / 2 + 0.012), size = 1.5 + ih(i, j, 45) * 1.2, y = FLOOR + 1.5 + ih(i, j, 46) * 0.4;
      if (dir) decal(g, mid, y, f, s > 0 ? 0 : Math.PI, size);
      else decal(g, f, y, mid, s > 0 ? Math.PI / 2 : -Math.PI / 2, size);
    }
  }
  // the niche dead are low in detail (there are thousands of them): a few long bones and a skull or two
  const skullLo = [0.15, 0.4].map((jaw) => {
    const b = new GeoBuilder(), col = C(0xffffff), dark = C(0x0c0906);
    b.sphere(v3(-0.012, 0.03, 0), 0.098, col, undefined, 10, v3(1.02, 0.86, 0.8));
    b.sphere(v3(0.05, -0.03, 0), 0.058, col, undefined, 8, v3(0.85, 0.95, 1.1));
    for (const s of [-1, 1]) b.sphere(v3(0.088, 0.0, s * 0.031), 0.021, dark, undefined, 6, v3(0.7, 0.9, 1));
    b.sphere(v3(0.102, -0.034, 0), 0.011, dark, undefined, 5, v3(0.6, 1.4, 0.8));
    const r = new THREE.Matrix4().makeRotationZ(-jaw), hinge = v3(-0.02, -0.035, 0);
    const J = (x, y, z) => v3(x, y, z).sub(hinge).applyMatrix4(r).add(hinge);
    b.tube([J(-0.02, -0.04, -0.045), J(0.04, -0.09, -0.035), J(0.075, -0.085, 0), J(0.04, -0.09, 0.035), J(-0.02, -0.04, 0.045)], () => 0.012, col, 5);
    return b;
  });
  const tint = (b, from, col) => { for (let n = from; n < b.col.length; n += 3) { const d = b.col[n] < 0.1; if (!d) { b.col[n] = col.r; b.col[n + 1] = col.g; b.col[n + 2] = col.b; } } };
  function bone(b, a, c, rad, col) {
    b.tube([a, c], () => rad, col, 5);
    b.sphere(a, rad * 1.7, col, undefined, 5, v3(1, 0.85, 1));
    b.sphere(c, rad * 1.5, col, undefined, 5, v3(1, 0.85, 1));
  }
  function ossuary(k, dir, side, h, c, seed) {
    const r = rng(seed >>> 0), b = k.b('bone');
    const along = (h[0] + h[1]) / 2, y = h[2], back = c + side * (NICHE_T / 2 - NICHE_D);
    const P = (a, yy, d) => (dir ? v3(a, yy, back + side * d) : v3(back + side * d, yy, a));
    const col = BONE_C.clone().multiplyScalar(0.7 + r() * 0.35);
    const n = 2 + Math.floor(r() * 4);
    for (let q = 0; q < n; q++) {
      const len = 0.32 + r() * 0.14, rad = 0.013 + r() * 0.006, d = 0.08 + r() * 0.2, lift = rad * 1.6 + Math.floor(q / 3) * 0.035, off = (r() - 0.5) * 0.4;
      bone(b, P(along + off - len / 2, y + lift, d), P(along + off + len / 2, y + lift + (r() - 0.5) * 0.02, d + (r() - 0.5) * 0.06), rad, col);
    }
    const skulls = r() < 0.8 ? 1 + (r() < 0.3 ? 1 : 0) : 0;
    const out = dir ? -side * Math.PI / 2 : side > 0 ? 0 : Math.PI;   // the face (skull +X) looks out of the niche
    for (let q = 0; q < skulls; q++) {
      const a = along + (skulls > 1 ? (q - 0.5) * 0.42 : (r() - 0.5) * 0.3);
      const m = new THREE.Matrix4().compose(P(a, y + 0.085 + (n > 3 ? 0.03 : 0), 0.24 + r() * 0.04),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.3, out + (r() - 0.5) * 0.8, (r() - 0.5) * 0.25, 'YXZ')), v3(1, 1, 1));
      const from = b.col.length;
      b.merge(skullLo[q & 1], m);
      tint(b, from, col);
    }
  }
  // someone who did not find the way out: a loose drift of bones on the floor
  function remains(k, x, z, seed) {
    const r = rng(seed >>> 0), b = k.b('bone'), col = BONE_C.clone().multiplyScalar(0.7 + r() * 0.3);
    const at = () => { const a = r() * 6.283, d = Math.sqrt(r()) * 0.7; return [x + Math.cos(a) * d, z + Math.sin(a) * d]; };
    for (let q = 0; q < 7; q++) {
      const [px, pz] = at(), a = r() * Math.PI, len = 0.25 + r() * 0.22, rad = 0.012 + r() * 0.007;
      bone(b, v3(px - Math.cos(a) * len / 2, FLOOR + rad * 1.6, pz - Math.sin(a) * len / 2), v3(px + Math.cos(a) * len / 2, FLOOR + rad * 1.5, pz + Math.sin(a) * len / 2), rad, col);
    }
    for (let q = 0; q < 5; q++) {   // ribs
      const [px, pz] = at(), a = r() * 6.283, pts = [];
      for (let n = 0; n <= 5; n++) { const th = (n / 5) * 2.2; pts.push(v3(px + Math.cos(a + th) * 0.13, FLOOR + 0.008 + Math.sin((n / 5) * Math.PI) * 0.02, pz + Math.sin(a + th) * 0.13)); }
      b.tube(pts, () => 0.007, col, 4);
    }
    const [sx, sz] = at(), from = b.col.length;
    b.merge(skullLo[r() < 0.5 ? 0 : 1], new THREE.Matrix4().compose(v3(sx, FLOOR + 0.085, sz), new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.6, r() * 6.283, (r() - 0.5) * 0.5, 'YXZ')), v3(1, 1, 1)));
    tint(b, from, col);
  }
  function column(k, i, j) {
    const x = cx(i) + SH, z = cz(j) + SH, h = PIL / 2, col = STONE_C.clone().multiplyScalar(0.8 + ih(i, j, 35) * 0.35);
    k.box('stone', x - h, FLOOR, z - h, x + h, CEIL, z + h, col, o1);
    k.box('stone', x - h - 0.1, FLOOR, z - h - 0.1, x + h + 0.1, FLOOR + 0.28, z + h + 0.1, col, o1);
    k.box('stone', x - h - 0.08, CEIL - 0.22, z - h - 0.08, x + h + 0.08, CEIL, z + h + 0.08, col, o1);
  }
  function fitting(k, f, i, j, lampRanges) {
    // a fluorescent fitting; dead ones sometimes hang from their last screw
    const ax = f.along === 0, yaw = ax ? 0 : Math.PI / 2, dirX = ax ? 1 : 0, dirZ = ax ? 0 : -1;
    const tilt = f.hang ? 0.45 + ih(i, j, 27) * 0.5 : 0;
    const m = M(cx(i) - dirX * 0.66, CEIL, cz(j) - dirZ * 0.66, yaw, 0, -tilt).multiply(new THREE.Matrix4().makeTranslation(0.66, 0, 0));
    k.box('ceil', -0.66, -0.08, -0.17, 0.66, 0, 0.17, HOUSING_C, { m, res: 0.7, collide: false });
    const start = k.b('lamp').pos.length / 3;
    k.box('lamp', -0.6, -0.13, -0.07, 0.6, -0.08, 0.07, f.lit ? C(0xe8f0d8) : C(0x5c5c54), { m, res: 0.6, collide: false, flat: true });
    lampRanges.push({ start, end: k.b('lamp').pos.length / 3, f });
  }
  function dressCell(k, g, i, j, lampRanges) {
    const x = cx(i), z = cz(j);
    if (wallE(i, j)) wallSegment(k, g, 0, i, j);
    if (wallN(i, j)) wallSegment(k, g, 1, i, j);
    if (pillar(i, j)) column(k, i, j);
    // steel beams along the open grid lines (none around the shaft, or across the hatch's parking bay)
    const skipE = (j === 0 && (i === 0 || i === -1 || i === 1)), skipN = ((i === 0 || i === 1) && (j === 0 || j === -1));
    if (!wallE(i, j) && !skipE) k.box('ceil', x + SH - 0.13, CEIL - 0.3, z - SH, x + SH + 0.13, CEIL, z + SH, BEAM_C, { res: 1.2, collide: false });
    if (!wallN(i, j) && !skipN) k.box('ceil', x - SH, CEIL - 0.26, z + SH - 0.13, x + SH, CEIL, z + SH + 0.13, BEAM_C, { res: 1.2, collide: false });
    const f = fixture(i, j);
    if (f) fitting(k, f, i, j, lampRanges);
    if (inHall(i, j)) return;
    if (ih(i, j, 61) < 0.07) {   // a cable sagging out of the ceiling
      const a = v3(x - 1.1, CEIL - 0.02, z + 0.3), b = v3(x + 1.2, CEIL - 0.02, z - 0.5), sag = 0.6 + ih(i, j, 65) * 0.9, pts = [];
      for (let q = 0; q <= 12; q++) { const t = q / 12; pts.push(a.clone().lerp(b, t).setY(CEIL - 0.02 - sag * 4 * t * (1 - t))); }
      k.tube('wall', pts, 0.016, C(0x1c1a18), 5);
    }
    if (ih(i, j, 62) < 0.08) {   // a ceiling plate come down
      const m = M(x + (ih(i, j, 66) - 0.5) * 2, FLOOR + 0.12, z + (ih(i, j, 67) - 0.5) * 2, ih(i, j, 68) * 6, 0.12, -0.08);
      k.box('ceil', -0.7, -0.03, -0.55, 0.7, 0.03, 0.55, BEAM_C, { m, res: 0.7, collide: false });
    }
    if (ih(i, j, 63) < 0.03) remains(k, x + (ih(i, j, 69) - 0.5) * 1.6, z + (ih(i, j, 70) - 0.5) * 1.6, (i * 7919) ^ (j * 104729));
  }

  // ---------------------------------------------------------------- streamed chunks
  const chunkOf = (i) => Math.floor((i + 3) / CH);   // chunk 0 holds the whole first hall (cells −3…2)
  function buildChunk(ci, cj) {
    const i0 = ci * CH - 3, j0 = cj * CH - 3;
    const k = new Kit('Backrooms', ((ci * 92821) ^ (cj * 68917) ^ 0x5bd1) >>> 0);
    const g = new THREE.Group(), lampRanges = [];
    const x0 = cx(i0) - SH, z0 = cz(j0) - SH, span = CH * S, N = CH * 4;
    k.b('floor').grid(N, N, (u, v) => { const x = x0 + v * span, z = z0 + u * span; return { p: v3(x, FLOOR, z), c: floorCol(x, z) }; });
    k.b('ceil').grid(N, N, (u, v) => { const x = x0 + u * span, z = z0 + v * span; return { p: v3(x, CEIL, z), c: ceilCol(x, z) }; }, false, (qi, qj) => {
      const x = x0 + ((qi + 0.5) * span) / N, z = z0 + ((qj + 0.5) * span) / N;
      return !(Math.abs(x - HX) < SH && Math.abs(z - HZ) < SH);
    });
    for (let i = i0; i < i0 + CH; i++) for (let j = j0; j < j0 + CH; j++) dressCell(k, g, i, j, lampRanges);
    kitToGroup(k, lightsAround(i0 - 2, j0 - 2, i0 + CH + 1, j0 + CH + 1), lampRanges, g);
    return g;
  }
  const chunks = new Map();
  function dropChunk(key) {
    const g = chunks.get(key);
    group.remove(g);
    g.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    chunks.delete(key);
  }

  // ---------------------------------------------------------------- the shaft, its hatch, the first hall
  const TVX = HX - 3.2, TVZ = HZ + 4.2, TV_YAW = Math.atan2(HX - TVX, HZ - TVZ), CORD = 0.95;
  {
    const k = new Kit('Backroom shaft', 4242);
    const wc = C(0x3d2c22), rc = C(0x33261e), t = 0.4, o = { res: 1, collide: false }, ow = { ...o, skip: 'ny' };
    // a square well lined with steel from the hall ceiling up into the mud
    const top = SEABED - 0.3;
    k.box('wall', HX - SH - t, CEIL, HZ - SH - t, HX + SH + t, top, HZ - SH, wc, ow);
    k.box('wall', HX - SH - t, CEIL, HZ + SH, HX + SH + t, top, HZ + SH + t, wc, ow);
    k.box('wall', HX - SH - t, CEIL, HZ - SH, HX - SH, top, HZ + SH, wc, ow);
    k.box('wall', HX + SH, CEIL, HZ - SH, HX + SH + t, top, HZ + SH, wc, ow);
    // a heavy collar round the opening, set flush into the seabed and bolted down
    const R = 0.55, y0 = SEABED - 0.3, y1 = SEABED + 0.24;
    k.box('wall', HX - SH - R, y0, HZ - SH - R, HX + SH + R, y1, HZ - SH, rc, o);
    k.box('wall', HX - SH - R, y0, HZ + SH, HX + SH + R, y1, HZ + SH + R, rc, o);
    k.box('wall', HX - SH - R, y0, HZ - SH, HX - SH, y1, HZ + SH, rc, o);
    k.box('wall', HX + SH, y0, HZ - SH, HX + SH + R, y1, HZ + SH, rc, o);
    for (let a = -SH - 0.2; a <= SH + 0.25; a += 0.6) for (const [bx, bz] of [[a, -SH - 0.27], [a, SH + 0.27], [-SH - 0.27, a], [SH + 0.27, a]]) {
      k.cyl('wall', v3(HX + bx, y1, HZ + bz), v3(HX + bx, y1 + 0.06, HZ + bz), 0.045, C(0x2a2018), { seg: 6, collide: false });
    }
    // rungs down one side, a few long gone
    const lr = rng(9);
    for (let y = CEIL + 0.3; y < SEABED - 0.5; y += 0.32) {
      if (lr() < 0.12) continue;
      const bend = lr() < 0.1 ? 0.12 : 0, zw = HZ - SH;
      k.tube('wall', [v3(HX - 0.28, y, zw), v3(HX - 0.28, y, zw + 0.14), v3(HX, y - bend, zw + 0.15 + bend * 0.5), v3(HX + 0.28, y, zw + 0.14), v3(HX + 0.28, y, zw)], 0.022, C(0x4a3424), 6);
    }
    // the rails the hatch runs on, under the hall ceiling
    for (const s of [-1, 1]) {
      const zr = HZ + s * (SH + 0.2);
      k.box('wall', HX - SH - 0.5, CEIL - 0.18, zr - 0.07, HX + SH + S + 0.7, CEIL, zr + 0.07, BEAM_C, o);
      for (let x = HX - SH - 0.3; x < HX + SH + S + 0.7; x += 1.6) k.box('wall', x - 0.05, CEIL - 0.24, zr - 0.1, x + 0.05, CEIL - 0.16, zr + 0.1, BEAM_C, o);
    }
    // the first hall: a sitting corpse slumped under the writing, another scattered near the set
    k.skeleton('sitting', HX + 0.9, FLOOR, HZ + 10 - T / 2 - 0.24, Math.PI / 2);
    k.skeleton('scattered', HX - 5.2, FLOOR, HZ + 1.4, 0.6);
    kitToGroup(k, lightsAround(-4, -4, 4, 4), [], group);
    decal(group, HX, FLOOR + 1.72, HZ + 10 - T / 2 - 0.012, Math.PI, 2.9);
  }
  // the hatch: a ribbed steel slab on rails; open, it is parked under the ceiling beside the shaft
  const slab = (() => {
    const k = new Kit('Hatch', 31);
    const c = C(0x3a2a20), o = { res: 0.8, collide: false };
    k.box('wall', -SH - 0.12, CEIL - 0.34, -SH - 0.12, SH + 0.12, CEIL - 0.02, SH + 0.12, c, o);
    for (let a = -SH + 0.3; a < SH; a += 0.6) {
      k.box('wall', a - 0.04, CEIL - 0.42, -SH, a + 0.04, CEIL - 0.34, SH, c.clone().multiplyScalar(0.8), o);
      k.box('wall', -SH, CEIL - 0.42, a - 0.04, SH, CEIL - 0.34, a + 0.04, c.clone().multiplyScalar(0.8), o);
    }
    const g = kitToGroup(k, []);
    g.position.set(HX + S + 0.25, 0, HZ);
    group.add(g);
    return g;
  })();

  // ---------------------------------------------------------------- the set, hanging on its one cord
  const screenU = { uTime: G.uTime, uGlow: G.uGlow, uLevel: { value: 1 }, uFlash: { value: 0 }, uMark: { value: bloodTex } };
  const tvPivot = new THREE.Group();
  tvPivot.position.set(TVX, CEIL, TVZ);
  group.add(tvPivot);
  const tvMarker = new THREE.Object3D();
  {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, CORD, 6), new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.7 }));
    cord.position.y = -CORD / 2;
    cord.castShadow = true;
    tvPivot.add(cord);
    const k = new Kit('Television', 77);
    const top = -CORD, W = 0.76, H = 0.58, sc = C(0x1d1a17), o = { res: 0.25, collide: false };
    k.box('shell', -W / 2, top - H, 0.13, W / 2, top, 0.27, sc, o);    // bezel
    k.hexa('shell', [v3(-0.21, top - H + 0.14, -0.3), v3(0.21, top - H + 0.14, -0.3), v3(-0.21, top - 0.12, -0.3), v3(0.21, top - 0.12, -0.3),
      v3(-W / 2 + 0.02, top - H + 0.02, 0.13), v3(W / 2 - 0.02, top - H + 0.02, 0.13), v3(-W / 2 + 0.02, top - 0.02, 0.13), v3(W / 2 - 0.02, top - 0.02, 0.13)], sc.clone().multiplyScalar(0.85), o);
    for (const y of [-0.18, -0.32]) k.cyl('shell', v3(0.29, top + y, 0.27), v3(0.29, top + y, 0.31), 0.035, C(0x8a8478), { seg: 12, collide: false });
    k.box('shell', 0.21, top - 0.5, 0.27, 0.35, top - 0.44, 0.275, C(0x1a1816), o);   // speaker grille
    k.box('shell', -0.04, top - 0.002, -0.04, 0.04, top + 0.03, 0.04, C(0x4a3a2a), o);   // the eye the cord is knotted to
    const tv = kitToGroup(k, []);
    tvPivot.add(tv);
    // the glass bulges a little, as tubes do
    const sg = new THREE.PlaneGeometry(0.5, 0.39, 12, 10), p = sg.attributes.position;
    for (let n = 0; n < p.count; n++) p.setZ(n, 0.028 * (1 - (p.getX(n) / 0.25) ** 2) * (1 - (p.getY(n) / 0.195) ** 2));
    sg.computeVertexNormals();
    const screen = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      uniforms: screenU,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime, uGlow, uLevel, uFlash; uniform sampler2D uMark; varying vec2 vUv;
        float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main(){
          vec2 c = vUv * 2.0 - 1.0;
          float vig = smoothstep(1.35, 0.55, length(c * vec2(0.85, 1.0)));
          float fr = floor(uTime * 30.0);
          vec2 px = floor(vUv * vec2(150.0, 112.0));
          float n = h(px + vec2(fr * 17.13, fr * 7.71));
          n = n * n * 1.3;
          float tear = h(vec2(px.y, fr)) * 0.35;
          float scan = 0.72 + 0.28 * sin(vUv.y * 700.0);
          float roll = 0.65 + 0.35 * smoothstep(0.0, 0.12, abs(fract(vUv.y + uTime * 0.21) - 0.5));
          vec3 col = vec3(0.86, 0.93, 1.0) * (n + tear * n) * scan * roll * vig * uLevel;
          float m = ${bloodTex ? 'texture2D(uMark, vUv).a' : '0.0'};
          col = mix(col, col * 0.2 + vec3(1.0, 0.05, 0.03) * (0.5 + n), uFlash * mix(0.6, 1.0, m)) * mix(1.0, m, uFlash * 0.9);
          col += vec3(0.04, 0.05, 0.06) * vig;
          gl_FragColor = vec4(col * 16.0 * uGlow, 1.0);
        }`,
    }));
    screen.position.set(-0.07, top - H / 2, 0.272);
    tvPivot.add(screen);
    tvMarker.position.set(-0.07, top - H / 2 - 0.1, 1.5);
    tvPivot.add(tvMarker);
  }
  // the static's flicker lights the hall (a real light, so it throws the set's shadow and catches the wet paint);
  // it lives on the scene root so the lighting setup never changes when the backrooms are hidden
  const tvLight = new THREE.PointLight(0xb8d8ff, 0, 13, 2);
  tvLight.layers.enable(1);
  scene.add(tvLight);
  const tvWorld = new THREE.Vector3(), local = new THREE.Vector3();

  // a sickly glow welling up out of the opening, seen from far off across the hadal floor
  const glowU = { uI: { value: 0 }, uScale: { value: 800 }, uDepthTex: G.uDepthTex, uRes: G.uRes, uFogT: G.uFogT };
  const glowPts = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([HX, SEABED + 0.4, HZ], 3)), new THREE.ShaderMaterial({
    uniforms: glowU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uScale; varying vec3 vW;
      void main(){ vW = position; vec4 mv = viewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uScale * 5.0 / -mv.z, 2.0, 360.0); }`,
    fragmentShader: `uniform sampler2D uDepthTex; uniform vec2 uRes; uniform vec3 uFogT; uniform float uI; varying vec3 vW;
      void main(){
        if (gl_FragCoord.z > texture2D(uDepthTex, gl_FragCoord.xy / uRes).r + 2e-5) discard;
        vec2 c = gl_PointCoord - 0.5;
        float a = exp(-dot(c, c) * 16.0);
        gl_FragColor = vec4(vec3(0.55, 0.85, 0.62) * uI * a * exp(-uFogT * length(vW - cameraPosition) * 0.35), 1.0);
      }`,
  }));
  glowPts.frustumCulled = false;
  glowPts.layers.set(1);
  glowPts.renderOrder = 4;
  group.add(glowPts);

  // ---------------------------------------------------------------- silt hanging in the water
  // A dense haze of fine particulate in a box that travels with you, invisible in the dark: each mote only shows when
  // the flashlight cone (or the set's glow) falls on it, so the beam is full of glittering, drifting specks and stutters
  // with the flashlight. The volumetric glow of the beam itself is in post.js (uLampDust).
  const MOTES = 6000, MB = 14;
  const motes = (() => {
    const r = rng(2718), p = new Float32Array(MOTES * 3), sz = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) { p[i * 3] = r() * MB; p[i * 3 + 1] = r() * MB; p[i * 3 + 2] = r() * MB; sz[i] = 0.35 + r() * r() * 1.6; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const u = { uDepthTex: G.uDepthTex, uRes: G.uRes, uFogT: G.uFogT, uExpo: G.uExpo, uTime: G.uTime,
      uCam: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3() }, uCos: { value: new THREE.Vector2(0.9, 0.97) },
      uLamp: { value: 0 }, uTv: { value: new THREE.Vector3() }, uTvI: { value: 0 }, uScale: { value: 800 } };
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        uniform vec3 uCam, uDir, uTv; uniform vec2 uCos; uniform float uTime, uLamp, uTvI, uScale;
        attribute float aSize; varying vec3 vCol; varying vec3 vW;
        void main(){
          float ph = position.x * 3.1 + position.z * 1.7;
          vec3 p = position + vec3(sin(uTime * 0.11 + ph) * 0.35, sin(uTime * 0.07 + position.y) * 0.25 - uTime * 0.012 * aSize, cos(uTime * 0.09 + ph * 1.3) * 0.35);
          p = uCam + mod(p - uCam + ${(MB / 2).toFixed(1)}, ${MB.toFixed(1)}) - ${(MB / 2).toFixed(1)};
          vW = p;
          vec3 d = p - uCam; float dist = length(d);
          float cone = smoothstep(uCos.x, uCos.y, dot(d / dist, uDir));
          // forward scatter: a mote in the beam glints far more than its share of the light
          float glint = 0.6 + 0.4 * sin(uTime * (1.5 + aSize) + ph * 5.0);
          vec3 tv = vec3(0.72, 0.85, 1.0) * uTvI / (1.0 + dot(p - uTv, p - uTv) * 1.5);
          vCol = (vec3(1.0, 0.95, 0.86) * uLamp * cone * glint / (1.0 + dist * dist * 0.06) + tv)
               * smoothstep(${(MB / 2).toFixed(1)}, ${(MB * 0.3).toFixed(1)}, dist) * smoothstep(0.15, 0.5, dist);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale * 0.006 / -mv.z, 0.5, 4.5);
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_TRANSP}
        varying vec3 vCol; varying vec3 vW;
        void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.05, length(c)); gl_FragColor = vec4(transpFog(vCol * a, vW), 1.0); }`,
    }));
    m.frustumCulled = false;
    m.layers.set(1);
    m.renderOrder = 3;
    m.visible = false;
    group.add(m);
    return { mesh: m, u };
  })();

  // ---------------------------------------------------------------- collision (walls are full height: circles vs boxes)
  const door = { state: 'open', t: 0, closeAt: Infinity, sealedAt: 0, openAmt: 1, msg: '', msgUntil: 0 };
  let slabX = HX + S + 0.25, slamPending = false;
  function ceilingAt(x, z) {
    if (Math.abs(x - slabX) < SH + 0.12 && Math.abs(z - HZ) < SH + 0.12) return CEIL - 0.42;
    if (Math.abs(x - HX) < SH && Math.abs(z - HZ) < SH) return Infinity;   // open up the shaft
    return CEIL;
  }
  function cellBoxes(i, j, out) {
    const x = cx(i), z = cz(j);
    if (wallE(i, j)) { const t = (niche(0, i, j) ? NICHE_T : T + 0.1) / 2; out.push(x + SH - t, z - SH, x + SH + t, z + SH); }
    if (wallN(i, j)) { const t = (niche(1, i, j) ? NICHE_T : T + 0.1) / 2; out.push(x - SH, z + SH - t, x + SH, z + SH + t); }
    if (pillar(i, j)) { const h = PIL / 2 + 0.1; out.push(x + SH - h, z + SH - h, x + SH + h, z + SH + h); }
  }
  const boxes = [];
  function resolve(p, vel) {
    if (p.y > SEABED + 0.3) return;
    if (p.y > CEIL - 0.05) {
      // up in the shaft: only the well itself is open
      const lim = SH - RAD * 0.75, dx = p.x - HX, dz = p.z - HZ;
      if (Math.abs(dx) > lim) { p.x = HX + Math.sign(dx) * lim; if (vel.x * dx > 0) vel.x = 0; }
      if (Math.abs(dz) > lim) { p.z = HZ + Math.sign(dz) * lim; if (vel.z * dz > 0) vel.z = 0; }
      const c = ceilingAt(p.x, p.z);
      if (c !== Infinity && p.y > c - 0.3) { p.y = c - 0.3; if (vel.y > 0) vel.y = 0; }
      return;
    }
    const c = ceilingAt(p.x, p.z);
    if (c !== Infinity && p.y > c - 0.3) { p.y = c - 0.3; if (vel.y > 0) vel.y = 0; }
    if (p.y < FLOOR + 0.35) { p.y = FLOOR + 0.35; if (vel.y < 0) vel.y = 0; }
    boxes.length = 0;
    const ci = Math.round((p.x - HX) / S), cj = Math.round((p.z - HZ) / S);
    for (let i = ci - 2; i <= ci + 1; i++) for (let j = cj - 2; j <= cj + 1; j++) cellBoxes(i, j, boxes);
    if (p.y > FLOOR + 1.05) boxes.push(TVX - 0.42, TVZ - 0.42, TVX + 0.42, TVZ + 0.42);
    for (let b = 0; b < boxes.length; b += 4) {
      const qx = Math.max(boxes[b], Math.min(boxes[b + 2], p.x)), qz = Math.max(boxes[b + 1], Math.min(boxes[b + 3], p.z));
      let dx = p.x - qx, dz = p.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RAD * RAD) continue;
      let pen;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); dx /= d; dz /= d; pen = RAD - d; }
      else {   // centre inside the box: leave by the nearest side
        const l = p.x - boxes[b], r = boxes[b + 2] - p.x, n = p.z - boxes[b + 1], f = boxes[b + 3] - p.z, m = Math.min(l, r, n, f);
        dx = m === l ? -1 : m === r ? 1 : 0; dz = m === n ? -1 : m === f ? 1 : 0;
        if (dx && dz) dz = 0;
        pen = m + RAD;
      }
      p.x += dx * pen; p.z += dz * pen;
      const vn = vel.x * dx + vel.z * dz;
      if (vn < 0) { vel.x -= dx * vn; vel.z -= dz * vn; }
    }
  }
  // whose space is this point in? Underground (only the backrooms are) or in the well above the opening
  const owns = (p) => p.y < SEABED - 0.3 || (Math.abs(p.x - HX) < SH && Math.abs(p.z - HZ) < SH && p.y < SEABED + 3.2);
  const q = new THREE.Vector3(), dv = new THREE.Vector3();
  function collide(p, vel, from) {
    if (!owns(p) && !owns(from)) return;
    dv.subVectors(p, from);
    const steps = Math.min(24, Math.max(1, Math.ceil(dv.length() / 0.3)));
    q.copy(from);
    for (let s = 0; s < steps; s++) { q.addScaledVector(dv, 1 / steps); resolve(q, vel); }
    p.copy(q);
  }
  function probe(p, dir, max) {
    if (dir < 0) return THREE.MathUtils.clamp(p.y - FLOOR, 0.001, max);
    const c = ceilingAt(p.x, p.z);
    return c === Infinity ? max : THREE.MathUtils.clamp(c - p.y, 0.001, max);
  }

  // ---------------------------------------------------------------- the flashlight is dying
  let ev = null, nextEv = 3, wasLamp = false;
  function flashlight(t, lampOn) {
    if (lampOn && !wasLamp) ev = { kind: 'stutter', end: t + 0.5 };   // it never comes on first time
    wasLamp = lampOn;
    if (!lampOn) return 1;
    if (!ev && t > nextEv) {
      const r = Math.random();
      ev = r < 0.42 ? { kind: 'stutter', end: t + 0.25 + Math.random() * 0.55 }
        : r < 0.72 ? { kind: 'brown', end: t + 0.3 + Math.random() * 0.9, lvl: 0.1 + Math.random() * 0.3 }
        : r < 0.94 ? { kind: 'out', end: t + 0.5 + Math.random() * 1.3 }
        : { kind: 'out', end: t + 2 + Math.random() * 1.6 };
      if (ev.kind !== 'brown') mods.audio?.crackle?.(ev.kind === 'out' ? 1 : 0.7);
    }
    let v = 0.93 + 0.07 * Math.sin(t * 37) * Math.sin(t * 11.3);
    if (ev) {
      const left = ev.end - t;
      if (left <= 0) { ev = null; nextEv = t + 1.2 + Math.random() * 5.5; }
      else if (ev.kind === 'stutter') v = Math.random() < 0.5 ? 0.04 : 1;
      else if (ev.kind === 'brown') v = ev.lvl * (0.7 + 0.6 * Math.random());
      else v = left < 0.2 ? (Math.random() < 0.5 ? 0 : 1) : 0;
    }
    return v;
  }

  // ---------------------------------------------------------------- state and the hatch's cycle
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const api = {
    group, hole: { x: HX, z: HZ, seabed: SEABED }, RAD, owns, collide, probe,
    inside: false, deep: false, trapped: false, flicker: 1, shake: 0, glitch: false, poi: '',
    audioState: { inside: false, near: false, tv: 0, tvPan: 0 },
    // for testing from the console: window.__ocean.mods.backrooms.debug.slam()
    debug: { slam: () => slam(lastT), open: () => { door.sealedAt = lastT - SEAL_TIME; }, plan: { wallE, wallN, fixture, pillar, niche } },
    update, consumeSlam() { const s = slamPending; slamPending = false; return s; },
    denied() { say(`THE HATCH IS SEALED · NO OTHER WAY OUT · ${mmss(Math.max(0, SEAL_TIME - (lastT - door.sealedAt)))}`, 3); mods.audio?.knock?.(0.6); },
    navText(arrow, dist, lampOn) {
      const at = `${dist} M ${arrow}`;
      if (door.state === 'open') return `THE OPENING ABOVE · ${at}`;
      if (door.state === 'sealed') return `HATCH SEALED · REOPENS IN ${mmss(Math.max(0, SEAL_TIME - (lastT - door.sealedAt)))} · ${at}${!lampOn && lastT - door.sealedAt > 10 ? ' · F FLASHLIGHT' : ''}`;
      if (door.state === 'opening') return `SOMETHING IS GRINDING OPEN · ${at}`;
      return `HATCH OPEN · ${mmss(Math.max(0, WINDOW - (lastT - door.t)))} LEFT · ${at} · UNDER IT, HOLD A`;
    },
  };
  let lastT = 0, glitchUntil = 0, nextGlitch = 8;
  function say(msg, secs) { door.msg = msg; door.msgUntil = lastT + secs; }
  function slam(t) {
    door.state = 'sealed'; door.sealedAt = t;
    slamPending = true; api.shake = 1;
    mods.audio?.clang?.();
    say('THE HATCH SLAMMED SHUT', 4);
  }
  chunks.set('0,0', buildChunk(0, 0));
  group.add(chunks.get('0,0'));

  function update(info) {
    const cam = camera.position, t = info.time, dt = info.dt;
    lastT = t;
    api.shake *= Math.exp(-dt * 3.5);
    const inCol = Math.abs(cam.x - HX) < SH && Math.abs(cam.z - HZ) < SH;
    api.inside = info.under && cam.y < SEABED - 0.4;
    api.deep = api.inside && cam.y < SEABED - 1.2;
    const inRooms = api.inside && cam.y < CEIL - 0.2, inShaft = inCol && cam.y > CEIL - 0.7;
    const dHole = Math.hypot(cam.x - HX, cam.z - HZ);
    const near = info.under && !api.inside && dHole < 300 && cam.y < SEABED + 350;
    group.visible = api.inside || near;

    // the hatch: open until someone is down in the rooms, then it slams when it pleases; every three minutes it
    // grinds back for half a minute; climb out and it stays open for the next visitor
    if (!api.inside) { door.state = 'open'; door.closeAt = Infinity; }
    else if (door.state === 'open') {
      if (inRooms && door.closeAt === Infinity) door.closeAt = t + 2.5 + Math.random() * 7.5;
      if (t >= door.closeAt && !inShaft) slam(t);
    } else if (door.state === 'sealed') {
      if (t - door.sealedAt >= SEAL_TIME) { door.state = 'opening'; door.t = t; mods.audio?.grind?.(); say('SOMETHING GRINDS OPEN ABOVE', 4); }
    } else if (door.state === 'opening') {
      if (t - door.t > 2.6) { door.state = 'window'; door.t = t; }
    } else if (door.state === 'window' && t - door.t > WINDOW && !inShaft) slam(t);
    api.trapped = api.inside && (door.state === 'sealed' || door.state === 'opening');
    if (door.state === 'sealed') door.openAmt = Math.max(0, door.openAmt - dt / 0.28);   // it does not close gently
    else if (door.state === 'opening') door.openAmt = THREE.MathUtils.smootherstep((t - door.t) / 2.6, 0, 1);
    else door.openAmt = 1;
    slabX = HX + door.openAmt * (S + 0.25);
    slab.position.x = slabX;

    api.flicker = api.inside ? flashlight(t, info.lampOn) : flashlight(t, false);
    if (api.inside && t > nextGlitch) { glitchUntil = t + 0.15 + Math.random() * 0.3; nextGlitch = t + 7 + Math.random() * 14; }
    api.glitch = api.inside && (t < glitchUntil || (info.lampOn && api.flicker < 0.05 && Math.random() < 0.3));
    api.poi = t < door.msgUntil ? door.msg : 'SONAR · NO RETURN';

    if (!group.visible) {
      tvLight.intensity = 0; glowU.uI.value = 0;
      Object.assign(api.audioState, { inside: false, near: false, tv: 0 });
      return;
    }

    // stream the maze in around you (outside, only the first hall is kept, for the glimpse down the well)
    const want = new Set();
    let ci0 = 0, cj0 = 0;
    if (api.inside) {
      ci0 = chunkOf(Math.round((cam.x - HX) / S)); cj0 = chunkOf(Math.round((cam.z - HZ) / S));
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) want.add(`${ci0 + a},${cj0 + b}`);
    } else want.add('0,0');
    for (const key of [...chunks.keys()]) if (!want.has(key)) dropChunk(key);
    const missing = [...want].filter((key) => !chunks.has(key)).map((key) => { const [a, b] = key.split(',').map(Number); return { key, a, b, d: Math.max(Math.abs(a - ci0), Math.abs(b - cj0)) }; }).sort((m, n) => m.d - n.d);
    let budget = 1;
    for (const m of missing) {
      if (m.d > 0 && budget <= 0) break;   // only the chunk you stand in is built at once; the rest stream in one a frame
      const g = buildChunk(m.a, m.b);
      chunks.set(m.key, g); group.add(g);
      budget--;
    }

    // the set sways on its cord in the faint current; the static stutters and, now and then, shows something
    tvPivot.rotation.set(Math.sin(t * 0.53) * 0.045 + Math.sin(t * 1.7 + 2) * 0.008, TV_YAW + Math.sin(t * 0.19) * 0.3 + Math.sin(t * 0.071) * 0.18, Math.sin(t * 0.41 + 1.3) * 0.05);
    if (t > (tvPivot.userData.next ?? 0)) {
      tvPivot.userData.next = t + 1 / 24;
      screenU.uLevel.value = Math.random() < 0.012 ? 0.06 : 0.55 + Math.random() * 0.45;
    }
    if (t > (tvPivot.userData.nextFlash ?? 12)) { tvPivot.userData.flashUntil = t + 0.12 + Math.random() * 0.2; tvPivot.userData.nextFlash = t + 14 + Math.random() * 30; }
    const flash = t < (tvPivot.userData.flashUntil ?? 0) ? 1 : 0;
    screenU.uFlash.value = flash;
    tvMarker.getWorldPosition(tvWorld);
    tvLight.position.copy(tvWorld);
    const tvDist = cam.distanceTo(tvWorld);
    tvLight.intensity = tvDist < 60 ? (75 / info.gain) * screenU.uLevel.value * (flash ? 0.6 : 1) : 0;
    tvLight.color.setRGB(flash ? 1 : 0.72, flash ? 0.22 : 0.85, flash ? 0.18 : 1);
    glowU.uI.value = near ? (0.22 + 0.4 * screenU.uLevel.value) * (0.6 + 0.4 * Math.sin(t * 2.3) * Math.sin(t * 0.7)) : 0;
    glowU.uScale.value = ctx.renderer.domElement.height * 0.5;
    motes.mesh.visible = api.inside;
    if (api.inside) {
      const mu = motes.u;
      mu.uCam.value.copy(cam);
      camera.getWorldDirection(mu.uDir.value);
      if (info.lampCos) mu.uCos.value.set(info.lampCos.x - 0.02, info.lampCos.y);
      mu.uLamp.value = info.lampOn ? (3.2 / info.gain) * (info.lampFlicker ?? 1) : 0;
      mu.uTv.value.copy(tvWorld);
      mu.uTvI.value = (12 / info.gain) * screenU.uLevel.value;
      mu.uScale.value = ctx.renderer.domElement.height;
    }
    bloodMat.emissiveIntensity = 0.14 / info.gain;
    local.copy(tvWorld).applyMatrix4(camera.matrixWorldInverse);
    Object.assign(api.audioState, {
      inside: api.inside, near,
      tv: (api.inside || dHole < 12) ? screenU.uLevel.value / (1 + (tvDist * tvDist) / 10) : 0,
      tvPan: THREE.MathUtils.clamp(local.x / Math.max(Math.hypot(local.x, local.z), 1), -1, 1),
    });
  }
  return api;
}
