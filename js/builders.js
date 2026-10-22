// Procedural geometry for marine animals. Local frame: +X = head / forward, +Y = up, Z = width.
import * as THREE from 'three';

const C = (hex) => new THREE.Color(hex);
const ZERO = new THREE.Color(0, 0, 0);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export class GeoBuilder {
  constructor() { this.pos = []; this.col = []; this.glow = []; this.idx = []; }
  vert(p, c = C(0xffffff), g = ZERO) {
    this.pos.push(p.x, p.y, p.z); this.col.push(c.r, c.g, c.b); this.glow.push(g.r, g.g, g.b);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  // generic grid surface: fn(u, v) → { p, c, g }; wrapU joins u = 1 back to u = 0; keep(i, j) can drop quads (holes)
  grid(nu, nv, fn, wrapU = false, keep = null) {
    const cols = wrapU ? nu : nu + 1;
    const base = this.pos.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) {
      const r = fn(i / nu, j / nv);
      this.vert(r.p, r.c, r.g);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (keep && !keep(i, j)) continue;
      const i1 = wrapU ? (i + 1) % nu : i + 1;
      const a = base + j * cols + i, b = base + j * cols + i1, c = base + (j + 1) * cols + i1, d = base + (j + 1) * cols + i;
      this.tri(a, b, c); this.tri(a, c, d);
    }
  }
  // bilinear patch: a, b along the base; d, c the outer edge
  patch(a, b, c, d, color, n = 5, glow = ZERO, bend = 0) {
    this.grid(n, n, (u, v) => {
      const p0 = a.clone().lerp(b, u), p1 = d.clone().lerp(c, u);
      const p = p0.lerp(p1, v);
      if (bend) p.z += Math.sin(u * Math.PI) * v * bend;
      return { p, c: color, g: glow };
    });
  }
  sphere(center, r, color, glow = ZERO, seg = 10, squash = v3(1, 1, 1)) {
    this.grid(seg, Math.ceil(seg * 0.6), (u, v) => {
      const th = u * Math.PI * 2, ph = v * Math.PI;
      return { p: v3(Math.sin(ph) * Math.cos(th) * r * squash.x + center.x, Math.cos(ph) * r * squash.y + center.y, Math.sin(ph) * Math.sin(th) * r * squash.z + center.z), c: color, g: glow };
    }, true);
  }
  // tube along points with radius function rf(t)
  tube(points, rf, color, seg = 6, glowFn = null, colorFn = null) {
    const n = points.length - 1;
    const frames = [];
    let prevN = null;
    for (let i = 0; i <= n; i++) {
      const t = points[Math.min(i + 1, n)].clone().sub(points[Math.max(i - 1, 0)]).normalize();
      let nrm = prevN ? prevN.clone().sub(t.clone().multiplyScalar(prevN.dot(t))).normalize() : new THREE.Vector3(0, 1, 0).cross(t).normalize();
      if (nrm.lengthSq() < 0.01) nrm = v3(1, 0, 0).cross(t).normalize();
      prevN = nrm;
      frames.push([nrm, t.clone().cross(nrm).normalize()]);
    }
    this.grid(seg, n, (u, v) => {
      const i = Math.round(v * n);
      const [N, B] = frames[i];
      const a = u * Math.PI * 2, r = rf(v);
      const p = points[i].clone().addScaledVector(N, Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r);
      return { p, c: colorFn ? colorFn(v, u) : color, g: glowFn ? glowFn(v, u) : ZERO };
    }, true);
  }
  // surface of revolution around an axis (default Y); prof(t) → [radius, height]
  lathe(prof, nv, color, seg = 24, axis = 'y', colorFn = null, glowFn = null) {
    this.grid(seg, nv, (u, v) => {
      const [r, h] = prof(v);
      const a = u * Math.PI * 2;
      const p = axis === 'y' ? v3(Math.cos(a) * r, h, Math.sin(a) * r) : v3(h, Math.cos(a) * r, Math.sin(a) * r);
      return { p, c: colorFn ? colorFn(v, u) : color, g: glowFn ? glowFn(v, u) : ZERO };
    }, true);
  }
  // append another builder's triangles, optionally transformed by a Matrix4
  merge(o, m = null) {
    const base = this.pos.length / 3, p = new THREE.Vector3();
    for (let i = 0; i < o.pos.length; i += 3) {
      p.set(o.pos[i], o.pos[i + 1], o.pos[i + 2]);
      if (m) p.applyMatrix4(m);
      this.pos.push(p.x, p.y, p.z);
    }
    for (let i = 0; i < o.col.length; i++) { this.col.push(o.col[i]); this.glow.push(o.glow[i]); }
    for (let i = 0; i < o.idx.length; i++) this.idx.push(o.idx[i] + base);
    return this;
  }
  build(phase = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------ fish / shark / whale body
export function fishGeometry(p) {
  const b = new GeoBuilder();
  const L = p.len ?? 1, H = (p.height ?? 0.22) * L, W = (p.width ?? 0.12) * L;
  const ha = p.headExp ?? 0.5, tb = p.tailExp ?? 1.0;
  const wa = p.wHeadExp ?? ha, wb = p.wTailExp ?? tb * 1.15;
  const norm = (a, bb) => { const t = a / (a + bb); return Math.pow(t, a) * Math.pow(1 - t, bb); };
  const nh = norm(ha, tb), nw = norm(wa, wb);
  const ped = p.ped ?? 0.07;
  const hF = (t) => H * ((Math.pow(t, ha) * Math.pow(1 - t, tb) / nh) * (1 - ped) + ped * t);
  const wF = (t) => W * ((Math.pow(t, wa) * Math.pow(1 - t, wb) / nw) * (1 - ped) + ped * 0.8 * t);
  const yc = (t) => H * (p.yShift ? p.yShift(t) : 0);
  const xF = (t) => L * (0.5 - t);
  const back = C(p.back ?? 0x334455), belly = C(p.belly ?? 0xdfe6ea), finC = C(p.fin ?? p.back ?? 0x334455);
  const shade = p.shade ?? 0.1;
  const tmpc = new THREE.Color();
  const point = (t, phi) => {
    const s = Math.sin(phi), c = Math.cos(phi);
    const sq = p.square ?? 1; // >1 boxier cross-section
    const ss = Math.sign(s) * Math.pow(Math.abs(s), 1 / sq), cc = Math.sign(c) * Math.pow(Math.abs(c), 1 / sq);
    let y = yc(t) + hF(t) * 0.5 * ss;
    if (p.flatBelly && ss < 0) y = yc(t) + hF(t) * 0.5 * ss * p.flatBelly;
    return v3(xF(t), y, wF(t) * 0.5 * cc);
  };
  b.grid(p.segV ?? 22, p.segU ?? 40, (u, v) => {
    const t = v, phi = u * Math.PI * 2;
    const s = Math.sin(phi);
    const k = THREE.MathUtils.smoothstep(s, -0.35 + shade, 0.3 + shade);
    tmpc.copy(belly).lerp(back, k);
    if (p.pattern) p.pattern(t, phi, tmpc, s);
    const g = p.photophores ? p.photophores(t, phi, s) : ZERO;
    return { p: point(t, phi), c: tmpc.clone(), g };
  }, true);

  // eyes
  const eT = p.eyeT ?? 0.09, eR = (p.eye ?? 0.025) * L;
  const eyeCol = C(p.eyeColor ?? 0x050505), eyeGlow = p.eyeGlow ? C(p.eyeGlow) : ZERO;
  for (const side of [-1, 1]) {
    const ep = point(eT, side > 0 ? (p.eyePhi ?? 0.45) : Math.PI - (p.eyePhi ?? 0.45));
    ep.z += side * eR * 0.25;
    if (p.anatomy) {
      b.sphere(ep, eR, C(p.iris ?? 0x968b60), ZERO, 16, v3(1, 1, 0.55));
      b.sphere(ep.clone().add(v3(0.001 * L, 0, side * eR * 0.45)), eR * 0.62, eyeCol, eyeGlow, 14, v3(1, 1, 0.45));
      const gill = [];
      for (let j = 0; j <= 12; j++) {
        const a = -0.95 + j / 12 * 2.1;
        const g = point(0.21 + Math.cos(a) * 0.025, side > 0 ? a : Math.PI - a);
        g.z += side * 0.002 * L; gill.push(g);
      }
      b.tube(gill, () => 0.0018 * L, back.clone().multiplyScalar(0.42), 5);
      const lip = [];
      for (let j = 0; j <= 8; j++) {
        const a = -0.28 + j / 8 * 0.62;
        const g = point(0.018 + Math.abs(a) * 0.024, side > 0 ? a : Math.PI - a);
        g.z += side * 0.001 * L; lip.push(g);
      }
      b.tube(lip, () => L * 0.0017, finC.clone().multiplyScalar(0.5), 5);
    } else b.sphere(ep, eR, eyeCol, eyeGlow, 10, v3(1, 1, 0.7));
  }

  const top = (t) => yc(t) + hF(t) * 0.5, bot = (t) => yc(t) - hF(t) * 0.5;
  // dorsal fins: [t0, t1, height, sweep]
  for (const d of p.dorsal ?? [[0.32, 0.5, 0.12, 0.08]]) {
    const [t0, t1, h, sw] = d;
    b.patch(v3(xF(t0), top(t0) - 0.01 * L, 0), v3(xF(t1), top(t1) - 0.01 * L, 0), v3(xF(t1) - sw * L * 0.6, top(t1) + h * L * 0.25, 0), v3(xF(t0) - sw * L, top(t0) + h * L, 0), finC, 5);
  }
  for (const d of p.anal ?? []) {
    const [t0, t1, h, sw] = d;
    b.patch(v3(xF(t0), bot(t0) + 0.01 * L, 0), v3(xF(t1), bot(t1) + 0.01 * L, 0), v3(xF(t1) - sw * L * 0.6, bot(t1) - h * L * 0.25, 0), v3(xF(t0) - sw * L, bot(t0) - h * L, 0), finC, 4);
  }
  // pectoral fins: [t, length, droop, spread]
  if (p.pectoral) {
    const [t, len, droop, spread] = p.pectoral;
    for (const side of [-1, 1]) {
      const y = yc(t) - hF(t) * 0.18, z = side * wF(t) * 0.42;
      const a = v3(xF(t), y, z), bb = v3(xF(t) - len * L * 0.3, y, z);
      const c = v3(xF(t) - len * L * 0.95, y - droop * len * L, z + side * spread * len * L);
      const d = v3(xF(t) - len * L * 0.55, y - droop * len * L * 0.7, z + side * spread * len * L * 1.05);
      b.patch(a, bb, c, d, finC, 5);
    }
  }
  // caudal fin
  const cf = p.caudal ?? { len: 0.2, h: 0.2, fork: 0.3, lower: 1 };
  const x0 = xF(1) + 0.012 * L, ph = Math.max(hF(1), 0.02 * L);
  const cl = cf.len * L, chh = cf.h * L, notch = cl * (cf.fork ?? 0.3);
  const lobe = (sgn, scale) => {
    const tip = cf.horizontal ? v3(x0 - cl * scale, 0, sgn * chh * scale) : v3(x0 - cl * scale, sgn * chh * scale, 0);
    const base = cf.horizontal ? v3(x0, 0, sgn * ph * 0.5) : v3(x0, sgn * ph * 0.5, 0);
    b.patch(base, v3(x0, 0, 0), v3(x0 - notch, 0, 0), tip, finC, 6);
    if (p.anatomy) for (let j = 1; j <= 8; j++) {
      const f = j / 9, end = v3(x0 - notch, 0, 0).lerp(tip, f);
      b.tube([base.clone().multiplyScalar(0.7).addScaledVector(v3(x0,0,0),0.3), end], t => L * 0.0014 * (1 - t * 0.65), finC.clone().multiplyScalar(0.65 + f * 0.2), 4);
    }
  };
  lobe(1, 1);
  lobe(-1, cf.lower ?? 1);
  return b.build();
}

// ------------------------------------------------------------------ jellyfish bell + hanging parts
export function bellGeometry({ radius = 0.5, height = 0.35, color = 0xffffff, rimGlow = null, segs = 36, lumps = 0, glowFn = null }) {
  const b = new GeoBuilder();
  const c = C(color);
  b.lathe((v) => {
    const th = v * Math.PI * 0.56;
    let r = Math.sin(th) * radius * (1 + v * 0.08);
    const h = Math.cos(th) * height - height * 0.15 + (v > 0.85 ? -(v - 0.85) * height * 0.6 : 0);
    if (lumps) r *= 1 + Math.sin(v * 40) * 0.01 * lumps;
    return [r, h];
  }, 14, c, segs, 'y', null, glowFn ?? ((v) => (rimGlow && v > 0.8 ? C(rimGlow).multiplyScalar((v - 0.8) * 5) : ZERO)));
  return b.build();
}

export function tentacleGeometry({ count = 24, radius = 0.5, length = 2, thick = 0.006, color = 0xffffff, jitter = 0.3, frill = 0, glow = null, seg = 18, y0 = -0.05 }) {
  const b = new GeoBuilder();
  const c = C(color);
  const g = glow ? C(glow) : null;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.1;
    const r = radius * (1 - Math.random() * jitter * 0.3);
    const len = length * (1 - Math.random() * jitter);
    const pts = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const wob = frill ? Math.sin(t * 30 + i) * frill * t : 0;
      pts.push(v3(Math.cos(a) * r * (1 - t * 0.25) + wob, y0 - t * len, Math.sin(a) * r * (1 - t * 0.25) + wob * 0.5));
    }
    b.tube(pts, (t) => thick * (1 - t * 0.7) * (frill ? 1 + Math.sin(t * 50 + i) * 0.5 : 1), c, 4, g ? (t) => g.clone().multiplyScalar(Math.max(0, Math.sin(t * 40 + i * 3)) ** 8) : null);
  }
  return b.build();
}

