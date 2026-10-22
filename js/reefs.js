// Persistent, instanced reef ecosystems and traversable flooded karst passages.
import * as THREE from 'three';
import { GeoBuilder, fishGeometry, turtleGeometry, rayGeometry, C, v3, ZERO } from './builders.js';
import { patch, ensurePhase, G, GLSL_TRANSP } from './materials.js';
import { rng } from './common.js';
import { photographic } from './pbr.js';
import { REEF_BANKS, CAVE_SITES, reefHeightAt, caveSection, caveSkylight, caveAt, caveSurface, caveRadii } from './habitats.js';

const TAU = Math.PI * 2;
// healthy reef pigments under white light: hot orange, violet, sulphur yellow, magenta, emerald, coral red
const coralColors = [0xb98055, 0x9d839c, 0xb6a76a, 0xc98b85, 0x809b83, 0xb75e4e, 0x929b79, 0xc4b494];
const tmp = new THREE.Object3D();

function coralGeometry(kind, seed) {
  const b = new GeoBuilder(), r = rng(seed), color = C(coralColors[seed % coralColors.length]);
  const tip = color.clone().lerp(C(0xf6dfb8), 0.42);
  if (kind === 'branch' || kind === 'staghorn') {
    const branch = (base, dir, length, radius, level) => {
      const end = base.clone().addScaledVector(dir, length);
      const bend = v3((r() - 0.5) * 0.22, 0, (r() - 0.5) * 0.22);
      const pts = Array.from({ length: 6 }, (_, i) => base.clone().lerp(end, i / 5).addScaledVector(bend, Math.sin(i / 5 * Math.PI)));
      b.tube(pts, (t) => radius * (1 - t * 0.72) * (1 + Math.sin(t * 19 + seed) * 0.07), color, 9, null, (t) => color.clone().lerp(tip, t * t));
      b.sphere(end, radius * 0.29, tip, ZERO, 8);
      for (let j = 1; j <= 3; j++) {
        const a = r() * TAU, p = pts[j].clone().add(v3(Math.cos(a), 0.2, Math.sin(a)).multiplyScalar(radius * 0.7));
        b.tube([p, p.clone().add(v3(Math.cos(a), 0.4, Math.sin(a)).multiplyScalar(radius * 0.48))], t => radius * (0.2 - t * 0.06), tip, 5);
      }
      if (level <= 0) return;
      for (let i = 0; i < (kind === 'staghorn' ? 2 : 3); i++) {
        const a = r() * TAU;
        const next = v3(Math.cos(a) * 0.65, 0.48 + r() * 0.4, Math.sin(a) * 0.65).normalize();
        branch(base.clone().lerp(end, 0.5 + r() * 0.4), next, length * (0.50 + r() * 0.18), radius * 0.52, level - 1);
      }
    };
    for (let i = 0; i < 4; i++) branch(v3((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5), v3((r() - 0.5) * 0.9, 0.6 + r() * 0.4, (r() - 0.5) * 0.9).normalize(), (kind === 'staghorn' ? 1.25 : 0.7) + r() * 0.6, kind === 'staghorn' ? 0.065 : 0.10, kind === 'staghorn' ? 3 : 2);
  } else if (kind === 'lettuce') {
    for (let k = 0; k < 6; k++) {
      const angle = k * 2.399 + seed, radius = 0.45 + r() * 0.5;
      b.grid(36, 12, (u, v) => {
        const a = angle + (u - 0.5) * 4.4, d = radius * (0.12 + v * 0.88);
        return { p: v3(Math.cos(a) * d, 0.08 + k * 0.12 + v * v * 0.35 + Math.sin(a * 8 + seed) * v * v * 0.075, Math.sin(a) * d), c: color.clone().lerp(tip, Math.pow(v, 12)) };
      });
    }
  } else if (kind === 'plate') {
    for (let k = 0; k < 4; k++) {
      const rad = 0.7 + r() * 0.5, y = 0.2 + k * 0.23, ox = (r() - 0.5) * 0.7, oz = (r() - 0.5) * 0.7;
      b.grid(64, 12, (u, v) => {
        const a = u * TAU, d = Math.max(v, 0.012) * rad * (1 + Math.sin(a * 7 + k) * 0.045);
        return { p: v3(ox + Math.cos(a) * d, y + v * v * 0.16 + Math.sin(a * 9) * v * 0.025, oz + Math.sin(a) * d), c: color.clone().lerp(tip, Math.pow(v, 8)) };
      }, true);
      b.tube([v3(ox, 0, oz), v3(ox, y, oz)], (t) => 0.13 - t * 0.05, color, 6);
    }
  } else if (kind === 'brain') {
    b.grid(80, 40, (u, v) => {
      const a = u * TAU, p = v * Math.PI * 0.56;
      const ridge = Math.sin(a * 13 + Math.sin(p * 15 + a * 3) * 2.5) * 0.025;
      const rad = 0.85 + ridge + Math.sin(a * 3 + seed) * Math.sin(p * 3) * 0.075;
      return { p: v3(Math.cos(a) * Math.sin(p) * rad, Math.cos(p) * rad * 0.78 + 0.12, Math.sin(a) * Math.sin(p) * rad), c: color.clone().multiplyScalar(0.75 + ridge * 7) };
    }, true);
  } else if (kind === 'fan') {
    // A branching, open lattice, with fine cross veins instead of an opaque paddle.
    b.tube([v3(0, 0, 0), v3(0, 0.7, 0)], () => 0.045, color, 5);
    for (let k = 0; k < 17; k++) {
      const a = (k / 16 - 0.5) * 2.2, pts = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8, h = 0.4 + t * 1.9;
        pts.push(v3(Math.sin(a) * t * 1.25, h * Math.cos(a * 0.45), Math.sin(t * 4 + k) * 0.035));
      }
      b.tube(pts, (t) => 0.018 * (1 - t * 0.6), color, 4);
      if (k > 0) for (let j = 2; j <= 7; j++) {
        const t = j / 8, a0 = ((k - 1) / 16 - 0.5) * 2.2;
        b.tube([v3(Math.sin(a0) * t * 1.25, (0.4 + t * 1.9) * Math.cos(a0 * 0.45), Math.sin(t * 4 + k - 1) * 0.035), pts[j]], () => 0.009, tip, 3);
      }
    }
  } else {
    // Open sponge vases: continuous outer lip and a visibly recessed inner wall.
    for (let k = 0; k < 5; k++) {
      const ox = (r() - 0.5) * 1.2, oz = (r() - 0.5) * 1.2, h = 0.6 + r() * 1.1;
      b.grid(20, 16, (u, v) => {
        const a = u * TAU, inner = v > 0.5, t = inner ? (1 - v) * 2 : v * 2;
        const rad = (0.13 + Math.sin(t * 1.7) * 0.12) * (inner ? 0.72 : 1);
        return { p: v3(ox + Math.cos(a) * rad, t * h + Math.sin(a * 4) * t * 0.025, oz + Math.sin(a) * rad), c: color.clone().multiplyScalar(inner ? 0.42 : 0.85 + t * 0.2) };
      }, true);
    }
  }
  return ensurePhase(b.build());
}

