// Human skeletons for the wreck interiors. Bones are laid along a posed set of joints, nudged and partly
// scattered the way remains settle after decades in cold, still water, with the leather shoes that outlast them.
// Local frame: floor at y = 0, lying bodies have the head towards +X.
import * as THREE from 'three';
import { GeoBuilder, C, v3, ZERO } from './builders.js';
import { rng } from './common.js';

// a century in iron-rich water leaves bone tea-stained, not white
const BONE = C(0xa8977a), STAIN = C(0x6a4a2c), HOLLOW = C(0x0c0906), TOOTH = C(0xa89c7c), LEATHER = C(0x2b1d13);

// basis with x = fwd, y = up (orthogonalised), positioned at pos
function frame(pos, fwd, up) {
  const x = fwd.clone().normalize();
  const y = up.clone().addScaledVector(x, -up.dot(x)).normalize();
  return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)).setPosition(pos);
}
const perp = (d) => (Math.abs(d.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0)).cross(d).normalize();

export function longBone(b, a, c, rad, col) {
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push(a.clone().lerp(c, i / 6));
  b.tube(pts, (t) => rad * (1 + 0.5 * Math.pow(Math.abs(t * 2 - 1), 4)), col, 7);
  b.sphere(a, rad * 1.65, col, ZERO, 8, v3(1, 0.85, 1));
  b.sphere(c, rad * 1.45, col, ZERO, 8, v3(1, 0.85, 1));
}

export function skullGeo(col, jawOpen) {
  const b = new GeoBuilder();
  b.sphere(v3(-0.012, 0.03, 0), 0.098, col, ZERO, 18, v3(1.02, 0.86, 0.8));     // cranium
  b.sphere(v3(0.022, 0.05, 0), 0.08, col, ZERO, 12, v3(0.95, 0.75, 0.82));      // frontal bone
  b.sphere(v3(0.05, -0.035, 0), 0.056, col, ZERO, 12, v3(0.85, 0.95, 1.12));    // face
  for (const s of [-1, 1]) {
    b.sphere(v3(0.085, -0.002, s * 0.031), 0.02, HOLLOW, ZERO, 8, v3(0.7, 0.9, 1));   // orbits
    b.tube([v3(0.06, -0.03, s * 0.05), v3(0.02, -0.03, s * 0.067), v3(-0.02, -0.025, s * 0.064)], () => 0.008, col, 5);
  }
  b.sphere(v3(0.1, -0.034, 0), 0.011, HOLLOW, ZERO, 6, v3(0.6, 1.4, 0.8));         // nasal aperture
  for (let i = 0; i < 12; i++) { const a = (i / 11 - 0.5) * 2.2; b.sphere(v3(0.046 + Math.cos(a) * 0.045, -0.075, Math.sin(a) * 0.03), 0.0056, TOOTH, ZERO, 5, v3(1, 1.4, 1)); }
  // mandible, hinged under the ear
  const hinge = v3(-0.02, -0.035, 0), rot = new THREE.Matrix4().makeRotationZ(-jawOpen);
  const J = (x, y, z) => v3(x, y, z).sub(hinge).applyMatrix4(rot).add(hinge);
  for (const s of [-1, 1]) b.tube([J(-0.02, -0.035, s * 0.052), J(-0.012, -0.085, s * 0.048), J(0.03, -0.1, s * 0.035), J(0.075, -0.106, s * 0.012), J(0.083, -0.105, 0)], (t) => 0.009 + t * 0.002, col, 6);
  for (let i = 0; i < 10; i++) { const a = (i / 9 - 0.5) * 2.0; b.sphere(J(0.046 + Math.cos(a) * 0.036, -0.089, Math.sin(a) * 0.026), 0.005, TOOTH, ZERO, 5); }
  return b;
}

