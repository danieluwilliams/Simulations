import * as THREE from 'three';
import { createOcean } from './surface.js';
import { createSky } from './sky.js';
import { createPipeline } from './post.js';
import { G } from './materials.js';
import { loadSurfaces, textureStatus } from './pbr.js';
import { SUN_DIR_WATER, DAY, SEA, WAVES, ZONES, SEAFLOOR_DEPTH, TRENCH_DEPTH, seaHeight, waterLight, waterTransmission, lnWaterLight } from './common.js';
import { createCaustics } from './caustics.js';
import { HABITAT_WAYPOINTS, caveSection } from './habitats.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const loadmsg = $('loadmsg');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
// floodlight shadows (refreshed once per frame by the pipeline, just before the opaque pass)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 60000);
camera.rotation.order = 'YXZ';
camera.position.set(0, 2.2, 0);
let yaw = 0, pitch = 0.1;

// the sky and its day cycle: afternoon → sunset → twilight → a starry night over the course of the dive
const day = createSky(renderer);
const { sky, skyCube } = day;
scene.add(sky);
const ocean = createOcean(skyCube);
scene.add(ocean.mesh);

// light rig: sun (filtered by depth), ambient sky light, diver lamp
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.copy(SUN_DIR_WATER).multiplyScalar(100);
scene.add(sun, sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 1, far: 320 });
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.12;
sun.shadow.camera.updateProjectionMatrix();
const ambient = new THREE.HemisphereLight(0x9fd6ff, 0x0a1a28, 0.5);
scene.add(ambient);
// the submersible's two hull-mounted LED floodlights (left and right of the viewport, angled in and down)
const hullLights = [-1, 1].map((s) => {
  const l = new THREE.SpotLight(0xffe9d2, 0, 170, THREE.MathUtils.degToRad(24), 0.55, 0.7);
  l.position.set(s * 1.5, -0.75, -0.6);
  l.target.position.set(-s * 0.9, -2.2, -16);
  // shadows are what make a wreck's rooms, doorways and skeletons read as solid in the beams
  l.castShadow = true;
  l.shadow.mapSize.set(1024, 1024);
  l.shadow.camera.near = 0.3;
  l.shadow.bias = -0.00015;
  l.shadow.normalBias = 0.025;
  l.shadow.radius = 2.5;
  camera.add(l, l.target);
  return l;
});
const fill = new THREE.PointLight(0xdfefff, 0, 6, 2);
fill.position.set(0, -0.6, -1.5);
camera.add(fill);
scene.add(camera);
for (const l of [sun, ambient, ...hullLights, fill]) l.layers.enable(1);
const lampState = [0, 1].map(() => ({ pos: new THREE.Vector3(), dir: new THREE.Vector3() }));
const lampShadows = hullLights.map((l) => l.shadow);   // the beams in the water are shadowed by what they strike

// underwater environment light: bright Snell's window above, deep blue below (for specular on fish);
// re-baked as the sun's refracted direction swings round during the evening
const envSun = SUN_DIR_WATER.clone(), envSunAmt = { value: 1 };
const bakeEnv = (() => {
  const envScene = new THREE.Scene();
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSun: { value: envSun }, uSunAmt: envSunAmt },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uSun; uniform float uSunAmt; varying vec3 vD;
      void main(){
        float up = vD.y;
        vec3 deep = vec3(0.004, 0.03, 0.07), mid = vec3(0.03, 0.22, 0.38), top = vec3(0.55, 0.85, 1.0);
        vec3 c = mix(deep, mid, smoothstep(-0.6, 0.2, up));
        c = mix(c, top * mix(0.9, 1.6, uSunAmt), smoothstep(0.62, 0.8, up));
        c += vec3(1.0, 0.95, 0.85) * pow(max(dot(vD, uSun), 0.0), 60.0) * 6.0 * uSunAmt;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
  const pm = new THREE.PMREMGenerator(renderer);
  let rt = null;
  return () => { const next = pm.fromScene(envScene, 0.02); scene.environment = next.texture; rt?.dispose(); rt = next; };
})();
bakeEnv();
const pipe = createPipeline(renderer);
// sun caustics: a tile of focused light re-rendered on the GPU each frame while there is sunlit water near you
const caustics = createCaustics(renderer);
G.uCausTex.value = caustics.texture;
pipe.shared.uCausTex.value = caustics.texture;
const dbg = { exp: 1, bloom: 1, beam: 0.06, spot: 0.3, fog: 1, ao: 0.85 };

// optional modules — each one fails independently
const mods = {};
const modObjects = {};   // each module's top-level scene objects (hidden while you are sealed in the backrooms)
async function loadModules() {
  loadmsg.textContent = 'Loading photographic surface detail';
  await loadSurfaces(renderer);
  const ctx = { scene, camera, renderer, skyCube, mods };
  const list = [
    ['seafloor', () => import('./seafloor.js').then((m) => m.createSeafloor(ctx))],
    ['reefs', () => import('./reefs.js').then((m) => m.createReefs(ctx))],
    ['life', () => import('./life.js').then((m) => m.createLife(ctx))],
    ['wrecks', () => import('./wrecks.js').then((m) => m.createWrecks(ctx, mods.seafloor))],
    ['trench', () => import('./trench.js').then((m) => m.createTrench(ctx, mods.seafloor))],
    ['backrooms', () => import('./backrooms.js').then((m) => m.createBackrooms(ctx, mods.seafloor))],
    ['bubbles', () => import('./bubbles.js').then((m) => m.createBubbles(ctx))],
    ['birds', () => import('./birds.js').then((m) => m.createBirds(ctx))],
    ['audio', () => import('./audio.js').then((m) => m.createAudio(mods.birds))],
  ];
  for (const [name, fn] of list) {
    loadmsg.textContent = 'Building ' + name;
    await new Promise((r) => setTimeout(r, 0));
    const before = new Set(scene.children);
    try { mods[name] = await fn(); } catch (e) { console.error('module failed:', name, e); }
    modObjects[name] = scene.children.filter((o) => !before.has(o));
  }
}