function upward(geo) {
  const index = geo.index.array;
  for (let i = 0; i < index.length; i += 3) [index[i], index[i + 2]] = [index[i + 2], index[i]];
  geo.computeVertexNormals();
  return geo;
}

//this function builds the geometry for the reef banks, which are the main underwater structures in the scene. It creates a grid of vertices based on the positions and sizes of the reef banks defined in REEF_BANKS, calculates their heights using reefHeightAt, and assigns colors based on their height and position. The resulting geometry is then returned for use in rendering the reef banks in the scene.
function bankGeometry() { 
  const b = new GeoBuilder();
  const minX = Math.min(...REEF_BANKS.map((b) => b.x - b.rx * 1.3)), maxX = Math.max(...REEF_BANKS.map((b) => b.x + b.rx * 1.3));
  const minZ = Math.min(...REEF_BANKS.map((b) => b.z - b.rz * 1.3)), maxZ = Math.max(...REEF_BANKS.map((b) => b.z + b.rz * 1.3));
  b.grid(224, 224, (u, v) => {
    const x = THREE.MathUtils.lerp(minX, maxX, u), z = THREE.MathUtils.lerp(minZ, maxZ, v);
    const h = Math.max(-3800, reefHeightAt(x, z));
    const mottling = 0.5 + 0.5 * Math.sin(x * 0.16) * Math.cos(z * 0.19);
    const c = C(0xc9c3a5).lerp(C(0x6e8372), mottling * 0.32);
    if (h < -180) c.multiplyScalar(0.65);
    return { p: v3(x, h, z), c };
  });
  return ensurePhase(upward(b.build()));
}

function caveGeometry(cave) {
  const b = new GeoBuilder(), segments = 144, rings = 144;
  for (const outer of [false, true]) b.grid(segments, rings, (u, t) => {
    const a = u * TAU, s = caveSection(cave, t), nx = Math.cos(a), ny = Math.sin(a);
    // Fine, continuous strata preserve the exact collision envelope at every section.
    const radii = caveRadii(cave, t, a);
    const thick = outer ? 9 + Math.sin(a * 5 + t * 21) * 1.4 : 0;
    const c = C(outer ? 0x8b9780 : 0x8f9c94).multiplyScalar(0.77 + Math.sin(t * 91 + a * 3) * 0.09 + Math.sin(a * 19) * 0.035);
    // Warm coralline crust at the entrances; mineral-grey limestone in the dark interior.
    if (t < 0.12 || t > 0.88) c.lerp(C(0x985d6e), Math.max(0, Math.cos(a * 6 + t * 30)) * 0.4);
    return { p: v3(s.x + nx * (radii.rx + thick), s.y + ny * (radii.ry + thick), s.z), c };
  }, true, (i, j) => !caveSkylight(cave, (j + 0.5) / rings, Math.cos((i + 0.5) / segments * TAU), Math.sin((i + 0.5) / segments * TAU)));
  for (const t of [0, 1]) b.grid(144, 3, (u, v) => {
    const a = u * TAU, s = caveSection(cave, t), thick = v * (9 + Math.sin(a * 5 + t * 21) * 1.4);
    const r = caveRadii(cave, t, a);
    return { p: v3(s.x + Math.cos(a) * (r.rx + thick), s.y + Math.sin(a) * (r.ry + thick), s.z), c: C(0x9c9b81) };
  }, true);
  return ensurePhase(b.build());
}

function limestoneGeometry(seed) {
  const b = new GeoBuilder(), r = rng(seed), phase = r() * TAU;
  b.grid(48, 28, (u, v) => {
    const a = u * TAU, p = v * Math.PI;
    const x = Math.sin(p) * Math.cos(a), y = Math.cos(p), z = Math.sin(p) * Math.sin(a);
    const joint = Math.pow(Math.abs(Math.sin(y * 8 + x * 2 + phase)), 8);
    const eroded = 1 + Math.sin(x * 5 + phase) * Math.cos(z * 4 - y * 3) * 0.19 + Math.sin(z * 13 + y * 9) * 0.055 - joint * 0.08;
    return { p: v3(x * eroded, Math.max(-0.68, y * eroded), z * eroded), c: C(0xafa994).multiplyScalar(0.82 + y * 0.08 - joint * 0.14) };
  }, true);
  return ensurePhase(b.build());
}

function starGeometry() {
  const b = new GeoBuilder(), c = C(0xd78f55);
  b.sphere(v3(0, 0.05, 0), 0.17, c, ZERO, 10, v3(1, 0.4, 1));
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * TAU;
    b.tube([v3(0, 0.05, 0), v3(Math.cos(a) * 0.24, 0.06, Math.sin(a) * 0.24), v3(Math.cos(a + 0.16) * 0.52, 0.02, Math.sin(a + 0.16) * 0.52)], (t) => 0.12 * (1 - t * 0.94), c, 7);
  }
  return ensurePhase(b.build());
}

function reefFishGeometry(kind) {
  // anthias orange-pink, blue tang, yellow tang, parrotfish teal and rose, silver glassfish
  const palettes = [[0xff5a2a, 0xffa050, 0xff3d7a], [0x1450ff, 0x3a86ff, 0xffd000], [0xffe010, 0xfff27a, 0xffc400], [0x10c8a0, 0x6fe8c8, 0xff5fa8], [0xa8c8ca, 0xe2eeec, 0xc4dcd8]];
  const [back, belly, fin] = palettes[kind];
  return ensurePhase(fishGeometry({ len: 1, anatomy: true, height: [0.32, 0.52, 0.58, 0.42, 0.28][kind], width: [0.14, 0.12, 0.1, 0.21, 0.1][kind], back, belly, fin, eye: 0.028, segU: 44, segV: 24,
    dorsal: [[0.22, 0.73, 0.09, 0.03]], pectoral: [0.25, 0.16, 0.4, 0.55], caudal: { len: 0.18, h: 0.23, fork: 0.4 },
    pattern: (t, phi, c) => {
      if (kind === 1 && t > 0.19 && t < 0.77 && Math.abs(Math.sin(phi)) < 0.8) c.lerp(C(0x101f42), 0.82);
      if (kind === 2 && (Math.abs(t - 0.13) < 0.035 || Math.abs(t - 0.73) < 0.07)) c.multiplyScalar(0.16);
      if (kind === 3 && t < 0.18) c.lerp(C(0xcf9ba1), 0.6);
    },
  }));
}