// ------------------------------------------------------------------ squid / octopus
export function squidGeometry(p) {
  const b = new GeoBuilder();
  const L = p.len ?? 1;
  const skin = C(p.color ?? 0xb0402c), light = C(p.under ?? 0xe8a090);
  const mantleL = L * (p.mantle ?? 0.45), R = L * (p.radius ?? 0.06);
  // mantle: tip at +X, opening at x = 0
  b.lathe((v) => [R * Math.pow(Math.sin(Math.min(v * 1.05, 1) * Math.PI * 0.5), 0.8) * (1 - v * 0.15), mantleL * (1 - v)], 20,
    skin, 18, 'x', (v, u) => skin.clone().lerp(light, Math.max(0, -Math.sin(u * Math.PI * 2)) * 0.6).multiplyScalar(0.85 + 0.3 * Math.random()), p.mantleGlow ?? null);
  // fins near tip
  const fl = mantleL * (p.finLen ?? 0.4), fw = R * (p.finW ?? 2.2);
  for (const s of [-1, 1]) b.patch(v3(mantleL * 0.98, 0, 0), v3(mantleL - fl, 0, s * R * 0.7), v3(mantleL - fl * 0.8, 0, s * fw), v3(mantleL * 0.9, 0, s * fw * 0.7), skin, 4);
  // head + eyes
  const hx = -R * 0.6;
  b.sphere(v3(hx, 0, 0), R * 0.9, skin, ZERO, 12, v3(1.3, 0.9, 1));
  const eyeR = R * (p.eye ?? 0.45);
  for (const s of [-1, 1]) b.sphere(v3(hx, R * 0.15, s * R * 0.75), eyeR, C(p.eyeColor ?? 0x101010), p.eyeGlow ? C(p.eyeGlow) : ZERO, 10);
  // arms trail behind (−X)
  const arms = p.arms ?? 8, armL = L * (p.armLen ?? 0.4);
  for (let i = 0; i < arms + (p.tentacles ? 2 : 0); i++) {
    const isT = i >= arms;
    const a = (i / arms) * Math.PI * 2 + (isT ? 0.4 : 0);
    const len = isT ? L * (p.tentLen ?? 0.9) : armL;
    const pts = [];
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const spread = (p.spread ?? 0.35) * t;
      pts.push(v3(hx - R * 0.8 - t * len, Math.sin(a) * R * (0.5 + spread * 3) , Math.cos(a) * R * (0.5 + spread * 3)));
    }
    b.tube(pts, (t) => R * (isT ? 0.12 : 0.28) * (1 - t * 0.85) + (isT && t > 0.85 ? R * 0.12 : 0), skin, 5, p.armGlow ? (t) => (t > 0.9 ? C(p.armGlow) : ZERO) : null);
  }
  if (p.web) {
    // umbrella web between arms (vampire squid, dumbo octopus)
    b.lathe((v) => [R * (0.6 + v * 2.6 * p.web), hx - R * 0.6 - v * armL * 0.75], 6, C(p.webColor ?? p.color), 24, 'x');
  }
  return b.build();
}