// ---------------------------------------------------------------- input
const keys = new Set();
let speedMul = 1;
let lampMode = 'auto';
let lampOn = false;
let hudHidden = false;
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyF' && !e.repeat) { lampMode = 'manual'; lampOn = !lampOn; mods.audio?.click(lampOn); }
  if (e.code === 'KeyM') mods.audio?.toggleMute();
  if (e.code === 'KeyT') { day.timeScale = day.timeScale === 1 ? 30 : 1; flashStatus(); }   // time-lapse the evening
  if (e.code === 'KeyH') { hudHidden = !hudHidden; document.querySelectorAll('.hud').forEach((el) => (el.hidden = hudHidden)); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('wheel', (e) => {
  speedMul = THREE.MathUtils.clamp(speedMul * (e.deltaY < 0 ? 1.25 : 0.8), 0.25, 120);
  flashStatus();
}, { passive: true });

function look(dx, dy) {
  yaw -= dx * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - dy * 0.0022, -1.55, 1.55);
}
// mouse: press and hold the middle button (wheel click) to look around; touch: drag
let dragging = false, lookHeld = false, lastX = 0, lastY = 0;
function endLook() {
  lookHeld = false;
  if (document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch { /* ignore */ } }
}
canvas.addEventListener('pointerdown', (e) => {
  lastX = e.clientX; lastY = e.clientY;
  if (e.pointerType === 'mouse') {
    if (e.button !== 1) return;
    e.preventDefault();
    lookHeld = true;
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* pointer lock optional */ }
    return;
  }
  dragging = true;
});
// stop the browser's middle-click autoscroll and paste behaviour
canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
addEventListener('mouseup', (e) => { if (e.button === 1) endLook(); });
addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') dragging = false; });
addEventListener('blur', endLook);
addEventListener('pointermove', (e) => {
  if (lookHeld) {
    if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
    else { look(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; }
    return;
  }
  if (dragging) { look(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; }
});
// touch buttons
const touchMap = { 't-up': 'KeyA', 't-down': 'KeyD', 't-left': 'ArrowLeft', 't-right': 'ArrowRight', 't-fwd': 'ArrowUp' };
for (const [id, code] of Object.entries(touchMap)) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => { e.stopPropagation(); keys.add(code); });
  b.addEventListener('pointerup', () => keys.delete(code));
  b.addEventListener('pointerleave', () => keys.delete(code));
}
$('t-light').addEventListener('click', () => { lampMode = 'manual'; lampOn = !lampOn; mods.audio?.click(lampOn); });

// ---------------------------------------------------------------- depth gauge
const MAXD = 11000;
const gaugeFrac = (d) => Math.log(1 + Math.max(d, 0) / 40) / Math.log(1 + MAXD / 40);
const gaugeDepth = (f) => 40 * (Math.exp(f * Math.log(1 + MAXD / 40)) - 1);
const gauge = $('gauge');
const marks = [
  ...ZONES.map((z) => ({ label: z.name.split(' · ')[0], d: z.from, jump: z.jump })),
  { label: 'Shipwrecks · 3,800 m', d: SEAFLOOR_DEPTH, jump: 3745, poi: 'wreck' },
  { label: 'Challenger Deep', d: TRENCH_DEPTH, jump: 10850 },
];
marks.sort((a, b) => a.d - b.d);
for (const m of marks) {
  const el = document.createElement('div');
  el.className = 'tick';
  el.style.top = (gaugeFrac(m.d) * 100).toFixed(2) + '%';
  el.textContent = m.label + (m.d > 0 ? ' ' + Math.round(m.d * 3.28084).toLocaleString() + ' ft' : '');
  el.addEventListener('click', (e) => { e.stopPropagation(); jumpTo(m.jump, m.poi); });
  gauge.appendChild(el);
}
gauge.addEventListener('click', (e) => {
  const r = gauge.getBoundingClientRect();
  jumpTo(gaugeDepth((e.clientY - r.top) / r.height));
});
function jumpTo(depth, poi) {
  if (mods.backrooms?.trapped) { mods.backrooms.denied(); return; }
  const target = mods.wrecks && poi === 'wreck' ? mods.wrecks.viewpoint : null;
  const sf = mods.seafloor;
  if (target) {
    camera.position.copy(target.pos); yaw = subYaw = target.yaw; pitch = subPitch = target.pitch;
  } else if (sf && mods.trench && depth > 10800) {
    // the Challenger Deep: beside the lander on the hadal floor
    const l = mods.trench.lander;
    camera.position.set(l.x + 4, l.y + 7, l.z - 20);
    yaw = subYaw = Math.PI + 0.15; pitch = subPitch = -0.3;
  } else if (sf && depth > SEAFLOOR_DEPTH - 30) {
    // below the abyssal plain only the trench goes deeper: arrive on the beacon line just off the wall, looking
    // obliquely along the cliff so the floods rake across it
    let lo = sf.trench.rimZ(0) - 300, hi = sf.trench.z;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (-sf.heightAt(0, m) < depth + 25) lo = m; else hi = m; }
    camera.position.set(8, -depth, lo + 6);
    yaw = subYaw = 0.8; pitch = subPitch = -0.3;
  } else {
    camera.position.y = -depth;
  }
  if (mods.seafloor) {
    const fl = mods.seafloor.heightAt(camera.position.x, camera.position.z);
    camera.position.y = Math.max(camera.position.y, fl + 12);
  }
  vel.set(0, 0, 0);
}