// ---------------------------------------------------------------- soft and swaying reef life
// (local +Y is up from the attachment point, which is what the surge sway bends against)

// soft "carnation" coral: a fleshy trunk splitting into lobes crowned with dense polyp clusters, which fluoresce
function softCoralGeometry(seed, hex, glowHex) {
  const b = new GeoBuilder(), r = rng(seed), c = C(hex), stem = c.clone().lerp(C(0xffffff), 0.35).multiplyScalar(0.75);
  const tip = c.clone().lerp(C(0xffffff), 0.18), glow = C(glowHex).multiplyScalar(2.6);
  const trunk = [v3(0, 0, 0), v3(0.03, 0.3, 0.01), v3(-0.02, 0.58, 0.03)];
  b.tube(trunk, (t) => 0.11 * (1 - t * 0.35), stem, 8);
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU, el = 0.45 + r() * 0.85, len = 0.3 + r() * 0.45;
    const base = trunk[1].clone().lerp(trunk[2], r());
    const end = base.clone().add(v3(Math.cos(a) * Math.cos(el) * len, Math.sin(el) * len, Math.sin(a) * Math.cos(el) * len));
    b.tube([base, base.clone().lerp(end, 0.5).add(v3(0, 0.05, 0)), end], (t) => 0.055 * (1 - t * 0.5), stem, 6);
    for (let k = 0; k < 13; k++) {
      const o = v3(r() - 0.5, r() * 0.9 - 0.25, r() - 0.5).normalize().multiplyScalar(0.05 + r() * 0.09);
      b.sphere(end.clone().add(o), 0.024 + r() * 0.022, tip.clone().multiplyScalar(0.85 + r() * 0.3), glow, 5);
    }
  }
  return ensurePhase(b.build());
}
// sea whips: a sheaf of long, thin, springy rods
function seaWhipGeometry(seed, hex) {
  const b = new GeoBuilder(), r = rng(seed), c = C(hex), tip = c.clone().lerp(C(0xfff0c0), 0.4);
  const n = 7 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, lean = 0.1 + r() * 0.35, h = 1.2 + r() * 1.3, curl = (r() - 0.5) * 0.5, pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push(v3(Math.cos(a) * (0.04 + lean * t * h * 0.6) + Math.sin(t * 3) * curl * t, t * h, Math.sin(a) * (0.04 + lean * t * h * 0.6)));
    }
    b.tube(pts, (t) => 0.03 * (1 - t * 0.7), c, 5, (t) => (t > 0.85 ? C(hex).multiplyScalar(0.5) : ZERO), (t) => c.clone().lerp(tip, t * t));
  }
  b.sphere(v3(0, 0.02, 0), 0.08, c.clone().multiplyScalar(0.6), ZERO, 6, v3(1, 0.4, 1));
  return ensurePhase(b.build());
}
// anemone: a stout column and a crown of long tentacles with glowing tips, home to a family of clownfish
function anemoneGeometry(seed, hex, tipHex) {
  const b = new GeoBuilder(), r = rng(seed), c = C(hex), tip = C(tipHex), glow = C(tipHex).multiplyScalar(1.8);
  b.lathe((v) => [0.26 + Math.sin(v * Math.PI) * 0.05 - v * 0.04, v * 0.28], 6, c.clone().multiplyScalar(0.7), 18);
  b.lathe((v) => [v * 0.24, 0.28 + v * 0.02], 3, c.clone().multiplyScalar(0.55), 18);
  for (let i = 0; i < 80; i++) {
    const a = r() * TAU, rad = 0.06 + Math.sqrt(r()) * 0.18, len = 0.22 + r() * 0.2, out = 0.3 + r() * 0.5;
    const p0 = v3(Math.cos(a) * rad, 0.29, Math.sin(a) * rad);
    const pts = [p0];
    for (let k = 1; k <= 4; k++) { const t = k / 4; pts.push(p0.clone().add(v3(Math.cos(a) * out * len * t, len * t * (1 - t * 0.25), Math.sin(a) * out * len * t))); }
    b.tube(pts, (t) => 0.022 * (1 - t * 0.55), c, 4, (t) => (t > 0.8 ? glow : ZERO), (t) => c.clone().lerp(tip, Math.pow(t, 2.5)));
  }
  return ensurePhase(b.build());
}
// a tuft of turtle-grass blades, rooted in the sand of the channels
function seagrassGeometry(seed) {
  const b = new GeoBuilder(), r = rng(seed);
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * 0.35, h = 0.35 + r() * 0.6, w = 0.018 + r() * 0.01, bend = (r() - 0.5) * 0.25;
    const base = v3(Math.cos(a) * d, 0, Math.sin(a) * d), dir = v3(Math.cos(a + 1.3), 0, Math.sin(a + 1.3));
    const col = C(0x3f9a3a).lerp(C(0x9ccf4a), r() * 0.6).lerp(C(0x8a7a3a), r() * r() * 0.5);
    b.grid(1, 6, (u, v) => {
      const p = base.clone().addScaledVector(dir, (u - 0.5) * w * (1 - v * 0.6)).add(v3(bend * v * v * h, v * h, bend * 0.5 * v * v * h));
      return { p, c: col.clone().multiplyScalar(0.75 + v * 0.35), g: ZERO };
    });
  }
  return ensurePhase(b.build());
}
// giant clam: fluted shell lips gaping around an iridescent mantle
function clamGeometry(seed, mantleHex) {
  const b = new GeoBuilder(), r = rng(seed);
  for (const s of [-1, 1]) b.grid(18, 6, (u, v) => {
    const x = (u - 0.5) * 0.9, flute = Math.abs(Math.sin(u * Math.PI * 5)) * 0.05;
    return { p: v3(x, 0.05 + v * 0.22 * Math.sin(u * Math.PI), s * (0.16 + v * 0.06 + flute)), c: C(0xd8d0bc).multiplyScalar(0.8 + flute * 3), g: ZERO };
  });
  b.sphere(v3(0, 0.2, 0), 0.42, C(mantleHex), ZERO, 16, v3(1, 0.22, 0.42));
  for (let i = 0; i < 26; i++) b.sphere(v3((r() - 0.5) * 0.7, 0.285, (r() - 0.5) * 0.25), 0.018, C(0xc8f6ff), C(0x60e0ff).multiplyScalar(0.6), 5);
  return ensurePhase(b.build());
}
// sea pen: a feather of polyp leaflets on a stalk, which glows in waves when touched by the current
function seaPenGeometry(seed, glowHex) {
  const b = new GeoBuilder(), r = rng(seed), c = C(0xf2c6a0), glow = C(glowHex);
  b.tube([v3(0, 0, 0), v3(0, 0.35, 0), v3(0.02, 0.85, 0)], (t) => 0.025 * (1 - t * 0.4), c, 6);
  for (let i = 0; i < 16; i++) for (const s of [-1, 1]) {
    const y = 0.38 + i * 0.028, w = 0.07 + Math.sin((i / 15) * Math.PI) * 0.06;
    b.patch(v3(0, y, 0), v3(0, y + 0.02, 0), v3(0.01, y + 0.05, s * w), v3(0.0, y + 0.01, s * w * 1.05), c.clone().lerp(C(0xffe8d0), r() * 0.4), 2, glow.clone().multiplyScalar(1.4 + r()));
  }
  return ensurePhase(b.build());
}
// bioluminescent colony on a cave wall (tunicates and hydroids): a cluster of glowing beads
function glowColonyGeometry(seed, glowHex) {
  const b = new GeoBuilder(), r = rng(seed), glow = C(glowHex);
  for (let i = 0; i < 34; i++) {
    // denser toward the middle of the patch, as colonies spread outward from where the larva settled
    const a = r() * TAU, d = Math.pow(r(), 0.7) * 0.75, p = v3(Math.cos(a) * d, (r() - 0.5) * 0.3, Math.sin(a) * d);
    b.sphere(p, 0.025 + r() * 0.055 * (1 - d), C(0x9fb8c0), glow.clone().multiplyScalar(0.35 + r() * 0.6), 8);
  }
  return ensurePhase(b.build());
}
// speleothems from the dry ages before the sea flooded the caves: stalactites (down) and stalagmites (up)
function dripstoneGeometry(seed, down) {
  const b = new GeoBuilder(), r = rng(seed), k = r() * 10;
  b.lathe((v) => {
    const t = v, rad = (0.5 * Math.pow(1 - t, 1.3) + 0.03) * (1 + Math.sin(t * 17 + k) * 0.08);
    return [rad, (down ? -1 : 1) * t * 3];
  }, 28, C(0xb8b39a), 24, 'y', (v, u) => C(0xb8b39a).lerp(C(0x8e8a74), Math.abs(Math.sin(v * 21 + u * 9)) * 0.3));
  if (!down) b.lathe((v) => [0.6 * (1 - v) + 0.4, v * 0.25], 2, C(0xa8a28a), 12);   // the flowstone foot
  return ensurePhase(b.build());
}
// clownfish: orange with three white bands edged in black
function clownfishGeometry() {
  return ensurePhase(fishGeometry({ len: 1, anatomy: true, height: 0.42, width: 0.16, back: 0xe67824, belly: 0xf6a54b, fin: 0xd96720, eye: 0.032, segU: 44, segV: 24,
    dorsal: [[0.2, 0.7, 0.1, 0.03]], pectoral: [0.25, 0.18, 0.4, 0.55], caudal: { len: 0.17, h: 0.2, fork: 0.1 },
    pattern: (t, phi, c) => {
      for (const [b0, w] of [[0.17, 0.05], [0.47, 0.06], [0.86, 0.04]]) {
        const d = Math.abs(t - b0);
        if (d < w) c.set(0xf8f8f8); else if (d < w + 0.015) c.set(0x101010);
      }
    },
  }));
}

