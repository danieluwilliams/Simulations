// Abyssal plain at ~3,800 m, a hadal trench to 10,935 m, hydrothermal vents and bottom fauna.
import * as THREE from 'three';
import { GeoBuilder, fishGeometry, C, v3, ZERO } from './builders.js';
import { patch, G, GLSL_TRANSP } from './materials.js';
import { SEAFLOOR_DEPTH, TRENCH_DEPTH, WRECK_SITES, rng } from './common.js';
import { reefHeightAt } from './habitats.js';

// ---------------------------------------------------------------- height field
const hash = (x, z) => { let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; } return s; }

// the trench runs east-west; its near rim lies about a kilometre north (+z) of the wreck field
export const TRENCH_Z = 6200, TRENCH_W = 5200, TRENCH_FLOOR = 260;
export const VENT_SITE = new THREE.Vector2(-210, -160);
// the trench axis meanders; positive values pull the rim towards the wrecks
const trenchWobble = (x) => (fbm(x / 600, 3.1, 3) - 0.5) * 900;
export const trenchRimZ = (x) => TRENCH_Z - TRENCH_W + trenchWobble(x);

export function baseHeightAt(x, z, detail = true) {
  let h = -SEAFLOOR_DEPTH;
  // abyssal hills, flattened into a sediment basin where the wrecks came to rest
  const basin = THREE.MathUtils.smoothstep(Math.hypot(x, z), 260, 1100);
  h += ((fbm(x / 900, z / 900, 4) - 0.5) * 110 - (fbm(0, 0, 4) - 0.5) * 110) * basin;
  h += (fbm(x / 140, z / 140, 3) - 0.5) * 18 * (0.25 + 0.75 * basin);
  if (detail) h += (fbm(x / 9, z / 9, 3) - 0.5) * 1.6;  // ripples and burrow mounds
  // hadal trench: the wall drops in a staircase of fault scarps and sediment-draped benches to a flat floor.
  // (MathUtils.smoothstep needs min < max — with the edges swapped it returns 0 and the trench vanishes.)
  const dz = Math.abs(z - TRENCH_Z) + trenchWobble(x);
  if (dz < TRENCH_W) {
    const k = 1 - THREE.MathUtils.smoothstep(dz, TRENCH_FLOOR, TRENCH_W);  // 0 at the rim → 1 on the floor
    const N = 9, s = k * N, i = Math.floor(s);
    const stair = (i + THREE.MathUtils.smoothstep(s - i, 0.3, 0.7)) / N;
    h = THREE.MathUtils.lerp(h, -TRENCH_DEPTH, THREE.MathUtils.lerp(k, stair, 0.65));
    const rough = Math.sin(k * Math.PI);
    h += ((fbm(x / 110, z / 110, 4) - 0.5) * 70 + (fbm(x / 23, z / 23, 2) - 0.5) * 8) * rough;
    if (detail) h += (fbm(x / 6.5, z / 6.5, 2) - 0.5) * 6 * rough;   // blocky crags and ledges on the scarps
  }
  // vent mound
  const vd = Math.hypot(x - VENT_SITE.x, z - VENT_SITE.y);
  h += 14 * Math.exp(-(vd * vd) / (2 * 60 * 60));
  return Math.max(h, reefHeightAt(x, z));
}

// height of each wreck's origin: where it settled on the untouched seafloor, minus how far it sank
const siteBase = WRECK_SITES.map(() => null);
export function siteOrigin(i) {
  const s = WRECK_SITES[i];
  if (siteBase[i] === null) siteBase[i] = baseHeightAt(s.x, s.z) - s.sink;
  return siteBase[i];
}

// the seafloor as rendered and collided with: base terrain, kept below the lowest deck inside every hull
export function heightAt(x, z, detail = true) {
  let h = baseHeightAt(x, z, detail);
  for (let i = 0; i < WRECK_SITES.length; i++) {
    const s = WRECK_SITES[i];
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz > 40000) continue;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const [a, b, hw, py] = s.pad;
    const e = Math.min(lx - a, b - lx, hw - Math.abs(lz));
    if (e <= 0) continue;
    const top = siteOrigin(i) + py + lx * s.pitch - lz * s.roll;
    if (h > top) h = THREE.MathUtils.lerp(h, top, THREE.MathUtils.smoothstep(e, 0, 1.5));
  }
  return h;
}