function pelvisGeo(col) {
  const b = new GeoBuilder();
  b.sphere(v3(-0.035, 0.0, 0), 0.045, col, ZERO, 10, v3(0.7, 1.25, 1));          // sacrum
  for (const s of [-1, 1]) {
    b.sphere(v3(-0.005, 0.05, s * 0.085), 0.075, col, ZERO, 12, v3(0.5, 0.85, 0.55)); // iliac wings
    b.tube([v3(-0.01, -0.01, s * 0.08), v3(0.02, -0.07, s * 0.06), v3(0.07, -0.06, s * 0.03)], () => 0.012, col, 6);  // ischium → pubis
    b.sphere(v3(0.0, -0.025, s * 0.1), 0.026, col, ZERO, 8);                     // acetabulum rim
  }
  b.tube([v3(0.07, -0.06, -0.03), v3(0.085, -0.055, 0), v3(0.07, -0.06, 0.03)], () => 0.012, col, 6);  // pubic symphysis
  return b;
}

// ribs, sternum, clavicles, spine and pelvis from the trunk joints
function trunk(b, J, r, col, o) {
  const curve = new THREE.CatmullRomCurve3([J.pelvis, J.lumbar, J.chest, J.neck]);
  const back = J.front.clone().negate();
  for (let i = 0; i <= 22; i++) {
    const t = i / 22, p = curve.getPoint(t), tan = curve.getTangent(t);
    b.sphere(p, 0.022 - t * 0.008, col, ZERO, 7, v3(1, 0.85, 1));
    const bk = back.clone().addScaledVector(tan, -back.dot(tan)).normalize();
    b.tube([p, p.clone().addScaledVector(bk, 0.032 - t * 0.012).addScaledVector(tan, -0.012)], (tt) => 0.006 * (1 - tt * 0.5), col, 4);
  }
  const up = J.chest.clone().sub(J.lumbar).normalize();
  const fr = J.front.clone().addScaledVector(up, -J.front.dot(up)).normalize();
  const lat = up.clone().cross(fr).normalize();
  const flat = o.collapse;
  let stTop = null, stBot = null;
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const sp = J.chest.clone().lerp(J.lumbar, 0.06 + t * 0.62);
    const rx = 0.075 + 0.07 * Math.sin(Math.PI * (0.2 + 0.65 * t));
    const ry = (0.06 + 0.06 * Math.sin(Math.PI * (0.15 + 0.6 * t))) * flat;
    const tMax = i < 7 ? 0.95 : i < 10 ? 0.75 : 0.45;
    const drop = 0.03 + 0.05 * t;
    const at = (s, th) => sp.clone().addScaledVector(lat, s * rx * Math.sin(th)).addScaledVector(fr, ry * (1 - Math.cos(th)) - 0.02).addScaledVector(up, -drop * (th / Math.PI) - 0.01);
    if (i === 0) stTop = at(1, Math.PI);
    if (i === 6) stBot = at(1, Math.PI);
    for (const s of [-1, 1]) {
      if (r() < o.missing) continue;
      const end = tMax * (r() < o.missing ? 0.4 + r() * 0.4 : 1);   // some broken short
      const pts = [];
      for (let k = 0; k <= 9; k++) pts.push(at(s, (k / 9) * Math.PI * end));
      b.tube(pts, (tt) => 0.0068 * (1 - tt * 0.35), col, 4);
    }
  }
  b.tube([stTop, stTop.clone().lerp(stBot, 0.5).addScaledVector(fr, 0.006), stBot], (t) => 0.014 - t * 0.005, col, 5);
  for (const [sh, s] of [[J.shL, -1], [J.shR, 1]]) {
    const base = J.chest.clone().addScaledVector(fr, 0.05 * flat + 0.02).addScaledVector(lat, s * 0.02);
    b.tube([base, base.clone().lerp(sh, 0.5).addScaledVector(up, 0.012), sh], () => 0.008, col, 5);    // clavicle
    const a = sh.clone().addScaledVector(fr, -0.05), c = J.chest.clone().lerp(J.lumbar, 0.35).addScaledVector(fr, -0.06).addScaledVector(lat, s * 0.06);
    b.patch(a, a.clone().addScaledVector(up, -0.05).lerp(J.chest, 0.4), c, a.clone().lerp(c, 0.5).addScaledVector(lat, s * 0.05), col, 3);  // scapula
  }
  b.merge(pelvisGeo(col), frame(J.pelvis, fr, up));
}