// ------------------------------------------------------------------ rays (manta)
export function rayGeometry(p) {
  const b = new GeoBuilder();
  const span = p.span ?? 1, Lc = span * (p.chord ?? 0.45);
  const top = C(p.top ?? 0x1b1d22), under = C(p.under ?? 0xe9ecef);
  const tmp = new THREE.Color();
  b.grid(40, 24, (u, v) => {
    // u around the outline, v from centre to edge (ellipse-ish delta wing)
    const a = u * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const z = sa * span * 0.5 * v;
    const sweep = Math.abs(sa) * Lc * 0.5;
    const x = ca * Lc * 0.5 * v * (1 - Math.abs(sa) * 0.45) - sweep * v * v * 0.8 + Lc * 0.12;
    const thick = Lc * 0.12 * (1 - v * v) * (1 - Math.abs(z) / span);
    return { p: v3(x, 0, z), c: top, g: ZERO, thick };
  }, true);
  // give it volume: duplicate as underside by mirroring y
  const n = b.pos.length / 3;
  for (let i = 0; i < n; i++) {
    const x = b.pos[i * 3], z = b.pos[i * 3 + 2];
    const r = Math.min(1, Math.hypot(x / (Lc * 0.6), z / (span * 0.5)));
    b.pos[i * 3 + 1] = Lc * 0.09 * (1 - r * r);
  }
  const base = b.pos.length / 3;
  for (let i = 0; i < n; i++) {
    b.pos.push(b.pos[i * 3], -b.pos[i * 3 + 1] * 0.6, b.pos[i * 3 + 2]);
    const z = b.pos[i * 3 + 2];
    tmp.copy(under).lerp(top, Math.min(1, Math.abs(z) / (span * 0.5)) ** 4 * 0.6);
    b.col.push(tmp.r, tmp.g, tmp.b); b.glow.push(0, 0, 0);
  }
  const triCount = b.idx.length;
  for (let i = 0; i < triCount; i += 3) b.idx.push(b.idx[i] + base, b.idx[i + 2] + base, b.idx[i + 1] + base);
  // cephalic lobes + tail
  for (const s of [-1, 1]) b.patch(v3(Lc * 0.5, 0, s * Lc * 0.12), v3(Lc * 0.5, 0, s * Lc * 0.22), v3(Lc * 0.78, -Lc * 0.05, s * Lc * 0.2), v3(Lc * 0.78, -Lc * 0.05, s * Lc * 0.13), top, 3);
  const tail = [];
  for (let k = 0; k <= 12; k++) tail.push(v3(-Lc * 0.35 - k / 12 * Lc * (p.tail ?? 0.6), 0, 0));
  b.tube(tail, (t) => Lc * 0.025 * (1 - t * 0.9), top, 5);
  for (const s of [-1, 1]) b.sphere(v3(Lc * 0.45, Lc * 0.02, s * Lc * 0.2), Lc * 0.02, C(0x050505));
  return b.build();
}

