// Populates the water column around the diver: every species lives in a camera-centred, wrapping
// volume clipped to its real depth range, so the ocean feels endless without simulating all of it.
import * as THREE from 'three';
import { allSpecies } from './species.js';
import { rng, DAY, waterLight } from './common.js';
import { G, GLSL_TRANSP } from './materials.js';

const wrap = (v, size) => v - size * Math.floor(v / size + 0.5);

export function createLife(ctx) {
  const { scene, camera } = ctx;
  const group = new THREE.Group();
  scene.add(group);
  const R = rng(1234);
  const species = allSpecies().map((def, si) => {
    const n = def.count;
    const phase = new Float32Array(n);
    const inst = [];
    const schools = [];
    for (let s = 0; s < (def.schools ?? 0); s++) {
      schools.push({ bx: R() * def.box, by: R() * def.vbox, bz: R() * def.box, h: R() * Math.PI * 2, r: def.schoolRadius[0] + R() * (def.schoolRadius[1] - def.schoolRadius[0]), dir: R() < 0.5 ? 1 : -1, sp: 0.4 + R() * 0.5 });
    }
    for (let i = 0; i < n; i++) {
      phase[i] = R() * 100;
      inst.push({
        bx: R() * def.box, by: R() * def.vbox, bz: R() * def.box,
        h: R() * Math.PI * 2, sp: def.speed[0] + R() * (def.speed[1] - def.speed[0]),
        sc: def.size[0] + R() * (def.size[1] - def.size[0]),
        w: 0.05 + R() * 0.12, wp: R() * 6.28, vb: 0.2 + R() * 1.2, vw: 0.03 + R() * 0.08,
        school: schools.length ? i % schools.length : -1,
        rr: 0.25 + Math.sqrt(R()) * 0.75, a0: R() * Math.PI * 2, oy: (R() - 0.5), oz: (R() - 0.5), ox: (R() - 0.5),
      });
    }
    const meshes = def.parts.map(({ geo, mat }) => {
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.renderOrder = mat.transparent ? 2 : 0;
      if (mat.transparent) m.layers.set(1);
      group.add(m);
      return m;
    });
    return { def, inst, schools, meshes, si };
  });

  // ---------------------------------------------------------------- marine snow
  const SN = 2400, SS = 40;
  const sp = new Float32Array(SN * 3), ss = new Float32Array(SN);
  for (let i = 0; i < SN; i++) { sp[i * 3] = R() * SS; sp[i * 3 + 1] = R() * SS; sp[i * 3 + 2] = R() * SS; ss[i] = 0.4 + R() * R() * 2.2; }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  snowGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(ss, 1));
  snowGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const snowU = {
    uDepthTex: G.uDepthTex, uRes: G.uRes, uFogT: G.uFogT, uExpo: G.uExpo,
    uCam: { value: new THREE.Vector3() }, uTime: G.uTime, uAmb: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3() },
    uLamp: { value: 0 }, uScale: { value: 400 }, uSize: { value: SS }, uSpark: { value: 0 },
  };
  const snow = new THREE.Points(snowGeo, new THREE.ShaderMaterial({
    uniforms: snowU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform vec3 uCam; uniform float uTime, uScale, uSize, uLamp, uSpark; uniform vec3 uAmb, uLampDir;
      attribute float aSize; varying vec3 vCol; varying float vA; varying vec3 vW;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.1 + position.y) * 0.4, -uTime * 0.05 * aSize, cos(uTime * 0.08 + position.x) * 0.4);
        p = uCam + mod(p - uCam + uSize * 0.5, uSize) - uSize * 0.5;
        vW = p;
        vec3 d = p - uCam; float dist = length(d);
        float cone = smoothstep(0.84, 0.95, dot(d / dist, uLampDir));
        vCol = uAmb * 0.9 + vec3(1.0, 0.97, 0.92) * uLamp * cone / (1.0 + dist * dist * 0.03);
        // dinoflagellates and copepods flash blue when the hull disturbs them in the dark
        float id = position.x * 12.9898 + position.y * 78.233 + position.z * 37.719;
        float flick = fract(sin(id + floor(uTime * 3.0 + aSize * 7.0)) * 43758.5453);
        vCol += vec3(0.25, 0.75, 1.0) * uSpark * step(0.975, flick) * smoothstep(9.0, 2.0, dist) * 7.0;
        vA = smoothstep(uSize * 0.5, uSize * 0.3, dist) * smoothstep(0.2, 0.8, dist);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uScale * 0.012 / -mv.z, 0.6, 9.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_TRANSP}
      varying vec3 vCol; varying float vA; varying vec3 vW;
      void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)); gl_FragColor = vec4(transpFog(vCol * a * vA, vW), 1.0); }`,
  }));
  snow.frustumCulled = false;
  snow.layers.set(1);
  snow.renderOrder = 3;
  group.add(snow);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX'), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const lc = new THREE.Vector3();

  function update(info) {
    group.visible = info.under;
    if (!info.under) return;
    const t = info.time;
    const cam = camera.position;
    const camD = -cam.y;
    const floorAt = ctx.mods?.seafloor?.heightAt;

    // snow brightness: ambient light at this depth, scaled into the exposed range
    waterLight(camD, lc).multiply(DAY.light);   // the daylight down here (spectral Beer–Lambert, with the twilight)
    snowU.uCam.value.copy(cam);
    snowU.uAmb.value.copy(lc).multiplyScalar(0.55);
    snowU.uLamp.value = info.lampOn ? (2.4 / info.gain) * (info.lampFlicker ?? 1) : 0;
    if (ctx.mods?.reefs?.nearReef || ctx.mods?.reefs?.nearCave) {
      snowU.uAmb.value.multiplyScalar(0.35);
      snowU.uLamp.value *= info.insideCave ? 0.15 : 0.3;
    }
    // plankton flash in the hull's wake wherever it is dark enough to see it: in the deep, or anywhere at night
    snowU.uSpark.value = (Math.min(info.vel.length() / 3, 1) * 0.8 + 0.2) * Math.max(THREE.MathUtils.smoothstep(camD, 120, 400), DAY.night) / info.gain;
    camera.getWorldDirection(snowU.uLampDir.value);
    snowU.uScale.value = ctx.renderer.domElement.height;

    for (const S of species) {
      const { def } = S;
      const lo = -def.depth[1], hi = -def.depth[0];
      const visible = !info.insideCave && cam.y - def.vbox * 0.5 < hi && cam.y + def.vbox * 0.5 > lo;
      for (const m of S.meshes) m.visible = visible;
      if (!visible) continue;
      // school centres
      const sc = S.schools.map((s) => {
        const hx = Math.cos(s.h), hz = -Math.sin(s.h);
        const px = s.bx + hx * s.sp * t + Math.sin(t * 0.05 + s.h) * 12;
        const pz = s.bz + hz * s.sp * t + Math.cos(t * 0.04 + s.h) * 12;
        const py = s.by + Math.sin(t * 0.07 + s.h * 3) * 4;
        return { x: cam.x + wrap(px - cam.x, def.box), y: cam.y + wrap(py - cam.y, def.vbox), z: cam.z + wrap(pz - cam.z, def.box), h: s.h, r: s.r, dir: s.dir };
      });
      for (let i = 0; i < S.inst.length; i++) {
        const I = S.inst[i];
        let x, y, z, vx, vy, vz;
        if (def.motion === 'mill' && sc.length) {
          const s = sc[I.school];
          const r = s.r * I.rr;
          const w = (I.sp / Math.max(r, 0.5)) * s.dir;
          const a = I.a0 + w * t;
          x = s.x + Math.cos(a) * r; z = s.z + Math.sin(a) * r;
          y = s.y + I.oy * s.r * 0.9 + Math.sin(t * 0.6 + I.wp) * 0.3;
          vx = -Math.sin(a) * s.dir; vz = Math.cos(a) * s.dir; vy = Math.cos(t * 0.6 + I.wp) * 0.05;
        } else if (def.motion === 'polar' && sc.length) {
          const s = sc[I.school];
          const hx = Math.cos(s.h), hz = -Math.sin(s.h);
          const ox = I.ox * s.r * 2, oz = I.oz * s.r * 2;
          x = s.x + ox * hx - oz * hz + Math.sin(t * 0.5 + I.wp) * 0.4;
          z = s.z + ox * hz + oz * hx + Math.cos(t * 0.4 + I.wp) * 0.4;
          y = s.y + I.oy * s.r;
          vx = hx + Math.cos(t * 0.5 + I.wp) * 0.1; vz = hz; vy = 0;
        } else {
          const hx = Math.cos(I.h), hz = -Math.sin(I.h);
          const turn = def.turn ?? 0.3;
          const A = turn * 25 * I.sp / 4;
          const px = I.bx + hx * I.sp * t, pz = I.bz + hz * I.sp * t;
          const wob = Math.sin(t * I.w + I.wp);
          x = cam.x + wrap(px - hz * A * wob - cam.x, def.box);
          z = cam.z + wrap(pz + hx * A * wob - cam.z, def.box);
          y = cam.y + wrap(I.by + Math.sin(t * I.vw + I.wp) * I.vb * 3 - cam.y, def.vbox);
          const dw = Math.cos(t * I.w + I.wp) * I.w * A;
          vx = hx * I.sp - hz * dw; vz = hz * I.sp + hx * dw; vy = Math.cos(t * I.vw + I.wp) * I.vw * I.vb * 3;
        }
        if (y > lo && y < hi && floorAt) {
          const f = floorAt(x, z) + I.sc * 0.6 + 0.4;
          if (y < f) y = f + (I.by % 3);
        }
        if (y < lo || y > hi || ctx.mods?.reefs?.isRock(pos.set(x, y, z), I.sc * 0.5)) { for (const m of S.meshes) m.setMatrixAt(i, zero); continue; }
        if (def.motion === 'drift') {
          e.set(Math.sin(t * 0.3 + I.wp) * 0.15, I.wp + t * 0.05, Math.cos(t * 0.25 + I.wp) * 0.15);
        } else {
          const hl = Math.hypot(vx, vz);
          e.set(0, Math.atan2(-vz, vx), Math.atan2(vy, hl) * 0.8);
        }
        q.setFromEuler(e);
        pos.set(x, y, z);
        scl.setScalar(I.sc);
        m4.compose(pos, q, scl);
        for (const m of S.meshes) m.setMatrixAt(i, m4);
      }
      for (const m of S.meshes) m.instanceMatrix.needsUpdate = true;
    }
  }

  return { update, species };
}
