// Building kit for enterable wrecks. Ships are assembled in their own frame (+X = bow, +Y = up, keel at y = 0)
// from boxes, walls with doorways, slabs with hatches and curved hull sheets; every solid piece also registers an
// oriented-box collider so the submersible can't pass through it. Props and skeletons dress the rooms.
import * as THREE from 'three';
import { GeoBuilder, C, v3, ZERO } from './builders.js';
import { rng } from './common.js';
import { skeleton } from './skeleton.js';

const clampi = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
const X = v3(1, 0, 0);
export const M = (x, y, z, ry = 0, rx = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), v3(s, s, s));

// rectangle [a0, a1] × [b0, b1] minus rectangular holes [[a0, a1, b0, b1], ...], as merged strips
export function rectMinus(a0, a1, b0, b1, holes = []) {
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const A = [a0, a1], B = [b0, b1];
  for (const h of holes) { A.push(cl(h[0], a0, a1), cl(h[1], a0, a1)); B.push(cl(h[2], b0, b1), cl(h[3], b0, b1)); }
  const uniq = (arr) => [...new Set(arr.map((v) => Math.round(v * 1000) / 1000))].sort((p, q) => p - q);
  const As = uniq(A), Bs = uniq(B), out = [];
  for (let j = 0; j < Bs.length - 1; j++) {
    let run = null;
    for (let i = 0; i < As.length - 1; i++) {
      const ca = (As[i] + As[i + 1]) / 2, cb = (Bs[j] + Bs[j + 1]) / 2;
      const hole = holes.some((h) => ca > h[0] && ca < h[1] && cb > h[2] && cb < h[3]);
      if (!hole) { if (run) run[1] = As[i + 1]; else run = [As[i], As[i + 1], Bs[j], Bs[j + 1]]; }
      else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
  }
  return out.filter((q) => q[1] - q[0] > 0.01 && q[3] - q[2] > 0.01);
}

export class Kit {
  constructor(name, seed) {
    this.name = name;
    this.parts = {};    // material key → GeoBuilder
    this.cols = [];     // 15 floats per collider: centre, half extents, box x/y/z axes
    this.rooms = [];    // named volumes for the HUD
    this.r = rng(seed);
  }
  b(mat) { return this.parts[mat] || (this.parts[mat] = new GeoBuilder()); }
  rand(a, b) { return a + this.r() * (b - a); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  room(name, x0, y0, z0, x1, y1, z1) { this.rooms.push({ name, min: v3(x0, y0, z0), max: v3(x1, y1, z1) }); }

  collider(c, ax, ay, az, hx, hy, hz) {
    if (hx < 0.02 || hy < 0.02 || hz < 0.02) return;
    this.cols.push(c.x, c.y, c.z, hx, hy, hz, ax.x, ax.y, ax.z, ay.x, ay.y, ay.z, az.x, az.y, az.z);
  }
  // a box collider fitted to a (nearly planar) quad of a curved sheet
  panel(p00, p10, p01, p11, t) {
    const c = p00.clone().add(p10).add(p01).add(p11).multiplyScalar(0.25);
    const ex = p10.clone().sub(p00).add(p11.clone().sub(p01)).multiplyScalar(0.5);
    const ey0 = p01.clone().sub(p00).add(p11.clone().sub(p10)).multiplyScalar(0.5);
    const hx = ex.length() / 2, hy = ey0.length() / 2;
    if (hx < 0.05 || hy < 0.05) return;
    ex.normalize();
    const ey = ey0.clone().addScaledVector(ex, -ey0.dot(ex));
    if (ey.lengthSq() < 1e-6) return;
    ey.normalize();
    this.collider(c, ex, ey, ex.clone().cross(ey), hx + 0.05, hy + 0.05, t / 2);
  }

  // one subdivided bilinear face; outward normal = (p10 - p00) × (p01 - p00)
  quad(mat, p00, p10, p01, p11, col, res, warp) {
    const nu = clampi(p10.distanceTo(p00) / res, 1, 24), nv = clampi(p01.distanceTo(p00) / res, 1, 24);
    const n = warp ? p10.clone().sub(p00).cross(p01.clone().sub(p00)).normalize() : null;
    this.b(mat).grid(nu, nv, (u, v) => {
      const p = p00.clone().lerp(p10, u).lerp(p01.clone().lerp(p11, u), v);
      if (warp && u > 0 && u < 1 && v > 0 && v < 1) p.addScaledVector(n, Math.sin(p.x * 1.3 + p.y * 0.7) * Math.sin(p.z * 1.1 - p.y * 0.9) * warp);
      return { p, c: col, g: ZERO };
    });
  }
  // box between two corners, optionally placed by o.m; o.collide = false for loose props
  box(mat, x0, y0, z0, x1, y1, z1, col, o = {}) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    const m = o.m;
    const P = (x, y, z) => { const p = v3(x, y, z); return m ? p.applyMatrix4(m) : p; };
    const c = [P(x0, y0, z0), P(x1, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x0, y0, z1), P(x1, y0, z1), P(x0, y1, z1), P(x1, y1, z1)];
    this.hexa(mat, c, col.clone().multiplyScalar(o.flat ? 1 : 0.86 + this.r() * 0.22), o);
    if (o.collide !== false) {
      const ax = c[1].clone().sub(c[0]), ay = c[2].clone().sub(c[0]), az = c[4].clone().sub(c[0]);
      this.collider(P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), ax.clone().normalize(), ay.clone().normalize(), az.clone().normalize(), ax.length() / 2, ay.length() / 2, az.length() / 2);
    }
  }
  // six faces from eight corners, indexed by bits (x | y << 1 | z << 2), so a box can also be a wedge or trapezoid
  hexa(mat, c, col, o = {}) {
    const res = o.res ?? 1.6, w = o.warp ?? 0, sk = o.skip ?? '';
    if (!sk.includes('px')) this.quad(mat, c[1], c[3], c[5], c[7], col, res, w);
    if (!sk.includes('nx')) this.quad(mat, c[0], c[4], c[2], c[6], col, res, w);
    if (!sk.includes('py')) this.quad(mat, c[2], c[6], c[3], c[7], col, res, w);
    if (!sk.includes('ny')) this.quad(mat, c[0], c[1], c[4], c[5], col, res, w);
    if (!sk.includes('pz')) this.quad(mat, c[4], c[5], c[6], c[7], col, res, w);
    if (!sk.includes('nz')) this.quad(mat, c[0], c[2], c[1], c[3], col, res, w);
  }
  // wall in the plane z = zc running along x; holes [[x0, x1, y0, y1], ...]
  wallX(mat, x0, x1, y0, y1, zc, t, holes, col, o) { for (const [a0, a1, b0, b1] of rectMinus(x0, x1, y0, y1, holes)) this.box(mat, a0, b0, zc - t / 2, a1, b1, zc + t / 2, col, o); }
  // wall in the plane x = xc running along z; holes [[z0, z1, y0, y1], ...]
  wallZ(mat, z0, z1, y0, y1, xc, t, holes, col, o) { for (const [a0, a1, b0, b1] of rectMinus(z0, z1, y0, y1, holes)) this.box(mat, xc - t / 2, b0, a0, xc + t / 2, b1, a1, col, o); }
  // horizontal slab with its top at y; holes [[x0, x1, z0, z1], ...]
  slab(mat, x0, x1, z0, z1, y, t, holes, col, o) { for (const [a0, a1, b0, b1] of rectMinus(x0, x1, z0, z1, holes)) this.box(mat, a0, y - t, b0, a1, y, b1, col, o); }
  // transverse bulkhead that follows a curved hull: horizontal strips whose outer edges are slanted to trace the
  // hull section (no staircase), with box colliders as wide as the narrower end of each strip
  bulkhead(mat, x, y0, y1, halfAt, holes, col, t = 0.3, step = 0.45) {
    const cc = col.clone().multiplyScalar(0.86 + this.r() * 0.22);
    for (let y = y0; y < y1 - 1e-3; y += step) {
      const yb = Math.min(y1, y + step), hw = Math.min(halfAt(y), halfAt(yb));
      if (hw <= 0.1) continue;
      for (const [a0, a1, b0, b1] of rectMinus(-hw, hw, y, yb, holes)) {
        const outL = a0 <= -hw + 1e-6, outR = a1 >= hw - 1e-6;
        const zl0 = outL ? -halfAt(b0) : a0, zl1 = outL ? -halfAt(b1) : a0, zr0 = outR ? halfAt(b0) : a1, zr1 = outR ? halfAt(b1) : a1;
        const xa = x - t / 2, xb = x + t / 2;
        this.hexa(mat, [v3(xa, b0, zl0), v3(xb, b0, zl0), v3(xa, b1, zl1), v3(xb, b1, zl1), v3(xa, b0, zr0), v3(xb, b0, zr0), v3(xa, b1, zr1), v3(xb, b1, zr1)], cc, { res: 2.5 });
        this.box(mat, xa, b0, a0, xb, b1, a1, cc, { skip: 'pxnxpynypznz' });
      }
    }
  }

  // parametric sheet fn(u, v) → point: hull plating, curved decks. Holes are cut from both mesh and colliders.
  surface(mat, s) {
    const keep = s.hole ? (i, j) => !s.hole(s.fn((i + 0.5) / s.nu, (j + 0.5) / s.nv), true) : null;
    // s.bend(p) can push plating near a tear inwards (visual only), so holes look ripped rather than cut
    this.b(mat).grid(s.nu, s.nv, (u, v) => { const p = s.fn(u, v), c = s.color(p, u, v); if (s.bend) s.bend(p); return { p, c, g: ZERO }; }, !!s.wrap, keep);
    if (!s.pu) return;
    for (let i = 0; i < s.pu; i++) for (let j = 0; j < s.pv; j++) {
      const p00 = s.fn(i / s.pu, j / s.pv), p10 = s.fn((i + 1) / s.pu, j / s.pv), p01 = s.fn(i / s.pu, (j + 1) / s.pv), p11 = s.fn((i + 1) / s.pu, (j + 1) / s.pv);
      const c = p00.clone().add(p10).add(p01).add(p11).multiplyScalar(0.25);
      if (c.y < (s.buried ?? -1e9) || (s.hole && s.hole(c, false))) continue;
      this.panel(p00, p10, p01, p11, s.thick ?? 0.6);
    }
  }
  // ship hull: vertical sides (with tumblehome), round bilge, flat bottom. v runs port deck edge → keel → starboard
  shell(mat, s) {
    const pt = (u, v) => {
      const w = Math.max(s.half(u), 0.05), T = s.top(u);
      const bR = Math.min(s.bilge, w * 0.95, T * 0.9), tum = s.tumble ?? 0;
      const S1 = T - bR, S2 = (Math.PI / 2) * bR, S3 = w - bR, Ph = S1 + S2 + S3;
      const sg = v < 0.5 ? -1 : 1, sd = (1 - Math.abs(v * 2 - 1)) * Ph;
      let y, z;
      if (sd < S1) { y = T - sd; z = w * (1 - tum * (y - bR) / Math.max(T - bR, 1e-3)); }
      else if (sd < S1 + S2) { const th = (sd - S1) / bR; z = w - bR + bR * Math.cos(th); y = bR - bR * Math.sin(th); }
      else { z = w - bR - (sd - S1 - S2); y = 0; }
      return v3(s.xAt ? s.xAt(u, v, y) : u * s.L, y, sg * z);
    };
    this.surface(mat, { ...s, fn: pt, pu: Math.ceil(s.L / (s.panel ?? 2.5)), pv: s.panelV ?? 20 });
    return pt;
  }

  // ------------------------------------------------------------ primitives for props (local frame via o.m)
  cyl(mat, a, b, r, col, o = {}) {
    if (o.m) { a = a.clone().applyMatrix4(o.m); b = b.clone().applyMatrix4(o.m); }
    const d = b.clone().sub(a), len = d.length();
    if (len < 1e-4) return;
    d.normalize();
    const r1 = o.r1 ?? r, prof = [[0, 0], [r, 0], [r, 0], [r1, len], [r1, len], [0, len]];
    const t = new GeoBuilder();
    t.lathe((v) => prof[Math.round(v * 5)], 5, col, o.seg ?? 14, 'x');
    const q = new THREE.Quaternion().setFromUnitVectors(X, d);
    this.b(mat).merge(t, new THREE.Matrix4().compose(a, q, v3(1, 1, 1)));
    if (o.collide) {
      const rr = Math.max(r, r1);
      this.collider(a.clone().addScaledVector(d, len / 2), d, v3(0, 1, 0).applyQuaternion(q), v3(0, 0, 1).applyQuaternion(q), len / 2, rr, rr);
    }
  }
  tube(mat, pts, r, col, seg = 6, m = null) {
    this.b(mat).tube(m ? pts.map((p) => p.clone().applyMatrix4(m)) : pts, typeof r === 'function' ? r : () => r, col, seg);
  }
  // irregular lump (silt drift, sack, coal, mattress): sphere roughened then scaled and placed
  lump(mat, x, y, z, sx, sy, sz, col, yaw = 0, rough = 0.25) {
    const t = new GeoBuilder(), k = this.r() * 50;
    t.sphere(v3(0, 0, 0), 1, col, ZERO, 12, v3(1, 1, 1));
    for (let i = 0; i < t.pos.length; i += 3) {
      const px = t.pos[i], py = t.pos[i + 1], pz = t.pos[i + 2];
      const f = 1 + (Math.sin(px * 3.1 + k) * Math.sin(pz * 2.7 - k) + Math.sin(py * 4.3 + k * 0.7) * 0.5) * rough;
      t.pos[i] = px * f; t.pos[i + 1] = Math.max(py * f, -0.15); t.pos[i + 2] = pz * f;
    }
    this.b(mat).merge(t, new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), yaw), v3(sx, sy, sz)));
  }
  skeleton(pose, x, y, z, yaw) {
    const { bone, shoe } = skeleton(pose, Math.floor(this.r() * 1e6));
    const m = M(x, y, z, yaw);
    this.b('bone').merge(bone, m);
    this.b('leather').merge(shoe, m);
  }

  // ------------------------------------------------------------ props
  door(x, y, z, alongX, w, h, col, mat = 'furn') {
    const st = this.r();
    if (st < 0.3) return;  // rotted away
    const t = 0.07;
    if (st < 0.5) {         // fallen flat
      const m = M(x, y + 0.08, z, (alongX ? 0 : Math.PI / 2) + this.rand(-0.3, 0.3), -Math.PI / 2 + 0.03);
      this.box(mat, -w / 2, 0, -t, w / 2, h, t, col, { m, collide: false });
      return;
    }
    const open = this.rand(0.6, 1.6), m = M(x - (alongX ? w / 2 : 0), y, z - (alongX ? 0 : w / 2), (alongX ? 0 : -Math.PI / 2) + open);
    this.box(mat, 0, 0, -t, w, h - 0.05, t, col, { m, collide: false });
    this.cyl('metal', v3(w - 0.12, h * 0.48, t), v3(w - 0.12, h * 0.48, t + 0.08), 0.03, C(0x6a5530), { m, seg: 8 });
  }
  bed(x, y, z, yaw, mattress = C(0x5e5444)) {
    const m = M(x, y, z, yaw), iron = C(0x3a3430);
    for (const [px, pz] of [[-1.0, -0.5], [1.0, -0.5], [-1.0, 0.5], [1.0, 0.5]]) this.cyl('iron', v3(px, 0, pz), v3(px, px > 0 ? 1.1 : 0.8, pz), 0.035, iron, { m, seg: 8 });
    for (const pz of [-0.5, 0.5]) this.cyl('iron', v3(-1.0, 0.45, pz), v3(1.0, 0.45, pz), 0.03, iron, { m, seg: 6 });
    for (const px of [-1.0, 1.0]) for (const yy of [0.45, px > 0 ? 1.05 : 0.75]) this.cyl('iron', v3(px, yy, -0.5), v3(px, yy, 0.5), 0.03, iron, { m, seg: 6 });
    this.box('iron', -1.0, 0, -0.5, 1.0, 0.5, 0.5, iron, { m, skip: 'pxnxpynypznz' });   // collider only
    if (this.r() < 0.75) { const p = v3(this.rand(-0.2, 0.2), 0.55, this.rand(-0.05, 0.05)).applyMatrix4(m); this.lump('silt', p.x, p.y, p.z, 0.95, 0.13, 0.46, mattress, yaw, 0.18); }
  }
  bunk(x, y, z, yaw, tiers = 3, len = 2.0) {
    const m = M(x, y, z, yaw), frame = C(0x3e4144);
    for (const px of [-len / 2, len / 2]) for (const pz of [-0.45, 0.45]) this.cyl('iron', v3(px, 0, pz), v3(px, tiers * 0.85 + 0.1, pz), 0.04, frame, { m, seg: 8 });
    for (let i = 0; i < tiers; i++) {
      const yy = 0.35 + i * 0.85;
      this.box('iron', -len / 2, yy - 0.05, -0.45, len / 2, yy, 0.45, frame, { m, collide: i === 0 });
      if (this.r() < 0.7) this.box('silt', -len / 2 + 0.05, yy, -0.42, len / 2 - 0.05, yy + 0.12, 0.42, C(0x4c4a40), { m, collide: false });
    }
  }
  table(x, y, z, r, round = true, h = 0.8, tipped = false) {
    const col = C(0x4a3020);
    if (tipped) {
      // on its side: rim of the top and the foot both resting on the deck
      const m = M(x, y, z, this.rand(0, 6.28)), p0 = v3(0, 0.32, 0), p1 = v3(h, r, 0), d = p1.clone().sub(p0).normalize();
      this.cyl('furn', p1.clone().addScaledVector(d, -0.03), p1.clone().addScaledVector(d, 0.03), r, col, { m, seg: 20 });
      this.cyl('furn', p0, p1, 0.07, col, { m, seg: 8 });
      this.cyl('iron', p0.clone().addScaledVector(d, -0.05), p0, 0.38, C(0x2c2622), { m, seg: 12 });
      return;
    }
    // The top has separated along its boards; gaps and missing ends are real holes.
    const strips = Math.max(5, Math.ceil(r * 9)), halfZ = round ? r : r * 0.55;
    for (let i = 0; i < strips; i++) {
      const z0 = -halfZ + 2 * halfZ * i / strips + 0.008, z1 = -halfZ + 2 * halfZ * (i + 1) / strips - 0.008;
      const span = round ? Math.sqrt(Math.max(0, r*r - Math.pow(Math.max(Math.abs(z0), Math.abs(z1)), 2))) : r;
      if (span < 0.04 || (i !== Math.floor(strips/2) && this.r() < 0.16)) continue;
      const broken = this.r() < 0.25, end = broken ? span * this.rand(0.15, 0.75) : span;
      this.box('furn', x - span, y + h - 0.065, z + z0, x + end, y + h + this.rand(-0.004, 0.004), z + z1, col, { collide: false, res: 0.25, warp: 0.006 });
      if (broken) for (let j = 0; j < 3; j++) this.cyl('furn', v3(x + end - 0.02, y + h - 0.02, z + z0 + (z1-z0)*(j+0.5)/3), v3(x + end + this.rand(0.04,0.12), y+h-0.02,z+z0+(z1-z0)*(j+0.5)/3), 0.009, col, { r1:0.001, seg:5 });
    }
    this.cyl('furn', v3(x, y, z), v3(x, y + h, z), 0.08, col, { seg: 8 });
    this.cyl('iron', v3(x, y, z), v3(x, y + 0.05, z), round ? r * 0.45 : 0.4, C(0x2c2622), { seg: 12 });
    this.box('furn', x - r * 0.8, y, z - r * (round ? 0.8 : 0.45), x + r * 0.8, y + h, z + r * (round ? 0.8 : 0.45), col, { skip: 'pxnxpynypznz' });
  }
  chair(x, y, z, yaw) {
    const prop = new Kit('Broken chair', Math.floor(this.r() * 1e6));
    const col = C(this.pick([0x695442, 0x514b41, 0x79634e, 0x50534a]));
    const damage = this.rand(0.35, 0.95), tipped = this.r() < 0.72;
    const timber = (a, b, w, h = w) => {
      const d = b.clone().sub(a), q = new THREE.Quaternion().setFromUnitVectors(X, d.clone().normalize());
      const m = new THREE.Matrix4().compose(a, q, v3(1, 1, 1));
      prop.box('furn', 0, -h / 2, -w / 2, d.length(), h / 2, w / 2, col, { m, collide: false, res: 0.12, warp: 0.003 });
    };
    // Open mortise-and-tenon seat frame, with individually warped/missing boards.
    for (const zz of [-0.24, 0.24]) timber(v3(-0.25, 0.43, zz), v3(0.25, 0.43, zz), 0.045, 0.075);
    for (const xx of [-0.24, 0.24]) timber(v3(xx, 0.43, -0.24), v3(xx, 0.43, 0.24), 0.045, 0.075);
    for (let i = 0; i < 5; i++) {
      if (this.r() < damage * 0.34) continue;
      const zz = -0.2 + i * 0.1, broken = this.r() < damage * 0.6;
      const end = broken ? this.rand(-0.08, 0.15) : 0.26;
      timber(v3(-0.26, 0.476, zz), v3(end, 0.478 + this.rand(-0.012, 0.012), zz), 0.085, 0.025);
      if (broken) for (let j = 0; j < 3; j++) prop.cyl('furn', v3(end - 0.02, 0.48, zz + j * 0.023 - 0.025), v3(end + this.rand(0.025, 0.09), 0.477, zz + j * 0.023 - 0.025), 0.007, col, { r1: 0.001, seg: 5 });
    }
    // Turned legs, splintered stumps, cross braces and oxidised joint pins.
    for (const xx of [-0.22, 0.22]) for (const zz of [-0.22, 0.22]) {
      const snapped = tipped && this.r() < damage * 0.8, foot = snapped ? this.rand(0.18, 0.32) : 0;
      const pts = [v3(xx * 1.14, foot, zz * 1.12), v3(xx * 1.06, Math.max(foot + 0.02, 0.24), zz * 1.04), v3(xx, 0.43, zz)];
      prop.tube('furn', pts, t => 0.022 + Math.sin(t * Math.PI) * 0.009, col, 10);
      if (snapped) for (let j = 0; j < 3; j++) prop.cyl('furn', v3(xx + j * 0.009, foot + 0.01, zz), v3(xx + j * 0.009, foot - this.rand(0.02, 0.07), zz), 0.006, col, { r1: 0.001, seg: 5 });
      if (!snapped && zz < 0) timber(v3(xx, 0.18, -0.22), v3(xx, 0.18, 0.22), 0.022);
      prop.cyl('iron', v3(xx, 0.42, zz), v3(xx, 0.42, zz + Math.sign(zz) * 0.032), 0.009, C(0x3d3027), { seg: 7 });
    }
    for (const zz of [-0.22, 0.22]) timber(v3(-0.22, 0.45, zz), v3(-0.29, this.r() < damage * 0.25 ? 0.71 : 1.01, zz), 0.04);
    for (let j = 0; j < 3; j++) {
      if (this.r() < damage * 0.45) continue;
      const yy = 0.65 + j * 0.15;
      timber(v3(-0.24 - j * 0.02, yy, -0.24), v3(-0.24 - j * 0.02, yy + 0.012, 0.24), 0.028, 0.085);
    }
    // Fit the transformed lowest vertex to the deck: no levitating tipped seats.
    const m = M(x, 0, z, yaw, tipped ? this.rand(1.4, 1.85) : this.rand(-0.025, 0.025), tipped ? this.rand(-0.3, 0.3) : 0);
    let bottom = Infinity;
    const p = v3(0, 0, 0);
    for (const b of Object.values(prop.parts)) for (let i = 0; i < b.pos.length; i += 3) bottom = Math.min(bottom, p.fromArray(b.pos, i).applyMatrix4(m).y);
    m.elements[13] = y + 0.012 - bottom;
    for (const [key, b] of Object.entries(prop.parts)) this.b(key).merge(b, m);
    for (let i = 0; i < 2 + Math.floor(damage * 3); i++) {
      const debris = M(x + this.rand(-0.65, 0.65), y + 0.025, z + this.rand(-0.65, 0.65), this.rand(0, 6.28));
      const length = this.rand(0.13, 0.4), width = this.rand(0.025, 0.07);
      // Fractured wedge, including exposed end grain, rather than another cube.
      this.hexa('furn', [v3(-length/2,0,-width),v3(length/2,0,-width),v3(-length/2,0.025,-width),v3(length*0.38,0.022,-width),v3(-length*0.4,0,width),v3(length*0.4,0,width),v3(-length*0.4,0.02,width),v3(length*0.25,0.025,width)].map(p => p.applyMatrix4(debris)), col, { res: 0.15 });
    }
  }
  crate(x, y, z, sx, sy, sz, yaw = 0, col = C(0x4b3826)) {
    const m = M(x, y, z, yaw);
    // Retain the original solid collider; render an open, partly collapsed carcass.
    this.box('wood', -sx/2, 0, -sz/2, sx/2, sy, sz/2, col, { m, skip:'pxnxpynypznz' });
    for (const xx of [-sx/2,sx/2]) for (const zz of [-sz/2,sz/2]) this.box('wood',xx-0.035,0,zz-0.035,xx+0.035,sy,zz+0.035,col,{m,collide:false});
    const rows = Math.max(3, Math.ceil(sy/0.19));
    for (let j=0;j<rows;j++) {
      const lo=j*sy/rows+0.012, hi=(j+1)*sy/rows-0.012;
      for (const side of [-1,1]) {
        if (this.r()>0.2) this.box('wood',-sx/2,lo,side*sz/2-0.022,sx/2*(j===rows-1?this.rand(0.25,1):1),hi,side*sz/2+0.022,col,{m,collide:false,res:0.4,warp:0.007});
        if (this.r()>0.18) this.box('wood',side*sx/2-0.022,lo,-sz/2,side*sx/2+0.022,hi,sz/2,col,{m,collide:false,res:0.4,warp:0.007});
      }
    }
    this.box('wood',-sx/2,0,-sz/2,sx/2,0.045,sz/2,col,{m,collide:false});
    for (const zz of [-sz*0.28,sz*0.28]) if(this.r()>0.5) this.box('wood',-sx/2,sy,zz-0.07,sx*this.rand(0.1,0.5),sy+0.04,zz+0.07,col,{m,collide:false});
  }
  barrel(x, y, z, lying, yaw = 0) {
    const t = new GeoBuilder(), wood = C(0x4a3420), H = 1.25, R = 0.42;
    t.lathe((v) => {
      const rows = [[0, 0], [R * 0.82, 0], [R * 0.82, 0], [R, H * 0.5], [R * 0.82, H], [R * 0.82, H], [0, H]];
      const i = Math.min(6, Math.round(v * 6)); return rows[i];
    }, 6, wood, 16);
    const hoops = new GeoBuilder();
    for (const hy of [0.12, 0.38, 0.62, 0.88]) {
      const rr = R * (0.82 + 0.18 * Math.sin(hy * Math.PI)) + 0.012, pts = [];
      for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2; pts.push(v3(Math.cos(a) * rr, hy * H, Math.sin(a) * rr)); }
      hoops.tube(pts, () => 0.025, C(0x3a2416), 4);
    }
    const m = lying ? M(x, y + R, z, yaw, 0, Math.PI / 2).multiply(M(0, -H / 2, 0)) : M(x, y, z, yaw);
    this.b('furn').merge(t, m); this.b('iron').merge(hoops, m);
    if (lying) this.box('furn', -H / 2, -R, -R, H / 2, R, R, wood, { m: M(x, y + R, z, yaw), skip: 'pxnxpynypznz' });
    else this.box('furn', -R, 0, -R, R, H, R, wood, { m: M(x, y, z), skip: 'pxnxpynypznz' });
  }
  cannon(x, y, z, yaw, fallen = false) {
    const m = fallen ? M(x, y + 0.3, z, yaw, 0, 0.35) : M(x, y, z, yaw), wood = C(0x3c2a1a), iron = C(0x26221e);
    this.box('wood', -0.7, 0.18, -0.38, 0.75, 0.62, 0.38, wood, { m });
    for (const px of [-0.5, 0.55]) for (const pz of [-0.42, 0.42]) this.cyl('wood', v3(px, 0.2, pz), v3(px, 0.2, pz + Math.sign(pz) * 0.1), 0.2, wood, { m, seg: 12 });
    const t = new GeoBuilder();
    t.lathe((v) => { const rows = [[0, -0.3], [0.2, -0.3], [0.27, -0.15], [0.26, 0.2], [0.21, 1.5], [0.17, 2.1], [0.2, 2.2], [0.1, 2.2]]; return rows[Math.round(v * 7)]; }, 7, iron, 16, 'x');
    this.b('iron').merge(t, m.clone().multiply(M(-0.4, 0.82, 0)));
    for (const s of [-1, 1]) this.cyl('iron', v3(0.1, 0.82, s * 0.27), v3(0.1, 0.82, s * 0.4), 0.06, iron, { m, seg: 8 });
  }
  cannonballs(x, y, z) {
    const iron = C(0x25211d);
    let n = 0;
    for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - l; i++) for (let j = 0; j < 3 - l; j++) {
      this.b('iron').sphere(v3(x + (i - (2 - l) / 2) * 0.24, y + 0.12 + l * 0.19, z + (j - (2 - l) / 2) * 0.24), 0.12, iron, ZERO, 8);
      n++;
    }
  }
  chest(x, y, z, yaw, open, gold = true) {
    const m = M(x, y, z, yaw), wood = C(0x3a2516), band = C(0x2a221a);
    this.box('wood', -0.6, 0, -0.38, 0.6, 0.62, 0.38, wood, { m, res: 1 });
    for (const px of [-0.45, 0, 0.45]) this.box('iron', px - 0.04, -0.01, -0.4, px + 0.04, 0.64, 0.4, band, { m, collide: false, res: 1 });
    if (open) {
      const lm = m.clone().multiply(M(0, 0.62, -0.38, 0, -1.9));
      this.box('wood', -0.6, 0, 0, 0.6, 0.06, 0.76, wood, { m: lm, collide: false, res: 1 });
      if (gold) {
        const gc = C(0xc9a03c);
        for (let i = 0; i < 70; i++) {
          const a = this.r() * 6.28, d = Math.sqrt(this.r());
          const p = v3(Math.cos(a) * d * 0.5, 0.58 + (1 - d) * 0.08 + this.r() * 0.03, Math.sin(a) * d * 0.3).applyMatrix4(m);
          this.cyl('gold', p, p.clone().add(v3(this.rand(-0.004, 0.004), 0.006, this.rand(-0.004, 0.004))), 0.022, gc.clone().multiplyScalar(this.rand(0.75, 1.05)), { seg: 10 });
        }
        for (let i = 0; i < 26; i++) {   // spilled coins on the deck
          const a = this.r() * 6.28, d = 0.5 + this.r() * 1.4;
          const p = v3(Math.cos(a) * d, 0.01, Math.sin(a) * d).applyMatrix4(m);
          this.cyl('gold', p, p.clone().add(v3(0, 0.006, 0)), 0.022, gc.clone().multiplyScalar(this.rand(0.6, 1.0)), { seg: 10 });
        }
      }
    } else this.box('wood', -0.6, 0.62, -0.38, 0.6, 0.78, 0.38, wood, { m, res: 1 });
  }
  shipWheel(x, y, z, yaw, h = 1.0) {
    const m = M(x, y, z, yaw), wood = C(0x4a2c18);
    this.box('furn', -0.15, 0, -0.15, 0.15, h, 0.15, wood, { m });
    const hub = v3(0.2, h + 0.55, 0), R = 0.7, ring = [];
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; ring.push(v3(0.2, hub.y + Math.cos(a) * R, Math.sin(a) * R)); }
    this.tube('furn', ring, 0.04, wood, 6, m);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, d = v3(0, Math.cos(a), Math.sin(a));
      this.tube('furn', [hub, hub.clone().addScaledVector(d, R + 0.22)], (t) => 0.035 * (1 - t * 0.3), wood, 5, m);
    }
    this.cyl('metal', v3(0.08, hub.y, 0), v3(0.32, hub.y, 0), 0.1, C(0x7a6030), { m, seg: 10 });
  }
  telegraph(x, y, z, yaw) {
    const m = M(x, y, z, yaw), brass = C(0x8a6a34);
    this.cyl('metal', v3(0, 0, 0), v3(0, 1.0, 0), 0.12, brass, { m, r1: 0.08, seg: 12, collide: true });
    this.cyl('metal', v3(-0.08, 1.2, 0), v3(0.08, 1.2, 0), 0.26, brass, { m, seg: 20 });
    this.cyl('paint', v3(0.081, 1.2, 0), v3(0.085, 1.2, 0), 0.22, C(0xb8b0a0), { m, seg: 20 });
    this.box('metal', 0.09, 1.18, -0.02, 0.12, 1.42, 0.02, brass, { m, collide: false, res: 1 });
  }
  stove(x, y, z, yaw, w = 2.4) {
    const m = M(x, y, z, yaw), iron = C(0x221f1c);
    this.box('iron', -w / 2, 0, -0.45, w / 2, 0.95, 0.45, iron, { m, res: 1 });
    for (let i = 0; i < Math.floor(w / 0.6); i++) this.cyl('iron', v3(-w / 2 + 0.3 + i * 0.6, 0.95, 0), v3(-w / 2 + 0.3 + i * 0.6, 0.98, 0), 0.2, C(0x151311), { m, seg: 12 });
    if (this.r() < 0.7) { const px = this.rand(-w / 2 + 0.4, w / 2 - 0.4); this.cyl('metal', v3(px, 0.98, 0), v3(px, 1.32, 0), 0.22, C(0x6a5a40), { m, seg: 14 }); }
  }
  pot(x, y, z) { this.cyl('metal', v3(x, y, z), v3(x, y + this.rand(0.2, 0.4), z), this.rand(0.15, 0.28), C(0x6a5638), { seg: 14 }); }
  plate(x, y, z) { this.cyl('china', v3(x, y, z), v3(x, y + 0.02, z), this.rand(0.1, 0.14), C(0xd8d4c8), { seg: 14, r1: this.rand(0.12, 0.15) }); }
  bottle(x, y, z, yaw) {
    const m = M(x, y + 0.04, z, yaw, 0, Math.PI / 2), g = C(0x1a2a1c);
    this.cyl('china', v3(0, 0, 0), v3(0.2, 0, 0), 0.04, g, { m, seg: 8 });
    this.cyl('china', v3(0.2, 0, 0), v3(0.3, 0, 0), 0.04, g, { m, seg: 8, r1: 0.015 });
  }
  suitcase(x, y, z, yaw) { this.box('leather', -0.4, 0, -0.12, 0.4, 0.5, 0.12, C(0x3a2618), { m: this.r() < 0.5 ? M(x, y + 0.12, z, yaw, Math.PI / 2) : M(x, y, z, yaw), collide: false, res: 1 }); }
  wardrobe(x, y, z, yaw, toppled) {
    const m = toppled ? M(x, y + 0.33, z, yaw, -Math.PI / 2 + 0.04) : M(x, y, z, yaw);
    this.box('furn', -0.7, 0, -0.32, 0.7, 2.1, 0.32, C(0x4a3020), { m, res: 1.2, collide: !toppled });
    if (toppled) this.box('furn', -0.7, 0, -0.32, 0.7, 2.1, 0.32, C(0x4a3020), { m, skip: 'pxnxpynypznz' });
  }
  washstand(x, y, z, yaw) {
    const m = M(x, y, z, yaw);
    this.box('furn', -0.45, 0, -0.25, 0.45, 0.85, 0.25, C(0x4a3020), { m, res: 1 });
    this.cyl('china', v3(0, 0.85, 0), v3(0, 0.95, 0), 0.22, C(0xd0ccc0), { m, seg: 14 });
  }
  chandelier(x, y, z) {
    const brass = C(0x7a5c2c), ring = [];
    for (let k = 0; k <= 20; k++) { const a = (k / 20) * Math.PI * 2; ring.push(v3(x + Math.cos(a) * 1.1, y + 0.15 + Math.sin(a * 3) * 0.08, z + Math.sin(a) * 1.1)); }
    this.tube('metal', ring, 0.04, brass, 6);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, tip = v3(x + Math.cos(a) * 1.1, y + 0.2, z + Math.sin(a) * 1.1);
      this.tube('metal', [v3(x, y + 0.5, z), v3(x + Math.cos(a) * 0.6, y + 0.65, z + Math.sin(a) * 0.6), tip], 0.025, brass, 5);
      this.b('china').sphere(tip.clone().add(v3(0, 0.08, 0)), 0.06, C(0xc8c4b8), ZERO, 8, v3(1, 1.6, 1));
    }
    this.cyl('metal', v3(x, y, z), v3(x, y + 0.9, z), 0.08, brass, { seg: 8 });
    for (let i = 0; i < 30; i++) { const a = this.r() * 6.28, d = 0.3 + this.r() * 2.2; this.b('china').sphere(v3(x + Math.cos(a) * d, y + 0.03, z + Math.sin(a) * d), 0.035, C(0xc8c4b8), ZERO, 6, v3(1, 1.5, 1)); }
  }
  pipeRun(pts, r = 0.12, col = C(0x3a2e26)) { this.tube('iron', pts, r, col, 8); }
  cable(x, y, z, len) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(v3(x + Math.sin(t * 3 + x) * 0.25 * t, y - t * len, z + Math.cos(t * 2 + z) * 0.25 * t)); }
    this.tube('leather', pts, 0.025, C(0x1a1612), 4);
  }
  valveWheel(x, y, z, normal, r = 0.3) {
    const n = normal.clone().normalize(), s = (Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0)).cross(n).normalize(), t = n.clone().cross(s), ring = [];
    for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2; ring.push(v3(x, y, z).addScaledVector(s, Math.cos(a) * r).addScaledVector(t, Math.sin(a) * r)); }
    this.tube('iron', ring, 0.025, C(0x5a1e14), 5);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; this.tube('iron', [v3(x, y, z), v3(x, y, z).addScaledVector(s, Math.cos(a) * r).addScaledVector(t, Math.sin(a) * r)], 0.018, C(0x5a1e14), 4); }
    this.cyl('iron', v3(x, y, z).addScaledVector(n, -0.25), v3(x, y, z), 0.05, C(0x3a2e26), { seg: 8 });
  }
  gauge(x, y, z, yaw) {
    const m = M(x, y, z, yaw);
    this.cyl('metal', v3(0, 0, 0), v3(0.06, 0, 0), 0.13, C(0x7a6030), { m, seg: 16 });
    this.cyl('china', v3(0.061, 0, 0), v3(0.065, 0, 0), 0.11, C(0xbab4a4), { m, seg: 16 });
  }
  // fallen ceiling panel / deck plate leaning or lying on the floor
  debris(mat, x, y, z, w, l, col) {
    const m = M(x, y + 0.05, z, this.rand(0, 6.28), this.rand(-0.25, 0.25), this.rand(-0.35, 0.35));
    this.box(mat, -w / 2, 0, -l / 2, w / 2, 0.06, l / 2, col, { m, collide: false, warp: 0.08, res: 1 });
  }
  // low drifts of silt that collect in corners and against walls
  silt(x0, x1, z0, z1, y, n = 3) {
    for (let i = 0; i < n; i++) this.lump('silt', this.rand(x0, x1), y, this.rand(z0, z1), this.rand(0.5, 1.5), this.rand(0.03, 0.1), this.rand(0.5, 1.5), C(0x4a443a), this.rand(0, 6), 0.45);
  }
  car(x, y, z, yaw) {
    const m = M(x, y, z, yaw), body = C(0x1c1e22), tyre = C(0x141210);
    this.box('hull', -2.1, 0.55, -0.85, 2.1, 1.1, 0.85, body, { m, res: 1.2 });
    this.box('hull', -1.1, 1.1, -0.8, 0.7, 1.8, 0.8, body, { m, res: 1.2 });
    this.box('hull', 0.7, 1.1, -0.65, 2.0, 1.35, 0.65, body, { m, res: 1.2, collide: false });
    for (const px of [-1.4, 1.45]) for (const pz of [-0.85, 0.85]) {
      this.cyl('leather', v3(px, 0.42, pz - 0.12), v3(px, 0.42, pz + 0.12), 0.42, tyre, { m, seg: 16 });
      this.cyl('metal', v3(px, 0.42, pz + Math.sign(pz) * 0.12), v3(px, 0.42, pz + Math.sign(pz) * 0.14), 0.22, C(0x6a5a40), { m, seg: 12 });
    }
    this.cyl('metal', v3(2.1, 0.95, -0.55), v3(2.25, 0.95, -0.55), 0.14, C(0x7a6a50), { m, seg: 12 });
    this.cyl('metal', v3(2.1, 0.95, 0.55), v3(2.25, 0.95, 0.55), 0.14, C(0x7a6a50), { m, seg: 12 });
  }
  truck(x, y, z, yaw) {
    const m = M(x, y, z, yaw), paint = C(0x2e3a2c), tyre = C(0x141210);
    this.box('hull', -3.2, 0.7, -1.2, 1.4, 1.0, 1.2, paint, { m });
    this.box('hull', -3.2, 1.0, -1.2, 1.4, 1.9, -1.1, paint, { m }); this.box('hull', -3.2, 1.0, 1.1, 1.4, 1.9, 1.2, paint, { m });
    this.box('hull', 1.5, 0.7, -1.1, 3.4, 2.7, 1.1, paint, { m });
    for (const px of [-2.3, -0.9, 2.6]) for (const pz of [-1.05, 1.05]) this.cyl('leather', v3(px, 0.5, pz - 0.15), v3(px, 0.5, pz + 0.15), 0.5, tyre, { m, seg: 16 });
  }
  torpedo(x, y, z, yaw) {
    const t = new GeoBuilder(), L = 6.4, R = 0.27;
    t.lathe((v) => { const rows = [[0, 0], [R * 0.6, 0.12], [R, 0.6], [R, L - 0.9], [R * 0.45, L - 0.15], [0.05, L]]; return rows[Math.round(v * 5)]; }, 5, C(0x3a3e3a), 16, 'x');
    for (const a of [0, Math.PI / 2]) t.patch(v3(0.1, -0.5 * Math.cos(a), -0.5 * Math.sin(a)), v3(0.6, -0.3 * Math.cos(a), -0.3 * Math.sin(a)), v3(0.6, 0.3 * Math.cos(a), 0.3 * Math.sin(a)), v3(0.1, 0.5 * Math.cos(a), 0.5 * Math.sin(a)), C(0x3a3e3a), 2);
    this.b('iron').merge(t, M(x, y, z, yaw).multiply(M(-L / 2, 0, 0)));
  }
  // sessile animals on a wreck: white anemones and glass sponges
  anemone(x, y, z, s = 1) {
    const t = new GeoBuilder(), col = C(0xe8e0d0).lerp(C(0xd89a7a), this.r() * 0.6);
    t.lathe((v) => [0.035 + v * 0.025, v * 0.16], 3, col, 8);
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; t.tube([v3(0, 0.16, 0), v3(Math.cos(a) * 0.08, 0.22, Math.sin(a) * 0.08), v3(Math.cos(a) * 0.13, 0.2, Math.sin(a) * 0.13)], (q) => 0.01 * (1 - q * 0.7), col, 3); }
    this.b('life').merge(t, M(x, y, z, this.r() * 6, 0, 0, s));
  }
  sponge(x, y, z, s = 1) {
    const t = new GeoBuilder();
    t.lathe((v) => [0.1 + Math.sin(v * Math.PI * 0.85) * 0.12 + v * 0.06, v * 0.9], 10, C(0xe2dccb), 12);
    this.b('life').merge(t, M(x, y, z, this.r() * 6, (this.r() - 0.5) * 0.3, (this.r() - 0.5) * 0.3, s));
  }
}