function limb(b, a, mid, end, r0, r1, col, twin) {
  longBone(b, a, mid, r0, col);
  if (twin) {
    const d = end.clone().sub(mid).normalize(), side = perp(d).multiplyScalar(r1 * 1.6);
    longBone(b, mid.clone().add(side), end.clone().add(side), r1, col);
    longBone(b, mid.clone().sub(side), end.clone().sub(side), r1 * 0.75, col);
  } else longBone(b, mid, end, r1, col);
}

function hand(b, wrist, dir, col, r) {
  const d = dir.clone().normalize(), s = perp(d);
  b.sphere(wrist.clone().addScaledVector(d, 0.02), 0.018, col, ZERO, 6, v3(1, 0.6, 1));
  for (let f = 0; f < 5; f++) {
    if (r() < 0.25) continue;
    const spread = (f - 2) * 0.016, len = f === 0 ? 0.06 : 0.085 - Math.abs(f - 2) * 0.008;
    const p0 = wrist.clone().addScaledVector(d, 0.03).addScaledVector(s, spread);
    const p1 = p0.clone().addScaledVector(d, len * 0.55).addScaledVector(s, spread * 0.5);
    const p2 = p1.clone().addScaledVector(d, len * 0.45).addScaledVector(s, spread * 0.3);
    p1.y = Math.max(p1.y, 0.006); p2.y = Math.max(p2.y, 0.005);
    b.tube([p0, p1, p2], (t) => 0.0045 * (1 - t * 0.4), col, 4);
  }
}

function foot(b, sh, ankle, toe, col, r, shoes) {
  const d = toe.clone().sub(ankle).normalize(), s = perp(d);
  if (shoes) {
    // the leather survives long after the foot inside it is gone
    const sb = new GeoBuilder();
    sb.sphere(v3(0.06, 0, 0), 0.135, LEATHER.clone().multiplyScalar(0.8 + r() * 0.4), ZERO, 12, v3(1, 0.42, 0.4));
    sb.sphere(v3(0.07, -0.045, 0), 0.14, C(0x18110b), ZERO, 10, v3(1.02, 0.12, 0.42));   // sole
    sb.lathe((v) => [0.045 + v * 0.008, v * 0.11], 3, LEATHER, 10);                        // ankle collar
    sh.merge(sb, frame(ankle.clone().addScaledVector(d, 0.02), d, v3(0, 1, 0)));
    return;
  }
  b.sphere(ankle.clone().addScaledVector(d, -0.03), 0.03, col, ZERO, 7, v3(1.2, 0.8, 0.9));   // heel
  for (let t = 0; t < 5; t++) {
    if (r() < 0.3) continue;
    const p0 = ankle.clone().addScaledVector(s, (t - 2) * 0.012), p1 = toe.clone().addScaledVector(s, (t - 2) * 0.02);
    b.tube([p0, p1], () => 0.005, col, 4);
  }
}

// ---------------------------------------------------------------- poses
const J0 = () => ({});
function sym(J, key, fn) { J[key + 'L'] = fn(-1); J[key + 'R'] = fn(1); }

