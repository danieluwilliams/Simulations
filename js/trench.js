// The way down. A line of survey beacons runs from the wreck field over the trench rim and down the wall to
// the Challenger Deep; their strobes fire in sequence, so a pulse of light always races off towards the deep.
// On the hadal floor sits a free-fall lander with its lamps on; lost shipping containers rest on the benches.
import * as THREE from 'three';
import { GeoBuilder, C, v3 } from './builders.js';
import { patch, G } from './materials.js';
import { Kit, M } from './shipkit.js';

const PULSE_RATE = 0.35, PULSE_STEP = 0.035;   // pulses per second at one beacon; phase offset per beacon

export function createTrench(ctx, seafloor) {
  const { scene, camera } = ctx;
  if (!seafloor?.trench) throw new Error('trench needs the seafloor module');
  const { heightAt, trench } = seafloor;
  const group = new THREE.Group();
  scene.add(group);

  // ---------------------------------------------------------------- beacon line along x = 0
  // spaced ~45 m along the ground, so on the steep scarps they come close together horizontally
  const path = [];
  for (let z = 150; z < trench.z - 40;) {
    const h0 = heightAt(0, z);
    path.push(v3(0, h0, z));
    let dz = 0;
    while (dz < 45) { dz += 3; if (Math.hypot(dz, heightAt(0, z + dz) - h0) > 45) break; }
    z += dz;
  }
  const n = path.length;
  const mast = new GeoBuilder();
  // clump weight, pole, float collar and strobe cage (strobe lens is a separate glowing mesh)
  mast.lathe((v) => [[0, 0], [0.7, 0], [0.7, 0], [0.62, 0.45], [0.62, 0.45], [0, 0.45]][Math.round(v * 5)], 5, C(0x3a3632), 12);
  mast.tube([v3(0, 0.4, 0), v3(0, 4.6, 0)], () => 0.07, C(0x8a8a84), 6);
  mast.sphere(v3(0, 3.3, 0), 0.48, C(0xc8661a), undefined, 16, v3(1, 0.8, 1));
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; mast.tube([v3(Math.cos(a) * 0.22, 4.55, Math.sin(a) * 0.22), v3(Math.cos(a) * 0.22, 5.05, Math.sin(a) * 0.22)], () => 0.02, C(0x2a2a28), 4); }
  const mastGeo = mast.build();
  mastGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(mastGeo.attributes.position.count), 1));
  const mastMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }), { dust: 0.3, glow: true });
  const masts = new THREE.InstancedMesh(mastGeo, mastMat, n);
  const lensGeo = new THREE.SphereGeometry(0.2, 14, 10);
  lensGeo.translate(0, 4.8, 0);
  const seq = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) seq[i] = i;
  lensGeo.setAttribute('aSeq', new THREE.InstancedBufferAttribute(seq, 1));
  const lensMat = new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uGlow: G.uGlow },
    vertexShader: `attribute float aSeq; varying float vSeq;
      void main(){ vSeq = aSeq; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime, uGlow; varying float vSeq;
      void main(){
        float run = fract(uTime * ${PULSE_RATE} - vSeq * ${PULSE_STEP});
        float flash = 1.0 - smoothstep(0.0, 0.035, run);
        vec3 c = vec3(0.45, 0.8, 1.0) * 9.0 + vec3(0.9, 0.95, 1.0) * flash * 120.0;   // blue-green carries furthest in seawater
        gl_FragColor = vec4(c * uGlow, 1.0);
      }`,
  });
  const lenses = new THREE.InstancedMesh(lensGeo, lensMat, n + 1);
  const dummy = new THREE.Object3D();
  path.forEach((p, i) => {
    dummy.position.copy(p).add(v3(0, -0.15, 0));
    dummy.rotation.set(0, i * 1.7, 0);
    dummy.updateMatrix();
    masts.setMatrixAt(i, dummy.matrix);
    lenses.setMatrixAt(i, dummy.matrix);
  });
  for (const m of [masts, lenses]) { m.frustumCulled = false; m.castShadow = m === masts; group.add(m); }

  // halos: the strobes seen through the water from far beyond lamp range
  const haloPos = new Float32Array((n + 1) * 3);
  path.forEach((p, i) => haloPos.set([p.x, p.y + 4.65, p.z], i * 3));
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
  haloGeo.setAttribute('aSeq', new THREE.BufferAttribute(seq, 1));
  const haloU = { uTime: G.uTime, uScale: { value: 800 }, uDepthTex: G.uDepthTex, uRes: G.uRes, uFogT: G.uFogT };
  const halos = new THREE.Points(haloGeo, new THREE.ShaderMaterial({
    uniforms: haloU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime, uScale; attribute float aSeq; varying float vF; varying vec3 vW;
      void main(){
        float run = fract(uTime * ${PULSE_RATE} - aSeq * ${PULSE_STEP});
        vF = 0.7 + (1.0 - smoothstep(0.0, 0.04, run)) * 2.4;
        vW = position;
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uScale * 4.0 / -mv.z, 3.0, 220.0);
      }`,
    fragmentShader: `uniform sampler2D uDepthTex; uniform vec2 uRes; uniform vec3 uFogT; varying float vF; varying vec3 vW;
      void main(){
        if (gl_FragCoord.z > texture2D(uDepthTex, gl_FragCoord.xy / uRes).r + 1e-6) discard;
        vec2 c = gl_PointCoord - 0.5;
        float a = exp(-dot(c, c) * 30.0);
        vec3 fog = exp(-uFogT * length(vW - cameraPosition) * 0.35);   // forward-scattered glow carries further than the image
        gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * vF * a * fog, 1.0);
      }`,
  }));
  halos.frustumCulled = false;
  halos.layers.set(1);
  halos.renderOrder = 4;
  group.add(halos);

  // ---------------------------------------------------------------- lander, containers
  const k = new Kit('Trench', 5);
  const lz = trench.z - 30, ly = heightAt(0, lz);
  const L = (x, y, z) => v3(x, ly + y, lz + z);
  const frameC = C(0x9a9a92), foam = C(0xd8801a), glass = C(0xb85a1a);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.tube('iron', [L(sx * 1.6, 0, sz * 1.6), L(sx * 1.1, 3.4, sz * 1.1)], 0.06, frameC, 6);
    k.cyl('steel', L(sx * 1.6, 0, sz * 1.6), L(sx * 1.6, 0.12, sz * 1.6), 0.3, C(0x3a3632), { seg: 10 });
  }
  for (const y of [1.0, 3.4]) {
    const r = y > 2 ? 1.1 : 1.47, ring = [L(-r, y, -r), L(r, y, -r), L(r, y, r), L(-r, y, r), L(-r, y, -r)];
    k.tube('iron', ring, 0.05, frameC, 6);
  }
  k.box('silt', -1.4, 3.4, -1.4, 1.4, 4.5, 1.4, foam, { m: M(0, ly, lz), collide: false });             // syntactic foam
  for (const s of [-1, 1]) k.b('china').sphere(L(s * 0.6, 2.2, 0), 0.42, glass, undefined, 16);          // instrument spheres
  k.cyl('metal', L(0.2, 1.4, 1.2), L(0.5, 1.0, 2.2), 0.16, C(0x6a6a64), { seg: 12 });                      // camera housing
  k.box('steel', 0, 0, -1.2, 0.5, 0.6, 1.2, C(0x2a2622), { m: M(0, ly, lz - 0.2), collide: false });        // drop-weight ballast
  k.tube('iron', [L(0, 1.2, 1.4), L(0, 0.7, 3.4)], 0.03, frameC, 4);                                       // bait arm
  k.lump('silt', 0, ly + 0.6, lz + 3.5, 0.25, 0.1, 0.4, C(0x8a7a6a), 0.3, 0.3);
  // containers lost from ships, resting on the benches beside the beacon line
  const cols = [C(0x6a2a1a), C(0x1e3a5a), C(0x2e4a2a), C(0x7a5a1a), C(0x5a5a5a)];
  for (let i = 0; i < 6; i++) {
    const p = path[Math.floor(n * (0.12 + i * 0.13))];
    if (!p) continue;
    const x = (i % 2 ? 1 : -1) * (14 + i * 6), z = p.z + (i - 3) * 5, y = heightAt(x, z);
    const gx = (heightAt(x + 3, z) - heightAt(x - 3, z)) / 6, gz = (heightAt(x, z + 3) - heightAt(x, z - 3)) / 6;
    const m = M(x, y + 0.6, z, i * 1.3, Math.atan(gz) * 0.8, -Math.atan(gx) * 0.8);
    k.box('hull', -6.1, 0, -1.22, 6.1, 2.6, 1.22, cols[i % cols.length], { m, collide: false, res: 1.2 });
    for (let r = -5.6; r <= 5.6; r += 0.7) k.box('hull', r - 0.05, 0.1, -1.27, r + 0.05, 2.5, 1.27, cols[i % cols.length].clone().multiplyScalar(0.8), { m, collide: false, res: 3 });
  }
  const tmats = {
    iron: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), { dust: 0.2, glow: true }),
    steel: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.3 }), { detail: 'rust', dust: 0.5, glow: true }),
    hull: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.3, side: THREE.DoubleSide }), { detail: 'paint', dust: 0.6, glow: true, bump: 'plates', bumpAmp: 2 }),
    silt: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), { dust: 0.3, glow: true }),
    china: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2 }), { glow: true }),
    metal: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.8 }), { glow: true }),
  };
  for (const [key, b] of Object.entries(k.parts)) {
    const geo = b.build();
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
    const mesh = new THREE.Mesh(geo, tmats[key] ?? tmats.steel);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  // the lander's strobe joins the end of the beacon sequence; its floodlamps light the hadal mud
  dummy.position.set(0, ly - 0.15, lz);   // lens sits 4.8 m up: just above the foam block
  dummy.rotation.set(0, 0, 0);
  dummy.updateMatrix();
  lenses.setMatrixAt(n, dummy.matrix);
  haloPos.set([0, ly + 4.65, lz], n * 3);
  const lamp = new THREE.SpotLight(0xdfe8ff, 0, 60, THREE.MathUtils.degToRad(38), 0.6, 1.2);
  lamp.position.set(0.5, ly + 1.0, lz + 2.2);
  lamp.target.position.set(0, ly - 2, lz + 14);
  group.add(lamp, lamp.target);
  lamp.layers.enable(1);

  function update(info) {
    const cam = camera.position;
    group.visible = info.under && cam.y < -3000 && Math.abs(cam.x) < 4000 && cam.z > -400 && cam.z < trench.z + 3000;
    if (!group.visible) { lamp.intensity = 0; return; }
    haloU.uScale.value = ctx.renderer.domElement.height * 0.5;
    lamp.intensity = cam.distanceTo(lamp.position) < 400 && !info.inBackrooms ? 260 / info.gain : 0;   // it would shine through the mud
  }
  return { update, path, lander: v3(0, ly, lz) };
}