export function createReefs(ctx) {
  const { scene, camera } = ctx, root = new THREE.Group();
  root.name = 'Reef banks and flooded caverns'; scene.add(root);
  const banks = [], caves = [], schools = [], swimmers = [], batches = [];
  const coralMat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.76, clearcoat: 0.18, clearcoatRoughness: 0.6, side: THREE.DoubleSide }), { detail: 'coral', bump: 'coral', bumpAmp: 0.8, causMul: 0.9 });
  const rockMat = photographic(patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }), { detail: 'limestone', bump: 'limestone', bumpAmp: 0.35 }), 'rock_face_03', { scale: 0.37, strength: 0.88, normal: 0.8, tint: 0xd8d6c6 });
  const sandMat = photographic(patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, side: THREE.DoubleSide }), { detail: 'sand', bump: 'sand', bumpAmp: 0.4 }), 'coral_ground_02', { scale: 0.5, strength: 0.68, normal: 0.45 });
  const kinds = ['branch', 'plate', 'brain', 'fan', 'sponge', 'staghorn', 'lettuce'];
  const variants = 5;
  const geos = kinds.map((kind, k) => Array.from({ length: variants }, (_, i) => coralGeometry(kind, k * 17 + i * 3 + 1)));
  const rocks = Array.from({ length: 5 }, (_, i) => limestoneGeometry(700 + i));
  const terrain = new THREE.Mesh(bankGeometry(), sandMat); terrain.receiveShadow = true; root.add(terrain);

  // living, moving reef: soft tissue sways with the surge, polyps and tentacle tips fluoresce in the dark
  const soft = (o = {}, extra = {}) => patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.5, side: THREE.DoubleSide, ...o }),
    { detail: 'coral', causMul: 0.9, glow: true, bio: true, glowPulse: 0.6, ...extra });
  const fanMat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }), { detail: 'coral', causMul: 0.9, surge: { height: 2.3, flex: 0.45 } });
  const softMat = soft({}, { surge: { height: 1.2, flex: 1.0 } });
  const whipMat = soft({}, { surge: { height: 2.2, flex: 1.3 } });
  const anemoneMat = soft({ roughness: 0.45, sheen: 0.6, sheenColor: new THREE.Color(0xffffff) }, { surge: { height: 0.55, flex: 1.6 }, glowPulse: 0.9 });
  const grassMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }), { surge: { height: 0.9, flex: 1.8 } });
  const clamMat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.8, iridescence: 0.9, iridescenceIOR: 1.6, side: THREE.DoubleSide }), { glow: true, bio: true });
  const penMat = soft({}, { surge: { height: 0.85, flex: 0.7 }, glowPulse: 1.3 });
  const glowMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), { glow: true, bio: true, glowPulse: 0.8 });
  const softGeos = [[0xff2d7a, 0x5dff9a], [0xa63dff, 0x7af0ff], [0xff7b1c, 0xffe060], [0xff3b3b, 0x9affc8]].map(([c, g], i) => softCoralGeometry(31 + i, c, g));
  const whipGeos = [0xff4a1a, 0xffc414, 0xe6305e].map((c, i) => seaWhipGeometry(51 + i, c));
  const anemoneGeos = [[0x7a5a3a, 0x9cff3a], [0xb0306a, 0xff9ce0], [0x3a6a8a, 0x7af7ff]].map(([c, t], i) => anemoneGeometry(71 + i, c, t));
  const grassGeos = [seagrassGeometry(91), seagrassGeometry(92)];
  const clamGeos = [0x1a6bff, 0x18d6b0, 0x9a3cff].map((m, i) => clamGeometry(101 + i, m));
  const penGeos = [0x45ffd0, 0x6ab8ff].map((g, i) => seaPenGeometry(111 + i, g));
  const colonyGeos = { caves: glowColonyGeometry(121, 0x48ffc8), grotto: glowColonyGeometry(122, 0x3aa8ff) };
  const dripDown = [dripstoneGeometry(131, true), dripstoneGeometry(132, true)], dripUp = [dripstoneGeometry(133, false), dripstoneGeometry(134, false)];
  const anemoneHomes = [], plankton = [];
  // scatter a variant set over a bank (or a list of positions) and instance each variant separately
  const scatter = (group, geoList, mat, n, pick, sc) => {
    const per = geoList.map(() => []);
    for (let i = 0; i < n; i++) {
      const p = pick(i);
      if (p) per[i % geoList.length].push({ pos: p, scale: sc[0] + (sc[1] - sc[0]) * ((i * 0.618) % 1), yaw: (i * 2.39996) % TAU, tilt: (((i * 0.37) % 1) - 0.5) * 0.2 });
    }
    // small swaying life casts no floodlight shadows (they would stand still while it moves; and it saves a pass)
    per.forEach((items, k) => { const m = addInstances(group, geoList[k], mat, items); if (m && mat !== rockMat) m.castShadow = false; });
    return per.flat();
  };

  function addInstances(parent, geo, material, items, chunked = false) {
    if (!items.length) return;
    if (!chunked && items.length > 12) {
      const cells = new Map();
      for (const item of items) {
        const key = `${Math.floor(item.pos.x / 32)},${Math.floor(item.pos.z / 32)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
      for (const cell of cells.values()) addInstances(parent, geo, material, cell, true);
      return;
    }
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    mesh.castShadow = material === rockMat || material === coralMat;
    mesh.receiveShadow = true;
    items.forEach((it, i) => {
      tmp.position.copy(it.pos); tmp.rotation.set(it.tilt ?? 0, it.yaw ?? 0, it.roll ?? 0);
      if (it.scaleXYZ) tmp.scale.copy(it.scaleXYZ); else tmp.scale.setScalar(it.scale ?? 1);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.computeBoundingSphere(); parent.add(mesh);
    batches.push(mesh);
    return mesh;
  }

  for (const bank of REEF_BANKS) {
    const group = new THREE.Group(); root.add(group);
    const r = rng(bank.seed), items = Array.from({ length: kinds.length * variants }, () => []), stars = [];
    // patch reefs ("bommies"): colonies crowd onto scattered coral heads with open sand between, as on real banks
    const bommies = [];
    for (let tries = 0; bank.colonies && bommies.length < (bank.id === 'reef' ? 34 : 24) && tries < 500; tries++) {
      const a = r() * TAU, rad = Math.sqrt(r()) * 0.58;
      const x = bank.x + Math.cos(a) * rad * bank.rx, z = bank.z + Math.sin(a) * rad * bank.rz;
      if (Math.abs(x - bank.x - Math.sin((z - bank.z) * 0.034) * 28) < 12 || isRock(v3(x, reefHeightAt(x, z) + 1, z), 4)) continue;
      bommies.push({ x, z, r: 6 + r() * 9 });
    }
    const nearBommie = () => {
      const b = bommies[Math.floor(r() * bommies.length)], a = r() * TAU, d = Math.sqrt(-2 * Math.log(1 - r() * 0.97)) * b.r * 0.5;
      return [b.x + Math.cos(a) * d, b.z + Math.sin(a) * d];
    };
    for (let i = 0; i < bank.colonies; i++) {
      let x, z;
      if (bommies.length && r() < 0.85) [x, z] = nearBommie();
      else { const a = r() * TAU, rad = Math.sqrt(r()) * 0.62; x = bank.x + Math.cos(a) * rad * bank.rx; z = bank.z + Math.sin(a) * rad * bank.rz; }
      // Meandering white sand channels separate dense colonies into natural patch reefs.
      const channel = Math.abs(x - bank.x - Math.sin((z - bank.z) * 0.034) * 28);
      if (channel < 7 || isRock(v3(x, reefHeightAt(x, z) + 1, z))) continue;
      const k = bank.id === 'terrace' ? [1, 6, 3, 4, 2][i % 5] : i % kinds.length;
      const scale = [0.9, 0.8, 0.8, 0.6, 0.65, 0.8, 0.9][k] + r() * [1.5, 1.6, 1.8, 0.85, 0.95, 1.1, 1.5][k];
      items[k * variants + Math.floor(r() * variants)].push({ pos: v3(x, reefHeightAt(x, z) - 0.1, z), scaleXYZ: v3(scale * (0.85 + r() * 0.3), scale * (0.85 + r() * 0.3), scale), yaw: r() * TAU, tilt: (r() - 0.5) * 0.25, color: C(0xffffff).offsetHSL((r() - 0.5) * 0.04, -r() * 0.12, -r() * 0.12) });
    }
    items.forEach((list, i) => addInstances(group, geos[Math.floor(i / variants)][i % variants], Math.floor(i / variants) === 3 ? fanMat : coralMat, list));
    if (bank.colonies) scatter(group, rocks, rockMat, 90, () => {
      const [x, z] = bommies.length ? nearBommie() : [bank.x, bank.z];
      const p = v3(x, reefHeightAt(x, z) + 0.35, z);
      return isRock(p, 3) ? null : p;
    }, [0.5, 2.2]);
    if (bank.colonies) {
      // a spot on the reef flat (or, for seagrass, in the sand channels), clear of the cave rock
      const onBank = (inChannel) => () => {
        for (let tries = 0; tries < 10; tries++) {
          let x, z;
          if (inChannel) { z = bank.z + (r() - 0.5) * bank.rz * 1.15; x = bank.x + Math.sin((z - bank.z) * 0.034) * 28 + (r() - 0.5) * 12; }
          else if (bommies.length) [x, z] = nearBommie();
          else { const a = r() * TAU, rad = Math.sqrt(r()) * 0.62; x = bank.x + Math.cos(a) * rad * bank.rx; z = bank.z + Math.sin(a) * rad * bank.rz; }
          if (Math.hypot((x - bank.x) / bank.rx, (z - bank.z) / bank.rz) > 0.62) continue;
          const channel = Math.abs(x - bank.x - Math.sin((z - bank.z) * 0.034) * 28);
          if (!inChannel && channel < 7) continue;
          const y = reefHeightAt(x, z);
          if (isRock(v3(x, y + 1, z))) continue;
          return v3(x, y - 0.05, z);
        }
        return null;
      };
      const shallow = bank.id === 'reef';
      scatter(group, softGeos, softMat, shallow ? 170 : 70, onBank(false), [0.8, 1.7]);
      scatter(group, whipGeos, whipMat, shallow ? 100 : 130, onBank(false), [0.7, 1.3]);
      const anem = scatter(group, anemoneGeos, anemoneMat, shallow ? 40 : 12, onBank(false), [1.0, 2.2]);
      if (shallow) {
        anemoneHomes.push(...anem.slice(0, 22));
        scatter(group, grassGeos, grassMat, 320, onBank(true), [0.8, 1.5]);
        scatter(group, clamGeos, clamMat, 45, onBank(false), [0.7, 1.4]);
      } else {
        scatter(group, penGeos, penMat, 160, onBank(false), [0.9, 1.6]);   // the dim mesophotic terrace glows
      }
    }
    for (let i = 0; i < 25 && bank.colonies; i++) {
      const x = bank.x + (r() - 0.5) * bank.rx, z = bank.z + (r() - 0.5) * bank.rz;
      stars.push({ pos: v3(x, reefHeightAt(x, z) + 0.12, z), scale: 0.5 + r(), yaw: r() * TAU });
    }
    addInstances(group, starGeometry(), coralMat, stars);
    banks.push({ bank, group, bommies });
    if (bank.colonies) for (let k = 0; k < 4; k++) addSchool(bank, k, k === 0 ? 105 : 48, r);
    if (bank.id === 'reef') {
      addSwimmer(bank, turtleGeometry(), 'turtle', 4, 1.25, r);
      addSwimmer(bank, rayGeometry({ span: 1, chord: 0.42, tail: 0.6 }), 'ray', 2, 3.4, r);
    }
  }

  // Cave shells have an actual interior, exterior and thick entrance rim; no hidden end caps.
  for (const cave of CAVE_SITES) {
    const group = new THREE.Group(); group.name = cave.name; root.add(group);
    const shell = new THREE.Mesh(caveGeometry(cave), rockMat); shell.castShadow = true; shell.receiveShadow = true; group.add(shell);
    const floor = new GeoBuilder();
    floor.grid(32, 100, (u, t) => {
      const s = caveSection(cave, t), dx = (u - 0.5) * 1.7;
      return { p: v3(s.x + dx * s.rx, s.y - s.ry * 0.84 + Math.sin(t * 63 + u * 15) * 0.1, s.z), c: C(0xc3c2aa) };
    });
    const floorMesh = new THREE.Mesh(ensurePhase(upward(floor.build())), sandMat); floorMesh.receiveShadow = true; group.add(floorMesh);
    const buttressGeo = limestoneGeometry(cave.seed);
    const bp = buttressGeo.attributes.position, bc = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i), n = 1 + Math.sin(x * 9 + y * 6) * Math.cos(z * 7) * 0.13;
      bp.setXYZ(i, x * n, y * n, z * n); const c = C(0x8e967f).multiplyScalar(0.9 + y * 0.1); bc.set([c.r, c.g, c.b], i * 3);
    }
    buttressGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3)); buttressGeo.computeVertexNormals(); ensurePhase(buttressGeo);
    const buttresses = [];
    for (let i = 0; i <= 15; i++) for (const side of [-1, 1]) {
      const s = caveSection(cave, i / 15);
      buttresses.push({ pos: v3(s.x + side * (s.rx + 6), s.y - s.ry * 0.63 - 4, s.z), scaleXYZ: v3(8, 24, 12), yaw: i * 1.9 });
    }
    addInstances(group, buttressGeo, rockMat, buttresses);
    const r = rng(cave.seed), decor = Array.from({ length: 3 }, () => []);
    for (let i = 0; i < 110; i++) {
      const t = 0.025 + r() * 0.95, s = caveSection(cave, t), side = r() > 0.5 ? 1 : -1;
      // Sponges and sea fans occupy side ledges; photosynthetic corals stay near daylight openings.
      const daylit = t < 0.14 || t > 0.86 || (cave.skylight && Math.abs(t - 0.5) < 0.08);
      const k = daylit ? i % 3 : 2;
      decor[k].push({ pos: v3(s.x + side * s.rx * (0.34 + r() * 0.14), s.y - s.ry * 0.84 + 0.05, s.z), scale: 0.65 + r() * 0.9, yaw: r() * TAU });
    }
    [1, 3, 4].forEach((k, i) => addInstances(group, geos[k][0], k === 3 ? fanMat : coralMat, decor[i]));
    // a point on the cave wall at section t and angle a (around the passage), kept off the floor and the skylight
    const wall = (inset) => () => {
      for (let tries = 0; tries < 10; tries++) {
        const t = 0.04 + r() * 0.92, a = r() * TAU, s = caveSection(cave, t);
        if (Math.sin(a) < -0.55 || caveSkylight(cave, t, Math.cos(a), Math.sin(a))) continue;
        return caveSurface(cave, t, a, (1 - inset) * Math.min(s.rx, s.ry));
      }
      return null;
    };
    // glowing colonies on the walls: green-cyan in the Cathedral Caverns, azure in the Azure Grotto
    scatter(group, [colonyGeos[cave.id === 'grotto' ? 'grotto' : 'caves']], glowMat, cave.id === 'grotto' ? 95 : 75, wall(0.99), [0.7, 1.8]);
    scatter(group, rocks, rockMat, 95, () => {
      const t = 0.03 + r() * 0.94, s = caveSection(cave, t), side = r() < 0.5 ? -1 : 1;
      return v3(s.x + side * s.rx * (0.5 + r() * 0.14), s.y - s.ry * 0.84 + 0.35, s.z);
    }, [0.45, 2.4]);
    // stalactites from the ceiling, stalagmites rising from the floor near the walls
    scatter(group, dripDown, rockMat, 60, () => {
      const t = 0.05 + r() * 0.9, a = Math.PI / 2 + (r() - 0.5) * 1.9, s = caveSection(cave, t);
      return caveSkylight(cave, t, Math.cos(a), Math.sin(a)) ? null : caveSurface(cave, t, a, -0.12);
    }, [0.5, 1.5]);
    scatter(group, dripUp, rockMat, 34, () => {
      const t = 0.08 + r() * 0.84, s = caveSection(cave, t), side = r() < 0.5 ? -1 : 1;
      return v3(s.x + side * s.rx * (0.25 + r() * 0.25), s.y - s.ry * 0.84, s.z);
    }, [0.35, 1.0]);
    // sea pens on the dark floor deep inside, glowing in slow waves
    scatter(group, penGeos, penMat, 50, () => {
      const t = 0.18 + r() * 0.64, s = caveSection(cave, t);
      return v3(s.x + (r() - 0.5) * s.rx * 0.9, s.y - s.ry * 0.84 + 0.05, s.z);
    }, [0.9, 1.5]);
    plankton.push(planktonCloud(cave, group, cave.id === 'grotto' ? 0x3f9dff : 0x46ffd2, cave.id === 'grotto' ? 700 : 550, r));
    addSchool({ x: cave.x, z: cave.z - cave.length * 0.5, depth: cave.depth + 6, id: cave.id, cave }, 4, 180, r);
    caves.push({ cave, group });
  }

  // Discreet survey markers run through the caves and distinguish the two open exits.
  const markerMat = new THREE.MeshStandardMaterial({ color: 0x48746f, roughness: 0.7 });
  const markerGlow = new THREE.MeshBasicMaterial({ color: 0x7ee8dc });
  for (const cave of CAVE_SITES) for (let i = 0; i <= 8; i++) {
    const s = caveSection(cave, i / 8), group = caves.find((c) => c.cave === cave).group;
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, 0.7, 6), markerMat);
    marker.position.set(s.x, s.y - s.ry * 0.84 + 0.35, s.z); group.add(marker);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.10, 6, 5), markerGlow); cap.position.copy(marker.position); cap.position.y += 0.38; group.add(cap);
  }

  // clownfish darting in and out over their anemones
  const nemoFish = [];
  anemoneHomes.forEach((h, i) => { for (let k = 0; k < 2 + (i % 2); k++) nemoFish.push({ home: h.pos.clone().add(v3(0, 0.4 * h.scale, 0)), phase: i * 3.1 + k * 2.2, rad: 0.22 + 0.18 * k, size: k ? 0.09 : 0.12 }); });
  const nemoGeo = clownfishGeometry();
  nemoGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, nemoFish.length)).map((_, i) => i * 1.7), 1));
  const nemo = new THREE.InstancedMesh(nemoGeo, patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, clearcoat: 0.6, side: THREE.DoubleSide }),
    { swim: { amp: 0.07, freq: 11, waveLen: 0.9, start: 0.5 }, bump: 'scales', bumpAmp: 0.3 }), Math.max(1, nemoFish.length));
  nemo.instanceMatrix.setUsage(THREE.DynamicDrawUsage); nemo.frustumCulled = false; nemo.count = nemoFish.length;
  (banks.find((b) => b.bank.id === 'reef')?.group ?? root).add(nemo);

  // bioluminescent plankton adrift in a cave: a faint twinkling haze that flares up in the sub's wake
  function planktonCloud(cave, group, hex, n, r) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = 0.03 + r() * 0.94, s = caveSection(cave, t), a = r() * TAU, f = Math.sqrt(r()) * 0.8;
      pos.set([s.x + Math.cos(a) * s.rx * f, Math.max(s.y + Math.sin(a) * s.ry * f, s.y - s.ry * 0.78), s.z], i * 3);
      seed[i] = r() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const U = { uTime: G.uTime, uGlow: G.uGlow, uBio: G.uBio, uDepthTex: G.uDepthTex, uRes: G.uRes, uFogT: G.uFogT, uExpo: G.uExpo,
      uCam: { value: camera.position }, uScale: { value: 800 }, uColor: { value: new THREE.Color(hex) } };
    const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime, uScale, uBio; uniform vec3 uCam; attribute float aSeed; varying float vA; varying vec3 vW;
        void main(){
          vec3 p = position + vec3(sin(uTime * 0.13 + aSeed * 7.0), sin(uTime * 0.1 + aSeed * 3.0) * 0.6, cos(uTime * 0.11 + aSeed * 5.0)) * 0.8;
          vW = p;
          float tw = pow(0.5 + 0.5 * sin(uTime * (0.6 + fract(aSeed * 13.1) * 1.8) + aSeed * 40.0), 8.0);
          float stir = smoothstep(9.0, 1.5, length(p - uCam));
          vA = (0.025 + tw * 0.3 + stir * 0.8) * uBio;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uScale * 0.07 / -mv.z, 1.0, 12.0);
        }`,
      fragmentShader: `${GLSL_TRANSP} uniform vec3 uColor; uniform float uGlow; varying float vA; varying vec3 vW;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float a = exp(-dot(c, c) * 18.0);
          gl_FragColor = vec4(transpFog(uColor * vA * a * uGlow * 2.6, vW), 1.0);
        }`,
    }));
    pts.frustumCulled = false; pts.layers.set(1); pts.renderOrder = 3;
    group.add(pts);
    return U;
  }

  function addSchool(home, kind, count, r) {
    const geo = reefFishGeometry(kind), phases = new Float32Array(count).map(() => r() * 100);
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    const mat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: kind === 4 ? 0.25 : 0.42, metalness: kind === 4 ? 0.45 : 0.05, clearcoat: 0.55, side: THREE.DoubleSide }), { swim: { amp: 0.065, freq: 8 + kind, waveLen: 0.9, start: 0.5 }, bump: 'scales', bumpAmp: 0.4 });
    const mesh = new THREE.InstancedMesh(geo, mat, count); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; root.add(mesh);
    const fish = Array.from({ length: count }, () => ({ a: r() * TAU, rad: Math.sqrt(r()), y: r(), size: (kind === 3 ? 0.55 : 0.22) + r() * (kind === 3 ? 0.4 : 0.22), phase: r() * TAU, dir: kind % 2 ? -1 : 1 }));
    schools.push({ home, kind, mesh, fish });
  }

  function addSwimmer(bank, geo, kind, count, scale, r) {
    ensurePhase(geo);
    const mat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.4, side: THREE.DoubleSide }), { flap: { amp: kind === 'ray' ? 0.16 : 0.3, freq: 1.3, span: kind === 'ray' ? 0.5 : 0.85 }, bump: 'skin' });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat); mesh.scale.setScalar(scale); root.add(mesh);
      swimmers.push({ mesh, bank, phase: r() * TAU, radius: 19 + r() * 30, scale });
    }
  }

  function isRock(pos, margin = 0) {
    for (const cave of CAVE_SITES) {
      const t = (cave.z - pos.z) / cave.length;
      if (t < 0 || t > 1) continue;
      const s = caveSection(cave, t), dx = pos.x - s.x, dy = pos.y - s.y;
      const nx = dx / s.rx, ny = dy / s.ry;
      if (caveSkylight(cave, t, nx, ny)) continue;
      const radii = caveRadii(cave, t, Math.atan2(ny, nx));
      const inner = Math.hypot(dx / (radii.rx - margin), dy / (radii.ry - margin));
      const outer = Math.hypot(dx / (radii.rx + 11 + margin), dy / (radii.ry + 11 + margin));
      if (inner >= 1 && outer <= 1) return true;
    }
    return false;
  }

  function floorAt(x, y, z) {
    let h = reefHeightAt(x, z);
    for (const cave of CAVE_SITES) {
      const t = (cave.z - z) / cave.length;
      if (t < 0 || t > 1) continue;
      const s = caveSection(cave, t);
      if (Math.abs(x - s.x) < s.rx * 0.85 && y > s.y - s.ry - 2 && y < s.y + s.ry) h = Math.max(h, s.y - s.ry * 0.84);
    }
    return h;
  }

  // Small swept steps prevent even a boosted sub from tunnelling through a wall or entrance lip.
  const sweep = new THREE.Vector3(), safe = new THREE.Vector3();
  function collide(pos, vel, previous) {
    const distance = pos.distanceTo(previous), steps = Math.max(1, Math.ceil(distance / 0.8));
    safe.copy(previous);
    for (let i = 1; i <= steps; i++) {
      sweep.copy(previous).lerp(pos, i / steps);
      const h = floorAt(sweep.x, sweep.y, sweep.z) + 1.6;
      if (sweep.y < h && previous.y >= h - 3) { sweep.y = h; vel.y = Math.max(0, vel.y); }
      if (isRock(sweep, 1.7)) {
        pos.copy(safe); vel.set(0, 0, 0); return;
      }
      safe.copy(sweep);
    }
    pos.copy(safe);
  }

  function shelterAt(pos) {
    const cave = caveAt(pos);
    if (!cave) return 0;
    const t = (cave.z - pos.z) / cave.length;
    let shade = THREE.MathUtils.smoothstep(Math.min(t, 1 - t), 0, 0.15);
    if (cave.skylight) shade *= 1 - 0.88 * Math.exp(-Math.pow((t - 0.5) / 0.065, 2));
    return shade;
  }

  function update(info) {
    root.visible = info.under && info.depth < 1850;
    if (!root.visible) return;
    for (const mesh of batches) mesh.visible = camera.position.distanceTo(mesh.boundingSphere.center) < 85 + mesh.boundingSphere.radius;
    for (const { bank, group } of banks) group.visible = Math.hypot(camera.position.x - bank.x, camera.position.z - bank.z) < bank.rx + 120 && Math.abs(camera.position.y + bank.depth) < 200;
    for (const { cave, group } of caves) {
      const t = THREE.MathUtils.clamp((cave.z - camera.position.z) / cave.length, 0, 1), s = caveSection(cave, t);
      group.visible = camera.position.distanceToSquared(v3(s.x, s.y, s.z)) < 180 * 180;
    }
    for (const { home, kind, mesh, fish } of schools) {
      mesh.visible = Math.hypot(camera.position.x - home.x, camera.position.z - home.z) < 210 && Math.abs(info.depth - home.depth) < 100;
      if (!mesh.visible) continue;
      fish.forEach((f, i) => {
        const a = f.a + info.time * (kind === 4 ? 0.055 : 0.075) * f.dir;
        let x, y, z, heading;
        if (home.cave) {
          const t = 0.08 + f.rad * 0.84, s = caveSection(home.cave, t);
          x = s.x + Math.cos(a) * s.rx * (0.18 + f.y * 0.25);
          y = s.y + Math.sin(a * 1.3 + f.phase) * s.ry * 0.28;
          z = s.z + Math.sin(a) * 3;
          heading = Math.atan2(-Math.cos(a), -Math.sin(a) * f.dir);
        } else {
          const orbit = 12 + f.rad * 53, center = kind * 1.7;
          x = home.x + Math.cos(a + center) * orbit;
          z = home.z + Math.sin(a + center) * orbit * 0.8;
          y = reefHeightAt(x, z) + 3 + f.y * 8 + Math.sin(info.time * 0.6 + f.phase) * 0.4;
          heading = -(a + center) - (f.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
        tmp.position.set(x, y, z); tmp.rotation.set(0, heading, Math.sin(info.time + f.phase) * 0.04); tmp.scale.setScalar(isRock(tmp.position) ? 0 : f.size); tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const U of plankton) U.uScale.value = ctx.renderer.domElement.height;
    if (nemo.parent?.visible && nemoFish.length) {
      nemoFish.forEach((f, i) => {
        const t = info.time, a = t * (1.0 + (i % 3) * 0.25) + f.phase;
        const x = f.home.x + Math.cos(a) * f.rad + Math.sin(t * 2.7 + f.phase) * 0.05;
        const z = f.home.z + Math.sin(a) * f.rad;
        tmp.position.set(x, f.home.y + Math.sin(t * 0.8 + f.phase) * 0.12, z);
        tmp.rotation.set(0, Math.atan2(-Math.cos(a), -Math.sin(a)), 0);
        tmp.scale.setScalar(f.size);
        tmp.updateMatrix();
        nemo.setMatrixAt(i, tmp.matrix);
      });
      nemo.instanceMatrix.needsUpdate = true;
    }
    for (const f of swimmers) {
      f.mesh.visible = Math.hypot(camera.position.x - f.bank.x, camera.position.z - f.bank.z) < 240;
      const a = info.time * 0.025 + f.phase, x = f.bank.x + Math.cos(a) * f.radius, z = f.bank.z + Math.sin(a) * f.radius;
      f.mesh.position.set(x, reefHeightAt(x, z) + 8 + Math.sin(a * 2) * 2, z); f.mesh.rotation.y = -a - Math.PI / 2;
    }
  }

  const pois = [
    ...REEF_BANKS.filter((b) => b.colonies).map((b) => ({ name: b.name, pos: v3(b.x, -b.depth + 7, b.z) })),
    ...CAVE_SITES.map((c) => ({ name: c.name + ' · entrance', pos: v3(c.x, -c.depth, c.z) })),
  ];
  return { update, collide, floorAt, isRock, shelterAt, pois, root, banks,
    get inside() { return caveAt(camera.position); },
    get nearReef() { return REEF_BANKS.some((b) => b.colonies && Math.hypot((camera.position.x - b.x) / b.rx, (camera.position.z - b.z) / b.rz) < 0.8 && Math.abs(camera.position.y + b.depth) < 32); },
    get nearCave() { return CAVE_SITES.some((c) => { const s = caveSection(c, THREE.MathUtils.clamp((c.z - camera.position.z) / c.length, 0, 1)); return camera.position.distanceToSquared(v3(s.x, s.y, s.z)) < 85 * 85; }); },
  };
}
