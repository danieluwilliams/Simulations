// Shipwrecks on the abyssal plain, built to be explored from the inside: a liner's bow section, a Spanish
// galleon, a submarine, a freighter and a trawler, each with decks, corridors, cabins and holds you can pilot
// through. Every wall collides, rooms are named on the HUD, and the remains of the crews are still aboard.
import * as THREE from 'three';
import { photographic } from './pbr.js';
import { spatialChunks } from './chunks.js';
import { GeoBuilder, C, v3 } from './builders.js';
import { patch } from './materials.js';
import { rng, WRECK_SITES } from './common.js';
import { Kit, M } from './shipkit.js';

const sstep = THREE.MathUtils.smoothstep;
// cos clamped at 0: at the very bow (u = 1) rounding makes cos(π/2) slightly negative, and pow() of that is NaN
const cos0 = (a) => Math.max(0, Math.cos(a));
const steelC = C(0x3e3832), white = C(0x8e877a), cream = C(0x8a7e66), tileC = C(0x4a3226), panelC = C(0x5a3a22);
const deckC = C(0x4a3a2c), brass = C(0x7a6030), ironC = C(0x2a2420);

// ---------------------------------------------------------------- shared helpers
// half-width of a hull at height y: round bilge below bR, tumblehome above
function hullWidth(L, half, top, bR, tum = 0) {
  return (x, y) => {
    const u = Math.min(1, Math.max(0, x / L)), w = Math.max(half(u), 0.05), T = top(u), b = Math.min(bR, w * 0.95, T * 0.9);
    if (y < b) { const dy = b - y; return w - b + Math.sqrt(Math.max(0, b * b - dy * dy)); }
    return w * (1 - tum * (y - b) / Math.max(T - b, 1e-3));
  };
}
// deck or floor inside a tapering hull: one slab per segment, as wide as the narrower end allows
function hullSlab(k, mat, hz, x0, x1, y, t, holes, col, inset = 0.35, seg = 2) {
  for (let x = x0; x < x1 - 1e-3; x += seg) {
    const xb = Math.min(x1, x + seg), w = Math.min(hz(x, y - t), hz(xb, y - t), hz(x, y), hz(xb, y)) - inset;
    if (w > 0.2) k.slab(mat, x, xb, -w, w, y, t, holes, col);
  }
}
function railing(k, pts, h = 1.1, mat = 'iron', col = C(0x2c2622), every = 2) {
  if (pts.length < 2) return;
  const top = pts.map((p) => p.clone().add(v3(0, h, 0)));
  k.tube(mat, top, 0.045, col, 5);
  for (let i = 0; i < pts.length; i += every) k.tube(mat, [pts[i], top[i]], 0.035, col, 4);
}
// railing with a few sections torn away
function brokenRailing(k, pts, h, seed) {
  let run = [];
  pts.forEach((p, i) => {
    const gone = Math.sin(i * 0.37 + seed) > 0.8;
    if (!gone) run.push(p);
    if (gone || i === pts.length - 1) { railing(k, run, h); run = []; }
  });
}
// a flight of stairs rising along +x; the sloped stringer underneath is what the sub slides along
function flight(k, x0, x1, y0, y1, z0, z1, col = C(0x4a2c18)) {
  const n = Math.max(4, Math.round((y1 - y0) / 0.3)), run = (x1 - x0) / n, rise = (y1 - y0) / n;
  for (let i = 0; i < n; i++) k.box('furn', x0 + i * run, y0 + i * rise, z0, x0 + (i + 1) * run + 0.03, y0 + (i + 1) * rise, z1, col, { collide: false, res: 4 });
  const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0);
  k.box('furn', 0, -0.35, z0, len, 0, z1, col.clone().multiplyScalar(0.75), { m: M(x0, y0, 0, 0, 0, ang), res: 2.5 });
  for (const z of [z0 - 0.08, z1 + 0.08]) {
    k.tube('furn', [v3(x0, y0 + 1.0, z), v3(x1, y1 + 1.0, z)], 0.06, col, 6);
    for (let i = 0; i <= n; i += 2) { const p = v3(x0 + i * run, y0 + (i + 1) * rise, z); k.tube('furn', [p, p.clone().add(v3(0, 1.0 - rise, 0))], 0.03, col, 4); }
    k.cyl('furn', v3(x0 - 0.15, y0, z), v3(x0 - 0.15, y0 + 1.3, z), 0.13, col, { seg: 8 });
  }
}
// rails around three sides of a floor opening (the fourth side is where the stairs arrive)
function wellRail(k, x0, x1, z0, z1, y, openSide = 'px') {
  const P = (x, z) => v3(x, y, z);
  if (openSide !== 'nz') railing(k, [P(x0, z0), P((x0 + x1) / 2, z0), P(x1, z0)], 1.0, 'furn', C(0x4a2c18), 1);
  if (openSide !== 'pz') railing(k, [P(x0, z1), P((x0 + x1) / 2, z1), P(x1, z1)], 1.0, 'furn', C(0x4a2c18), 1);
  if (openSide !== 'nx') railing(k, [P(x0, z0), P(x0, z1)], 1.0, 'furn', C(0x4a2c18), 1);
  if (openSide !== 'px') railing(k, [P(x1, z0), P(x1, z1)], 1.0, 'furn', C(0x4a2c18), 1);
}
function ladder(k, x, y0, y1, z, alongZ = true) {
  for (const s of [-0.4, 0.4]) k.cyl('iron', v3(x + (alongZ ? 0 : s), y0, z + (alongZ ? s : 0)), v3(x + (alongZ ? 0 : s), y1, z + (alongZ ? s : 0)), 0.035, C(0x3a3430), { seg: 6 });
  for (let y = y0 + 0.3; y < y1; y += 0.35) k.cyl('iron', v3(x - (alongZ ? 0 : 0.4), y, z - (alongZ ? 0.4 : 0)), v3(x + (alongZ ? 0 : 0.4), y, z + (alongZ ? 0.4 : 0)), 0.025, C(0x3a3430), { seg: 5 });
}
// plating around a breach is folded inwards, raggedly (e2 = squared ellipse distance from the hole's centre)
function tornIn(p, e2, side, depth) {
  if (!side || e2 > 2.4) return;
  const k = (1 - sstep(Math.sqrt(e2), 0.95, 1.55)) * (0.55 + 0.45 * Math.sin(p.x * 3.7 + p.y * 2.9) * Math.sin(p.x * 1.3 - p.y * 4.1));
  p.z -= Math.sign(p.z) * k * depth;
}
// iron-oxide icicles hanging from plating
function rusticles(k, n, at, seed) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const p = at(r);
    if (!p) continue;
    // knobbly, slightly crooked drips that taper to a point
    const len = 0.3 + r() * r() * 2.8, w0 = 0.05 + r() * 0.13, dx = (r() - 0.5) * 0.25, dz = (r() - 0.5) * 0.15, ph = r() * 20, pts = [];
    for (let j = 0; j <= 6; j++) { const t = j / 6; pts.push(p.clone().add(v3(dx * t + Math.sin(t * 9 + ph) * 0.03, -len * t, dz * t))); }
    k.tube('rusticle', pts, (t) => w0 * Math.pow(1 - t, 0.8) * (0.7 + 0.5 * Math.abs(Math.sin(t * 17 + ph))) + 0.004, C(0x5a2a10).lerp(C(0x8a4a1e), r()), 5);
  }
}
function sprinkleLife(k, n, at) {
  for (let i = 0; i < n; i++) { const p = at(); if (!p) continue; if (k.r() < 0.85) k.anemone(p.x, p.y, p.z, k.rand(0.7, 1.4)); else k.sponge(p.x, p.y, p.z, k.rand(0.6, 1.2)); }
}

