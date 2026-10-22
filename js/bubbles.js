// Air bubbles: ballast-vent plumes while diving, the splash-down burst, drifting bubbles in the wave-mixed surface
// layer, exhaust breaths while walking a wreck's decks or the backrooms' floors, and a wake that grows with speed:
// a sparse trickle at a slow walk, a churning, turbulent stream when you sprint or boost the thrusters.
// Bubbles shrink with pressure (Boyle's law), rise at the speed their size gives them, and fade out at the end of
// their lives (or when they pool under a ceiling, or reach the surface) rather than vanishing.
import * as THREE from 'three';
import { G, GLSL_TRANSP } from './materials.js';
import { DAY, waterLight } from './common.js';

const N = 4096;            // the pool: room for a flat-out sprint, allocated once and never grown
const FADE_IN = 0.12, FADE_OUT = 1.2;   // seconds

export function createBubbles(ctx) {
  const { scene, camera } = ctx;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  const rad = new Float32Array(N), seed = new Float32Array(N), fade = new Float32Array(N);
  const life = new Float32Array(N), age = new Float32Array(N);
  const top = new Float32Array(N);       // how high each can rise: the surface (0) or the ceiling it was released under
  const trapped = new Uint8Array(N);
  // free slots, as a stack: a bubble takes the lowest free slot and gives it back when it is gone, so the live ones
  // stay packed at the front of the buffers and only that front part is integrated, uploaded and drawn
  const free = new Int32Array(N);
  let nFree = N, hi = 0, ceiling = 0;
  for (let i = 0; i < N; i++) { free[i] = N - 1 - i; seed[i] = Math.random(); }

  const geo = new THREE.BufferGeometry();
  const attr = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr(pos, 3));
  geo.setAttribute('aRad', attr(rad, 1));
  geo.setAttribute('aFade', attr(fade, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  geo.setDrawRange(0, 0);
  const U = {
    uDepthTex: G.uDepthTex, uRes: G.uRes, uFogT: G.uFogT, uExpo: G.uExpo, uTime: G.uTime,
    uAmb: { value: new THREE.Vector3() }, uLamp: { value: 0 }, uLampDir: { value: new THREE.Vector3() }, uScale: { value: 800 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uScale, uLamp; uniform vec3 uAmb, uLampDir;
      attribute float aRad, aSeed, aFade; varying vec3 vCol; varying vec3 vW; varying float vA;
      void main(){
        vW = position;
        vec4 mv = viewMatrix * vec4(position, 1.0);
        float dist = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aFade > 0.0 ? clamp(aRad * 2.0 * uScale / max(dist, 0.05), 0.0, 90.0) : 0.0;
        vec3 d = normalize(position - cameraPosition);
        float cone = smoothstep(0.80, 0.95, dot(d, uLampDir));
        vCol = uAmb * 1.4 + vec3(1.0, 0.95, 0.88) * uLamp * (0.15 + cone) / (1.0 + dist * dist * 0.02);
        vA = aFade * smoothstep(0.15, 0.6, dist);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_TRANSP}
      varying vec3 vCol; varying vec3 vW; varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        // thin bright meniscus ring, darker core, specular glint from above
        float rim = smoothstep(0.7, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
        float core = 0.06 * (1.0 - r);
        float glint = smoothstep(0.22, 0.0, length(c - vec2(-0.14, -0.16))) * 1.4;
        float lower = smoothstep(0.35, 0.0, length(c - vec2(0.1, 0.22))) * 0.25;
        vec3 col = vCol * (rim * 0.9 + core + glint + lower) * vA;
        gl_FragColor = vec4(transpFog(col, vW), 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.layers.set(1);
  points.renderOrder = 4;
  scene.add(points);

  function emit(x, y, z, r, vx = 0, vy = 0, vz = 0, lifetime = 14) {
    if (nFree === 0) return;   // the pool is full: the newest bubble is the one that never forms
    const i = free[--nFree];
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    rad[i] = r; life[i] = lifetime; age[i] = 0; fade[i] = 0; trapped[i] = 0; top[i] = ceiling;
    if (i >= hi) hi = i + 1;
  }
  function kill(i) {
    life[i] = 0; rad[i] = 0; fade[i] = 0;
    free[nFree++] = i;
  }
  const tmp = new THREE.Vector3(), tv = new THREE.Vector3();
  function emitLocal(lx, ly, lz, r, vlx = 0, vly = 0, vlz = 0, lifetime) {
    tmp.set(lx, ly, lz).applyMatrix4(camera.matrixWorld);
    tv.set(vlx, vly, vlz).applyQuaternion(camera.quaternion);
    emit(tmp.x, tmp.y, tmp.z, r, tv.x, tv.y, tv.z, lifetime);
  }
  const rnd = () => Math.random() * 2 - 1;

  let wasUnder = false, wake = 0;
  const acc = { vent: 0, amb: 0, wake: 0, trickle: 0, breath: 1.5, burst: 0, exhale: 0 };
  const api = { update, stats: { live: 0, wakeRate: 0, pool: N } };
  function update(info) {
    const dt = info.dt;
    points.visible = info.under;
    const d = Math.max(info.depth, 0);
    const shrink = Math.pow(1 + d / 10, -1 / 3);
    ceiling = info.walking && info.ceiling < 0 ? info.ceiling - 0.04 : 0;
    // as the pool fills, every source tapers off, so old bubbles are never cut short to make room for new ones
    const room = THREE.MathUtils.smoothstep(nFree / N, 0.02, 0.25);
    if (info.under && !wasUnder) {
      // splash-down: a cloud of bubbles rolling up over the window
      for (let k = 0; k < 500; k++) emitLocal(rnd() * 2, -1.5 + Math.random() * 2.5, -1.2 - Math.random() * 4, (0.002 + Math.random() ** 3 * 0.02) * shrink, rnd() * 0.2, 0.6 + Math.random(), 0);
    }
    wasUnder = info.under;
    wake = 0;
    if (info.under) {
      const vy = info.vel.y;
      // ballast vent while diving / blowing tanks while surfacing
      acc.vent += dt * room * Math.min(Math.abs(vy) * 30 + (Math.abs(vy) > 0.3 ? 12 : 0), 260);
      while (acc.vent > 1) { acc.vent--; emitLocal(rnd() * 1.2, -1.1 + Math.random() * 0.3, -1.3 - Math.random() * 1.6, (0.0015 + Math.random() ** 2.5 * 0.012) * shrink, 0, 0.25, 0); }

      // The wake. Moving through water drags some of it along and sheds eddies behind you, and the air in your kit and
      // clothing is shaken loose: a few stray bubbles at a slow walk, a dense, churning stream at a sprint. The rate
      // climbs faster than the speed (turbulence grows roughly with its square), each bubble leaves with more of a
      // kick, and at speed they break away in clusters, mostly small ones, as turbulent water tears air apart.
      const walking = info.walking;
      const sp = walking ? info.walkSpeed : Math.hypot(info.vel.x, info.vel.y, info.vel.z);
      const x = sp / (walking ? 1.1 : 4);   // 1 = an ordinary walk on the floor / an ordinary cruise in the sub
      if (sp > 0.12) wake = Math.min((walking ? 9 : 14) * (0.25 + x + 0.6 * x * x) * (info.boost ? 1.35 : 1), 520);
      acc.wake += dt * wake * room;
      const spread = 0.12 + 0.1 * sp, churn = Math.min(x, 4);
      while (acc.wake > 1) {
        const cluster = Math.min(1 + Math.floor(Math.random() * churn), Math.floor(acc.wake));
        acc.wake -= cluster;
        let lx, ly, lz, vx, vyl, vz;
        if (walking) {
          // around your legs and body, from just ahead of you to just behind
          const s = Math.random() < 0.5 ? -1 : 1;
          lx = s * (0.25 + Math.random() * 0.5); ly = -1.35 + Math.random() * 1.05; lz = -0.9 + Math.random() * 1.5;
          vx = s * 0.15 * churn; vyl = 0.15; vz = 0.25 * churn;
        } else {
          // off the thrusters on either side, jetting aft harder the faster you go
          const s = Math.random() < 0.5 ? -1 : 1;
          lx = s * (1.4 + Math.random() * 0.5); ly = -0.6 + Math.random() * 0.6; lz = -1.0 - Math.random() * 1.5;
          vx = s * 0.2; vyl = 0.1; vz = 0.6 + 0.25 * sp;
        }
        for (let c = 0; c < cluster; c++) {
          const r = (0.0012 + Math.random() ** 3 * (0.004 + 0.002 * churn)) * (walking ? 1 : shrink);
          emitLocal(lx + rnd() * 0.06 * c, ly + rnd() * 0.06 * c, lz + rnd() * 0.06 * c, r,
            vx + rnd() * spread, vyl + rnd() * spread * 0.5, vz + rnd() * spread, 3 + Math.random() * 5);
        }
      }
      // ...and the water you push aside carries the bubbles already in it along with you
      if (sp > 0.12) {
        const pushX = info.vel.x * 0.35, pushZ = info.vel.z * 0.35, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        const k = 1 - Math.exp(-dt * 1.2);
        for (let i = 0; i < hi; i++) {
          if (life[i] <= 0 || trapped[i]) continue;
          const dx = pos[i * 3] - cx, dy = pos[i * 3 + 1] - cy, dz = pos[i * 3 + 2] - cz;
          if (dx * dx + dy * dy + dz * dz > 2.25) continue;   // within 1.5 m of you
          vel[i * 3] += (pushX - vel[i * 3]) * k; vel[i * 3 + 2] += (pushZ - vel[i * 3 + 2]) * k;
        }
      }

      // occasional trickle from hull fittings
      if (!walking) {
        acc.trickle += dt * 3 * room;
        while (acc.trickle > 1) { acc.trickle--; emitLocal(rnd() * 1.5, -1.2, -1.5 - Math.random(), 0.0015 * shrink + Math.random() * 0.002 * shrink, 0, 0.2, 0); }
      }
      if (walking) {
        // every breath out leaves the exhaust valve as a burst rising past the right of the view, quicker and fuller
        // the harder you are moving. The valve, not the depth, sets their size (the gas leaves at the pressure
        // around it), so no shrink here.
        const effort = Math.min(info.walkSpeed / 3, 1);
        acc.breath -= dt;
        if (acc.breath <= 0) { acc.breath = (4.2 - 2.7 * effort) * (0.85 + Math.random() * 0.3); acc.burst += (14 + effort * 26) * room; }
        const out = Math.min(acc.burst, dt * 70);   // a breath takes about half a second to leave
        acc.burst -= out; acc.exhale += out;
        while (acc.exhale > 1) { acc.exhale--; emitLocal(0.25 + Math.random() * 0.25, -0.35 + Math.random() * 0.25, -0.7 - Math.random() * 0.4, 0.0025 + Math.random() ** 2.5 * 0.0085, 0.06 + Math.random() * 0.1, 0.3 + Math.random() * 0.35, -0.05, 6 + Math.random() * 4); }
      }
      // wave-entrained bubbles in the top ~20 m
      if (d < 25) {
        acc.amb += dt * 90 * Math.exp(-d / 6) * room;
        while (acc.amb > 1) {
          acc.amb--;
          const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 18;
          emit(camera.position.x + Math.cos(a) * r, camera.position.y - 6 + Math.random() * 12, camera.position.z + Math.sin(a) * r, 0.001 + Math.random() ** 3 * 0.008, 0, 0.1, 0);
        }
      }
    }

    // integrate: buoyant rise (bigger bubbles rise faster and wobble), drag bleeding off the turbulence they left with
    const t = info.time;
    const drag = Math.exp(-dt * 1.5), slide = Math.exp(-dt * 0.4), relax = 1 - Math.exp(-dt * 2);
    let newHi = 0, live = 0;
    for (let i = 0; i < hi; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt; age[i] += dt;
      const r = rad[i], o = i * 3;
      if (trapped[i]) {
        // pooled under a ceiling: it wanders along it, slowing, while it fades
        vel[o] *= slide; vel[o + 2] *= slide;
        pos[o] += vel[o] * dt; pos[o + 2] += vel[o + 2] * dt;
      } else {
        const rise = 0.12 + Math.min(r, 0.006) * 45;
        vel[o] *= drag; vel[o + 2] *= drag;
        vel[o + 1] += (rise - vel[o + 1]) * relax;
        const wob = r * 60;
        pos[o] += (vel[o] + Math.sin(t * 9 + seed[i] * 40) * wob) * dt;
        pos[o + 1] += vel[o + 1] * dt;
        pos[o + 2] += (vel[o + 2] + Math.cos(t * 8 + seed[i] * 30) * wob) * dt;
        if (top[i] < 0 && pos[o + 1] > top[i]) {
          pos[o + 1] = top[i]; trapped[i] = 1; vel[o + 1] = 0;
          const a = seed[i] * 40;
          vel[o] += Math.cos(a) * 0.12; vel[o + 2] += Math.sin(a) * 0.12;
          life[i] = Math.min(life[i], FADE_OUT + 0.3 + seed[i] * 1.5);
        } else if (pos[o + 1] > 0) {
          pos[o + 1] = 0; trapped[i] = 1; vel[o + 1] = 0;   // at the surface it bursts: a quick fade
          life[i] = Math.min(life[i], 0.15);
        }
      }
      if (life[i] <= 0) { kill(i); continue; }
      fade[i] = Math.min(1, age[i] / FADE_IN) * Math.min(1, life[i] / (trapped[i] && pos[o + 1] >= 0 ? 0.15 : FADE_OUT));
      newHi = i + 1; live++;
    }
    hi = newHi;
    for (const name of ['position', 'aRad', 'aFade']) {
      const a = geo.attributes[name];
      a.clearUpdateRanges();
      if (hi > 0) { a.addUpdateRange(0, hi * a.itemSize); a.needsUpdate = true; }
    }
    geo.setDrawRange(0, hi);
    api.stats.live = live; api.stats.wakeRate = wake;

    const cd = Math.max(-camera.position.y, 0);
    waterLight(cd, U.uAmb.value).multiply(DAY.light).multiplyScalar(0.9);
    U.uLamp.value = info.lampOn ? (6 / info.gain) * (info.lampFlicker ?? 1) : 0;
    camera.getWorldDirection(U.uLampDir.value);
    U.uScale.value = ctx.renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  return api;
}