// ---------------------------------------------------------------- terrain tiles
const TILE = 128, RES = 64;
function sedimentColor(x, z, h, out) {
  const n = fbm(x / 30, z / 30, 3);
  out.setRGB(0.36, 0.32, 0.27).multiplyScalar(0.85 + n * 0.3);
  if (h < -6000) out.lerp(new THREE.Color(0.30, 0.29, 0.27), 0.6);
  return out;
}
function makeTile(tx, tz, mat) {
  const g = new THREE.PlaneGeometry(TILE, TILE, RES, RES);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + tx * TILE, z = p.getZ(i) + tz * TILE;
    const h = heightAt(x, z);
    p.setXYZ(i, x, h, z);
    sedimentColor(x, z, h, c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;   // wreck shadows from the hull floodlights
  return m;
}

// ---------------------------------------------------------------- bottom fauna & features
function seaPigGeo() {
  const b = new GeoBuilder();
  const pink = C(0xd7a3a6);
  b.sphere(v3(0, 0.06, 0), 0.5, pink, ZERO, 16, v3(0.5, 0.2, 0.22));
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.tube([v3(0.18 - i * 0.09, 0.02, s * 0.08), v3(0.2 - i * 0.09, -0.06, s * 0.13)], (t) => 0.022 * (1 - t * 0.5), pink, 5);
  for (let i = 0; i < 4; i++) b.tube([v3(0.15 + (i % 2) * 0.05, 0.12, (i < 2 ? -1 : 1) * 0.04), v3(0.24 + (i % 2) * 0.06, 0.3, (i < 2 ? -1 : 1) * 0.06)], (t) => 0.02 * (1 - t * 0.6), pink, 5);
  return b.build();
}
function brittleStarGeo() {
  const b = new GeoBuilder();
  const c = C(0xc9ab86);
  b.sphere(v3(0, 0.01, 0), 0.06, c, ZERO, 10, v3(1, 0.35, 1));
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2, pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; const aa = a + Math.sin(t * 3 + k) * 0.5 * t; pts.push(v3(Math.cos(aa) * (0.05 + t * 0.4), 0.01 + Math.sin(t * Math.PI) * 0.03, Math.sin(aa) * (0.05 + t * 0.4))); }
    b.tube(pts, (t) => 0.014 * (1 - t * 0.8), c, 4);
  }
  return b.build();
}
function lumpGeo(seed, color, rough = 0.35) {
  const g = new THREE.IcosahedronGeometry(0.5, 3);
  const p = g.attributes.position;
  const r = rng(seed);
  const o = [r() * 10, r() * 10, r() * 10];
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = fbm(v.x * 3 + o[0], v.z * 3 + v.y * 2 + o[1], 3);
    v.multiplyScalar(1 + (n - 0.5) * rough * 2);
    v.y *= 0.6;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3).fill(1);
  const cc = C(color);
  for (let i = 0; i < p.count; i++) { col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
  return g;
}
function glassSpongeGeo() {
  const b = new GeoBuilder();
  b.lathe((v) => [0.12 + Math.sin(v * Math.PI * 0.9) * 0.1 + v * 0.05, v * 1.0], 16, C(0xe8e2d0), 14);
  b.tube([v3(0, 0, 0), v3(0, -0.15, 0)], () => 0.03, C(0xd8d0bc), 5);
  return b.build();
}
function crinoidGeo() {
  const b = new GeoBuilder();
  const c = C(0xe2c48e);
  const stalk = []; for (let i = 0; i <= 10; i++) stalk.push(v3(Math.sin(i * 0.3) * 0.03, i * 0.07, 0));
  b.tube(stalk, () => 0.012, C(0xcfbfa0), 4);
  const top = stalk[10];
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2, pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(top.clone().add(v3(Math.cos(a) * t * 0.3, t * 0.25 - t * t * 0.3, Math.sin(a) * t * 0.3))); }
    b.tube(pts, (t) => 0.012 * (1 - t * 0.6) * (1 + Math.max(0, Math.sin(t * 60)) * 0.8), c, 4);
  }
  return b.build();
}
function seaPenGeo() {
  const b = new GeoBuilder();
  b.tube([v3(0, 0, 0), v3(0, 0.7, 0)], (t) => 0.02 * (1 - t * 0.5), C(0xe9c7a0), 5);
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) {
    const y = 0.25 + i * 0.035;
    b.patch(v3(0, y, 0), v3(0, y + 0.03, 0), v3(0.0, y + 0.06, s * 0.1), v3(0, y + 0.01, s * 0.11), C(0xf2d2a8), 2, ZERO);
  }
  return b.build();
}
function tripodGeo() {
  const b = new GeoBuilder();
  const body = fishGeometry({ len: 1, height: 0.14, width: 0.1, headExp: 0.35, back: 0x3e4048, belly: 0x5a5c62, fin: 0x3a3c44, eye: 0.015, dorsal: [[0.3, 0.38, 0.12, 0.05]], pectoral: [0.18, 0.2, -0.5, 0.4], caudal: { len: 0.1, h: 0.1, fork: 0 } });
  const g2 = new GeoBuilder();
  for (const s of [-1, 1]) g2.tube([v3(0.15, -0.06, s * 0.04), v3(0.05, -0.75, s * 0.12)], () => 0.006, C(0x6a6c72), 3);
  g2.tube([v3(-0.5, 0, 0), v3(-0.85, -0.72, 0)], () => 0.006, C(0x6a6c72), 3);
  return [body, g2.build()];
}
function isopodGeo() {
  const b = new GeoBuilder();
  const c = C(0xc9b896);
  for (let i = 0; i < 8; i++) b.sphere(v3(0.35 - i * 0.1, 0.04, 0), 0.5, c.clone().multiplyScalar(i % 2 ? 0.92 : 1), ZERO, 12, v3(0.12, 0.12, 0.3 - Math.abs(i - 3) * 0.015));
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) b.tube([v3(0.3 - i * 0.1, 0.0, s * 0.12), v3(0.3 - i * 0.1, -0.06, s * 0.2)], () => 0.012, c, 3);
  for (const s of [-1, 1]) b.sphere(v3(0.43, 0.06, s * 0.08), 0.03, C(0x1a1a1a), ZERO, 6);
  return b.build();
}
function tubeWormClusterGeo(seed) {
  const b = new GeoBuilder();
  const r = rng(seed);
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.9, h = 0.8 + r() * 1.2;
    const base = v3(Math.cos(a) * d, 0, Math.sin(a) * d), lean = v3((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4);
    const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(base.clone().add(lean.clone().multiplyScalar(t * t)).add(v3(0, t * h, 0))); }
    b.tube(pts, () => 0.035, C(0xe9e4d6), 6);
    const n0 = b.pos.length / 3;
    b.lathe((v) => [0.035 + Math.sin(v * Math.PI) * 0.05, v * 0.18], 4, C(0xc4161c), 8, 'y', null, null);
    const n = b.pos.length / 3;
    for (let k = n0; k < n; k++) { b.pos[k * 3] += pts[8].x; b.pos[k * 3 + 1] += pts[8].y; b.pos[k * 3 + 2] += pts[8].z; }
  }
  return b.build();
}
function chimneyGeo(seed, height) {
  const b = new GeoBuilder();
  const r = rng(seed);
  const off = r() * 100;
  b.lathe((v) => {
    const rad = (1.6 - v * 1.1) * (1 + (fbm(v * 9 + off, off, 3) - 0.5) * 0.8);
    return [Math.max(rad, 0.25), v * height];
  }, 24, C(0x2b2520), 16, 'y', (v, u) => C(0x2b2520).lerp(C(0x7a4a22), Math.max(0, fbm(u * 8 + off, v * 10, 3) - 0.45) * 2).lerp(C(0xb8b0a0), v > 0.9 ? 0.0 : Math.max(0, Math.sin(u * 30 + v * 9)) * 0.08));
  return b.build();
}