// ---------------------------------------------------------------- SS Meridian: the bow half of an ocean liner
function liner(k) {
  const L = 150, W = 15, H = 20.4, BODY = 92, IN = W - 0.4, T = 0.35;
  const DK = [6.0, 10.8, 15.6, 20.4];   // D, C and B deck floors, then the weather deck
  const half = (u) => (u < 0.62 ? W : W * Math.pow(cos0(((u - 0.62) / 0.38) * Math.PI * 0.5), 0.75) + 0.15);
  const sheer = (u) => (u < 0.62 ? 0 : Math.pow((u - 0.62) / 0.38, 2) * 4);
  const gashAt = (p, j) => p.z > 0 && ((p.x - 59) / 8) ** 2 + ((p.y - 13.2) / 4) ** 2 < 1 + j;
  const jag = (x, y) => (Math.sin(x * 2.3 + y * 1.1) * 0.6 + Math.sin(x * 5.1 - y * 3.7) * 0.35) * 0.35;
  const tear = (v) => Math.abs(Math.sin(v * 37)) * 4 + Math.sin(v * 11) * 2;   // plating torn where she broke in two
  const red = C(0x5a1f12), black = C(0x2b211b);   // black topsides, long since gone rust-brown
  k.shell('hull', {
    L, nu: 220, nv: 84, half, top: (u) => H + sheer(u), bilge: 3.5, buried: 4.0, panel: 2.5, panelV: 24, thick: 0.6,
    xAt: (u, v, y) => u * L + sstep(u, 0.93, 1) * (y / H) * 6 - (u === 0 ? tear(v) : 0),
    color: (p) => (p.y < 7.5 ? red : black).clone().multiplyScalar(0.85 + 0.3 * Math.abs(Math.sin(p.x * 0.37 + p.y * 0.21))),
    hole: (p, vis) => gashAt(p, vis ? jag(p.x, p.y) : -0.25),
    bend: (p) => tornIn(p, ((p.x - 59) / 8) ** 2 + ((p.y - 13.2) / 4) ** 2, p.z > 0, 1.6),
  });

  // decks: inner bottom, D/C/B floors with stairwells, the cargo hatch and the collapse at the break
  k.slab('paint', 0, BODY, -IN, IN, DK[0], 1.6, [], tileC);
  k.slab('paint', 0, BODY, -IN, IN, DK[1], T, [[34, 42, -4, 0], [76, 86, -5, 5], [-1, 5, -9.3, 9.3]], tileC);
  k.slab('paint', 0, BODY, -IN, IN, DK[2], T, [[34, 42, 0, 4], [76, 86, -5, 5], [-1, 4, -7, 7]], tileC);
  k.slab('wood', 0, BODY, -W + 0.05, W - 0.05, H, T, [[34, 42, -4, 0], [76, 86, -5, 5], [-1, 2.5, -5, 5]], deckC);
  k.surface('wood', {   // forecastle deck over the tapering bow
    nu: 40, nv: 20, pu: 20, pv: 8, thick: 0.6,
    fn: (u, v) => { const x = BODY + u * (L - 1.2 - BODY), w = half(x / L) - 0.2; return v3(x, H + sheer(x / L) - 0.02, (v * 2 - 1) * w); },
    color: () => deckC,
  });
  k.wallZ('steel', -IN, IN, DK[0], H - T, BODY, 0.4, [], steelC);   // collision bulkhead: the bow is sealed

  // ---- D deck: boiler room, galley, reception, dining saloon, forward hold
  const yD = DK[0], yDc = DK[1] - T;
  k.wallZ('steel', -IN, IN, yD, yDc, 20, 0.4, [[-1.4, 1.4, yD, yD + 3.2]], steelC);
  k.wallZ('paint', -IN, IN, yD, yDc, 32, 0.3, [[-1.4, 1.4, yD, yD + 3.2], [6, 8.6, yD, yD + 3.2]], white);
  k.wallZ('paint', -IN, IN, yD, yDc, 44, 0.3, [[-4, 4, yD, yD + 3.6], [9, 11.5, yD, yD + 3.2], [-11.5, -9, yD, yD + 3.2]], cream);
  k.wallZ('steel', -IN, IN, yD, yDc, 72, 0.4, [[-1.5, 1.5, yD, yD + 3.4]], steelC);
  for (const s of [-1, 1]) k.wallX('furn', 44, 72, yD, yDc, s * (IN - 0.15), 0.12, s > 0 ? [[53, 65, 9.4, 11]] : [], panelC);
  k.room('Where the hull tore apart', -6, yD, -IN, 6, yDc, IN);
  k.room('Boiler room', 6, yD, -IN, 20, yDc, IN);
  k.room('Galley', 20, yD, -IN, 32, yDc, IN);
  k.room('Reception room', 32, yD, -IN, 44, yDc, IN);
  k.room('First-class dining saloon', 44, yD, -IN, 72, yDc, IN);
  k.room('Forward cargo hold', 72, yD, -IN, BODY, yDc, IN);
  // boilers: one has rolled out through the break
  for (const bx of [7.5, 15]) for (const s of [-1, 1]) {
    if (bx === 7.5 && s < 0) continue;
    k.cyl('iron', v3(bx, yD + 1.95, s * 1.4), v3(bx, yD + 1.95, s * 7.6), 1.9, C(0x2a2420), { collide: true, seg: 24 });
    for (const dz of [-1.5, 0, 1.5]) k.cyl('iron', v3(bx - 1.9, yD + 1.4, s * 4.5 + dz), v3(bx - 2.0, yD + 1.4, s * 4.5 + dz), 0.42, C(0x1a1612), { seg: 12 });
    k.pipeRun([v3(bx, yD + 3.8, s * 4.5), v3(bx, yDc - 0.4, s * 4.5), v3(19.5, yDc - 0.4, s * 2.5)], 0.22);
  }
  k.cyl('iron', v3(-0.5, yD + 0.9, -3.5), v3(4.5, yD + 1.4, -9.5), 1.9, C(0x2a2420), { collide: true, seg: 24 });
  for (let i = 0; i < 14; i++) k.lump('silt', k.rand(1, 18), yD, k.rand(-12, 12), k.rand(0.3, 1.1), k.rand(0.15, 0.4), k.rand(0.3, 1.1), C(0x141210), k.rand(0, 6), 0.4);
  // galley
  for (const s of [-1, 1]) {
    k.stove(21.1, yD, s * 7.5, Math.PI / 2, 8);
    k.box('furn', 25, yD, s * 2.6, 28, yD + 0.95, s * 9, C(0x4a3828));
    for (let i = 0; i < 4; i++) k.pot(k.rand(25.3, 27.7), yD + 0.95, s * k.rand(3, 8.5));
  }
  for (let i = 0; i < 8; i++) k.pot(k.rand(22, 31), yD, k.rand(-12, 12));
  k.skeleton('scattered', 29.5, yD, -5, 0);
  // reception and the foot of the grand staircase
  flight(k, 34.5, 41.5, yD, DK[1], -3.5, -0.5);
  for (const z of [-7, 7]) k.box('paint', 37.6, yD, z - 0.35, 38.3, yDc, z + 0.35, cream);
  k.skeleton('prone', 37, yD, 6, 1.2);
  // the dining saloon
  for (const x of [50, 58, 66]) for (const z of [-7.5, 7.5]) k.box('paint', x - 0.35, yD, z - 0.35, x + 0.35, yDc, z + 0.35, cream);
  for (const x of [47.5, 54, 62, 69]) for (const z of [-11, -3.5, 3.5, 11]) {
    const tipped = k.r() < 0.25;
    k.table(x, yD, z, 0.9, true, 0.78, tipped);
    for (let c = 0; c < 4; c++) { const a = (c / 4) * Math.PI * 2 + k.r() * 0.5; k.chair(x + Math.cos(a) * 1.4, yD, z + Math.sin(a) * 1.4, -a + k.r()); }
    if (!tipped) for (let p = 0; p < 3; p++) k.plate(x + k.rand(-0.6, 0.6), yD + 0.78, z + k.rand(-0.6, 0.6));
    for (let p = 0; p < 2; p++) k.plate(x + k.rand(-2, 2), yD, z + k.rand(-2, 2));
    if (k.r() < 0.3) k.bottle(x + k.rand(-1.5, 1.5), yD, z + k.rand(-1.5, 1.5), k.rand(0, 6));
  }
  k.chandelier(58, yD, 0);
  k.skeleton('sitting', 50.6, yD, -7.5, 0);
  k.skeleton('supine', 58.5, yD, 4.6, 2.2);
  k.skeleton('scattered', 66, yD, -11.5, 0);
  k.skeleton('curled', 54, yD, 9, 0.8);
  k.silt(45, 71, -13, 13, yD, 6);
  // forward hold: cars, crates and mail
  k.car(77, yD, -9, 0.2); k.car(87, yD, 8.5, -2.9);
  for (const [x, z, n] of [[74.5, 12.5, 2], [77.5, 12.5, 1], [89.5, -12, 2], [86.5, -12.5, 1], [90, 2, 2], [74, -5, 1]]) for (let i = 0; i < n; i++) k.crate(x, yD + i * 1.8, z, 2.2, 1.8, 1.8, k.rand(-0.15, 0.15));
  for (let i = 0; i < 10; i++) k.lump('silt', k.rand(78, 88), yD, k.rand(-4, 6), 0.7, 0.35, 0.45, C(0x5a4a38), k.rand(0, 6), 0.3);   // mail sacks
  k.skeleton('scattered', 81, yD, 3, 0);

  // ---- C deck (second class) and B deck (first class): corridor, cabins, enclosed promenades
  function cabinDeck(deck, yF, bays, first) {
    const yC = yF + 4.8 - T, dW = 2.2, dH = 3.0, wm = first ? 'furn' : 'paint', wc = first ? panelC : white;
    const xs = new Set(bays.flat());
    for (const s of [-1, 1]) {
      for (const [a, b] of [[6, 30], [46, 69]]) {
        const inSeg = bays.filter(([x0, x1]) => x0 >= a && x1 <= b);
        const door = ([x0, x1]) => [(x0 + x1) / 2 - dW / 2, (x0 + x1) / 2 + dW / 2, yF, yF + dH];
        k.wallX(wm, a, b, yF, yC, s * 2.125, 0.25, inSeg.map(door), wc);
        k.wallX(wm, a, b, yF, yC, s * 9.5, 0.3, inSeg.filter((_, i) => (i + (s > 0 ? 0 : 1)) % 2 === 0).map(door), wc);
      }
      k.wallX(wm, 30, 46, yF, yC, s * 9.5, 0.3, [[36.5, 39.5, yF, yF + dH]], wc);
      for (const x of xs) k.wallZ(wm, s > 0 ? 2.25 : -9.35, s > 0 ? 9.35 : -2.25, yF, yC, x, 0.2, [], wc);
      k.room(`${deck}-deck promenade`, 0, yF, s > 0 ? 9.65 : -IN, 72, yC, s > 0 ? IN : -9.65);
      for (let x = 8; x < 68; x += k.rand(5, 9)) k.chair(x, yF, s * k.rand(11, 13.5), k.rand(0, 6.28));
      k.silt(2, 70, s * 10, s * 14, yF, 4);
    }
    k.wallZ('steel', -IN, IN, yF, yC, 72, 0.4, [[-1.5, 1.5, yF, yF + 3.3], [10.4, 13.6, yF, yF + 3.3], [-13.6, -10.4, yF, yF + 3.3]], steelC);
    let num = first ? 1 : 21;
    for (const [x0, x1] of bays) for (const s of [-1, 1]) {
      const xc = (x0 + x1) / 2, n = num++;
      k.room(`${deck}-deck ${first ? 'stateroom' : 'cabin'} ${deck}-${n}`, x0, yF, s > 0 ? 2.25 : -9.35, x1, yC, s > 0 ? 9.35 : -2.25);
      k.door(xc, yF, s * 2.125, true, dW, dH, wc);
      k.bed(x1 - 0.8, yF, s * 6.4, Math.PI / 2, first ? C(0x6a5a48) : C(0x5e5444));
      if (!first && k.r() < 0.6) k.bed(x0 + 0.8, yF, s * 6.4, Math.PI / 2);
      k.wardrobe(x0 + 1.1, yF, s * 8.9, s > 0 ? Math.PI : 0, k.r() < 0.35);
      k.washstand(x0 + 0.3, yF, s * 3.4, Math.PI / 2);
      k.chair(xc + k.rand(-1, 1), yF, s * k.rand(3.5, 5), k.rand(0, 6.28));
      if (first) { k.table(xc - 0.6, yF, s * 4.4, 0.5, true, 0.7, k.r() < 0.3); if (k.r() < 0.5) k.chest(x0 + 2.6, yF, s * 8.7, 0, false, false); }
      if (k.r() < 0.5) k.suitcase(xc + k.rand(-1.5, 1.5), yF, s * k.rand(3, 8), k.rand(0, 6.28));
      k.silt(x0 + 0.5, x1 - 0.5, s * 3, s * 8.5, yF, 2);
      const sk = k.r();
      if (sk < 0.1) k.skeleton('supine', x1 - 0.8, yF + 0.68, s * 6.4, s > 0 ? -Math.PI / 2 : Math.PI / 2);
      else if (sk < 0.17) k.skeleton(k.pick(['curled', 'prone']), xc, yF, s * 5.2, k.rand(0, 6.28));
      else if (sk < 0.22) k.skeleton('sitting', x0 + 0.4, yF, s * 4.8, 0);
    }
    k.room('Grand staircase', 30, yF, -9.35, 46, yC, 9.35);
    k.room('Cross passage', 69, yF, -9.4, 72, yC, 9.4);
    k.room('Tween deck (forward cargo)', 72, yF, -IN, BODY, yC, IN);
    k.room(`${deck}-deck corridor`, 0, yF, -2, 72, yC, 2);
    for (const s of [-1, 1]) k.pipeRun([v3(1, yC - 0.3, s * 1.5), v3(71.5, yC - 0.3, s * 1.5)], 0.08);
    for (let i = 0; i < 6; i++) k.debris('paint', k.rand(8, 68), yF, k.rand(-1.2, 1.2), k.rand(1, 1.8), k.rand(0.8, 1.4), C(0x6a6458));
    for (let i = 0; i < 10; i++) k.cable(k.rand(4, 70), yC - 0.05, k.rand(-1.6, 1.6), k.rand(0.6, 2.2));
    for (let x = 9; x < 70; x += 6) k.cyl('metal', v3(x, yC - 0.15, 0), v3(x, yC, 0), 0.22, brass, { seg: 12 });
    rusticles(k, 40, (r) => v3(1 + r() * 70, yC - 0.02, (r() - 0.5) * 3.6), 70 + yF);
    for (let i = 0; i < 6; i++) k.crate(k.rand(74, 90), yF, k.rand(-12, 12), 2, 1.6, 1.6, k.rand(-0.3, 0.3));
    for (let i = 0; i < 4; i++) k.debris('steel', k.rand(1, 5), yF, k.rand(-10, 10), k.rand(1.5, 3), k.rand(1.5, 3), steelC);
  }
  cabinDeck('C', DK[1], [[6, 12], [12, 18], [18, 24], [24, 30], [46, 52], [52, 58], [58, 64], [64, 69]], false);
  cabinDeck('B', DK[2], [[6, 14], [14, 22], [22, 30], [46, 54], [54, 62], [62, 69]], true);
  flight(k, 34.5, 41.5, DK[1], DK[2], 0.5, 3.5);
  flight(k, 34.5, 41.5, DK[2], DK[3], -3.5, -0.5);
  wellRail(k, 34, 42, -4, 0, DK[1]);
  wellRail(k, 34, 42, 0, 4, DK[2]);
  k.skeleton('prone', 20, DK[1], 0.3, 2.8);
  k.skeleton('curled', 40, DK[1], 12, 1.5);
  k.skeleton('scattered', 54, DK[2], -0.5, 0);
  k.skeleton('sitting', 31, DK[2], 7.5, 0);

  // ---- A deck: deckhouse with lounge, staircase dome and reading room
  const yA = H, yAc = 24.8, roof = 25.15;
  for (const s of [-1, 1]) {
    const wins = [];
    for (let x = 12; x <= 64; x += 4) wins.push([x - 1.2, x + 1.2, 21.6, 23.8]);
    k.wallX('paint', 10, 66, yA, yAc, s * 10, 0.3, wins, white);
  }
  for (const x of [10, 66]) k.wallZ('paint', -10.15, 10.15, yA, yAc, x, 0.3, [[-1.4, 1.4, yA, yA + 3.0], [-8, -5, 21.6, 23.8], [5, 8, 21.6, 23.8]], white);
  for (const x of [30, 46]) k.wallZ('furn', -9.85, 9.85, yA, yAc, x, 0.25, [[-3.5, 3.5, yA, yA + 3.4]], panelC);
  k.slab('paint', 9.85, 66.15, -10.15, 10.15, roof, 0.35, [[34, 42, -4, 4]], white);
  k.room('Lounge', 10, yA, -10, 30, yAc, 10);
  k.room('Grand staircase · dome', 30, yA, -10, 46, yAc, 10);
  k.room('Reading and writing room', 46, yA, -10, 66, yAc, 10);
  wellRail(k, 34, 42, -4, 0, yA);
  // the wrought-iron dome over the staircase, its glass long gone
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, pts = [];
    for (let j = 0; j <= 8; j++) { const t = (j / 8) * Math.PI * 0.5; pts.push(v3(38 + Math.cos(a) * 4.2 * Math.cos(t), roof + Math.sin(t) * 2.6, Math.sin(a) * 4.2 * Math.cos(t))); }
    k.tube('iron', pts, 0.06, ironC, 5);
  }
  for (const t of [0, 0.45, 0.85]) { const ring = []; for (let j = 0; j <= 24; j++) { const a = (j / 24) * Math.PI * 2; ring.push(v3(38 + Math.cos(a) * 4.2 * Math.cos(t * 1.57), roof + Math.sin(t * 1.57) * 2.6, Math.sin(a) * 4.2 * Math.cos(t * 1.57))); } k.tube('iron', ring, 0.05, ironC, 5); }
  k.box('furn', 45.6, yA + 1.4, 3.6, 45.85, yA + 3.4, 6.4, panelC, { collide: false });            // staircase clock panel
  k.cyl('metal', v3(45.55, yA + 2.5, 5), v3(45.45, yA + 2.5, 5), 0.5, brass, { seg: 20 });
  // lounge: piano, armchairs, fallen chandelier
  k.box('furn', 15, yA, -7.5, 17.6, yA + 1.0, -5.9, C(0x1a1210));                                        // grand piano
  k.box('furn', 0, 0, -1.6, 2.6, 0.05, 0, C(0x1a1210), { m: M(15, yA + 1.0, -5.9, 0, 0.7), collide: false });   // its lid, propped open
  for (let i = 0; i < 8; i++) k.lump('leather', k.rand(12, 28), yA, k.rand(-8, 8), 0.5, 0.45, 0.5, C(0x3a2418), k.rand(0, 6), 0.3);
  for (let i = 0; i < 4; i++) k.table(k.rand(13, 27), yA, k.rand(-7, 7), 0.5, true, 0.6, k.r() < 0.4);
  k.chandelier(21, yA, 2);
  k.skeleton('prone', 16, yA, 4, 0.6);
  // reading room
  for (const s of [-1, 1]) for (const x of [49, 54, 59]) { k.box('furn', x - 1, yA, s * 8.3, x + 1, yA + 0.8, s * 9.4, C(0x4a2c18)); k.chair(x, yA, s * 7.4, k.rand(0, 6)); }
  for (const z of [-7.5, -3, 3, 7.5]) k.box('furn', 65.2, yA, z - 1.3, 65.75, yA + 2.6, z + 1.3, C(0x3a2416));
  for (let i = 0; i < 30; i++) k.box('silt', -0.12, 0, -0.1, 0.12, 0.03, 0.1, C(0x5a4632), { m: M(k.rand(48, 64), yA, k.rand(-8, 8), k.rand(0, 6)), collide: false, res: 1 });   // books
  k.skeleton('sitting', 65.0, yA, 5.2, Math.PI);
  k.silt(11, 65, -9, 9, yA, 6);

  // ---- wheelhouse
  const yW = H, yWc = 24.4;
  k.wallZ('paint', -7, 7, yW, yWc, 68, 0.3, [[-1.3, 1.3, yW, yW + 2.9]], white);
  k.wallZ('paint', -7, 7, yW, yWc, 76, 0.3, [[-5.9, -3.7, 21.7, 23.7], [-2.9, -0.7, 21.7, 23.7], [0.7, 2.9, 21.7, 23.7], [3.7, 5.9, 21.7, 23.7]], white);
  for (const s of [-1, 1]) k.wallX('paint', 68, 76, yW, yWc, s * 7, 0.3, [[70, 72.4, yW, yW + 2.9]], white);
  k.slab('paint', 67.8, 76.2, -7.3, 7.3, 24.75, 0.35, [], white);
  k.room('Wheelhouse', 68, yW, -7, 76, yWc, 7);
  k.shipWheel(73, yW, 0, 0, 1.0);
  for (const s of [-1, 1]) k.telegraph(74.8, yW, s * 2.4, 0);
  k.cyl('metal', v3(70.8, yW, 0), v3(70.8, yW + 1.25, 0), 0.24, brass, { r1: 0.3, collide: true, seg: 14 });
  k.b('metal').sphere(v3(70.8, yW + 1.45, 0), 0.32, brass, undefined, 14);
  k.box('furn', 68.4, yW, -6.6, 69.8, yW + 0.95, -4.2, C(0x4a2c18));
  k.skeleton('curled', 71.4, yW, -2.2, 0.4);

  // ---- weather deck fittings, hatch coaming, masts, exterior plating details
  for (const [a, b, c, d] of [[76, 86, -5, 5]]) { k.wallX('steel', a, b, H, H + 1.2, c, 0.3, [], steelC); k.wallX('steel', a, b, H, H + 1.2, d, 0.3, [], steelC); k.wallZ('steel', c, d, H, H + 1.2, a, 0.3, [], steelC); k.wallZ('steel', c, d, H, H + 1.2, b, 0.3, [], steelC); }
  for (const s of [-1, 1]) {
    const pts = [];
    for (let x = 3; x <= 146; x += 1.8) { const u = x / L; pts.push(v3(x, H + sheer(u), s * (half(u) - 0.25))); }
    brokenRailing(k, pts, 1.1, s * 3);
    for (const x of [14, 22, 30, 50, 58]) k.tube('iron', [v3(x, H, s * 11.2), v3(x, H + 3.2, s * 11.6), v3(x + 0.2, H + 4.2, s * 13.2), v3(x + 0.3, H + 3.6, s * 14.2)], 0.12, ironC, 6);   // empty lifeboat davits
    const ax = L * 0.93, az = s * (half(0.93) + 0.3);
    k.tube('iron', [v3(ax, 15, az), v3(ax, 10, az)], 0.35, C(0x3a2416), 6);
    k.tube('iron', [v3(ax - 1.8, 10.8, az), v3(ax, 9.8, az), v3(ax + 1.8, 10.8, az)], 0.3, C(0x3a2416), 6);
    for (const y of [8.2, 13.0, 17.8]) for (let x = 4; x < 90; x += 2.6) {
      if (s > 0 && gashAt(v3(x, y, 1), 0.35)) continue;
      const ring = [];
      for (let a = 0; a <= 8; a++) { const t = (a / 8) * Math.PI * 2; ring.push(v3(x + Math.cos(t) * 0.36, y + Math.sin(t) * 0.36, s * (W + 0.06))); }
      k.tube('metal', ring, 0.07, C(0x5a4a2a), 4);
      k.cyl('china', v3(x, y, s * (W + 0.01)), v3(x, y, s * (W + 0.05)), 0.3, C(0x080a0c), { seg: 10 });
    }
  }
  k.tube('iron', [v3(112, H + sheer(112 / L) + 1, 0), v3(98, H + 1.2, -5), v3(84, H + 1.6, -10.5)], 0.45, C(0x2a2420), 8);   // fallen foremast
  k.tube('iron', [v3(118, H + sheer(118 / L), 0), v3(118, H + 14, 0)], 0.4, C(0x2a2420), 8);
  k.cyl('hull', v3(14, roof, 0), v3(14.3, roof + 1.8, 0.2), 3.4, C(0x2e2620), { collide: true, seg: 24 });   // funnel stump
  for (const x of [100, 128]) for (const s of [-1, 1]) k.cyl('iron', v3(x, H + sheer(x / L), s * 2.5), v3(x, H + sheer(x / L) + 0.9, s * 2.5), 0.35, ironC, { seg: 10, collide: true });   // bollards
  // the break: plates bent down from every deck, cables trailing
  for (const y of [DK[1], DK[2], H]) for (let i = 0; i < 4; i++) {
    const z = k.rand(-12, 12);
    k.box('steel', -2.5, -0.08, -1, 0, 0, 1, steelC, { m: M(0.3, y, z, k.rand(-0.3, 0.3), 0, -k.rand(0.6, 1.3)), collide: false, warp: 0.1, res: 1 });
  }
  for (let i = 0; i < 12; i++) k.cable(k.rand(-0.5, 1), k.pick([DK[1], DK[2], H]) - 0.3, k.rand(-12, 12), k.rand(1.5, 4));
  rusticles(k, 600, (r) => { const u = 0.02 + r() * 0.9, s = r() < 0.5 ? -1 : 1, x = L * u, y = 4 + r() * (H + sheer(u) - 4.5); return s > 0 && gashAt(v3(x, y, 1), 0.4) ? null : v3(x, y, s * (half(u) + 0.15)); }, 9);
  sprinkleLife(k, 160, () => { const x = k.rand(3, 140), u = x / L, z = k.rand(-1, 1) * (half(u) - 1.2); if (x > 10 && x < 66 && Math.abs(z) < 10.3) return v3(x, roof, z * 0.9); if (x > 75 && x < 87 && Math.abs(z) < 5.5) return null; return v3(x, H + sheer(u), z); });
}

