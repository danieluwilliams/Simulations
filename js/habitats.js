// Tropical oceanic bank: sunlight reefs, a mesophotic terrace, and flooded limestone caves.
// Depths follow NOAA's shallow (<30 m) and mesophotic (30–150 m) habitat ranges.
import * as THREE from 'three';

export const REEF_BANKS = [
  { id: 'reef', name: 'Prismatic Reef', x: -48, z: -620, rx: 155, rz: 180, depth: 26, seed: 410, colonies: 620 },
  { id: 'terrace', name: 'Twilight Coral Terrace', x: 266, z: -790, rx: 138, rz: 170, depth: 126, seed: 820, colonies: 430 },
  { id: 'cave-bank', name: 'Limestone Bank', x: 104, z: -820, rx: 112, rz: 178, depth: 99, seed: 932, colonies: 0 },
];

export const CAVE_SITES = [
  { id: 'caves', name: 'Cathedral Caverns', x: 96, z: -697, length: 224, depth: 60, width: 24, height: 20, seed: 72, skylight: true },
  { id: 'grotto', name: 'Azure Grotto', x: 277, z: -761, length: 154, depth: 101, width: 21, height: 17, seed: 94, skylight: false },
];

export function bankHeight(bank, x, z) {
  const dx = (x - bank.x) / bank.rx, dz = (z - bank.z) / bank.rz;
  const r = Math.hypot(dx, dz);
  if (r >= 1.28) return -Infinity;
  const ledge = -bank.depth + Math.sin(x * 0.047 + z * 0.021) * 2.1 + Math.sin(z * 0.083) * 0.8;
  const drop = THREE.MathUtils.smoothstep(r, 0.63, 1.28);
  return ledge - drop * drop * (3800 - bank.depth);
}

export function reefHeightAt(x, z) {
  let h = -Infinity;
  for (const b of REEF_BANKS) h = Math.max(h, bankHeight(b, x, z));
  return h;
}

// The same analytic section drives the rendered shell, animal placement, and collision.
// A gently curving 48–76 m wide passage opens into a cathedral-sized central chamber.
export function caveSection(cave, t) {
  const s = Math.sin(Math.PI * t), chamber = s * s;
  return {
    x: cave.x + Math.sin(t * Math.PI * 2) * 9,
    y: -cave.depth - s * 7,
    z: cave.z - t * cave.length,
    rx: cave.width + chamber * 14,
    ry: cave.height + chamber * 8,
  };
}

export function caveSkylight(cave, t, nx, ny) {
  return cave.skylight && t > 0.43 && t < 0.57 && Math.abs(nx) < 0.32 && ny > 0.9;
}

// Dissolution scallops and bedding folds shared by the mesh and collision shell.
export function caveRadii(cave, t, angle) {
  const s = caveSection(cave, t);
  const fade = 0.35 + 0.65 * Math.sin(Math.PI * t);
  const offset = fade * (Math.sin(angle * 3 + t * 19 + cave.seed) * 1.2
    + Math.sin(angle * 7 - t * 31) * 0.65 + Math.cos(angle * 13 + t * 57) * 0.28);
  return { rx: s.rx + offset, ry: s.ry + offset };
}

export function caveSurface(cave, t, angle, inset = 0) {
  const s = caveSection(cave, t), r = caveRadii(cave, t, angle);
  return new THREE.Vector3(s.x + Math.cos(angle) * (r.rx - inset), s.y + Math.sin(angle) * (r.ry - inset), s.z);
}

export function caveAt(position) {
  for (const cave of CAVE_SITES) {
    const t = (cave.z - position.z) / cave.length;
    if (t <= 0 || t >= 1) continue;
    const s = caveSection(cave, t);
    const nx = (position.x - s.x) / s.rx, ny = (position.y - s.y) / s.ry;
    const r = caveRadii(cave, t, Math.atan2(ny, nx));
    if (Math.hypot((position.x - s.x) / r.rx, (position.y - s.y) / r.ry) < 1) return cave;
  }
  return null;
}

export const HABITAT_WAYPOINTS = [
  { id: 'reef', label: 'Coral reef', depth: 18, pos: [-48, -18, -552] },
  { id: 'caves', label: 'Cathedral caves', depth: 60, pos: [96, -60, -689] },
  { id: 'terrace', label: 'Coral terrace', depth: 113, pos: [237, -113, -732] },
  { id: 'grotto', label: 'Azure grotto', depth: 101, pos: [277, -101, -753] },
];