const habitatRoutes = HABITAT_WAYPOINTS.map((waypoint) => {
  const line = document.createElement('div');
  $('habitat-nav').appendChild(line);
  return { ...waypoint, line };
});

// ---------------------------------------------------------------- HUD
const ftEl = $('ft'), mEl = $('meters'), zoneEl = $('zone'), rateEl = $('rate'), meEl = $('me'), statusEl = $('status');
function waterTemp(d) {
  if (d <= 0) return 18;
  if (d < 60) return 18 - d * 0.015;
  if (d < 1000) return 4.3 + (17.1 - 4.3) * Math.exp(-(d - 60) / 260);
  if (d < 4000) return 2.2 + 2.1 * Math.exp(-(d - 1000) / 900);
  return 1.6 + (d - 4000) * 0.00012; // adiabatic warming in the trench
}
let statusTimer = 0;
function flashStatus() { statusTimer = 2.5; }
function updateHud(depth, rate, dt) {
  const ft = Math.max(0, depth * 3.28084);
  ftEl.textContent = Math.round(ft).toLocaleString('en-US');
  const atm = 1 + Math.max(depth, 0) / 10.06;
  mEl.textContent = `${Math.max(depth, 0).toFixed(1)} m · ${atm.toFixed(atm > 100 ? 0 : 2)} atm · ${waterTemp(depth).toFixed(1)} °C`;
  rateEl.textContent = (rate >= 0 ? '▼ ' : '▲ ') + Math.abs(rate * 3.28084).toFixed(1) + ' ft/s';
  let z = 'Surface';
  if (depth > 0.3) for (const zz of ZONES) if (depth >= zz.from) z = zz.name;
  const BR = mods.backrooms;
  if (BR?.inside) {
    z = 'Below the Deep · unmapped';
    if (BR.glitch) ftEl.textContent = '!?';
  }
  zoneEl.textContent = z;
  meEl.style.top = (gaugeFrac(depth) * 100).toFixed(2) + '%';
  statusTimer -= dt;
  const sp = walking ? `WALKING ${Math.min(WALK * speedMul, WALK_MAX).toFixed(1)}` : `SPEED ${(4 * speedMul).toFixed(speedMul < 1 ? 1 : 0)}`;
  statusEl.innerHTML = `${sp} m/s · LIGHTS <span class="${lampOn ? 'on' : ''}">${lampOn ? 'ON' : 'OFF'}</span>${mods.audio?.muted ? ' · MUTED' : ''} · ${day.clock}${day.timeScale > 1 ? ' <span class="on">▸▸ ×' + day.timeScale + '</span>' : ''}`;
  statusEl.style.opacity = statusTimer > 0 || depth > 0.3 ? 1 : 0.6;
  // sonar contact: nearest wreck or vent once the seafloor is within range; inside a wreck, the compartment
  let txt = '';
  const W = mods.wrecks, pois = W?.pois;
  const reef = mods.reefs, cave = reef?.inside;
  if (BR?.inside) txt = BR.poi;
  else if (cave) txt = 'EXPLORING · ' + cave.name.toUpperCase();
  else if (W?.inside) txt = 'INSIDE · ' + W.room.toUpperCase();
  else if (reef && depth < 220) {
    let best = null, bd = Infinity;
    for (const p of reef.pois) { const d = camera.position.distanceTo(p.pos); if (d < bd) { bd = d; best = p; } }
    if (best && bd < 650) txt = `${best.name.toUpperCase()} · ${Math.round(bd)} M ${bearing(best.pos.x, best.pos.z)}`;
  }
  else if (pois && depth > 2500) {
    let best = null, bd = Infinity;
    for (const p of pois) { const d = camera.position.distanceTo(p.pos); if (d < bd) { bd = d; best = p; } }
    if (best && bd < 3000) txt = `SONAR ${best.name.toUpperCase()} ${feet(bd)} FT ${bearing(best.pos.x, best.pos.z)}`;
  }
  if (poiEl.textContent !== txt) poiEl.textContent = txt;
  // the way down: from the plain, a bearing to the trench edge; over the trench, how far below the floor is
  let nav = '';
  if (cave) {
    const t = (cave.z - camera.position.z) / cave.length;
    const exit = caveSection(cave, t > 0.5 ? 1 : 0);
    nav = `OPEN EXIT ${Math.round(camera.position.distanceTo(new THREE.Vector3(exit.x, exit.y, exit.z)))} M ${bearing(exit.x, exit.z)} · FOLLOW THE TEAL SURVEY MARKERS`;
  } else if (reef?.nearReef) nav = 'REEF HABITAT · SUNLIGHT / MESOPHOTIC · F TO REVEAL NATURAL COLORS';
  const sf = mods.seafloor;
  if (sf && depth > 2500 && !W?.inside) {
    const cx = camera.position.x, cz = camera.position.z, floor = -sf.heightAt(cx, cz, false), tz = sf.trench.z;
    if (floor < SEAFLOOR_DEPTH + 120) {
      const rz = cz < tz ? sf.trench.rimZ(cx) : 2 * tz - sf.trench.rimZ(cx);
      nav = `TRENCH EDGE ${feet(Math.abs(rz - cz))} FT ${bearing(cx, rz)} · FOLLOW THE STROBES`;
    } else nav = `HADAL TRENCH · FLOOR ${feet(floor)} FT · ${feet(Math.max(0, floor - depth))} FT BELOW · HOLD D`;
  }
  if (walking) nav = 'WALKING THE DECKS · ↑ ↓ WALK · A KICK UP · D CROUCH · WHEEL SETS THE PACE';
  if (BR?.inside) nav = BR.navText(bearing(BR.hole.x, BR.hole.z), Math.round(Math.hypot(BR.hole.x - camera.position.x, BR.hole.z - camera.position.z)), lampOn);
  else if (BR && depth > 10700) {
    const dh = Math.hypot(BR.hole.x - camera.position.x, BR.hole.z - camera.position.z);
    if (dh < 500) nav = dh < 3 ? 'A SQUARE OPENING BELOW YOU · HOLD D TO GO DOWN' : `A SQUARE OPENING IN THE SEABED · ${feet(dh)} FT ${bearing(BR.hole.x, BR.hole.z)}`;
  }
  if (navEl.textContent !== nav) navEl.textContent = nav;
  habitatNav.hidden = !!BR?.inside;   // nothing up there is any use to you down here
  for (const route of habitatRoutes) {
    const [x, , z] = route.pos, distance = Math.hypot(x - camera.position.x, z - camera.position.z);
    const range = distance >= 1000 ? (distance / 1000).toFixed(1) + ' KM' : Math.round(distance) + ' M';
    const delta = route.depth - Math.max(depth, 0);
    const vertical = Math.abs(delta) < 4 ? 'DEPTH OK' : `${delta > 0 ? 'DIVE' : 'RISE'} TO ${route.depth} M`;
    const arrived = distance < 24 && Math.abs(delta) < 12;
    const text = `${route.label.toUpperCase()} · ${arrived ? 'HERE' : range + ' ' + bearing(x, z)} · ${vertical}`;
    if (route.line.textContent !== text) route.line.textContent = text;
  }
}
const poiEl = $('poi'), navEl = $('nav'), habitatNav = $('habitat-nav');
const feet = (m) => Math.round(m * 3.28084).toLocaleString('en-US');
// arrow for a world point relative to the sub's heading
function bearing(x, z) {
  let rel = Math.atan2(-(x - camera.position.x), -(z - camera.position.z)) - yaw;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  return ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'][((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8];
}