function supine(r) {
  const J = J0();
  J.pelvis = v3(0, 0.1, 0); J.lumbar = v3(0.2, 0.075, 0); J.chest = v3(0.47, 0.085, 0); J.neck = v3(0.57, 0.08, 0);
  J.head = v3(0.68, 0.09, 0); J.headF = v3(0.15, 1, (r() - 0.5) * 1.8); J.headU = v3(1, 0, 0); J.front = v3(0, 1, 0);
  const arm = r(), splay = r() < 0.4;
  sym(J, 'sh', (s) => v3(0.44, 0.07, s * 0.18));
  sym(J, 'el', (s) => (arm < 0.45 ? v3(0.18, 0.05, s * 0.25) : arm < 0.7 ? v3(0.22, 0.09, s * 0.24) : v3(0.68, 0.05, s * 0.36)));
  sym(J, 'wr', (s) => (arm < 0.45 ? v3(-0.07, 0.04, s * 0.28) : arm < 0.7 ? v3(0.33, 0.16, s * 0.06) : v3(0.9, 0.04, s * 0.46)));
  sym(J, 'hip', (s) => v3(-0.01, 0.08, s * 0.09));
  sym(J, 'kn', (s) => v3(-0.44, 0.065, s * (splay ? 0.22 : 0.11)));
  sym(J, 'an', (s) => v3(-0.85, 0.06, s * (splay ? 0.32 : 0.13)));
  sym(J, 'to', (s) => J['an' + (s < 0 ? 'L' : 'R')].clone().add(v3(-0.03, 0.05, s * 0.14)));
  return J;
}
function prone(r) {
  const J = supine(r);
  J.front = v3(0, -1, 0);
  const s0 = r() < 0.5 ? -1 : 1;
  J.headF = v3(0.2, -0.45, s0 * 0.85); J.head.y = 0.085;
  sym(J, 'el', (s) => v3(0.6, 0.05, s * 0.3));
  sym(J, 'wr', (s) => v3(0.78, 0.04, s * 0.14));
  sym(J, 'to', (s) => J['an' + (s < 0 ? 'L' : 'R')].clone().add(v3(-0.13, -0.01, s * 0.03)));
  return J;
}
function curled(r) {
  // on the right side, knees drawn up towards the chest
  const J = J0();
  J.pelvis = v3(0, 0.1, 0); J.lumbar = v3(0.19, 0.1, 0.04); J.chest = v3(0.45, 0.1, 0.07); J.neck = v3(0.55, 0.1, 0.09);
  J.head = v3(0.66, 0.09, 0.12); J.headF = v3(0.3, 0.05, 1); J.headU = v3(1, 0.1, -0.15); J.front = v3(0, 0.1, 1);
  J.shL = v3(0.43, 0.2, 0.08); J.shR = v3(0.43, 0.05, 0.02);
  J.elL = v3(0.35, 0.15, 0.32); J.elR = v3(0.6, 0.05, 0.27);
  J.wrL = v3(0.52, 0.09, 0.47); J.wrR = v3(0.76, 0.04, 0.38);
  J.hipL = v3(0, 0.16, 0.05); J.hipR = v3(0, 0.06, -0.01);
  J.knL = v3(-0.1, 0.13, 0.43); J.knR = v3(-0.15, 0.06, 0.38);
  J.anL = v3(-0.44, 0.09, 0.45); J.anR = v3(-0.5, 0.05, 0.36);
  J.toL = J.anL.clone().add(v3(-0.04, 0.0, 0.13)); J.toR = J.anR.clone().add(v3(-0.04, 0.0, 0.13));
  return J;
}
function sitting(r) {
  // slumped against a bulkhead behind it (at x ≈ -0.22), facing +X
  const J = J0();
  J.pelvis = v3(0, 0.11, 0); J.lumbar = v3(-0.07, 0.32, 0); J.chest = v3(-0.13, 0.6, 0); J.neck = v3(-0.1, 0.7, 0);
  J.head = v3(-0.02, 0.76, (r() - 0.5) * 0.1); J.headF = v3(1, -0.9, (r() - 0.5) * 0.9); J.headU = v3(0.5, 0.85, 0); J.front = v3(1, 0.2, 0);
  const lap = r() < 0.4, kneeUp = r() < 0.4;
  sym(J, 'sh', (s) => v3(-0.12, 0.56, s * 0.18));
  sym(J, 'el', (s) => (lap ? v3(0.0, 0.3, s * 0.22) : v3(-0.06, 0.3, s * 0.27)));
  sym(J, 'wr', (s) => (lap ? v3(0.22, 0.16, s * 0.08) : v3(0.1, 0.07, s * 0.32)));
  sym(J, 'hip', (s) => v3(0.02, 0.09, s * 0.09));
  sym(J, 'kn', (s) => (kneeUp && s > 0 ? v3(0.33, 0.42, 0.13) : v3(0.45, 0.11, s * 0.12)));
  sym(J, 'an', (s) => (kneeUp && s > 0 ? v3(0.62, 0.07, 0.15) : v3(0.87, 0.07, s * 0.15)));
  sym(J, 'to', (s) => J['an' + (s < 0 ? 'L' : 'R')].clone().add(v3(0.06, 0.12, s * 0.04)));
  return J;
}
const POSES = { supine, prone, curled, sitting };