export function createSeafloor(ctx) {
  const { scene, camera } = ctx;
  const group = new THREE.Group();
  scene.add(group);
  // sediment on the flats, banded rock in the trench scarps
  const terrainOpts = { detail: 'terrain', causMul: 0, bump: 'terrain', bumpAmp: 2.5 };
  // the square opening past the lander is cut out of the detailed tiles (backrooms.js sets where)
  const holeClip = { value: new THREE.Vector4(0, 0, -1, 0) };
  const terrainMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }), { ...terrainOpts, clip: holeClip });
  const tiles = new Map();

  // coarse far terrain (follows the camera; carries the trench walls). It is cut away wherever the detailed
  // tiles are built, otherwise its long triangles poke through the rugged trench wall.
  const clipU = { value: new THREE.Vector4(0, 0, -1, 0) };
  const farMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }), { ...terrainOpts, clip: clipU });
  const farGeo = new THREE.PlaneGeometry(16000, 16000, 160, 160);
  farGeo.rotateX(-Math.PI / 2);
  farGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(farGeo.attributes.position.count * 3), 3));
  const far = new THREE.Mesh(farGeo, farMat);
  far.frustumCulled = false;
  group.add(far);
  const farBase = farGeo.attributes.position.array.slice();
  let farCenter = null;
  function rebuildFar(cx, cz) {
    const p = farGeo.attributes.position, col = farGeo.attributes.color, c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = farBase[i * 3] + cx, z = farBase[i * 3 + 2] + cz;
      const h = heightAt(x, z, false);
      p.setXYZ(i, x, h - 2.5, z);
      sedimentColor(x, z, h, c); col.setXYZ(i, c.r, c.g, c.b);
    }
    p.needsUpdate = true; col.needsUpdate = true;
    farGeo.computeVertexNormals();
    farCenter = new THREE.Vector2(cx, cz);
  }

  // instanced bottom life, rebuilt whenever the active tile set changes
  const solid = (rough = 0.6, opts = {}) => patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, side: THREE.DoubleSide }), { dust: 0.25, glow: true, ...opts });
  const [tripodBody, tripodLegs] = tripodGeo();
  const kinds = [
    { geo: lumpGeo(1, 0x1d1a17, 0.25), mat: solid(0.8), per: 160, s: [0.04, 0.12], deep: [3000, 6500], yaw: true, sink: 0.4 },              // manganese nodules
    { geo: lumpGeo(2, 0x3b3631, 0.5), mat: solid(0.9, { detail: 'sediment' }), per: 6, s: [0.4, 2.4], deep: [3000, 11000], sink: 0.45 },   // rocks
    { geo: lumpGeo(3, 0x9c8e78, 0.6), mat: solid(0.95), per: 18, s: [0.1, 0.3], deep: [3000, 11000], sink: 0.1 },                          // xenophyophores
    { geo: seaPigGeo(), mat: solid(0.4, { dust: 0 }), per: 7, s: [0.12, 0.18], deep: [3000, 6500], swim: true },                             // sea pigs
    { geo: brittleStarGeo(), mat: solid(0.6, { dust: 0 }), per: 20, s: [0.6, 1.1], deep: [3000, 9000], yaw: true },                       // brittle stars
    { geo: glassSpongeGeo(), mat: patch(new THREE.MeshStandardMaterial({ vertexColors: true, wireframe: true, roughness: 0.3 }), { glow: true }), per: 3, s: [0.6, 1.1], deep: [3000, 6000] },
    { geo: crinoidGeo(), mat: solid(0.5, { dust: 0 }), per: 3, s: [0.8, 1.4], deep: [3000, 7000] },
    { geo: seaPenGeo(), mat: solid(0.5, { dust: 0 }), per: 4, s: [0.6, 1.0], deep: [3000, 6000] },
    { geo: tripodBody, mat: solid(0.4, { dust: 0 }), per: 1.2, s: [0.3, 0.4], deep: [3000, 6000], lift: 0.75, pair: 9 },
    { geo: tripodLegs, mat: solid(0.4, { dust: 0 }), per: 0, pairOf: 8 },
    { geo: isopodGeo(), mat: solid(0.45, { dust: 0 }), per: 1.5, s: [0.25, 0.4], deep: [3000, 7000], swim: true },
  ];
  const CAP = 25 * 400;
  for (const k of kinds) {
    if (!k.geo.getAttribute('aPhase')) k.geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(CAP).map(() => Math.random() * 50), 1));
    k.mesh = new THREE.InstancedMesh(k.geo, k.mat, Math.max(1, Math.ceil(k.per * 25 + 4)));
    k.mesh.frustumCulled = false;
    k.mesh.count = 0;
    k.items = [];
    group.add(k.mesh);
  }
  const dummy = new THREE.Object3D();
  function rebuildFauna() {
    for (const k of kinds) k.items = [];
    for (const [key] of tiles) {
      const [tx, tz] = key.split(',').map(Number);
      const r = rng(((tx * 73856093) ^ (tz * 19349663)) >>> 0);
      kinds.forEach((k, ki) => {
        if (k.pairOf !== undefined) return;
        let n = Math.floor(k.per * (0.6 + r() * 0.8));
        for (let i = 0; i < n; i++) {
          const x = (tx + r() - 0.5) * TILE, z = (tz + r() - 0.5) * TILE;
          const h = heightAt(x, z);
          if (-h < k.deep[0] || -h > k.deep[1]) continue;
          const s = k.s[0] + r() * (k.s[1] - k.s[0]);
          k.items.push({ x, y: h + (k.lift ?? 0) * s - (k.sink ?? 0) * s, z, s, yaw: r() * Math.PI * 2, tilt: (r() - 0.5) * 0.2, swim: k.swim ? r() * 100 : 0 });
        }
      });
    }
    kinds.forEach((k) => { if (k.pairOf !== undefined) k.items = kinds[k.pairOf].items; });
    for (const k of kinds) {
      const n = Math.min(k.items.length, k.mesh.instanceMatrix.count);
      k.mesh.count = n;
      writeKind(k, 0);
    }
  }
  function writeKind(k, t) {
    for (let i = 0; i < k.mesh.count; i++) {
      const it = k.items[i];
      let x = it.x, z = it.z, yaw = it.yaw;
      if (it.swim) { // slow crawl in a lazy loop
        const a = t * 0.02 + it.swim;
        x += Math.cos(a) * 1.5; z += Math.sin(a) * 1.5; yaw = -a - Math.PI / 2;
      }
      dummy.position.set(x, it.swim ? heightAt(x, z) : it.y, z);
      dummy.rotation.set(it.tilt, yaw, 0);
      dummy.scale.setScalar(it.s);
      dummy.updateMatrix();
      k.mesh.setMatrixAt(i, dummy.matrix);
    }
    k.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- hydrothermal vent field
  const vents = new THREE.Group();
  group.add(vents);
  const ventMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { detail: 'sediment', glow: true });
  const wormMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), { glow: true, sway: false });
  const smokeSrc = [];
  const vr = rng(77);
  for (let i = 0; i < 7; i++) {
    const a = vr() * Math.PI * 2, d = 6 + vr() * 34;
    const x = VENT_SITE.x + Math.cos(a) * d, z = VENT_SITE.y + Math.sin(a) * d;
    const ht = 5 + vr() * 16;
    const m = new THREE.Mesh(ensure(chimneyGeo(i + 5, ht)), ventMat);
    const y = heightAt(x, z) - 0.5;
    m.position.set(x, y, z);
    vents.add(m);
    smokeSrc.push(new THREE.Vector3(x, y + ht, z));
    for (let w = 0; w < 3; w++) {
      const wm = new THREE.Mesh(ensure(tubeWormClusterGeo(i * 10 + w)), wormMat);
      const aa = vr() * Math.PI * 2, dd = 2 + vr() * 2.5;
      wm.position.set(x + Math.cos(aa) * dd, heightAt(x + Math.cos(aa) * dd, z + Math.sin(aa) * dd) - 0.1, z + Math.sin(aa) * dd);
      wm.scale.setScalar(0.8 + vr() * 0.6);
      vents.add(wm);
    }
  }
  // black smoker plumes: soft dark particles rising and spreading
  const PN = 2600;
  const pp = new Float32Array(PN * 3), pa = new Float32Array(PN * 2);
  for (let i = 0; i < PN; i++) { const s = smokeSrc[i % smokeSrc.length]; pp.set([s.x, s.y, s.z], i * 3); pa[i * 2] = Math.random(); pa[i * 2 + 1] = Math.random(); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  pg.setAttribute('aR', new THREE.BufferAttribute(pa, 2));
  const smokeU = { uTime: { value: 0 }, uLamp: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 800 }, uDepthTex: G.uDepthTex, uRes: G.uRes, uFogT: G.uFogT, uExpo: G.uExpo };
  const smoke = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms: smokeU, transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime, uScale; attribute vec2 aR; varying float vA; varying vec3 vW;
      void main(){
        float life = fract(uTime * (0.05 + aR.x * 0.03) + aR.y);
        vec3 p = position + vec3(sin(aR.y * 40.0 + uTime * 0.3) * life * 4.0, life * 26.0, cos(aR.x * 37.0 + uTime * 0.25) * life * 4.0 + life * life * 6.0);
        vA = smoothstep(0.0, 0.05, life) * (1.0 - life);
        vW = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((0.5 + life * 5.0) * uScale / -mv.z, 1.0, 200.0);
      }`,
    fragmentShader: `uniform float uLamp; varying float vA; varying vec3 vW;
      ${GLSL_TRANSP}
      void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)) * vA * 0.35; gl_FragColor = vec4(transpFog(vec3(0.05, 0.045, 0.04) * uLamp, vW) / max(uExpo, 1e-4), a); }`,
  }));
  smoke.frustumCulled = false;
  smoke.layers.set(1);
  vents.add(smoke);

  function ensure(g) {
    if (!g.getAttribute('aPhase')) g.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    return g;
  }

  function update(info) {
    const cam = camera.position;
    const floorH = heightAt(cam.x, cam.z, false);
    // over the trench the wall can be close beside you while the floor is kilometres below
    const near = cam.y - floorH < 700 || floorH < -SEAFLOOR_DEPTH - 150;
    group.visible = info.under && cam.y < -2500;
    if (!group.visible) return;
    if (!farCenter || Math.hypot(cam.x - farCenter.x, cam.z - farCenter.y) > 1500) rebuildFar(Math.round(cam.x / 100) * 100, Math.round(cam.z / 100) * 100);
    clipU.value.z = -1;
    if (near) {
      const tx = Math.round(cam.x / TILE), tz = Math.round(cam.z / TILE);
      const want = new Set();
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) want.add(`${tx + i},${tz + j}`);
      let changed = false;
      for (const [k, m] of tiles) if (!want.has(k)) { group.remove(m); m.geometry.dispose(); tiles.delete(k); changed = true; }
      let built = 0;
      for (const k of want) {
        if (tiles.has(k) || built > 2) continue;
        const [x, z] = k.split(',').map(Number);
        const m = makeTile(x, z, terrainMat);
        tiles.set(k, m); group.add(m); built++; changed = true;
      }
      if (changed) rebuildFauna();
      if (built === 0) clipU.value.set(tx * TILE, tz * TILE, 2.5 * TILE - 2, 0);
    }
    for (const k of kinds) if (k.swim || kinds[k.pairOf]?.swim) writeKind(k, info.time);
    vents.visible = Math.hypot(cam.x - VENT_SITE.x, cam.z - VENT_SITE.y) < 600;
    smokeU.uTime.value = info.time;
    smokeU.uLamp.value = info.lampOn ? 1.2 : 0;
    smokeU.uScale.value = ctx.renderer.domElement.height * 0.6;
  }

  return {
    update, heightAt, baseHeightAt, siteOrigin, ventSite: VENT_SITE, holeClip,
    trenchPoint: new THREE.Vector2(0, TRENCH_Z),
    trench: { z: TRENCH_Z, rimZ: trenchRimZ, floorHalf: TRENCH_FLOOR },
  };
}