// ---------------------------------------------------------------- loop
const vel = new THREE.Vector3();
const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), prevPos = new THREE.Vector3();
let enclosed = 0;   // 0 in open water → 1 inside a wreck
// inside a wreck you walk its decks through the water instead of swimming through it: eye height when standing
// and crouched, the highest step up you take in your stride (a bench, yes; a table, no) (m), the walking pace at wheel
// speed ×1 and its ceiling (m/s). Your feet cover a little of the deck, enough to cross a gap at the head of the stairs.
const EYE = 1.55, CROUCH_EYE = 0.95, STEP = 0.5, WALK = 1.1, WALK_MAX = 8;
const FOOTPRINT = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
let walking = false, walkGrace = 0, crouch = 0, stepPhase = 0, walkSpeed = 0, ceilingY = Infinity, eyeH = EYE;
let supported = false, groundY = 0;   // standing on something last frame, and how high it was
const foot = new THREE.Vector3();
const lightCol = new THREE.Vector3(), waterT = new THREE.Vector3(), wb = new THREE.Vector3(1, 1, 1), ONE3 = new THREE.Vector3(1, 1, 1);
const waterP = new THREE.Vector3(), lightP = new THREE.Vector3();
const lum3 = (v) => v.x * 0.15 + v.y * 0.55 + v.z * 0.3;
let time = 0, last = performance.now(), wasUnder = false, prevDepth = 0, rateSmooth = 0, started = false;
const AIR_EXPOSURE = 0.22;
let exposureSmooth = AIR_EXPOSURE;
let subYaw = yaw, subPitch = pitch, subRoll = 0, yawVel = 0;
let lampLevel = 0, wasInBack = false;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const v = new THREE.Vector2(); renderer.getDrawingBufferSize(v);
  pipe.setSize(v.x, v.y);
  ocean.uniforms.uPixelAngle.value = (camera.fov * Math.PI / 180) / v.y;
}
addEventListener('resize', resize);
resize();

