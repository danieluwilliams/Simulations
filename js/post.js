// HDR render pipeline:
//   scene (opaque) → half-res volumetrics (sun shafts + hull-light beams shadowed by what they hit) and half-res
//   ambient occlusion (both with a depth-aware blur) → fog composite → transparent pass → bloom → filmic grade.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLSL_NOISE, GLSL_SEEN, SEEN_LUT, SUN_DIR_WATER, KD } from './common.js';
import { CAUSTIC_TILE } from './caustics.js';

const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const VERT = `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fsPass(material) {
  const mesh = new THREE.Mesh(quadGeo, material);
  mesh.frustumCulled = false;
  return { material, render(renderer, target) { renderer.setRenderTarget(target); renderer.render(mesh, quadCam); } };
}

// shared: rebuild world position / distance from the depth buffer
const GLSL_RECON = `
  uniform sampler2D tDepth; uniform mat4 uProjInv; uniform mat4 uCamWorld; uniform vec3 uCamPos;
  float sceneDist(vec2 uv, out vec3 rd){
    float d = texture2D(tDepth, uv).r;
    vec4 vp = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    vec3 wp = (uCamWorld * vp).xyz;
    rd = normalize(wp - uCamPos);
    return d >= 0.99999 ? 1e5 : length(wp - uCamPos);
  }`;

export function createPipeline(renderer) {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples) });
  sceneRT.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
  const compRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: true });
  const half = () => [Math.max(1, size.x >> 1), Math.max(1, size.y >> 1)];
  const volRT = new THREE.WebGLRenderTarget(...half(), { type: THREE.HalfFloatType, depthBuffer: false });
  const blurRT = new THREE.WebGLRenderTarget(...half(), { type: THREE.HalfFloatType, depthBuffer: false });
  const aoRT = new THREE.WebGLRenderTarget(...half(), { type: THREE.HalfFloatType, depthBuffer: false });

  const shared = {
    tDepth: { value: sceneRT.depthTexture },
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uTime: { value: 0 }, uSunW: { value: SUN_DIR_WATER.clone() }, uE0: { value: new THREE.Vector3(3.2, 3.15, 3.0) },
    uKd: { value: KD.clone() },
    uSigmaT: { value: new THREE.Vector3(0.46, 0.075, 0.052) },
    uSigmaS: { value: new THREE.Vector3(0.016, 0.042, 0.046) },
    uExposure: { value: 0.55 },
    uLamp: { value: 0 }, uLampColor: { value: new THREE.Vector3(1.0, 0.93, 0.82) },
    uLampDust: { value: 0 },   // 0 clear water … 1 silt-laden: the beam shows curtains and wisps of drifting particulate
    uSunAmt: { value: 1 },   // share of direct sunlight left (sun shafts fade as it sets)
    uLampPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uLampDir: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uLampCos: { value: new THREE.Vector2(0.91, 0.98) },   // cos of the floodlights' outer and inner cone angles
    // the floodlights' own shadow maps, so whatever their beams strike casts a shadow back through the water
    uLampShadow0: { value: null }, uLampShadow1: { value: null }, uLampShadowOn: { value: 0 },
    uLampShadowMat: { value: [new THREE.Matrix4(), new THREE.Matrix4()] }, uLampNF: { value: new THREE.Vector2(0.3, 170) },
    uNear: { value: 0.1 }, uFar: { value: 6000 },
    // daylight down the water column (spectral Beer–Lambert, with the twilight), the caustic tile that shapes the
    // shafts, and the sun's shadow map so whatever stands in the light (coral heads, a cave mouth) casts a shaft of shade
    uSeenLUT: { value: SEEN_LUT }, uCausTex: { value: null },
    uSunShadow: { value: null }, uSunShadowMat: { value: new THREE.Matrix4() }, uSunShadowOn: { value: 0 },
  };

  // ------------------------------------------------------------ volumetric in-scatter (half res)
  const vol = fsPass(new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, uniforms: shared, vertexShader: VERT,
    fragmentShader: /* glsl */`
      precision highp float;
      #include <packing>
      ${GLSL_NOISE}
      ${GLSL_SEEN}
      ${GLSL_RECON}
      uniform sampler2D uCausTex, uSunShadow; uniform mat4 uSunShadowMat; uniform float uSunShadowOn;
      uniform float uTime, uLamp, uSunAmt, uLampDust;
      uniform vec3 uSunW, uE0, uKd, uSigmaT, uSigmaS, uLampColor;
      uniform vec3 uLampPos[2]; uniform vec3 uLampDir[2]; uniform vec2 uLampCos;
      uniform sampler2D uLampShadow0, uLampShadow1; uniform mat4 uLampShadowMat[2]; uniform vec2 uLampNF; uniform float uLampShadowOn;
      varying vec2 vUv;
      float hg(float c, float g){ float g2 = g*g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0*g*c, 1.5)); }
      // does floodlight k reach p, or is something in the way? (compared in metres along the beam, not raw depth)
      float lampLit(int k, vec3 p){
        if (uLampShadowOn < 0.5) return 1.0;
        vec4 sc = uLampShadowMat[k] * vec4(p, 1.0);
        if (sc.w <= 0.0) return 1.0;
        sc.xyz /= sc.w;
        if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
        float d = unpackRGBAToDepth(k == 0 ? texture2D(uLampShadow0, sc.xy) : texture2D(uLampShadow1, sc.xy));
        float zp = -perspectiveDepthToViewZ(sc.z, uLampNF.x, uLampNF.y), zs = -perspectiveDepthToViewZ(d, uLampNF.x, uLampNF.y);
        return step(zp, zs + 0.05 + zp * 0.01);
      }
      // is this point of water in the sun, or in the shadow of something between it and the surface?
      float sunLit(vec3 p){
        if (uSunShadowOn < 0.5) return 1.0;
        vec4 sc = uSunShadowMat * vec4(p, 1.0);
        sc.xyz /= sc.w;
        if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
        return step(sc.z - 0.002, unpackRGBAToDepth(texture2D(uSunShadow, sc.xy)));
      }
      void main(){
        vec3 rd;
        float dist = sceneDist(vUv, rd);
        float tMax = min(dist, 160.0);
        const int STEPS = 16;
        bool shafts = uCamPos.y > -260.0 && uSunAmt > 0.03;
        float jitter = hash12(gl_FragCoord.xy);            // static per pixel; removed by the blur
        float ds = tMax / float(STEPS);
        vec3 T = vec3(1.0), inS = vec3(0.0);
        float phaseSun = hg(dot(rd, uSunW), 0.82) * 0.75 + 0.25 / 12.566;
        vec3 stepT = exp(-uSigmaT * ds);
        for (int i = 0; i < STEPS; i++) {
          float t = (float(i) + jitter) * ds;
          vec3 p = uCamPos + rd * t;
          float z = max(-p.y, 0.0);
          vec3 L = uE0 * seenAt(z);   // the daylight that reaches this depth
          float sh = 0.55;
          if (shafts && z < 140.0) {
            // god rays are the caustics seen edge-on: the light the surface ripples focus, streaming down along the
            // refracted sun. The same tile the seabed samples, much enlarged and blurred (the long swell focuses the
            // broad shafts), and shaded wherever something blocks the sun
            vec2 ps = p.xz + uSunW.xz / max(uSunW.y, 0.2) * z;
            sh = textureLod(uCausTex, ps / ${(CAUSTIC_TILE * 6).toFixed(1)}, 4.5).r * 0.35;
            sh = mix(sh, 0.55, clamp(z / 110.0, 0.0, 1.0)) * sunLit(p);
          }
          vec3 s = L * (sh * phaseSun * 4.0 * mix(0.25, 1.0, uSunAmt) + 0.35 / 12.566 * 4.0);
          inS += T * uSigmaS * s * ds;
          T *= stepT;
        }
        // the floodlights' glow lies within a few metres of the hull, far finer than the 10 m steps above resolve:
        // march it separately with the samples packed towards the lamps, only as wide as the spotlights' own cones.
        // Whatever the beams strike shadows the water behind it, as an ROV's lights throw the wreck's shadow into the haze.
        if (uLamp > 0.0) {
          const int LSTEPS = 24;
          float tL = min(dist, 48.0);
          for (int i = 0; i < LSTEPS; i++) {
            float u = (float(i) + jitter) / float(LSTEPS);
            float t = u * u * tL, dt = 2.0 * u * tL / float(LSTEPS);
            vec3 p = uCamPos + rd * t;
            // in silty water the scattering is not even: suspended matter hangs in slowly drifting curtains and wisps,
            // so the beam shows texture and moves (two octaves of value noise, drifting and sinking)
            float dens = 1.0;
            if (uLampDust > 0.0) {
              vec3 q = p * 0.75 + vec3(uTime * 0.045, uTime * 0.03, -uTime * 0.035);
              float n = vnoise(q) * 0.62 + vnoise(q * 2.9 + 11.0) * 0.38;
              dens = mix(1.0, 0.15 + 2.3 * smoothstep(0.28, 0.82, n), uLampDust);
            }
            for (int k = 0; k < 2; k++) {
              vec3 lv = p - uLampPos[k];
              float ld = length(lv) + 0.0001;
              float cone = smoothstep(uLampCos.x, uLampCos.y, dot(lv / ld, uLampDir[k]));
              if (cone > 0.0) inS += uSigmaS * uLampColor * uLamp * dens * cone * lampLit(k, p) * exp(-uSigmaT * (t + ld)) / (ld * ld * 0.35 + 0.8) * dt;
            }
          }
        }
        if (dist > tMax) {
          vec3 pe = uCamPos + rd * tMax;
          vec3 Le = uE0 * seenAt(max(-pe.y, 0.0)) * (0.35 + 0.65 * phaseSun * 12.566 * 0.18);
          vec3 Tfar = exp(-uSigmaT * (min(dist, 4000.0) - tMax));
          inS += T * (uSigmaS / uSigmaT) * Le * (1.0 - Tfar) * 0.32;
        }
        gl_FragColor = vec4(inS, 1.0);
      }`,
  }));

  // ------------------------------------------------------------ depth-aware separable blur
  const blurMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, vertexShader: VERT,
    uniforms: { tSrc: { value: null }, tDepth: shared.tDepth, uDir: { value: new THREE.Vector2() }, uNear: shared.uNear, uFar: shared.uFar },
    fragmentShader: /* glsl */`
      uniform sampler2D tSrc; uniform sampler2D tDepth; uniform vec2 uDir; uniform float uNear, uFar;
      varying vec2 vUv;
      float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
      void main(){
        float c = lin(texture2D(tDepth, vUv).r);
        vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = -6; i <= 6; i++) {
          vec2 uv = vUv + uDir * float(i);
          float w = exp(-float(i * i) / 18.0);
          float dz = abs(lin(texture2D(tDepth, uv).r) - c) / max(c, 0.5);
          w *= exp(-dz * 12.0);
          acc += texture2D(tSrc, uv).rgb * w; wsum += w;
        }
        gl_FragColor = vec4(acc / max(wsum, 1e-4), 1.0);
      }`,
  });
  const blur = fsPass(blurMat);

  // ------------------------------------------------------------ ambient occlusion (half res, from depth alone)
  // corners, seams and the ground under things lose the light scattered in from all around them: what turns a lit
  // crevice, the foot of a bulkhead or the gap between coral heads nearly black in real footage
  const aoMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, vertexShader: VERT,
    uniforms: { tDepth: shared.tDepth, uProjInv: shared.uProjInv, uProjScale: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.9 } },
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uProjScale, uTexel; uniform float uRadius;
      varying vec2 vUv;
      float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 viewPos(vec2 uv){ vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).r * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
      void main(){
        // centre on a full-resolution depth texel: at this half-resolution pixel's own centre (a texel corner) a
        // neighbour can read back the same texel, which leaves no slope to take a normal from
        vec2 uv = (floor(vUv / uTexel) + 0.5) * uTexel;
        if (texture2D(tDepth, uv).r >= 0.99999) { gl_FragColor = vec4(1.0); return; }
        vec3 P = viewPos(uv);
        // surface normal from the nearer neighbour on each side, so silhouettes don't smear into it
        vec3 r = viewPos(uv + vec2(uTexel.x, 0.0)) - P, l = P - viewPos(uv - vec2(uTexel.x, 0.0));
        vec3 t = viewPos(uv + vec2(0.0, uTexel.y)) - P, b = P - viewPos(uv - vec2(0.0, uTexel.y));
        vec3 N = normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(t.z) < abs(b.z) ? t : b));
        // a spiral of samples over a disc uRadius metres across at this depth; whatever rises above the surface's
        // tangent plane nearby shades it, and things much further off (a background behind an edge) don't
        vec2 disc = min(uRadius * uProjScale / -P.z, vec2(0.12));
        float rot = hash(gl_FragCoord.xy) * 6.2832, occ = 0.0;
        for (int i = 0; i < 12; i++) {
          float fi = float(i) + 0.5, a = fi * 2.39996 + rot;
          vec3 v = viewPos(uv + vec2(cos(a), sin(a)) * sqrt(fi / 12.0) * disc) - P;
          float len = length(v);
          occ += max(0.0, dot(v / max(len, 1e-4), N) - 0.12) * (1.0 - smoothstep(uRadius, uRadius * 2.0, len));
        }
        gl_FragColor = vec4(vec3(1.0 - clamp(occ / 12.0 * 3.0, 0.0, 1.0)), 1.0);
      }`,
  });
  const ao = fsPass(aoMat);

  // ------------------------------------------------------------ fog composite
  const comp = fsPass(new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, vertexShader: VERT,
    uniforms: { ...shared, tColor: { value: sceneRT.texture }, tVol: { value: volRT.texture }, uUnder: { value: 0 },
      tAO: { value: aoRT.texture }, uAO: { value: 0 } },
    fragmentShader: /* glsl */`
      precision highp float;
      ${GLSL_RECON}
      uniform sampler2D tColor; uniform sampler2D tVol; uniform sampler2D tAO;
      uniform float uUnder, uTime, uExposure, uAO; uniform vec3 uSigmaT;
      varying vec2 vUv;
      void main(){
        vec2 uv = vUv;
        vec3 col = texture2D(tColor, uv).rgb;
        if (uUnder < 0.5) { gl_FragColor = vec4(col * uExposure, 1.0); return; }
        // occlusion darkens the surfaces themselves, not the lit water between them and the eye
        if (uAO > 0.0) col *= mix(1.0, texture2D(tAO, uv).r, uAO);
        vec3 rd;
        float dist = sceneDist(uv, rd);
        vec3 Ttot = exp(-uSigmaT * min(dist, 4000.0));
        col = col * Ttot + texture2D(tVol, uv).rgb;
        // one bad pixel (NaN/inf from a degenerate normal) would be smeared over the whole frame by the bloom
        // (some drivers optimise isnan away, so infinities are also clamped arithmetically)
        if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
        col = min(col, vec3(30000.0));
        gl_FragColor = vec4(col * uExposure, 1.0);
      }`,
  }));

  const bloom = new UnrealBloomPass(size.clone(), 0.18, 0.18, 1.8);

  // ------------------------------------------------------------ final: unobstructed filmic grade
  const final = fsPass(new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, vertexShader: VERT,
    uniforms: { tColor: { value: compRT.texture }, uScot: { value: 0 },
      uWB: { value: new THREE.Vector3(1, 1, 1) }, uVib: { value: 0 } },
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D tColor; uniform float uScot, uVib; uniform vec3 uWB;
      varying vec2 vUv;
      float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
      vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
      void main(){
        vec3 col = texture2D(tColor, vUv).rgb;
        // shallow-water white balance and vibrance, as a diver's eye or a dive camera sees a reef: what little red
        // survives is lifted, and dull tones gain colour while already-vivid ones are left alone
        col *= uWB;
        if (uVib > 0.0) {
          float mx = max(max(col.r, col.g), col.b), mn = min(min(col.r, col.g), col.b);
          float sat = (mx - mn) / max(mx, 1e-4), L = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = max(mix(vec3(L), col, 1.0 + uVib * (1.0 - sat)), 0.0);
        }
        // night vision: as the eye goes over to rods, colour drains out of dim things and what is left shifts
        // towards blue-grey (the Purkinje shift); lights, glows and stars stay coloured
        if (uScot > 0.0) {
          float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
          float rod = uScot * (1.0 - smoothstep(0.02, 0.5, L));
          col = mix(col, L * vec3(0.62, 0.82, 1.2) * 1.08, rod * 0.85);
        }
        col = aces(col);
        col = toSRGB(col);
        // tiny ordered dither to prevent banding (static, invisible)
        col += (h(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));

  function setSize(w, h) {
    size.set(w, h);
    sceneRT.setSize(w, h);
    sceneRT.depthTexture.image.width = w; sceneRT.depthTexture.image.height = h;
    compRT.setSize(w, h);
    volRT.setSize(...half()); blurRT.setSize(...half()); aoRT.setSize(...half());
    bloom.setSize(w, h);
  }

  function render(scene, camera, state) {
    renderer.info.autoReset = false;
    renderer.info.reset();
    shared.uProjInv.value.copy(camera.projectionMatrixInverse);
    shared.uCamWorld.value.copy(camera.matrixWorld);
    shared.uCamPos.value.copy(camera.position);
    shared.uTime.value = state.time;
    shared.uExposure.value = state.exposure;
    shared.uLamp.value = state.lamp;
    shared.uLampDust.value = state.lampDust ?? 0;
    shared.uNear.value = camera.near; shared.uFar.value = camera.far;
    if (state.lamps) for (let i = 0; i < 2; i++) { shared.uLampPos.value[i].copy(state.lamps[i].pos); shared.uLampDir.value[i].copy(state.lamps[i].dir); }
    comp.material.uniforms.uUnder.value = state.under ? 1 : 0;

    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.shadowMap.needsUpdate = true;   // once per frame, for the opaque pass only
    renderer.render(scene, camera);
    // the floodlights' shadow maps were redrawn by that pass
    const ss = state.sunShadow;
    shared.uSunShadowOn.value = ss?.map ? 1 : 0;
    if (ss?.map) { shared.uSunShadow.value = ss.map.texture; shared.uSunShadowMat.value.copy(ss.matrix); }
    if (state.lampShadows) {
      state.lampShadows.forEach((s, i) => { shared['uLampShadow' + i].value = s.map ? s.map.texture : null; shared.uLampShadowMat.value[i].copy(s.matrix); });
      shared.uLampNF.value.set(state.lampShadows[0].camera.near, state.lampShadows[0].camera.far);
      shared.uLampShadowOn.value = state.lampShadows.every((s) => s.map) ? 1 : 0;
    }
    const blurInto = (src, tmp) => {
      const [hw, hh] = half();
      blurMat.uniforms.tSrc.value = src.texture; blurMat.uniforms.uDir.value.set(1.5 / hw, 0);
      blur.render(renderer, tmp);
      blurMat.uniforms.tSrc.value = tmp.texture; blurMat.uniforms.uDir.value.set(0, 1.5 / hh);
      blur.render(renderer, src);
    };
    const aoAmt = state.under ? (state.ao ?? 0) : 0;
    if (state.under) {
      vol.render(renderer, volRT);
      blurInto(volRT, blurRT);
      if (aoAmt > 0) {
        aoMat.uniforms.uProjScale.value.set(camera.projectionMatrix.elements[0] * 0.5, camera.projectionMatrix.elements[5] * 0.5);
        aoMat.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
        ao.render(renderer, aoRT);
        blurInto(aoRT, blurRT);
      }
    }
    comp.material.uniforms.uAO.value = aoAmt;
    comp.render(renderer, compRT);
    renderer.setRenderTarget(compRT);
    renderer.clearDepth();
    if (state.under) {
      camera.layers.set(1);
      renderer.render(scene, camera);
      camera.layers.set(0);
    }
    bloom.strength = state.bloom;
    bloom.render(renderer, null, compRT, 0, false);
    const fu = final.material.uniforms;
    fu.uScot.value = state.scotopic ?? 0;
    if (state.wb) fu.uWB.value.copy(state.wb); else fu.uWB.value.set(1, 1, 1);
    fu.uVib.value = state.vibrance ?? 0;
    final.render(renderer, null);
  }

  return { render, setSize, comp, final, bloom, sceneRT, shared };
}
