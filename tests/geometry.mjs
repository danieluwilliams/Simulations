// Run with: node --experimental-vm-modules tests/geometry.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map();
const files = (await fs.readdir(path.join(root, 'js'))).filter(f => f.endsWith('.js')).map(f => path.join(root, 'js', f));
files.push(path.join(root, 'tests/vendor/three.module.js'));
for (const file of files) modules.set(file, new vm.SourceTextModule(await fs.readFile(file, 'utf8'), { identifier: file }));
const link = (specifier, parent) => modules.get(specifier === 'three' ? path.join(root, 'tests/vendor/three.module.js') : path.resolve(path.dirname(parent.identifier), specifier));
async function load(file) {
  const mod = modules.get(path.join(root, file));
  if (mod.status === 'unlinked') await mod.link(link);
  if (mod.status === 'linked') await mod.evaluate();
  return mod.namespace;
}
const T = await load('tests/vendor/three.module.js');
const { Kit } = await load('js/shipkit.js');
const { createReefs } = await load('js/reefs.js');
const { createSeafloor } = await load('js/seafloor.js');
const { createWrecks } = await load('js/wrecks.js');
const { CAVE_SITES, caveSection, caveSurface, caveAt } = await load('js/habitats.js');
const { spatialChunks } = await load('js/chunks.js');
const original = new T.SphereGeometry(20, 64, 48);
const sourceTriangles = original.index.count;
const chunks = spatialChunks(original, 8);
assert.ok(chunks.length > 12, 'spatial partitioning');
assert.equal(chunks.reduce((n, g) => n + g.index.count, 0), sourceTriangles, 'partition preserves every triangle');
for (const chunk of chunks) assert.ok(chunk.boundingSphere && chunk.attributes.normal.array.every(Number.isFinite), 'partition preserves normals');

// Different seeds, orientations and deck elevations must keep fallen chairs supported.
for (let seed = 1; seed <= 24; seed++) {
  const k = new Kit('Chair regression', seed), floor = -seed * 0.5;
  k.chair(2, floor, -3, seed * 0.4);
  let minY = Infinity, n = 0;
  for (const part of Object.values(k.parts)) {
    const geo = part.build();
    for (const attribute of ['position', 'normal']) assert.ok(geo.attributes[attribute].array.every(Number.isFinite), `${attribute}: chair ${seed}`);
    for (let i = 1; i < part.pos.length; i += 3) minY = Math.min(minY, part.pos[i]);
    n += part.pos.length;
  }
  assert.ok(minY >= floor - 1e-5 && minY < floor + 0.04, `chair ${seed}: supported`);
  assert.ok(n > 2500 && k.parts.iron, `chair ${seed}: timber and joinery`);
}

const ctx = { scene: new T.Scene(), camera: new T.PerspectiveCamera(), renderer: { domElement: { height: 800 } } };
const reefs = createReefs(ctx);
let triangles = 0, meshes = 0;
ctx.scene.traverse(m => {
  if (!m.geometry) return;
  meshes++;
  for (const attribute of ['position', 'normal']) if (m.geometry.attributes[attribute]) assert.ok(m.geometry.attributes[attribute].array.every(Number.isFinite), `${attribute}: ${m.name}`);
  if (m.geometry.index) triangles += m.geometry.index.count / 3;
});
for (const cave of CAVE_SITES) {
  for (const t of [0.04, 0.21, 0.38, 0.65, 0.91]) {
    const s = caveSection(cave, t), center = new T.Vector3(s.x, s.y, s.z);
    assert.equal(caveAt(center), cave);
    assert.equal(reefs.isRock(center, 1.7), false);
    for (const a of [0, 0.5, 2.5, Math.PI]) {
      const p = caveSurface(cave, t, a);
      assert.ok(reefs.isRock(p, 0.3), `${cave.id}: mesh matches collision`);
    }
    const proposed = center.clone().add(new T.Vector3(75,0,0)), velocity = new T.Vector3(120,0,0);
    reefs.collide(proposed, velocity, center);
    assert.ok(proposed.distanceTo(center) < 50 && velocity.length() === 0, 'swept collision');
  }
}
console.log(`PASS: 24 grounded chair variants; finite reef geometry (${meshes} meshes); both cave shells and swept collision. ${triangles.toLocaleString()} mesh triangles before instancing/culling.`);

const wreckContext = { scene: new T.Scene(), camera: new T.PerspectiveCamera(), renderer: { domElement: { height: 800 } } };
const seafloor = createSeafloor(wreckContext);
const wrecks = createWrecks(wreckContext, seafloor);
assert.equal(wrecks.list.filter(w => w.id !== 'debris').length, 5, 'all five wrecks build');
let wreckChunks = 0;
for (const wreck of wrecks.list) for (const mesh of wreck.group.children) {
  wreckChunks++;
  assert.ok(mesh.geometry.boundingSphere, 'culling bounds exist');
  assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite), 'finite wreck positions');
  assert.ok(mesh.geometry.attributes.normal.array.every(Number.isFinite), 'finite wreck normals');
}
assert.ok(wreckChunks > 100, 'wreck interiors split into spatial sections');
console.log(`PASS: five wrecks and debris built with ${wreckChunks} valid spatial sections.`);