// a skeleton fully come apart: bones lying in a loose drift
function scattered(b, sh, r, col) {
  const at = () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.75; return v3(Math.cos(a) * d, 0, Math.sin(a) * d); };
  const lay = (len, rad) => {
    const c = at(), a = r() * Math.PI, h = v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(len / 2);
    longBone(b, c.clone().sub(h).setY(rad * 1.6), c.clone().add(h).setY(rad * 1.5), rad, col);
  };
  for (const [len, rad, n] of [[0.45, 0.015, 2], [0.38, 0.012, 2], [0.32, 0.011, 2], [0.26, 0.008, 3]]) for (let i = 0; i < n; i++) if (r() > 0.15) lay(len, rad);
  for (let i = 0; i < 9; i++) {
    const c = at(), a = r() * Math.PI * 2, pts = [];
    for (let k = 0; k <= 8; k++) { const th = (k / 8) * 2.2; pts.push(c.clone().add(v3(Math.cos(a + th) * 0.13, 0.008 + Math.sin(k / 8 * Math.PI) * 0.02, Math.sin(a + th) * 0.13))); }
    b.tube(pts, () => 0.0065, col, 4);
  }
  const sp = at(), sa = r() * Math.PI;
  for (let i = 0; i < 12; i++) b.sphere(sp.clone().add(v3(Math.cos(sa + i * 0.06) * i * 0.04, 0.018, Math.sin(sa + i * 0.06) * i * 0.04)), 0.02, col, ZERO, 7, v3(1, 0.8, 1));
  const pc = at();
  b.merge(pelvisGeo(col), frame(pc.setY(0.06), v3(r() - 0.5, 0.2, r() - 0.5), v3(r() - 0.5, 1, r() - 0.5)));
  const sk = at();
  b.merge(skullGeo(col, 0.3 + r() * 0.3), frame(sk.setY(0.085), v3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5), v3(r() - 0.5, 1, r() - 0.5)));
  if (r() < 0.6) { const p = at(); foot(b, sh, p.setY(0.06), p.clone().add(v3(0.2, 0, 0.05)), col, r, true); }
}

/**
 * pose: 'supine' | 'prone' | 'curled' | 'sitting' | 'scattered'. Returns { bone, shoe } GeoBuilders in skeleton-local space.
 */
export function skeleton(pose, seed) {
  const r = rng(seed * 7919 + 13);
  const col = BONE.clone().lerp(STAIN, r() * 0.5).multiplyScalar(0.8 + r() * 0.2);
  const b = new GeoBuilder(), sh = new GeoBuilder();
  if (pose === 'scattered' || !POSES[pose]) { scattered(b, sh, r, col); return { bone: b, shoe: sh }; }
  const J = POSES[pose](r);
  // settling: every joint shifts a little
  for (const k of Object.keys(J)) if (!['front', 'headF', 'headU'].includes(k)) J[k].add(v3((r() - 0.5) * 0.04, (r() - 0.5) * 0.015, (r() - 0.5) * 0.04));
  trunk(b, J, r, col, { collapse: pose === 'sitting' ? 0.9 : 0.55 + r() * 0.25, missing: 0.12 });
  // the skull often rolls away from the neck
  let hp = J.head, hf = J.headF, hu = J.headU;
  if (r() < 0.3) { hp = J.head.clone().add(v3((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5)).setY(0.085); hf = v3(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5); hu = v3(r() - 0.5, 1, r() - 0.5); }
  b.merge(skullGeo(col, 0.1 + r() * 0.35), frame(hp, hf, hu));
  const shoes = r() < 0.7;
  for (const s of ['L', 'R']) {
    limb(b, J['sh' + s], J['el' + s], J['wr' + s], 0.011, 0.007, col, true);
    if (r() > 0.2) hand(b, J['wr' + s], J['wr' + s].clone().sub(J['el' + s]), col, r);
    limb(b, J['hip' + s], J['kn' + s], J['an' + s], 0.015, 0.011, col, true);
    b.sphere(J['kn' + s].clone().add(J.front.clone().multiplyScalar(0.025)), 0.022, col, ZERO, 7, v3(1, 0.6, 1));   // patella
    foot(b, sh, J['an' + s], J['to' + s], col, r, shoes);
  }
  // nothing rests below the floor it settled on
  for (const g of [b, sh]) for (let i = 1; i < g.pos.length; i += 3) g.pos[i] = Math.max(g.pos[i], 0.004);
  return { bone: b, shoe: sh };
}
