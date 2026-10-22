// Surface gulls: shared geometry, separate wing joints, and calls on the Web Audio clock.
import * as THREE from 'three';
import { DAY } from './common.js';
import { GeoBuilder } from './builders.js';

export const birdDaylight = () => THREE.MathUtils.smoothstep(DAY.elevation, 0, 5);

export function createBirds({ scene, camera, mods }) {
  const root = new THREE.Group();
  root.name = 'Daytime gulls';
  scene.add(root);
  const white = new THREE.Color(0xe8edf0), gray = new THREE.Color(0x9ba9b3);
  const black = new THREE.Color(0x283038), gold = new THREE.Color(0xd7a64b);
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, forceSinglePass: true });
  // +Z faces forward; a real gull-sized body and swept, black-tipped wings.
  const body = new GeoBuilder();
  body.sphere(v(0, 0, 0), 1, white, undefined, 12, v(0.17, 0.19, 0.46));
  body.sphere(v(0, 0.13, 0.39), 1, white, undefined, 10, v(0.13, 0.14, 0.16));
  for (const s of [-1, 1]) body.sphere(v(s * 0.116, 0.18, 0.44), 0.024, black, undefined, 6);
  body.patch(v(-0.10, 0.03, -0.32), v(0.10, 0.03, -0.32), v(0.23, 0.01, -0.75), v(-0.23, 0.01, -0.75), white, 1);
  body.patch(v(-0.045, 0.11, 0.49), v(0.045, 0.11, 0.49), v(0, 0.09, 0.74), v(0, 0.15, 0.55), gold, 1);
  const bodyGeo = body.build();
  const jaw = new GeoBuilder();
  jaw.patch(v(-0.038, 0, 0), v(0.038, 0, 0), v(0, -0.02, 0.24), v(0, -0.04, 0.05), gold, 1);
  const jawGeo = jaw.build();
  const wingGeos = [-1, 1].map(s => {
    const b = new GeoBuilder();
    b.patch(v(0, 0, 0.18), v(0, 0, -0.25), v(s * 0.61, 0.06, -0.24), v(s * 0.65, 0.06, 0.08), gray, 3);
    b.patch(v(s * 0.65, 0.06, 0.08), v(s * 0.61, 0.06, -0.24), v(s * 1.01, -0.01, -0.34), v(s * 1.08, -0.01, -0.12), white, 2);
    b.patch(v(s * 1.08, -0.01, -0.12), v(s * 1.01, -0.01, -0.34), v(s * 1.28, -0.06, -0.48), v(s * 1.39, -0.06, -0.34), black, 2);
    return b.build();
  });
  const flock = Array.from({ length: 10 }, (_, i) => {
    const mesh = new THREE.Group();
    mesh.name = `Gull ${i + 1}`;
    mesh.add(new THREE.Mesh(bodyGeo, material));
    const beak = new THREE.Mesh(jawGeo, material);
    beak.position.set(0, 0.09, 0.5);
    mesh.add(beak);
    const wings = wingGeos.map((geometry, j) => {
      const wing = new THREE.Mesh(geometry, material);
      wing.position.set(j === 0 ? -0.1 : 0.1, 0.08, 0);
      mesh.add(wing);
      return wing;
    });
    mesh.scale.setScalar(0.9 + (i % 3) * 0.12);
    root.add(mesh);
    return { mesh, beak, wings, phase: i * 2.39996, radius: 28 + i * 7, height: 11 + (i % 4) * 6,
      rate: (i % 2 ? -1 : 1) * (0.075 + (i % 3) * 0.012), notes: [] };
  });
  const center = v(camera.position.x, 0, camera.position.z - 25);
  const local = v(0, 0, 0), projected = v(0, 0, 0);
  let daylight = 1;

  function update(info) {
    daylight = birdDaylight();
    root.visible = !info.under && daylight > 0;
    // Follow the explored stretch of ocean slowly; never rotate the flock with the view.
    const follow = 1 - Math.exp(-info.dt * 0.08);
    center.x += (camera.position.x - center.x) * follow;
    center.z += (camera.position.z - 25 - center.z) * follow;
    if (material.transparent !== (daylight < 1)) {
      material.transparent = daylight < 1;
      material.needsUpdate = true;
    }
    material.opacity = daylight;
    material.depthWrite = daylight === 1;
    const audioTime = mods?.audio?.currentTime ?? 0;
    for (const bird of flock) {
      const a = info.time * bird.rate + bird.phase;
      const bob = info.time * 0.7 + bird.phase;
      bird.mesh.position.set(center.x + Math.cos(a) * bird.radius,
        bird.height + Math.sin(bob) * 2.2 + (1 - daylight) * 35,
        center.z + Math.sin(a) * bird.radius * 0.72);
      bird.mesh.rotation.set(0, Math.atan2(-Math.sin(a) * bird.rate, Math.cos(a) * bird.rate * 0.72), -bird.rate * 1.5, 'YXZ');
      bird.notes = bird.notes.filter(note => audioTime < note.end);
      let calling = 0;
      for (const note of bird.notes) if (audioTime >= note.start && audioTime <= note.end) {
        calling = Math.min(1, (audioTime - note.start) / 0.03, (note.end - audioTime) / 0.06);
      }
      bird.beak.rotation.x = calling * 0.65;
      bird.mesh.rotation.x = -calling * 0.12;
      const burst = THREE.MathUtils.smoothstep(Math.sin(info.time * 0.65 + bird.phase), 0.25, 0.7);
      const flap = Math.sin(info.time * (6.5 + (bird.radius % 3) * 0.3) + bird.phase) * (0.08 + burst * 0.48 + calling * 0.12);
      bird.wings[0].rotation.z = -0.08 - flap;
      bird.wings[1].rotation.z = 0.08 + flap;
    }
    root.updateMatrixWorld(true);
  }

  function spatial(bird) {
    local.copy(bird.mesh.position).applyMatrix4(camera.matrixWorldInverse);
    return { pan: THREE.MathUtils.clamp(local.x / Math.max(Math.hypot(local.x, local.z), 1), -1, 1),
      level: THREE.MathUtils.clamp(35 / Math.max(local.length(), 1), 0.15, 1) };
  }
  function pickCaller() {
    if (!root.visible || daylight <= 0.03) return null;
    const visible = flock.filter(bird => {
      projected.copy(bird.mesh.position).project(camera);
      return Math.abs(projected.x) < 0.92 && Math.abs(projected.y) < 0.92 && projected.z > -1 && projected.z < 1;
    });
    return visible.length ? visible[Math.floor(Math.random() * visible.length)] : null;
  }
  return { root, flock, update, spatial, pickCaller, get daylight() { return daylight; } };
}