// ---------------------------------------------------------------- San Teodoro: a Spanish galleon
function galleon(k) {
  const L = 46, W = 6.6, bR = 3.2, TUM = 0.14;
  const half = (u) => Math.max(0.05, W * Math.pow(Math.max(0, Math.sin(Math.PI * (0.2 + 0.8 * u))), 0.55));
  const top = (u) => 9 + 4.2 * (1 - sstep(u, 0.27, 0.33)) + 2 * sstep(u, 0.78, 0.88);
  const hz = hullWidth(L, half, top, bR, TUM);
  const plank = C(0x3b2a1c), dark = C(0x1d150e), dk = C(0x3e2e1e);
  const ports = [7, 11, 15, 19, 23, 27, 31, 35];
  const tearAt = (p, j) => p.z > 0 && ((p.x - 21.5) / 5.5) ** 2 + ((p.y - 5.4) / 3.1) ** 2 < 1 + j;
  k.shell('wood', {
    L, nu: 92, nv: 52, half, top, bilge: bR, tumble: TUM, buried: 1.6, panel: 2.3, panelV: 18, thick: 0.6,
    color: (p) => plank.clone().multiplyScalar((Math.floor(p.y * 1.6) % 2 ? 1 : 0.8) * (0.85 + 0.3 * Math.abs(Math.sin(p.x * 0.7 + p.y * 3.1)))),
    hole: (p, vis) => tearAt(p, vis ? Math.sin(p.x * 2.7 + p.y * 1.9) * 0.3 : -0.25)
      || (vis && p.y > 6.0 && p.y < 7.2 && ports.some((px) => Math.abs(p.x - px) < 0.6) && !(p.z > 0 && p.x > 16 && p.x < 27)),
    bend: (p) => tornIn(p, ((p.x - 21.5) / 5.5) ** 2 + ((p.y - 5.4) / 3.1) ** 2, p.z > 0, 1.1),
  });
  // transom with the great cabin's stern windows and two chase-gun ports
  k.bulkhead('wood', 0.3, 1.6, 13.15, (y) => hz(0.3, y) - 0.05, [[-3.6, -1.4, 9.9, 12.0], [-1.1, 1.1, 9.9, 12.0], [1.4, 3.6, 9.9, 12.0], [-2.3, -1.4, 6.1, 7.0], [1.4, 2.3, 6.1, 7.0]], plank, 0.35, 0.5);
  hullSlab(k, 'wood', hz, 3.5, 36, 2.4, 0.8, [], dk);
  hullSlab(k, 'wood', hz, 0.5, 38, 5.2, 0.3, [[19.5, 22.5, -1.5, 1.5]], dk);
  hullSlab(k, 'wood', hz, 0.5, 40, 9.0, 0.35, [[19.5, 22.5, -1.5, 1.5], [27, 31, -2, 2], [14, 17.5, 1.2, 4.2]], dk);
  hullSlab(k, 'wood', hz, 0.5, 12.2, 13.1, 0.35, [], dk);
  for (let x = 37; x < 43.5; x += 1.5) { const xb = Math.min(43.5, x + 1.5), w = Math.min(hz(x, 11), hz(xb, 11)) - 0.35; if (w > 0.3) k.box('wood', x, 9.0, -w, xb, 11.0, w, dk); }
  k.bulkhead('wood', 3.5, 2.4, 4.9, (y) => hz(3.5, y) - 0.3, [], plank);
  k.bulkhead('wood', 36, 2.4, 4.9, (y) => hz(36, y) - 0.3, [], plank);
  k.bulkhead('wood', 38, 5.2, 8.65, (y) => hz(38, y) - 0.3, [], plank);
  k.bulkhead('wood', 12.1, 9.0, 12.75, (y) => hz(12.1, y) - 0.3, [[-1.2, 1.2, 9.0, 11.6]], plank);
  k.room('Hold', 3.5, 2.4, -6.6, 36, 4.9, 6.6);
  k.room('Gun deck', 0.3, 5.2, -6.6, 38, 8.65, 6.6);
  k.room("Captain's great cabin", 0.3, 9.0, -6, 12.1, 12.75, 6);
  // gun deck: cannon run out at every port (two fell out through the breach)
  for (const px of ports) for (const s of [-1, 1]) {
    if (s > 0 && px > 16 && px < 27) continue;
    k.cannon(px, 5.2, s * (hz(px, 6.6) - 1.9), -s * Math.PI / 2, k.r() < 0.15);
  }
  k.cannon(19.5, 2.2 + 9.5 * 0.12, 9.5, 1.2, true);
  k.cannon(24.5, 2.2 + 10.5 * 0.12, 10.5, 2.4, true);
  k.cannonballs(13, 5.2, 0); k.cannonballs(29.5, 5.2, -0.6);
  const coil = (x, y, z) => { const pts = []; for (let i = 0; i <= 40; i++) { const a = i * 0.5, rr = 0.35 + i * 0.006; pts.push(v3(x + Math.cos(a) * rr, y + 0.04 + Math.floor(i / 13) * 0.06, z + Math.sin(a) * rr)); } k.tube('leather', pts, 0.035, C(0x3a3020), 4); };
  coil(9, 5.2, -1.4); coil(33, 5.2, 1.6); coil(24, 9.0, -2.5);
  for (let i = 0; i < 5; i++) k.pot(k.rand(5, 34), 5.2, k.rand(-2, 2));
  k.skeleton('prone', 9, 5.2, 1.5, 0.4);
  k.skeleton('curled', 26, 5.2, -2.4, 2.0);
  k.skeleton('scattered', 33, 5.2, 1.0, 0);
  k.skeleton('sitting', 15.5, 5.2, -(hz(15.5, 6) - 0.75), -Math.PI / 2);
  k.silt(2, 37, -4, 4, 5.2, 6);
  // hold: casks, crates, ballast stones
  for (let x = 5.5; x < 34; x += 1.45) for (const s of [-1, 1]) {
    if (k.r() < 0.2 || (s > 0 && x > 17 && x < 26)) continue;
    const z = s * (hz(x, 3) - 1.0);
    k.barrel(x, 2.4, z, true, 0);
    if (k.r() < 0.35) k.barrel(x + 0.7, 3.24, z - s * 0.4, true, 0);
  }
  k.crate(10, 2.4, 0.4, 1.4, 1.1, 1.0, 0.3); k.crate(30, 2.4, 1.2, 1.2, 1.0, 1.0, -0.2); k.crate(28.5, 2.4, -1.4, 1.0, 0.8, 0.9, 0.6);
  for (let i = 0; i < 16; i++) k.lump('silt', k.rand(5, 34), 2.4, k.rand(-2.5, 2.5), k.rand(0.2, 0.45), k.rand(0.15, 0.3), k.rand(0.2, 0.4), C(0x4a4844), k.rand(0, 6), 0.35);
  k.skeleton('curled', 14, 2.4, 0.8, 1.2);
  k.skeleton('scattered', 27, 2.4, -1.2, 0);
  k.silt(4, 35, -4, 4, 2.4, 6);
  // great cabin
  const yc = 9.0;
  k.table(6.5, yc, 0, 1.5, false, 0.85);
  for (const [x, z, a] of [[5.2, -1.4, 0.2], [7.8, 1.4, 3.0], [8.4, -1.2, 1.4], [4.6, 1.2, -1.2]]) k.chair(x, yc, z, a);
  k.box('silt', 5.6, yc + 0.85, -0.5, 7.2, yc + 0.87, 0.6, C(0x8a8270), { collide: false, res: 1 });
  k.chest(2.4, yc, 3.0, Math.PI / 2 + 0.2, true, true);
  k.chest(2.2, yc, -3.2, Math.PI / 2 - 0.1, false);
  k.bed(9.6, yc, -3.6, 0, C(0x4a4236));
  for (let i = 0; i < 4; i++) k.bottle(k.rand(3, 10), yc, k.rand(-3, 3), k.rand(0, 6));
  for (const z of [-0.4, 0.5]) k.cyl('metal', v3(6.2 + z, yc + 0.85, z), v3(6.2 + z, yc + 1.15, z), 0.04, brass, { r1: 0.02, seg: 8 });   // candlesticks
  k.box('metal', -0.05, 0, -0.6, 0.05, 0.03, 0.6, C(0x6a6a64), { m: M(4.0, yc + 0.02, -1.5, 0.7), collide: false, res: 1 });   // a sword
  k.skeleton('sitting', 1.25, yc, 0.4, 0);
  k.skeleton('prone', 4.2, yc, 1.8, 2.4);
  // main deck and quarterdeck
  k.cyl('wood', v3(25, 9, 0), v3(25, 10.2, 0), 0.6, dark, { r1: 0.45, collide: true, seg: 12 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; k.tube('wood', [v3(25 + Math.cos(a) * 0.5, 10.0, Math.sin(a) * 0.5), v3(25 + Math.cos(a) * 1.6, 10.0, Math.sin(a) * 1.6)], 0.05, dark, 5); }
  k.shipWheel(10, 13.1, 0, 0, 0.9);
  k.cyl('wood', v3(22.5, 8.9, 0), v3(22.6, 16.5, 0.3), 0.55, dark, { r1: 0.45, collide: true, seg: 12 });
  k.tube('wood', [v3(31, 9, 0), v3(49, 0.8, 9)], 0.45, dark, 8);
  k.tube('wood', [v3(8, 13.1, 0), v3(-6, 1.2, -8)], 0.35, dark, 8);
  for (let i = 0; i < 6; i++) k.tube('leather', [v3(22.5, 15, 0), v3(k.rand(14, 32), 11, k.rand(-3, 3)), v3(k.rand(10, 36), 9.1, k.pick([-1, 1]) * (hz(20, 9) - 0.2))], 0.03, C(0x2a2418), 4);
  for (const s of [-1, 1]) {
    k.cyl('metal', v3(0.6, 13.2, s * 3.2), v3(0.6, 14.4, s * 3.2), 0.25, brass, { r1: 0.12, seg: 8 });   // stern lanterns
    k.tube('wood', [v3(0.4, 13.2, 0), v3(0.4, 14.2, s * 2), v3(0.6, 13.2, s * 4)], 0.1, dark, 5);
  }
  for (let i = 0; i < 6; i++) { const x = 6 + k.r() * 34, z = (k.r() < 0.5 ? -1 : 1) * (8.5 + k.r() * 6), a = k.r() * Math.PI, d = v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(1.4), y = 2.1 + z * 0.12; k.tube('iron', [v3(x, y, z).sub(d), v3(x, y, z).add(d)], (t) => 0.3 - t * 0.08, C(0x22201c), 8); }
  sprinkleLife(k, 50, () => { const x = k.rand(13, 37); return v3(x, 9.0, k.rand(-1, 1) * (hz(x, 9) - 0.6)); });
}

// ---------------------------------------------------------------- Halcyon: a fleet submarine
function submarine(k) {
  const L = 84, R = 4.6, AX = R, FL = 3.0;
  const rr = (v) => Math.max(0.06, R * (v < 0.22 ? Math.pow(Math.sin((v / 0.22) * Math.PI / 2), 0.6) : v > 0.85 ? Math.pow(cos0(((v - 0.85) / 0.15) * Math.PI / 2), 0.5) : 1));
  const chord = (y) => Math.sqrt(Math.max(0, R * R - (y - AX) ** 2));
  const breach = (x, phi, j) => ((x - 35) / 4.2) ** 2 + ((phi - 0.3) / 0.65) ** 2 < 1 + j;
  const hatch = (x, phi, cx, rad) => (x - cx) ** 2 + ((phi - Math.PI / 2) * R) ** 2 < rad * rad;
  const hullCol = C(0x23272a), rustC = C(0x6a3a1a), grey = C(0x4a4640);
  k.surface('hull', {
    // fine collider panels so the round hatches stay passable (the collider cut is a little generous)
    nu: 64, nv: 180, wrap: true, pu: 36, pv: 56, thick: 0.6, buried: 1.6,
    fn: (u, v) => { const a = u * Math.PI * 2, r = rr(v); return v3(v * L, AX + Math.sin(a) * r, Math.cos(a) * r); },
    color: (p) => hullCol.clone().lerp(rustC, Math.max(0, Math.sin(p.x * 0.9 + p.y * 2)) * 0.25),
    bend: (p) => {   // the pressure hull is stove in around the breach
      const phi = Math.atan2(p.y - AX, p.z), e = Math.sqrt(((p.x - 35) / 4.2) ** 2 + ((phi - 0.3) / 0.65) ** 2);
      if (e > 1.6) return;
      const k = 1 - (1 - sstep(e, 0.95, 1.6)) * 0.18 * (0.6 + 0.4 * Math.sin(p.x * 3.3 + phi * 9));
      p.y = AX + (p.y - AX) * k; p.z *= k;
    },
    hole: (p, vis) => {
      const phi = Math.atan2(p.y - AX, p.z), j = vis ? Math.sin(p.x * 3.1 + phi * 7) * 0.25 : -0.25;
      return breach(p.x, phi, j) || hatch(p.x, phi, 65.25, vis ? 1.25 : 1.75) || hatch(p.x, phi, 45, vis ? 1.25 : 1.75);
    },
  });
  k.slab('steel', 18.5, 71.5, -4.05, 4.05, FL, 0.5, [], C(0x3a3632));
  for (const [x, door] of [[19, false], [30, true], [40, true], [52, true], [62, true], [71, false]]) {
    k.bulkhead('steel', x, FL - 0.4, AX + R - 0.25, (y) => chord(y) - 0.2, door ? [[-1.0, 1.0, FL, FL + 2.6]] : [], grey, 0.3, 0.4);
    if (door) for (const s of [-1, 1]) k.valveWheel(x - s * 0.2, FL + 1.3, 1.6, v3(-s, 0, 0), 0.25);
  }
  k.room('Engine room', 19, FL, -R, 30, AX + R, R);
  k.room('Galley and crew mess', 30, FL, -R, 40, AX + R, R);
  k.room('Control room', 40, FL, -R, 52, AX + R, R);
  k.room('Crew quarters', 52, FL, -R, 62, AX + R, R);
  k.room('Forward torpedo room', 62, FL, -R, 71, AX + R, R);
  k.room('Conning tower', 41, 8.6, -2.2, 49, 13.6, 2.2);
  // conning tower (sail) with a hatch on top
  for (const s of [-1, 1]) k.wallX('hull', 41, 49, 8.5, 13.6, s * 2.2, 0.25, [], C(0x272b2e));
  for (const x of [41, 49]) k.wallZ('hull', -2.3, 2.3, 8.5, 13.6, x, 0.25, [], C(0x272b2e));
  k.slab('hull', 40.85, 49.15, -2.35, 2.35, 13.9, 0.3, [[43.5, 46.5, -1.1, 1.1]], C(0x272b2e));
  k.box('hull', 43.4, 13.9, -1.2, 46.6, 14.15, -1.1, C(0x272b2e), { collide: false });
  for (const x of [47, 48.3]) k.cyl('iron', v3(x, FL, 0), v3(x, x > 48 ? 15.5 : 18, 0), 0.2, C(0x2a2c2e), { collide: true, seg: 10 });   // periscopes
  k.tube('iron', [v3(48.3, 15.5, 0), v3(48.9, 16.4, 0.5)], 0.12, C(0x2a2c2e), 6);                                                     // the snapped one
  ladder(k, 45, FL, 9.2, 0);
  ladder(k, 45, 9.2, 13.9, 0);
  // deck casing, deck gun, planes, rudder, screws
  k.slab('wood', 12, 40.9, -1.9, 1.9, 9.45, 0.15, [], C(0x2a2620));
  k.slab('wood', 49.1, 76, -1.9, 1.9, 9.45, 0.15, [[63.8, 66.7, -1.3, 1.3]], C(0x2a2620));
  k.cyl('iron', v3(56, 9.45, 0), v3(56, 10.6, 0), 0.5, C(0x2a2c2e), { collide: true });
  k.tube('iron', [v3(55.2, 11.1, 0), v3(60.4, 11.8, 0)], (t) => 0.2 - t * 0.06, C(0x2a2c2e), 8);
  for (const s of [-1, 1]) {
    k.box('hull', 74, 4.4, s * 2.6, 76.5, 4.6, s * 5.4, hullCol, { collide: false });   // bow planes
    k.box('hull', 4, 4.4, s * 1.8, 6.5, 4.6, s * 4.4, hullCol, { collide: false });
    k.tube('iron', [v3(6, 3.2, s * 1.5), v3(-1.5, 3.0, s * 1.5)], 0.18, ironC, 6);
    for (let b = 0; b < 3; b++) { const a = (b / 3) * Math.PI * 2 + s; k.b('metal').patch(v3(-1.2, 3.0, s * 1.5), v3(-1.0, 3.0 + Math.cos(a) * 0.2, s * 1.5 + Math.sin(a) * 0.2), v3(-1.4, 3.0 + Math.cos(a + 0.4) * 1.3, s * 1.5 + Math.sin(a + 0.4) * 1.3), v3(-1.6, 3.0 + Math.cos(a) * 1.2, s * 1.5 + Math.sin(a) * 1.2), brass, 3); }
  }
  k.box('hull', -0.5, 2.0, -0.1, 2.5, 7.0, 0.1, hullCol);
  for (const s of [-1, 1]) for (let x = 14; x < 76; x += 3) if (Math.sin(x * 1.3 + s) < 0.75) k.cyl('iron', v3(x, 9.45, s * 1.85), v3(x, 10.5, s * 1.85), 0.03, C(0x2a2c2e), { seg: 5 });
  // pipes and cable runs along the deckhead the whole length of the boat
  for (const s of [-1, 1]) { k.pipeRun([v3(19, 8.3, s * 1.3), v3(71, 8.3, s * 1.3)], 0.09); k.pipeRun([v3(19, 7.6, s * 2.7), v3(71, 7.6, s * 2.7)], 0.07, C(0x5a2a18)); }
  for (let x = 22; x < 70; x += 4) k.cyl('metal', v3(x, 8.8, 0), v3(x, 8.6, 0), 0.16, brass, { seg: 10 });
  for (let i = 0; i < 10; i++) k.cable(k.rand(20, 70), 8.3, k.rand(-1.5, 1.5), k.rand(0.6, 2));
  // engine room: two diesels with a walkway between
  for (const s of [-1, 1]) {
    k.box('iron', 20.5, FL, s * 1.3, 28.5, FL + 2.3, s * 3.0, C(0x2a2622));
    for (let i = 0; i < 6; i++) k.box('iron', 21 + i * 1.25, FL + 2.3, s * 1.6, 22 + i * 1.25, FL + 2.8, s * 2.7, C(0x221e1a), { collide: false, res: 1 });
    k.pipeRun([v3(21, FL + 3.0, s * 2.2), v3(28, FL + 3.0, s * 2.2), v3(29.5, FL + 4.2, s * 2.2)], 0.16);
    k.cyl('iron', v3(19.6, FL + 1.2, s * 2.15), v3(20.4, FL + 1.2, s * 2.15), 0.85, C(0x221e1a), { seg: 16 });
  }
  for (let i = 0; i < 5; i++) k.gauge(19.2, FL + 1.6 + (i % 2) * 0.4, -1.6 + i * 0.8, 0);
  k.skeleton('sitting', 24, FL, 1.05, Math.PI / 2);
  // galley and mess (the breach opened its starboard side)
  k.table(35, FL, -1.5, 2.4, false, 0.8);
  for (const z of [-3.2, 0.2]) k.box('furn', 33, FL, z - 0.25, 37, FL + 0.45, z + 0.25, C(0x3a2a1c));
  k.stove(37.8, FL, -3.55, 0, 2.0);
  for (let i = 0; i < 6; i++) k.plate(k.rand(33, 37), FL + 0.8, k.rand(-2.6, -0.4));
  for (let i = 0; i < 5; i++) k.pot(k.rand(31, 39), FL, k.rand(-2, 3));
  k.skeleton('prone', 34, FL, 1.8, 0.3);
  k.skeleton('scattered', 38, FL, 2.4, 0);
  k.silt(31, 39, -1, 3.5, FL, 4);
  // control room
  k.box('furn', 41.2, FL, 2.2, 43.8, FL + 0.95, 3.4, C(0x3a2a1c));
  k.box('silt', 41.4, FL + 0.95, 2.4, 43.4, FL + 0.97, 3.2, C(0x8a8270), { collide: false, res: 1 });
  k.box('steel', 41, FL, -3.9, 51, FL + 2.6, -3.5, grey, { res: 1.2 });
  for (let i = 0; i < 9; i++) k.valveWheel(41.8 + i * 1.1, FL + 1.1 + (i % 2) * 0.8, -3.45, v3(0, 0, 1), 0.2);
  for (let i = 0; i < 6; i++) k.gauge(42.3 + i * 1.5, FL + 2.2, -3.45, -Math.PI / 2);
  for (const x of [49.5, 51]) k.valveWheel(x, FL + 1.5, 3.4, v3(0, 0, -1), 0.45);
  k.skeleton('curled', 44.5, FL, -2, 0.7);
  // crew quarters: three-high racks
  for (const x of [54, 56.6, 59.2]) for (const s of [-1, 1]) k.bunk(x, FL, s * 2.9, 0, 3, 2.2);
  k.skeleton('supine', 56.6, FL + 0.35 + 0.85 + 0.12, 2.9, 0);
  k.skeleton('scattered', 58, FL, -0.6, 0);
  k.box('steel', 61.2, FL, -1.6, 61.7, FL + 2.0, 1.6, grey, { res: 1 });
  // forward torpedo room
  for (const s of [-1, 1]) for (const y of [4.2, 6.2]) {
    k.cyl('iron', v3(68.4, y, s * 1.2), v3(71, y, s * 1.2), 0.38, C(0x2c2e30), { collide: true, seg: 16 });
    k.cyl('metal', v3(68.25, y, s * 1.2), v3(68.4, y, s * 1.2), 0.42, brass, { seg: 16 });
  }
  for (const s of [-1, 1]) for (const y of [FL + 0.55, FL + 1.45]) {
    k.box('iron', 63, y - 0.32, s * 2.6 - 0.3, 68, y - 0.27, s * 2.6 + 0.3, C(0x3a3430), { res: 2 });
    k.torpedo(65.4, y, s * 2.6, 0);
  }
  k.pipeRun([v3(62.5, 8.0, 0), v3(70.5, 8.0, 0)], 0.1, C(0x3a3430));
  ladder(k, 65.25, FL, 9.2, 0);
  k.skeleton('prone', 65.5, FL, 0.4, 3.0);
  k.silt(63, 70, -1.2, 1.2, FL, 3);
  rusticles(k, 160, (r) => { const v = 0.08 + r() * 0.85, a = r() * Math.PI, rad = rr(v); const p = v3(v * L, AX + Math.sin(a) * rad, Math.cos(a) * rad); return p.y > 4 ? p : null; }, 21);
  sprinkleLife(k, 40, () => v3(k.rand(14, 75), 9.45, k.rand(-1.6, 1.6)));
}

// ---------------------------------------------------------------- Kestrel Bay: a general-cargo freighter
function freighter(k) {
  const L = 130, W = 11, H = 14, FL = 3.0, T = 0.35, IN = W - 0.4;
  const half = (u) => (u < 0.06 ? W * Math.pow(Math.sin((u / 0.06) * Math.PI / 2), 0.5) + 0.05 : u > 0.84 ? W * Math.pow(cos0(((u - 0.84) / 0.16) * Math.PI / 2), 0.7) + 0.1 : W);
  const fc = (u) => 3 * sstep(u, 0.86, 0.9);
  const ruptureAt = (p, j) => p.z < 0 && ((p.x - 70) / 6) ** 2 + ((p.y - 7.2) / 3.8) ** 2 < 1 + j;
  const hullCol = C(0x22262a), antifoul = C(0x4a1c12), stC = C(0x3a342e), paintW = C(0x8c877a);
  k.shell('hull', {
    L, nu: 180, nv: 68, half, top: (u) => H + fc(u), bilge: 2.5, buried: 2.5, panel: 2.6, panelV: 20, thick: 0.6,
    xAt: (u, v, y) => u * L + sstep(u, 0.95, 1) * (y / H) * 4,
    color: (p) => (p.y < 6 ? antifoul : hullCol).clone().multiplyScalar(0.8 + 0.35 * Math.abs(Math.sin(p.x * 0.23 + p.y * 0.4))),
    hole: (p, vis) => ruptureAt(p, vis ? Math.sin(p.x * 2.1 + p.y * 1.7) * 0.3 : -0.25),
    bend: (p) => tornIn(p, ((p.x - 70) / 6) ** 2 + ((p.y - 7.2) / 3.8) ** 2, p.z < 0, 1.3),
  });
  for (let x = 0.4; x < 8; x += 1) { const w = Math.min(half(x / L), half((x + 1) / L)) - 0.1; if (w > 0.3) k.slab('steel', x, x + 1, -w, w, H, T, [[7, 10, -1.6, 1.6]], stC); }
  k.slab('steel', 8, 111, -W + 0.05, W - 0.05, H, T, [[34, 55, -7, 7], [66, 87, -7, 7], [97, 109, -6, 6], [7, 10, -1.6, 1.6]], stC);
  k.surface('steel', {
    nu: 36, nv: 16, pu: 18, pv: 8, thick: 0.6,
    fn: (u, v) => { const x = 111 + u * (L - 1 - 111), w = half(x / L) - 0.15; return v3(x, H + fc(x / L) - 0.02, (v * 2 - 1) * w); },
    color: () => stC,
  });
  k.slab('steel', 6, 113, -IN, IN, FL, 2.6, [], stC);
  for (const [x, holes] of [[6, []], [29, []], [60, []], [92, [[-3, 3.5, 5, 10]]], [113, []]]) k.wallZ('steel', -IN, IN, FL, H - T, x, 0.4, holes, stC);
  k.room('Engine room', 6, FL, -IN, 29, H - T, IN);
  k.room('No. 3 cargo hold', 29, FL, -IN, 60, H - T, IN);
  k.room('No. 2 cargo hold', 60, FL, -IN, 92, H - T, IN);
  k.room('No. 1 cargo hold', 92, FL, -IN, 113, H - T, IN);
  // hatch coamings and the covers that came off as she went down
  for (const [a, b, c, d] of [[34, 55, -7, 7], [66, 87, -7, 7], [97, 109, -6, 6]]) {
    for (const z of [c, d]) k.wallX('steel', a, b, H, H + 1.4, z, 0.35, [], stC);
    for (const x of [a, b]) k.wallZ('steel', c, d, H, H + 1.4, x, 0.35, [], stC);
  }
  for (const [x, y, z, ry, rx] of [[44, H + 1.6, 0, 0, 0.05], [40, FL + 4, 2, 0.1, 0.9], [76, H, 9.0, Math.PI / 2, 0], [80, FL + 2.5, -3, -0.2, -0.7], [103, H, -8.6, Math.PI / 2 + 0.05, 0]]) k.box('hull', -1.6, 0, -7.2, 1.6, 0.5, 7.2, C(0x2a2e30), { m: M(x, y, z, ry, rx) });
  // engine room
  for (const s of [-1, 1]) {
    k.slab('iron', 8, 27, s > 0 ? 5.5 : -IN + 0.2, s > 0 ? IN - 0.2 : -5.5, 8.5, 0.2, [], C(0x3a3632));
    railing(k, [v3(8, 8.5, s * 5.5), v3(17.5, 8.5, s * 5.5), v3(27, 8.5, s * 5.5)], 1.0, 'iron', C(0x3a3632), 1);
    k.box('iron', 8, FL, s * 6, 11, FL + 2.4, s * 8.5, C(0x2a2622));
  }
  k.box('iron', 11, FL, -3, 24, FL + 6.2, 3, C(0x2a2622));
  for (let i = 0; i < 6; i++) k.box('iron', 11.6 + i * 2.1, FL + 6.2, -1.4, 13.2 + i * 2.1, FL + 7.2, 1.4, C(0x221e1a), { res: 1 });
  k.cyl('iron', v3(9.6, FL + 2.3, 0), v3(10.6, FL + 2.3, 0), 2.0, C(0x221e1a), { collide: true, seg: 24 });
  k.pipeRun([v3(12, FL + 7.6, 0), v3(23, FL + 7.6, 0), v3(25, H - 0.5, 0)], 0.4);
  for (let i = 0; i < 8; i++) k.gauge(28.75, FL + 2 + (i % 2) * 0.5, -6 + i * 1.6, Math.PI);
  ladder(k, 8.5, FL, H, 0);
  k.skeleton('sitting', 17, FL, 3.25, -Math.PI / 2);
  // holds
  for (const [x, z] of [[32, -8], [34.5, -8], [37, -8], [32, 8], [34.5, 8], [57, -8], [57, 8], [54.5, 8]]) { const n = 1 + Math.floor(k.r() * 2); for (let i = 0; i < n; i++) k.crate(x, FL + i * 2.3, z, 2.3, 2.3, 2.3, k.rand(-0.1, 0.1)); }
  for (let i = 0; i < 14; i++) { const x = k.rand(40, 52), z = k.rand(-6, 6); k.cyl('hull', v3(x, FL + 0.32, z), v3(x + 0.9, FL + 0.32, z + k.rand(-0.3, 0.3)), 0.3, C(0x3a4a3a), { seg: 12 }); }
  k.truck(70, FL, 5.5, 0.1); k.truck(85, FL, -4, 3.0);
  for (let i = 0; i < 6; i++) k.cyl('hull', v3(78, FL + 0.35 + Math.floor(i / 3) * 0.65, -8.5 + (i % 3) * 0.7), v3(90, FL + 0.35 + Math.floor(i / 3) * 0.65, -8.5 + (i % 3) * 0.7), 0.33, C(0x3a3430), { collide: true, seg: 12 });
  k.skeleton('scattered', 66, FL, 1, 0);
  for (let i = 0; i < 24; i++) k.lump('silt', k.rand(94, 111), FL + k.rand(0, 1.5), k.rand(-8, 8), 0.9, 0.45, 0.6, C(0x6a5a40), k.rand(0, 6), 0.3);
  k.car(101, FL, 6.5, 0.4);
  k.crate(108, FL, -6, 2.2, 2.2, 2.2, 0.2);
  k.silt(30, 112, -9, 9, FL, 10);
  // king posts and derricks
  for (const x of [58, 89.5]) {
    k.cyl('iron', v3(x, H, 0), v3(x, H + 11, 0), 0.4, C(0x2c2a28), { collide: true, seg: 12 });
    k.tube('iron', [v3(x - 0.1, H + 8, -3), v3(x - 0.1, H + 8, 3)], 0.2, C(0x2c2a28), 6);
  }
  k.tube('iron', [v3(58.5, H + 1.5, 0.5), v3(70, H + 4, 4)], 0.25, C(0x2c2a28), 6);
  k.tube('iron', [v3(89, H + 1.5, 0), v3(80, H - 2, -2)], 0.25, C(0x2c2a28), 6);
  // accommodation block aft: A deck (galley, mess, crew), B deck (officers), bridge
  const lv = [14, 17.6, 21.2, 24.8];
  for (let l = 0; l < 3; l++) {
    const y0 = lv[l], y1 = lv[l + 1] - T;
    const front = l === 2 ? [-7.5, -5, -2.5, 0, 2.5, 5, 7.5].map((c) => [c - 1.1, c + 1.1, 22.3, 24.1]) : [[-1.3, 1.3, y0, y0 + 2.9]];
    k.wallZ('paint', -9.15, 9.15, y0, y1, 26, 0.3, front, paintW);
    k.wallZ('paint', -9.15, 9.15, y0, y1, 6, 0.3, [], paintW);
    for (const s of [-1, 1]) k.wallX('paint', 6, 26, y0, y1, s * 9, 0.3, l === 2 ? [[20, 22.4, y0, y0 + 2.6]] : l === 0 && s < 0 ? [[22, 24.2, y0, y0 + 2.6]] : [], paintW);
    k.slab('paint', 5.85, 26.15, -9.15, 9.15, lv[l + 1], T, l < 2 ? [[7, 10, -1.6, 1.6]] : [], l < 2 ? tileC : paintW);
    if (l < 2) for (const s of [-1, 1]) {
      const rooms = l === 0 ? (s < 0 ? [[6, 14, 'Galley'], [14, 26, 'Mess room']] : [[6, 12.5, 'Crew cabin'], [12.5, 19, 'Crew cabin'], [19, 26, 'Crew cabin']])
        : (s < 0 ? [[6, 16, "Captain's cabin"], [16, 26, "Chief engineer's cabin"]] : [[6, 14, "Officers' cabin"], [14, 20, "Officers' cabin"], [20, 26, "Officers' cabin"]]);
      k.wallX('paint', 6, 26, y0, y1, s * 1.75, 0.25, rooms.map(([a, b]) => [(a + b) / 2 - 1.1, (a + b) / 2 + 1.1, y0, y0 + 2.8]), paintW);
      for (const [a, b, name] of rooms) {
        if (a > 6) k.wallZ('paint', s > 0 ? 1.85 : -8.85, s > 0 ? 8.85 : -1.85, y0, y1, a, 0.2, [], paintW);
        k.room(name, a, y0, s > 0 ? 1.85 : -8.85, b, y1, s > 0 ? 8.85 : -1.85);
        k.door((a + b) / 2, y0, s * 1.75, true, 2.2, 2.8, paintW);
        if (name === 'Galley') { k.stove(10, y0, s * 8.2, 0, 3.2); k.pot(9, y0, -4); k.skeleton('scattered', 10, y0, -5, 0); }
        else if (name === 'Mess room') { for (const x of [17.5, 22.5]) { k.table(x, y0, -5.4, 1.6, false, 0.78); for (const z of [-4.2, -6.6]) k.box('furn', x - 1.5, y0, z - 0.22, x + 1.5, y0 + 0.45, z + 0.22, C(0x3a2a1c)); } k.skeleton('sitting', 14.45, y0, -3.2, 0); k.skeleton('prone', 22, y0, -3, 1.2); }
        else {
          k.bed(b - 0.8, y0, s * 5.4, Math.PI / 2, C(0x5a5248));
          k.wardrobe(a + 1.1, y0, s * 8.4, s > 0 ? Math.PI : 0, k.r() < 0.3);
          k.chair((a + b) / 2, y0, s * 3.6, k.rand(0, 6));
          if (name === "Captain's cabin") { k.box('furn', a + 2, y0, -8.4, a + 4.2, y0 + 0.8, -7.2, C(0x4a2c18)); k.skeleton('prone', a + 3, y0, -5, 0.5); }
          else if (k.r() < 0.25) k.skeleton('supine', b - 0.8, y0 + 0.68, s * 5.4, s > 0 ? -Math.PI / 2 : Math.PI / 2);
        }
        k.silt(a + 0.5, b - 0.5, s * 2.5, s * 8, y0, 2);
      }
      k.room(l === 0 ? 'Crew corridor' : "Officers' corridor", 6, y0, -1.75, 26, y1, 1.75);
    }
  }
  k.wallZ('paint', -8.85, 8.85, lv[2], lv[3] - T, 10, 0.25, [[-1.3, 1.3, lv[2], lv[2] + 2.6]], paintW);
  k.room('Chart room', 6, lv[2], -9, 10, lv[3] - T, 9);
  k.room('Bridge', 10, lv[2], -9, 26, lv[3] - T, 9);
  k.box('furn', 7, lv[2], -3.5, 8.6, lv[2] + 0.95, -1.8, C(0x4a2c18));
  k.shipWheel(22, lv[2], 0, 0, 0.9);
  for (const s of [-1, 1]) {
    k.telegraph(24.6, lv[2], s * 2.2, 0);
    k.box('steel', 25.2, lv[2], s * 4 - 1.5, 25.75, lv[2] + 1.1, s * 4 + 1.5, C(0x3a3e40));
    k.slab('iron', 18, 24, s > 0 ? 9 : -11.8, s > 0 ? 11.8 : -9, lv[2], 0.25, [], C(0x3a3632));
    railing(k, [v3(18, lv[2], s * 11.7), v3(21, lv[2], s * 11.7), v3(24, lv[2], s * 11.7)], 1.1, 'iron', C(0x3a3632), 1);
    for (const x of [12, 20]) k.tube('iron', [v3(x, lv[1], s * 9.2), v3(x, lv[1] + 2.2, s * 9.6), v3(x + 0.2, lv[1] + 2.8, s * 11)], 0.1, ironC, 6);
  }
  k.skeleton('sitting', 12.5, lv[2], 4, 0);
  k.skeleton('curled', 19.5, lv[2], -5, 2.2);
  for (const y of [lv[1], lv[2]]) wellRail(k, 7, 10, -1.6, 1.6, y, 'nz');
  ladder(k, 8.5, lv[0], lv[1], -1.0); ladder(k, 8.5, lv[1], lv[2], -1.0);
  k.cyl('hull', v3(9, lv[3], 0), v3(8.6, 32, 0), 2.4, C(0x3a3430), { collide: true, seg: 24 });
  k.cyl('hull', v3(8.6, 32, 0), v3(8.58, 33.4, 0), 2.42, C(0x121110), { seg: 24 });
  // deck edge railings, forecastle windlass and foremast
  for (const s of [-1, 1]) {
    const pts = [];
    for (let x = 28; x <= 110; x += 2) pts.push(v3(x, H, s * (W - 0.25)));
    brokenRailing(k, pts, 1.1, s * 5);
  }
  k.cyl('iron', v3(121, H + 3.8, -2), v3(121, H + 3.8, 2), 0.7, ironC, { collide: true, seg: 14 });
  for (const s of [-1, 1]) k.tube('iron', [v3(121, H + 3.6, s * 1.2), v3(124, H + 3.1, s * 2), v3(126, H + 1, s * 3)], 0.12, C(0x3a2416), 5);
  k.cyl('iron', v3(116, H + 3, 0), v3(116, H + 15, 0), 0.35, C(0x2c2a28), { collide: true, seg: 10 });
  rusticles(k, 420, (r) => { const u = 0.03 + r() * 0.9, s = r() < 0.5 ? -1 : 1, x = L * u, y = 4 + r() * (H + fc(u) - 4.5); return s < 0 && ruptureAt(v3(x, y, -1), 0.4) ? null : v3(x, y, s * (half(u) + 0.12)); }, 31);
  sprinkleLife(k, 120, () => { const x = k.rand(28, 128), u = x / L, z = k.rand(-1, 1) * (half(u) - 1); if ([[34, 55, 7.6], [66, 87, 7.6], [97, 109, 6.6]].some(([a, b, c]) => x > a - 0.6 && x < b + 0.6 && Math.abs(z) < c)) return null; return v3(x, H + fc(u), z); });
}

// ---------------------------------------------------------------- Ellen Ruth: a steel stern trawler
function trawler(k) {
  const L = 34, W = 4.6, H = 5.6, FL = 1.6, T = 0.3, bR = 1.6;
  const half = (u) => (u < 0.08 ? W * (0.78 + 0.22 * Math.sin((u / 0.08) * Math.PI / 2)) : u > 0.7 ? W * Math.pow(cos0(((u - 0.7) / 0.3) * Math.PI / 2), 0.65) + 0.08 : W);
  const top = (u) => H + 1.4 * sstep(u, 0.7, 0.76) + 0.6 * sstep(u, 0.85, 1);
  const hz = hullWidth(L, half, top, bR);
  const blue = C(0x2a3a44), red = C(0x5a1a12), wh = C(0x88857a);
  k.shell('hull', {
    L, nu: 68, nv: 36, half, top, bilge: bR, buried: 0.8, panel: 2, panelV: 16, thick: 0.5,
    color: (p) => (p.y < 2.2 ? red : blue).clone().multiplyScalar(0.8 + 0.35 * Math.abs(Math.sin(p.x * 0.5 + p.y * 0.8))),
  });
  k.bulkhead('hull', 0.2, 1.0, H, (y) => hz(0.2, y) - 0.05, [], blue, 0.3, 0.4);
  hullSlab(k, 'steel', hz, 3.5, 30.5, FL, 1.0, [], C(0x3a3632), 0.3, 1.5);
  hullSlab(k, 'steel', hz, 0.2, 23.8, H, T, [[8, 11.5, -1.7, 1.7], [16.8, 19.8, -1.3, 1.3]], C(0x3a3632), 0.1, 1.5);
  k.surface('steel', {
    nu: 24, nv: 12, pu: 10, pv: 6, thick: 0.5,
    fn: (u, v) => { const x = 23.8 + u * (L - 0.6 - 23.8), w = half(x / L) - 0.12; return v3(x, top(x / L) - 0.02, (v * 2 - 1) * w); },
    color: () => C(0x3a3632),
    hole: (p) => p.x > 26.2 && p.x < 29.4 && Math.abs(p.z) < 1.3,
  });
  k.bulkhead('steel', 3.5, FL, H - T, (y) => hz(3.5, y) - 0.3, [], C(0x3a3632));
  k.bulkhead('steel', 15, FL, H - T, (y) => hz(15, y) - 0.3, [[-1.0, 1.0, FL, FL + 2.5]], C(0x3a3632));
  k.bulkhead('steel', 24, FL, H - T, (y) => hz(24, y) - 0.3, [[-1.0, 1.0, FL, FL + 2.5]], C(0x3a3632));
  k.bulkhead('steel', 30.5, FL, top(30.5 / L) - T, (y) => hz(30.5, y) - 0.3, [], C(0x3a3632));
  k.room('Fish hold', 3.5, FL, -W, 15, H - T, W);
  k.room('Engine room', 15, FL, -W, 24, H - T, W);
  k.room("Crew's quarters", 24, FL, -W, 30.5, 6.8, W);
  // wheelhouse
  const yw = H, ywc = 9.2;
  k.wallZ('paint', -3.1, 3.1, yw, ywc, 23.5, 0.2, [[-2.6, -0.9, 6.9, 8.6], [-0.8, 0.8, 6.9, 8.6], [0.9, 2.6, 6.9, 8.6]], wh);
  k.wallZ('paint', -3.1, 3.1, yw, ywc, 16, 0.2, [[-0.8, 0.8, 7.0, 8.4]], wh);
  for (const s of [-1, 1]) k.wallX('paint', 16, 23.5, yw, ywc, s * 3.0, 0.2, [[17, 18.8, yw, yw + 2.4]], wh);
  k.slab('paint', 15.8, 23.7, -3.2, 3.2, 9.5, 0.3, [], wh);
  k.room('Wheelhouse', 16, yw, -3, 23.5, ywc, 3);
  k.shipWheel(21.6, yw, 0, 0, 0.8);
  k.box('steel', 22.6, yw, -2.8, 23.3, yw + 1.0, -0.8, C(0x3a3e40));
  k.box('steel', 22.6, yw, 0.8, 23.3, yw + 1.0, 2.8, C(0x3a3e40));
  k.box('furn', 16.15, yw, -2.6, 16.9, yw + 0.9, -1.2, C(0x4a2c18));
  k.skeleton('sitting', 22.2, yw, -2.0, Math.PI);
  ladder(k, 18.3, FL, H, -0.9);
  // fish hold, engine room, crew quarters
  for (let i = 0; i < 26; i++) k.box('wood', -0.4, 0, -0.25, 0.4, 0.35, 0.25, C(0x5a4a34), { m: M(k.rand(4.5, 14), FL + (i % 3 === 0 ? 0.35 : 0), k.rand(-3.2, 3.2), k.rand(0, 6), k.rand(-0.2, 0.2)), collide: false, res: 1 });
  for (let i = 0; i < 6; i++) k.lump('leather', k.rand(5, 13), FL, k.rand(-2.5, 2.5), k.rand(0.6, 1.2), k.rand(0.3, 0.6), k.rand(0.6, 1.2), C(0x1e2a1e), k.rand(0, 6), 0.4);
  k.silt(4, 14, -3, 3, FL, 3);
  k.box('iron', 17, FL, -1.2, 22, FL + 2.0, 1.2, C(0x2a2622));
  k.pipeRun([v3(17.5, FL + 2.0, 0), v3(15.5, H - 0.5, -0.8), v3(15.5, H + 4, -0.8)], 0.15);   // exhaust stack behind the wheelhouse
  k.box('furn', 16, FL, 2.8, 18.5, FL + 0.9, 3.7, C(0x3a2a1c));
  for (const z of [-3, 3]) k.cyl('hull', v3(23.3, FL, z), v3(23.3, FL + 0.9, z), 0.3, C(0x3a4a3a), { seg: 12, collide: true });
  k.skeleton('scattered', 20, FL, 2.6, 0);
  for (const s of [-1, 1]) k.bunk(26.6, FL, s * (hz(26.6, 2.5) - 0.9), 0, 2, 2.0);
  k.stove(29.5, FL, 0, Math.PI / 2, 1.4);
  k.skeleton('supine', 26.6, FL + 0.35 + 0.12, hz(26.6, 2.5) - 0.9, 0);
  // deck gear: stern gallows, trawl winch, nets, otter boards, mast
  for (const s of [-1, 1]) {
    k.tube('iron', [v3(1.2, H, s * 3.9), v3(1.2, H + 4.5, s * 3.4), v3(1.2, H + 4.7, s * 1.2)], 0.15, C(0x3a3430), 6);
    k.box('hull', -1.2, 0, -0.08, 1.2, 1.2, 0.08, C(0x2a2622), { m: M(2.6, H + 0.6, s * 3.6, 0, 0, 0.15) });
  }
  k.tube('iron', [v3(1.2, H + 4.7, -1.2), v3(1.2, H + 4.7, 1.2)], 0.15, C(0x3a3430), 6);
  for (const s of [-1, 1]) k.cyl('iron', v3(13.4, H + 0.8, s * 0.4), v3(13.4, H + 0.8, s * 2.4), 0.7, C(0x2c2a28), { collide: true, seg: 16 });
  for (let i = 0; i < 9; i++) k.lump('leather', k.rand(3.5, 7.5), H, k.rand(-2.5, 2.5), k.rand(0.5, 1.2), k.rand(0.2, 0.5), k.rand(0.5, 1.2), C(0x22301e), k.rand(0, 6), 0.45);
  for (let i = 0; i < 7; i++) k.b('china').sphere(v3(k.rand(3, 8), H + 0.2, k.rand(-3, 3)), 0.2, C(0x6a4a2a), undefined, 10);
  k.cyl('iron', v3(25, top(25 / L), 0), v3(25, 15, 0), 0.18, C(0x2c2a28), { collide: true, seg: 8 });
  k.tube('iron', [v3(25, 13, -2), v3(25, 13, 2)], 0.08, C(0x2c2a28), 5);
  for (const s of [-1, 1]) k.wallX('hull', 3, 15.5, H, H + 1.0, s * (W - 0.12), 0.12, [], blue);
  rusticles(k, 140, (r) => { const u = 0.03 + r() * 0.9, s = r() < 0.5 ? -1 : 1; return v3(L * u, 1.8 + r() * (top(u) - 2.2), s * (half(u) + 0.1)); }, 41);
  sprinkleLife(k, 30, () => v3(k.rand(3, 15), H, k.rand(-3.6, 3.6)));
}

// ---------------------------------------------------------------- debris between the wrecks (world coordinates)
function debrisField(k, hAt) {
  // the liner's funnels lie open-ended on the mud: you can fly through them
  const funnel = (x, z, yaw, len, r) => {
    const d = v3(Math.cos(yaw), 0, -Math.sin(yaw)), side = v3(-d.z, 0, d.x), y0 = hAt(x, z) + r * 0.86;
    k.surface('hull', {
      nu: 30, nv: 14, wrap: true, pu: 16, pv: 7, thick: 0.4,
      fn: (u, v) => { const a = u * Math.PI * 2; return v3(x, y0, z).addScaledVector(d, (v - 0.5) * len).addScaledVector(side, Math.cos(a) * r).add(v3(0, Math.sin(a) * r * 0.9, 0)); },
      color: (p, u, v) => (v > 0.86 ? C(0x141210) : C(0x5a3a1c)).clone().multiplyScalar(0.75 + 0.35 * Math.abs(Math.sin(u * 40))),
    });
  };
  funnel(-10, -95, 0.4, 16, 3.4);
  funnel(-38, -66, 1.9, 14, 3.2);
  for (const [x, z, a] of [[2, -78, 0.3], [14, -90, 1.4]]) {
    const y = hAt(x, z) + 1.6, d = v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(3);
    k.cyl('iron', v3(x, y, z).sub(d), v3(x, y, z).add(d), 2.0, C(0x2a2420), { collide: true, seg: 24 });
  }
  const r = rng(31);
  for (let i = 0; i < 90; i++) {
    const x = -50 + r() * 100, z = -140 + r() * 100, y = hAt(x, z) + 0.05;
    const s = 0.6 + r() * 2.8, a = r() * Math.PI, dx = Math.cos(a) * s, dz = Math.sin(a) * s;
    k.b('hull').patch(v3(x - dx, y, z - dz), v3(x + dz * 0.6, y + r() * 0.6, z - dx * 0.6), v3(x + dx, y + r() * 0.4, z + dz), v3(x - dz * 0.6, y, z + dx * 0.6), C(0x3a2a1e), 2, undefined, (r() - 0.5) * 0.6);
  }
  for (let i = 0; i < 40; i++) { const x = -40 + r() * 80, z = -130 + r() * 80; k.lump('silt', x, hAt(x, z), z, 0.3 + r() * 0.6, 0.2 + r() * 0.3, 0.3 + r() * 0.6, C(0x141210), r() * 6, 0.4); }
  for (let i = 0; i < 18; i++) { const x = -30 + r() * 70, z = -120 + r() * 70; k.chair(x, hAt(x, z), z, r() * 6); }
  for (let i = 0; i < 24; i++) { const x = -30 + r() * 70, z = -120 + r() * 70; k.plate(x, hAt(x, z) + 0.02, z); }
  k.skeleton('scattered', 6, hAt(6, -70), -70, 0);
}

const BUILD = { liner, galleon, submarine, freighter, trawler };
const NAMES = { liner: 'SS Meridian', galleon: 'San Teodoro', submarine: 'Submarine Halcyon', freighter: 'MV Kestrel Bay', trawler: 'Trawler Ellen Ruth' };
const KIND = { liner: 'Liner', galleon: 'Galleon', submarine: 'Submarine', freighter: 'Freighter', trawler: 'Trawler' };

export function createWrecks(ctx, seafloor) {
  const { scene, camera } = ctx;
  if (!seafloor) throw new Error('wrecks need the seafloor module');
  const group = new THREE.Group();
  scene.add(group);
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, ...o });
  const mats = {
    hull: patch(std({ roughness: 0.82, metalness: 0.3 }), { detail: 'rust', dust: 0.55, glow: true, bump: 'plates', bumpAmp: 3 }),
    steel: patch(std({ roughness: 0.85, metalness: 0.25 }), { detail: 'rust', dust: 0.7, glow: true, bump: 'skin', bumpFreq: 0.08, bumpAmp: 2 }),
    iron: patch(std({ roughness: 0.8, metalness: 0.35 }), { detail: 'rust', dust: 0.6, glow: true, bump: 'skin', bumpFreq: 0.12, bumpAmp: 2 }),
    paint: patch(std({ roughness: 0.7, metalness: 0.05 }), { detail: 'paint', dust: 0.75, glow: true, bump: 'paint', bumpAmp: 2.5 }),
    wood: patch(std({ roughness: 0.92 }), { detail: 'wood', dust: 0.7, glow: true, bump: 'planks', bumpAmp: 3 }),
    furn: patch(std({ roughness: 0.85 }), { detail: 'wood', dust: 0.6, glow: true }),
    metal: patch(std({ roughness: 0.45, metalness: 0.85 }), { detail: 'tarnish', dust: 0.4, glow: true }),
    bone: patch(std({ roughness: 0.78 }), { detail: 'bone', dust: 0.3, glow: true }),
    silt: patch(std({ roughness: 1.0 }), { detail: 'sediment', dust: 0.3, glow: true }),
    leather: patch(std({ roughness: 0.75 }), { detail: 'skin', dust: 0.5, glow: true }),
    gold: patch(std({ roughness: 0.28, metalness: 1.0 }), { dust: 0.15, glow: true }),
    china: patch(std({ roughness: 0.25 }), { dust: 0.5, glow: true }),
    rusticle: patch(std({ roughness: 0.9 }), { detail: 'sediment', glow: true }),
    life: patch(std({ roughness: 0.6 }), { glow: true }),
  };
  const toMeshes = (k, g) => {
    for (const [key, b] of Object.entries(k.parts)) {
      if (!b.idx.length) continue;
      const geo = b.build();
      geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
      for (const chunk of spatialChunks(geo)) {
        const mesh = new THREE.Mesh(chunk, mats[key] ?? mats.hull);
        mesh.name = key;
        mesh.castShadow = key !== 'life' && key !== 'gold';
        mesh.receiveShadow = true;
        g.add(mesh);
      }
    }
  };

  for (const key of ['hull', 'steel', 'iron', 'paint', 'rusticle']) photographic(mats[key], 'rusty_metal_03', { scale: 0.8, strength: key === 'paint' ? 0.3 : 0.65, normal: 0.65 });
  for (const key of ['wood', 'furn']) photographic(mats[key], 'weathered_planks', { scale: key === 'furn' ? 1.7 : 0.65, strength: 0.78, normal: 0.5 });

  // collision: oriented boxes in each wreck's frame, bucketed in a coarse grid
  const RAD = 0.85, CELL = 6;
  const cellKey = (x, y, z) => ((Math.floor(x / CELL) + 512) * 1024 + (Math.floor(y / CELL) + 512)) * 1024 + (Math.floor(z / CELL) + 512);
  function buildGrid(c) {
    const grid = new Map();
    for (let i = 0; i < c.length / 15; i++) {
      const o = i * 15;
      const ex = Math.abs(c[o + 6]) * c[o + 3] + Math.abs(c[o + 9]) * c[o + 4] + Math.abs(c[o + 12]) * c[o + 5] + RAD + 0.1;
      const ey = Math.abs(c[o + 7]) * c[o + 3] + Math.abs(c[o + 10]) * c[o + 4] + Math.abs(c[o + 13]) * c[o + 5] + RAD + 0.1;
      const ez = Math.abs(c[o + 8]) * c[o + 3] + Math.abs(c[o + 11]) * c[o + 4] + Math.abs(c[o + 14]) * c[o + 5] + RAD + 0.1;
      for (let x = Math.floor((c[o] - ex) / CELL); x <= Math.floor((c[o] + ex) / CELL); x++)
        for (let y = Math.floor((c[o + 1] - ey) / CELL); y <= Math.floor((c[o + 1] + ey) / CELL); y++)
          for (let z = Math.floor((c[o + 2] - ez) / CELL); z <= Math.floor((c[o + 2] + ez) / CELL); z++) {
            const key = ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
            let list = grid.get(key);
            if (!list) grid.set(key, (list = []));
            list.push(i);
          }
    }
    return grid;
  }
  const wrecks = [];
  const addWreck = (k, g, id, site = null) => {
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const cols = new Float32Array(k.cols);
    wrecks.push({
      id, site, name: k.name, group: g, rooms: k.rooms, cols, grid: buildGrid(cols), cellKey, RAD,
      mat: g.matrixWorld.clone(), inv: g.matrixWorld.clone().invert(), rot: new THREE.Matrix3().setFromMatrix4(g.matrixWorld),
      center: box.getCenter(new THREE.Vector3()), radius: box.getSize(new THREE.Vector3()).length() / 2,
    });
  };
  WRECK_SITES.forEach((s, i) => {
    const k = new Kit(NAMES[s.id], 101 + i * 17);
    try { BUILD[s.id](k); } catch (e) { console.error('wreck failed:', s.id, e); return; }
    const g = new THREE.Group();
    toMeshes(k, g);
    g.position.set(s.x, seafloor.siteOrigin(i), s.z);
    g.rotation.set(s.roll, s.yaw, s.pitch, 'YXZ');
    group.add(g);
    addWreck(k, g, s.id, s);
  });
  {
    const k = new Kit('Debris field', 7);
    debrisField(k, seafloor.heightAt);
    const g = new THREE.Group();
    toMeshes(k, g);
    group.add(g);
    addWreck(k, g, 'debris');
  }

  const lp = new THREE.Vector3(), q = new THREE.Vector3(), dv = new THREE.Vector3(), nW = new THREE.Vector3();
  function resolve(w, p, vel) {
    lp.copy(p).applyMatrix4(w.inv);
    const list = w.grid.get(cellKey(lp.x, lp.y, lp.z));
    if (!list) return;
    const c = w.cols;
    let hit = false;
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const i of list) {
        const o = i * 15;
        const dx = lp.x - c[o], dy = lp.y - c[o + 1], dz = lp.z - c[o + 2];
        const hx = c[o + 3], hy = c[o + 4], hz = c[o + 5];
        const bx = dx * c[o + 6] + dy * c[o + 7] + dz * c[o + 8];
        const by = dx * c[o + 9] + dy * c[o + 10] + dz * c[o + 11];
        const bz = dx * c[o + 12] + dy * c[o + 13] + dz * c[o + 14];
        if (Math.abs(bx) > hx + RAD || Math.abs(by) > hy + RAD || Math.abs(bz) > hz + RAD) continue;
        const ex = bx - Math.max(-hx, Math.min(hx, bx)), ey = by - Math.max(-hy, Math.min(hy, by)), ez = bz - Math.max(-hz, Math.min(hz, bz));
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= RAD * RAD) continue;
        let nx = 0, ny = 0, nz = 0, pen;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = ex / d; ny = ey / d; nz = ez / d; pen = RAD - d; }
        else {   // centre inside the box: leave through the nearest face
          const px = hx - Math.abs(bx), py = hy - Math.abs(by), pz = hz - Math.abs(bz);
          if (px <= py && px <= pz) { nx = bx >= 0 ? 1 : -1; pen = px + RAD; }
          else if (py <= pz) { ny = by >= 0 ? 1 : -1; pen = py + RAD; }
          else { nz = bz >= 0 ? 1 : -1; pen = pz + RAD; }
        }
        const wx = nx * c[o + 6] + ny * c[o + 9] + nz * c[o + 12], wy = nx * c[o + 7] + ny * c[o + 10] + nz * c[o + 13], wz = nx * c[o + 8] + ny * c[o + 11] + nz * c[o + 14];
        lp.x += wx * pen; lp.y += wy * pen; lp.z += wz * pen;
        nW.set(wx, wy, wz).applyMatrix3(w.rot);
        const vn = vel.dot(nW);
        if (vn < 0) vel.addScaledVector(nW, -vn);
        moved = hit = true;
      }
      if (!moved) break;
    }
    if (hit) p.copy(lp).applyMatrix4(w.mat);
  }
  // sweep from the previous position in short steps so thin bulkheads can't be tunnelled through
  const near = [];
  function collide(p, vel, from) {
    near.length = 0;
    for (const w of wrecks) if (w.group.visible && p.distanceTo(w.center) < w.radius + 6) near.push(w);
    if (!near.length) return;
    dv.subVectors(p, from);
    const steps = Math.min(32, Math.max(1, Math.ceil(dv.length() / 0.3)));
    q.copy(from);
    for (let s = 0; s < steps; s++) { q.addScaledVector(dv, 1 / steps); for (const w of near) resolve(w, q, vel); }
    p.copy(q);
  }
  // distance from p straight up (dir = 1) or down (dir = -1) to the first solid face that is roughly level, up to max:
  // what you stand on when walking the decks (floors, stair stringers, debris), and the deckhead over you. A ray
  // grazing the (slightly tilted) side of a table or a bulkhead is not a floor.
  const ro = new THREE.Vector3(), rd = new THREE.Vector3(), rp = new THREE.Vector3();
  function probe(p, dir, max) {
    let best = max;
    for (const w of wrecks) {
      if (!w.group.visible || p.distanceTo(w.center) > w.radius + max) continue;
      ro.copy(p).applyMatrix4(w.inv);
      rd.set(p.x, p.y + dir, p.z).applyMatrix4(w.inv).sub(ro);   // the vertical, in the wreck's (tilted) frame
      const c = w.cols;
      for (let s = 0; s <= max + 0.5; s++) {
        rp.copy(ro).addScaledVector(rd, Math.min(s, max));
        const list = w.grid.get(cellKey(rp.x, rp.y, rp.z));
        if (!list) continue;
        for (const i of list) {
          // ray against the oriented box (slab test in its own axes); a box the ray starts inside is ignored
          const o = i * 15, dx = ro.x - c[o], dy = ro.y - c[o + 1], dz = ro.z - c[o + 2];
          let t0 = 0, t1 = best, level = 0;
          for (let a = 0; a < 3 && t0 <= t1; a++) {
            const ax = c[o + 6 + a * 3], ay = c[o + 7 + a * 3], az = c[o + 8 + a * 3], h = c[o + 3 + a];
            const org = dx * ax + dy * ay + dz * az, dn = rd.x * ax + rd.y * ay + rd.z * az;
            if (Math.abs(dn) < 1e-6) { if (Math.abs(org) > h) t0 = Infinity; continue; }
            const ta = (-h - org) / dn, tb = (h - org) / dn;
            if (Math.min(ta, tb) > t0) { t0 = Math.min(ta, tb); level = Math.abs(dn); }   // the face the ray enters by
            t1 = Math.min(t1, Math.max(ta, tb));
          }
          if (t0 > 0 && t0 <= t1 && t0 < best && level > 0.5) best = t0;
        }
      }
    }
    return best;
  }

  const liner = wrecks.find((w) => w.id === 'liner') ?? wrecks[0];
  // hover just off the liner's bow, above and ahead of the stem, looking back along the forecastle
  const viewpoint = { pos: new THREE.Vector3(176, 30, 10).applyMatrix4(liner.mat), yaw: 0, pitch: 0 };
  {
    const d = new THREE.Vector3(138, 17, 0).applyMatrix4(liner.mat).sub(viewpoint.pos);
    viewpoint.yaw = Math.atan2(-d.x, -d.z);
    viewpoint.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }
  const pois = wrecks.filter((w) => w.id !== 'debris').map((w) => ({ name: `${KIND[w.id]} ${w.name.replace(/^(Submarine|Trawler) /, '')}`, pos: new THREE.Vector3(w.center.x, seafloor.heightAt(w.center.x, w.center.z), w.center.z) }));
  pois.push({ name: 'Hydrothermal vents', pos: new THREE.Vector3(seafloor.ventSite.x, seafloor.heightAt(seafloor.ventSite.x, seafloor.ventSite.y), seafloor.ventSite.y) });

  const api = { update, viewpoint, pois, collide, probe, RAD, inside: false, room: '', list: wrecks };
  function update(info) {
    const cam = camera.position;
    group.visible = info.under && cam.y < -3000 && Math.hypot(cam.x, cam.z) < 2500;
    api.inside = false; api.room = '';
    if (!group.visible) return;
    for (const w of wrecks) {
      const d = cam.distanceTo(w.center);
      w.group.visible = d < w.radius + 450;   // the water swallows everything further off at this depth
      if (w.group.visible) {
        lp.copy(cam).applyMatrix4(w.inv);
        for (const mesh of w.group.children) {
          const sphere = mesh.geometry.boundingSphere;
          mesh.visible = lp.distanceTo(sphere.center) < 115 + sphere.radius;
        }
      }
      if (api.inside || d > w.radius) continue;
      lp.copy(cam).applyMatrix4(w.inv);
      for (const r of w.rooms) {
        if (lp.x > r.min.x && lp.x < r.max.x && lp.y > r.min.y && lp.y < r.max.y && lp.z > r.min.z && lp.z < r.max.z) { api.inside = true; api.room = `${w.name} · ${r.name}`; break; }
      }
    }
  }
  return api;
}