function frame(now) {
  const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.05);
  last = now; time += dbg.freeze ? 0 : dt;
  // resolution changes happen before drawing: resizing the canvas after a frame is drawn wipes it (a black flash)

  // the submersible turns with some inertia: smooth heading/pitch, bank into turns, gentle bob
  // ← / → rotate the submersible on the spot (thrusters yaw it around)
  const turnRate = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.6 : 0.8) * dt;
  if (keys.has('ArrowLeft')) yaw += turnRate;
  if (keys.has('ArrowRight')) yaw -= turnRate;
  const kTurn = 1 - Math.exp(-dt * 3.2);
  const prevYaw = subYaw;
  subYaw += (yaw - subYaw) * kTurn;
  subPitch += (pitch - subPitch) * kTurn;
  yawVel = (subYaw - prevYaw) / Math.max(dt, 1e-4);
  // walking starts as soon as you are in one of a wreck's rooms, and lasts a moment longer through doorways
  const BR = mods.backrooms, inBack = !!BR?.inside;
  walkGrace = mods.wrecks?.inside || inBack ? 0.6 : Math.max(0, walkGrace - dt);
  walking = walkGrace > 0;
  subRoll += (THREE.MathUtils.clamp(-yawVel * 0.12, -0.12, 0.12) * (walking ? 0.25 : 1) - subRoll) * (1 - Math.exp(-dt * 2));
  // afloat the view drifts with the hull; walking, it nods and sways a little with each heavy step
  const gait = walking ? Math.min(walkSpeed / 1.2, 1) : 0;
  const bob = (Math.sin(time * 0.6) * 0.012 + Math.sin(time * 1.13) * 0.006) * (walking ? 0.3 : 1) + Math.cos(stepPhase * 2) * 0.006 * gait;
  // movement: I/K forward-back along view, arrows strafe and rise/sink
  camera.rotation.set(subPitch + bob, subYaw, subRoll + Math.sin(time * 0.43) * 0.006 + Math.sin(stepPhase) * 0.008 * gait);
  const shake = BR?.shake ?? 0;
  if (shake > 0.01) { camera.rotation.x += (Math.random() - 0.5) * 0.03 * shake; camera.rotation.z += (Math.random() - 0.5) * 0.02 * shake; }
  camera.getWorldDirection(fwd);
  right.set(-Math.cos(subYaw), 0, Math.sin(subYaw)).negate();
  tmp.set(0, 0, 0);
  // ↑ forward, ↓ reverse (I/K still work), D descend, A ascend
  if (keys.has('ArrowUp') || keys.has('KeyI')) tmp.add(fwd);
  if (keys.has('ArrowDown') || keys.has('KeyK')) tmp.sub(fwd);
  if (keys.has('KeyA')) tmp.y += 1;
  if (keys.has('KeyD')) tmp.y -= 1;
  if (tmp.lengthSq() > 0) tmp.normalize();
  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6 : 1;
  let speed = 4 * speedMul * boost;
  if (walking) {
    // feet on the deck: ↑ / ↓ walk along the heading whichever way you look; the wheel sets the pace, Shift hurries it
    speed = Math.min(WALK * speedMul * (boost > 1 ? 1.8 : 1), WALK_MAX);
    const ahead = (keys.has('ArrowUp') || keys.has('KeyI') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyK') ? 1 : 0);
    const kWalk = 1 - Math.exp(-dt * 3.5);
    vel.x += (-Math.sin(subYaw) * ahead * speed - vel.x) * kWalk;
    vel.z += (-Math.cos(subYaw) * ahead * speed - vel.z) * kWalk;
    // heavy in the water: you sink back onto the deck unless kicking up (A) a stairwell or out through a hatch;
    // D crouches to look under things
    vel.y = keys.has('KeyA') ? vel.y + (1.6 - vel.y) * (1 - Math.exp(-dt * 3)) : Math.max(vel.y - 3 * dt, -1.5);
    crouch += ((keys.has('KeyD') ? 1 : 0) - crouch) * (1 - Math.exp(-dt * 5));
  } else {
    vel.lerp(tmp.multiplyScalar(speed), 1 - Math.exp(-dt * 2.2));
    crouch = 0;
  }
  prevPos.copy(camera.position);
  camera.position.addScaledVector(vel, dt);
  camera.position.y = Math.min(camera.position.y, 120);
  const vy0 = vel.y;
  mods.wrecks?.collide(camera.position, vel, prevPos);
  mods.reefs?.collide(camera.position, vel, prevPos);
  BR?.collide(camera.position, vel, prevPos);
  // walking into the edge of a table or a crate deflects you along it, never up and over it
  if (walking && !keys.has('KeyA')) vel.y = Math.min(vel.y, Math.max(vy0, 0));
  if (mods.seafloor && !BR?.owns(camera.position)) {
    const sf = mods.seafloor, inside = mods.wrecks?.inside;
    const fl = sf.heightAt(camera.position.x, camera.position.z) + (inside || walking ? 0.9 : 2.6);
    if (camera.position.y < fl) {
      camera.position.y = fl; vel.y = Math.max(vel.y, 0);
      // holding D against a slope slides the sub down it: off the edge of the plain and down the trench wall
      if (tmp.y < 0 && !inside && !walking) {
        const x = camera.position.x, z = camera.position.z, e = 4;
        const gx = (sf.heightAt(x + e, z, false) - sf.heightAt(x - e, z, false)) / (2 * e);
        const gz = (sf.heightAt(x, z + e, false) - sf.heightAt(x, z - e, false)) / (2 * e);
        const g = Math.hypot(gx, gz);
        if (g > 0.15) { const s = speed * dt * Math.min(1, g); camera.position.x -= (gx / g) * s; camera.position.z -= (gz / g) * s; }
      }
    }
  }
  // stand on whatever is underfoot (a deck, a stair stringer, debris, the seabed through a breach) at eye height,
  // stooping under a low deckhead; with nothing within reach below, you sink until you land
  ceilingY = Infinity;
  const W = inBack ? BR : mods.wrecks;
  if (walking && W) {
    const p = camera.position;
    const groundAt = () => {
      let g = mods.seafloor && !inBack ? mods.seafloor.heightAt(p.x, p.z) : -Infinity;
      for (const [ox, oz] of FOOTPRINT) g = Math.max(g, p.y - W.probe(foot.set(p.x + ox, p.y, p.z + oz), -1, 6));
      return g;
    };
    let ground = groundAt();
    // anything more than a step up from where you stand (a table, a crate) is walked around, not climbed: slide along
    // its edge. Dropping onto it from above is still a landing.
    const reach = () => (supported ? groundY + STEP : p.y - eyeH);
    if (!keys.has('KeyA') && ground > reach()) {
      const x = p.x, z = p.z;
      for (const [sx, sz] of [[prevPos.x, z], [x, prevPos.z], [prevPos.x, prevPos.z]]) {
        p.x = sx; p.z = sz; ground = groundAt();
        if (ground <= reach()) break;
      }
      if (p.x !== x) vel.x = 0;
      if (p.z !== z) vel.z = 0;
    }
    const up = W.probe(p, 1, 4);
    if (up < 4) ceilingY = p.y + up;
    stepPhase += Math.min(walkSpeed, 2.2) * dt * Math.PI / 0.75;
    const stand = Math.min(THREE.MathUtils.lerp(EYE, CROUCH_EYE, crouch), ceilingY - ground - W.RAD - 0.08);
    eyeH = THREE.MathUtils.clamp(stand, W.RAD + 0.05, EYE);
    const target = ground + eyeH + (Math.abs(Math.sin(stepPhase)) - 0.6) * 0.06 * gait;
    supported = p.y < target + 0.05 && !keys.has('KeyA');
    if (supported) {
      p.y += (target - p.y) * (1 - Math.exp(-dt * 9));
      vel.y = Math.max(vel.y, 0);
      groundY = ground;
    }
  } else supported = false;
  walkSpeed = walking ? Math.hypot(vel.x, vel.z) : 0;
  // bob gently on the swell when floating at the surface
  const sh = seaHeight(camera.position.x, camera.position.z, time);
  // never park the lens in the waterline: float up to the surface or settle just below it
  const d0 = sh - camera.position.y;
  if (d0 > -1.6 && d0 < 1.2 && Math.abs(tmp.y) < 0.01) {
    const target = d0 < 0.45 ? sh + 1.8 : sh - 1.3;
    camera.position.y += (target - camera.position.y) * (1 - Math.exp(-dt * 2.5));
  }
  // swell only matters near the surface; deeper the reading is plain depth below mean sea level
  const depth = -camera.position.y + sh * Math.exp(Math.min(camera.position.y, 0) / 3);
  const under = depth > 0.05;
  if (under !== wasUnder) { mods.audio?.splash(); wasUnder = under; }

  // the evening moves on (only once the dive has begun): sun, sky and the light falling on the sea
  const ds = day.update(started ? dt : 0, { under, depth, pixelAngle: ocean.uniforms.uPixelAngle.value, gain: exposureSmooth / AIR_EXPOSURE });
  DAY.light.copy(ds.daylight);
  DAY.night = ds.night;
  DAY.elevation = ds.elevation;
  // the breeze drops through the sunset and the sea lies down for the night (smaller swell, hardly any ripples)
  SEA.calm = 1 - THREE.MathUtils.smoothstep(ds.elevation, -12, 2);
  SEA.amp = THREE.MathUtils.lerp(1, 0.38, SEA.calm);
  ocean.uniforms.uSea.value = SEA.amp;

  // light at the camera depth: what reaches the sea, filtered by the water above us
  const dPos = Math.max(depth, 0);
  const caveShade = mods.reefs?.shelterAt(camera.position) ?? 0;
  // Beer–Lambert, band by band (common.js): waterT is the daylight the scene is lit by at this depth, a deep-blue
  // twilight that reaches total darkness at 3,000 ft; waterP is the physical light, which is what the eye adapts to
  waterLight(dPos, waterT);
  waterTransmission(dPos, waterP);
  lightCol.copy(waterT).multiply(ds.daylight);
  lightP.copy(waterP).multiply(ds.daylight);
  const lum = lum3(lightP);
  lnWaterLight(under ? dPos : 0, G.uLnSeenCam.value);   // surfaces are re-lit for their own depth relative to this
  // the eye adapts: above water to the sky; underwater fully to the depth but only partly to the evening, so dusk
  // and night come down through the water as they do above it (light at sunset ≈1% of the afternoon reads as ~18%)
  const eve = Math.min(Math.pow(Math.max(lum3(ds.daylight), 1e-12), -0.65), 1e6);
  const depthComp = Math.min(Math.pow(Math.max(lum3(waterP), 1e-9), -0.85) * 1.6, 160);
  const underGain = Math.min(depthComp * eve, 160);
  let exposure = AIR_EXPOSURE * ds.airGain;
  if (under) exposure = AIR_EXPOSURE * underGain;
  // the sky seen up through the surface is lifted by the evening exactly as much as it is above water, not by the
  // (much larger) boost the dim water itself gets, or Snell's window would still blaze like the afternoon at dusk
  ocean.uniforms.uWinScale.value = ds.airBoost / Math.max(underGain / depthComp, 1);
  scene.environmentIntensity = under ? lum3(lightCol) * 1.25 * (1 - caveShade * 0.94) : 0.6 * lum3(ds.skyRel);
  exposureSmooth = Math.exp(THREE.MathUtils.lerp(Math.log(exposureSmooth), Math.log(exposure), 1 - Math.exp(-dt * (under ? 1.5 : 4))));
  if (dbg.snap) exposureSmooth = exposure;   // debugging: skip the eye's adaptation
  sun.color.setRGB(waterT.x * ds.sunRel.x, waterT.y * ds.sunRel.y, waterT.z * ds.sunRel.z);
  sun.intensity = 3.0 * (1 - caveShade * 0.985);
  sun.target.position.copy(camera.position);
  sun.position.copy(under ? ds.sunDirWater : ds.sunDir).multiplyScalar(150).add(camera.position);
  sun.castShadow = under && depth < 220 && ds.sunAmt > 0.02 && caveShade < 0.95;
  ambient.color.setRGB(waterT.x * ds.skyRel.x * 0.35, waterT.y * ds.skyRel.y * 0.75, waterT.z * ds.skyRel.z * 0.95);
  ambient.groundColor.setRGB(waterT.x * ds.skyRel.x * 0.02, waterT.y * ds.skyRel.y * 0.08, waterT.z * ds.skyRel.z * 0.14);
  ambient.intensity = (under ? 0.72 : 0.8) * (1 - caveShade * 0.92);
  G.uCaus.value.copy(waterT).multiply(ds.sunRel).multiplyScalar(under ? 2.4 * Math.exp(-dPos / 22) * (1 - caveShade) : 0);
  // the caustics focus the direct sun on every surface it reaches (they fade with each surface's own depth and are
  // gone by 200 ft); the tile is only re-rendered while there is sunlit water within reach
  G.uCausAmt.value = under ? 1 - caveShade : 0;
  if (under && depth < 140 && ds.sunAmt > 0.01) caustics.update(time);
  G.uSunW.value.copy(ds.sunDirWater);
  pipe.shared.uSunW.value.copy(ds.sunDirWater);
  pipe.shared.uE0.value.set(3.2, 3.15, 3.0).multiply(ds.daylight).multiplyScalar(1 - caveShade * 0.98);
  pipe.shared.uSunAmt.value = ds.sunAmt * (1 - caveShade);
  if (envSun.angleTo(ds.sunDirWater) > 0.05 || Math.abs(envSunAmt.value - ds.sunAmt) > 0.08) { envSun.copy(ds.sunDirWater); envSunAmt.value = ds.sunAmt; bakeEnv(); }
  G.uTime.value = time;
  const gain = exposureSmooth / AIR_EXPOSURE;
  G.uGlow.value = 0.45 / gain;
  // reef life sways in the surge of the swell overhead (it slackens as the sea calms at night), and its
  // bioluminescence shows only where daylight does not drown it out: in the caves, on the deep terrace, at night
  G.uSurge.value.set(WAVES[0].dx, WAVES[0].dz, 0.16 * SEA.amp, 0);
  G.uBio.value = under ? 1 - THREE.MathUtils.smoothstep(lum * (1 - caveShade * 0.92), 0.004, 0.09) : 0;

  // floods come on by themselves once it is too dark to see: deep down, or near the surface after nightfall
  // in the backrooms the floods die when the hatch slams; after that they are yours to switch on (and they flicker)
  if (BR?.consumeSlam()) { lampMode = 'manual'; if (lampOn) { lampOn = false; mods.audio?.click(false); } }
  if (wasInBack && !inBack) lampMode = 'auto';
  wasInBack = inBack;
  if (lampMode === 'auto') lampOn = under && (lum * eve < 0.0062 || !!mods.reefs?.nearCave || !!mods.reefs?.nearReef);
  const flick = inBack && lampOn ? BR.flicker : 1;
  // inside a wreck the floods fold in against the hull, widen and dim (walls are close), so they never end up
  // inside a bulkhead or blow out the nearest surface
  enclosed += ((mods.wrecks?.inside || inBack ? 1 : 0) - enclosed) * (1 - Math.exp(-dt * 3));
  const lampTarget = (lampOn ? 1 : 0) * THREE.MathUtils.lerp(1, inBack ? 0.34 : 0.2, enclosed);
  lampLevel += (lampTarget - lampLevel) * Math.min(1, dt * 6);
  for (const l of hullLights) l.intensity = ((lampLevel * 520 * dbg.spot) / gain) * flick;
  hullLights.forEach((l, i) => {
    const s = i ? 1 : -1, lerp = THREE.MathUtils.lerp;
    l.position.set(s * lerp(1.5, 0.5, enclosed), lerp(-0.75, -0.35, enclosed), -0.6);
    l.target.position.set(-s * lerp(0.9, 0.2, enclosed), lerp(-2.2, -1.2, enclosed), -16);
    // folded in for a wreck's rooms; in the backrooms a hand flashlight's narrower cone, so the beam reads as a beam
    l.angle = THREE.MathUtils.degToRad(lerp(24, inBack ? 27 : 40, enclosed));
  });
  fill.distance = THREE.MathUtils.lerp(6, 16, enclosed);
  fill.intensity = lampOn ? (THREE.MathUtils.lerp(1.5, 2.5, enclosed) / gain) * flick * (inBack ? 0.5 : 1) : 0;
  if (mods.reefs?.nearReef || mods.reefs?.nearCave) {
    // A dim local bounce preserves the modelling from the shadowed spotlights.
    fill.distance = mods.reefs?.inside ? 7 : 14;
    fill.intensity = lampOn ? (mods.reefs?.inside ? 0.8 : 3) / gain : 0;
  }

  ocean.uniforms.uTime.value = time;
  ocean.uniforms.uCenter.value.set(Math.round(camera.position.x / 4) * 4, Math.round(camera.position.z / 4) * 4);
  ocean.uniforms.uUnderColor.value.set(lightCol.x * 0.02, lightCol.y * 0.25, lightCol.z * 0.42);
  ocean.uniforms.uSun.value.copy(ds.sunDir);
  ocean.uniforms.uSunTint.value.copy(ds.sunRel);
  ocean.uniforms.uAmb.value = lum3(ds.skyRel);
  sky.position.copy(camera.position);
  sky.visible = !under;
  camera.far = under ? 6000 : 60000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const info = { time, dt, depth, under, gain, lampOn, vel, rate: rateSmooth, lum: under ? lum : 1, inside: !!mods.wrecks?.inside, insideCave: !!mods.reefs?.inside,
    walking, walkSpeed, ceiling: ceilingY, boost: boost > 1, lampFlicker: flick, lampCos: ocean.uniforms.uLampCos.value, backrooms: BR?.audioState, inBackrooms: inBack };
  // down in the backrooms the world above is hidden and left alone (the trench keeps running: its lander lamp stays in
  // the light list, so no material has to recompile on the way in or out, and it simply goes dark)
  const below = !!BR?.deep;
  for (const k of ['seafloor', 'reefs', 'life', 'wrecks', 'trench', 'backrooms', 'bubbles', 'birds']) {
    if (below && ['seafloor', 'reefs', 'wrecks', 'birds'].includes(k)) { for (const o of modObjects[k] ?? []) o.visible = false; continue; }
    mods[k]?.update?.(info);
  }
  mods.audio?.update(info, vel.length());
  hullLights.forEach((l, i) => {
    l.getWorldPosition(lampState[i].pos);
    l.target.getWorldPosition(lampState[i].dir);
    lampState[i].dir.sub(lampState[i].pos).normalize();
    ocean.uniforms.uLampPos.value[i].copy(lampState[i].pos);
    ocean.uniforms.uLampDir.value[i].copy(lampState[i].dir);
  });
  // the water surface is a custom shader, so it is told about the floods directly (it reflects them from above)
  {
    const l = hullLights[0], ou = ocean.uniforms;
    ou.uLampI.value = under ? 0 : l.intensity;
    ou.uLampCos.value.set(Math.cos(l.angle), Math.cos(l.angle * (1 - l.penumbra)));
    ou.uLampCol.value.set(l.color.r, l.color.g, l.color.b);
    pipe.shared.uLampCos.value.copy(ou.uLampCos.value);   // the beams in the water match the lit cone
  }

  // in the shallows the eye white-balances against the blue: partly restore the red the water has taken, and give
  // dull tones more colour (strongest over the reefs), fading out with depth
  const shallow = under ? 1 - THREE.MathUtils.smoothstep(depth, 50, 140) : 0;
  {
    // the floods are white, so with them on most of the red on screen is lamp-lit and needs far less help
    const wl = lum3(waterP), lit = lampOn ? 0.4 : 1;
    wb.set(1 + (Math.min(1.4, Math.pow(wl / Math.max(waterP.x, 1e-6), 0.08)) - 1) * lit, 1,
      1 - (1 - Math.max(0.88, Math.pow(wl / Math.max(waterP.z, 1e-30), 0.2))) * lit).lerp(ONE3, 1 - shallow);
  }
  const vibrance = shallow * 0.12;
  G.uDepthTex.value = pipe.sceneRT.depthTexture;
  G.uRes.value.set(pipe.sceneRT.width, pipe.sceneRT.height);
  G.uExpo.value = exposureSmooth * dbg.exp;
  // deep water is far clearer than the plankton-rich surface layer (and our lamps sit close to the subject)
  const clear = THREE.MathUtils.smoothstep(depth, 150, 900);
  pipe.comp.material.uniforms.uSigmaT.value.set(
    THREE.MathUtils.lerp(0.46, 0.085, clear), THREE.MathUtils.lerp(0.075, 0.036, clear), THREE.MathUtils.lerp(0.052, 0.026, clear)).multiplyScalar(dbg.fog);
  // Clear tropical bank water opens long vistas while retaining wavelength-dependent absorption.
  // Still cave water, sheltered from the plankton above, is clearer still: the glowing walls show far down the passage.
  if (depth < 220 && mods.reefs && (mods.reefs.nearReef || mods.reefs.nearCave)) pipe.comp.material.uniforms.uSigmaT.value.set(0.13, 0.032 - caveShade * 0.016, 0.024 - caveShade * 0.012).multiplyScalar(dbg.fog);
  pipe.comp.material.uniforms.uSigmaS.value.set(
    THREE.MathUtils.lerp(0.016, 0.03, clear), THREE.MathUtils.lerp(0.042, 0.031, clear), THREE.MathUtils.lerp(0.046, 0.033, clear));
  // the backrooms' water is still and silty: it swallows the corridors and the flashlight beams show in it
  if (BR?.deep) {
    pipe.comp.material.uniforms.uSigmaT.value.set(0.12, 0.072, 0.062).multiplyScalar(dbg.fog);
    pipe.comp.material.uniforms.uSigmaS.value.set(0.035, 0.042, 0.04);
  }
  G.uFogT.value.copy(pipe.comp.material.uniforms.uSigmaT.value);
  pipe.render(scene, camera, {
    under, time, exposure: exposureSmooth * dbg.exp, lamp: lampOn ? ((16 * dbg.beam) / gain) * flick * (BR?.deep ? 5 : 1) : 0, lampDust: BR?.deep ? 1 : 0, lamps: lampState, lampShadows,
    sunShadow: sun.castShadow ? sun.shadow : null,
    ao: dbg.ao,
    bloom: (under ? 0.18 : 0.14) * dbg.bloom,
    // night vision: after dark at the surface, and in the twilight zone, where the eye has gone over to its rods and
    // the last of the blue loses its colour (fading out again below the twilight, where only lamps light anything)
    scotopic: Math.max(ds.scotopic * (under ? 1 - THREE.MathUtils.smoothstep(depth, 40, 250) : 1),
      under ? 0.55 * THREE.MathUtils.smoothstep(depth, 160, 420) * (1 - THREE.MathUtils.smoothstep(depth, 700, 1000)) : 0),
    wb, vibrance,
  });

  // Preserve native detail. Slow frames must never silently lower image resolution.
  const rate = (depth - prevDepth) / Math.max(dt, 1e-4);
  prevDepth = depth;
  rateSmooth += (rate - rateSmooth) * Math.min(1, dt * 4);
  updateHud(depth, rateSmooth, dt);
  requestAnimationFrame(frame);
}

loadModules().then(() => {
  const go = $('go');
  go.disabled = false; go.textContent = 'Begin dive';
  loadmsg.textContent = 'Best with headphones · sound starts when you dive';
  go.addEventListener('click', () => {
    started = true;
    $('intro').style.opacity = 0;
    setTimeout(() => ($('intro').hidden = true), 800);
    mods.audio?.start();
    setTimeout(() => ($('hint').style.opacity = 0.35), 12000);
  });
});
requestAnimationFrame(frame);
window.__ocean = { camera, mods, jumpTo, dbg, ocean, pipe, keys, sky, day, scene, THREE, renderer, textureStatus, setView: (y, p) => { yaw = subYaw = y; pitch = subPitch = p; } };