// ------------------------------------------------------------------ sea turtle
export function turtleGeometry() {
  const b = new GeoBuilder();
  const shell = C(0x4a3b26), skin = C(0x6f6a52), plastron = C(0xd8c99a);
  const tmp = new THREE.Color();
  b.grid(28, 16, (u, v) => {
    const th = u * Math.PI * 2, ph = v * Math.PI;
    const s = Math.cos(ph);
    const x = Math.sin(ph) * Math.cos(th) * 0.5, z = Math.sin(ph) * Math.sin(th) * 0.4;
    const y = s > 0 ? s * 0.17 : s * 0.07;
    const scute = (Math.sin(x * 22) * Math.sin(z * 26)) > 0.2 ? 0.75 : 1;
    tmp.copy(s > 0 ? shell : plastron).multiplyScalar(s > 0 ? scute * (0.8 + Math.random() * 0.3) : 1);
    return { p: v3(x, y, z), c: tmp.clone() };
  }, true);
  b.sphere(v3(0.58, 0.02, 0), 0.1, skin, ZERO, 10, v3(1.3, 0.8, 0.85));
  for (const s of [-1, 1]) b.sphere(v3(0.66, 0.06, s * 0.065), 0.018, C(0x050505), ZERO, 6);
  for (const s of [-1, 1]) {
    b.patch(v3(0.25, -0.02, s * 0.3), v3(0.1, -0.02, s * 0.33), v3(-0.05, -0.05, s * 0.85), v3(0.12, -0.04, s * 0.8), skin, 5);
    b.patch(v3(-0.35, -0.02, s * 0.2), v3(-0.45, -0.02, s * 0.15), v3(-0.62, -0.03, s * 0.32), v3(-0.5, -0.03, s * 0.36), skin, 3);
  }
  return b.build();
}

export { C, v3, ZERO };
