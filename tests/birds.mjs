// Run with: node --experimental-vm-modules tests/birds.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map();
for (const file of ['tests/vendor/three.module.js', 'js/builders.js', 'js/common.js', 'js/birds.js', 'js/audio.js']) {
  modules.set(file, new vm.SourceTextModule(await fs.readFile(path.join(root, file), 'utf8'), { identifier: file }));
}
async function load(file) {
  const mod = modules.get(file);
  if (mod.status === 'unlinked') await mod.link((name, parent) => modules.get(name === 'three' ? 'tests/vendor/three.module.js' : path.posix.join(path.posix.dirname(parent.identifier), name)));
  if (mod.status === 'linked') await mod.evaluate();
  return mod.namespace;
}
const T = await load('tests/vendor/three.module.js');
const { DAY } = await load('js/common.js');
const { createBirds } = await load('js/birds.js');
const { createAudio } = await load('js/audio.js');
const camera = new T.PerspectiveCamera(78, 16 / 9, 0.1, 60000);
camera.position.set(0, 2.2, 0); camera.updateMatrixWorld();
const mods = {}, scene = new T.Scene();
const birds = createBirds({ scene, camera, mods });
const info = { time: 0, dt: 0.05, depth: -2.2, under: false };
birds.update(info);
assert.equal(birds.flock.length, 10);
assert.ok(birds.root.visible && birds.pickCaller(), 'daytime surface has visible callers');
scene.traverse(m => {
  if (!m.geometry) return;
  for (const name of ['position', 'normal']) assert.ok(m.geometry.attributes[name].array.every(Number.isFinite), 'finite bird geometry');
});
const before = birds.flock.map(b => b.mesh.position.clone());
birds.update({ ...info, time: 2 });
assert.ok(birds.flock.every((b, i) => b.mesh.position.distanceTo(before[i]) > 1 && b.mesh.position.y > 6), 'gulls fly above the waves');
for (const elevation of [2.5, 0, -12, 24]) {
  DAY.elevation = elevation; birds.update(info);
  assert.equal(birds.root.visible, elevation > 0, 'sunset visibility');
  if (elevation === 2.5) assert.ok(birds.daylight > 0 && birds.daylight < 1, 'gradual sunset fade');
  if (elevation <= 0) assert.equal(birds.pickCaller(), null, 'no night callers');
}
birds.update({ ...info, under: true, depth: 30 });
assert.ok(!birds.root.visible && !birds.pickCaller(), 'no underwater gulls');
birds.update(info);
const spatialBird = birds.flock[0];
spatialBird.mesh.position.set(20, 12, -40);
assert.ok(birds.spatial(spatialBird).pan > 0, 'right-hand bird pans right');
camera.rotation.y = Math.PI; camera.updateMatrixWorld();
assert.ok(birds.spatial(spatialBird).pan < 0, 'turning changes stereo bearing');
camera.rotation.y = 0; camera.updateMatrixWorld();
birds.update(info);

// Trace actual audio graph scheduling, including the beak timestamps and output bus.
const oscillators = [];
function param() {
  return { value: 0, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; } };
}
function node() {
  return { connections: [], gain: param(), frequency: param(), Q: param(), pan: param(), delayTime: param(),
    connect(n) { this.connections.push(n); }, disconnect() { this.disconnected = true; },
    start(t) { this.started = t; }, stop(t) { this.stopped = t; } };
}
let ac;
class AudioContext {
  constructor() { ac = this; this.currentTime = 10; this.state = 'running'; this.sampleRate = 1000; this.destination = node(); }
  resume() { this.state = 'running'; }
  createGain() { return node(); }
  createDynamicsCompressor() { return node(); }
  createDelay() { return node(); }
  createBiquadFilter() { return node(); }
  createStereoPanner() { return node(); }
  createBufferSource() { return node(); }
  createOscillator() { const o = node(); oscillators.push(o); return o; }
  createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: i => data[i] }; }
}
globalThis.window = { AudioContext };
mods.audio = createAudio(birds); mods.audio.start();
mods.audio.update({ ...info, dt: 3 }, 0);
const caller = birds.flock.find(b => b.notes.length);
assert.ok(caller, 'a visible gull owns the sound');
const voices = oscillators.filter(o => o.type === 'sawtooth');
assert.equal(voices.length, caller.notes.length, 'one audio voice per beak note');
for (const [i, note] of caller.notes.entries()) {
  assert.equal(voices[i].started, note.start, 'beak opens on audio start');
  assert.ok(Math.abs(voices[i].stopped - note.end - 0.3) < 1e-6, 'beak closes with note envelope, before quiet tail');
}
ac.currentTime = caller.notes[0].start + 0.04; birds.update(info);
assert.ok(caller.beak.rotation.x > 0.5, 'calling bird opens its beak');
assert.ok(birds.flock.filter(b => b !== caller).every(b => b.beak.rotation.x === 0), 'silent birds keep their beaks closed');
const gainNode = voices[0].connections[0], bp = gainNode.connections[0], hp = bp.connections[0];
const output = hp.connections[0], panner = output.connections[0], bus = panner.connections[0], master = bus.connections[0];
assert.ok(bus.gain.value > 0, 'daytime call is audible');
mods.audio.update({ ...info, under: true, depth: 30 }, 0);
assert.equal(bus.gain.value, 0, 'submerging ducks active calls');
DAY.elevation = -12; birds.update(info); mods.audio.update(info, 0);
assert.equal(bus.gain.value, 0, 'night ducks active calls');
DAY.elevation = 24; birds.update(info);
camera.rotation.y = Math.PI; camera.updateMatrixWorld();
mods.audio.update(info, 0);
assert.equal(panner.pan.value, birds.spatial(caller).pan, 'active voice follows listener rotation');
mods.audio.toggleMute(); assert.equal(master.gain.value, 0, 'mute reaches gull output');
mods.audio.toggleMute(); assert.ok(master.gain.value > 0, 'unmute restores output');
ac.currentTime = 30; birds.update(info); mods.audio.update(info, 0);
assert.equal(caller.beak.rotation.x, 0, 'beak closes after the last note');
assert.ok(output.disconnected && panner.disconnected, 'finished gull voices are released');
const count = oscillators.filter(o => o.type === 'sawtooth').length;
const fallback = createAudio(); fallback.start(); fallback.update({ ...info, dt: 10 }, 0);
assert.equal(oscillators.filter(o => o.type === 'sawtooth').length, count, 'no phantom calls if the bird module is unavailable');
delete globalThis.window;
console.log('PASS: gull geometry and flight, day/night and underwater visibility, audio/beak timing, moving stereo, mute, and voice cleanup.');
