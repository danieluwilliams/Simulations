// The sky over the open Pacific from late afternoon through sunset and twilight into a moonless night.
//  - the sun follows its real path for latitude 22° N (declination +12°), compressed into a ~17-minute session
//  - atmosphere: Rayleigh + Mie scattering with ozone absorption and the planet's shadow, ray-marched into a small
//    sky-view table whenever the sun moves; this is what gives the orange horizon, the pink Belt of Venus over the
//    blue shadow of the Earth, and the deep blue of twilight
//  - two cloud layers lit by sunlight that has crossed the atmosphere (they glow red after the sea is in shadow)
//  - a star field that turns with the sky, with the Milky Way, faint airglow and twinkling near the horizon
import * as THREE from 'three';
import { GLSL_NOISE } from './common.js';

const D2R = Math.PI / 180;
const LAT = 22 * D2R, DEC = 12 * D2R;
const sinL = Math.sin(LAT), cosL = Math.cos(LAT), sinD = Math.sin(DEC), cosD = Math.cos(DEC);
// session seconds → true solar elevation (°): late afternoon, golden hour from ~3 min, sunset at ~6½ min,
// the blue hour, and full night by 12 minutes
const SCHEDULE = [[0, 24], [240, 8], [420, -1], [570, -7], [720, -18]];
// world frame: west = -Z (where the sub faces at the start), north = +X, east = +Z
const POLE = new THREE.Vector3(cosL, sinL, 0), MERID = new THREE.Vector3(-sinL, cosL, 0), EAST = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------- atmosphere (shared by GPU and CPU)
const RE = 6360e3, RA = 6460e3;
// clean maritime air: less haze (Mie) than a continental sky, so a smaller, less milky glow round the sun
const BR = [5.802e-6, 13.558e-6, 33.1e-6], BMS = 2.6e-6, BME = 2.9e-6, BO = [0.65e-6, 1.881e-6, 0.085e-6];
const ATMOS = /* glsl */`
  const float RE = ${RE.toFixed(1)}, RA = ${RA.toFixed(1)};
  const vec3 BR = vec3(${BR.map((v) => v.toExponential(4)).join(',')});
  const float BMS = ${BMS.toExponential(4)}, BME = ${BME.toExponential(4)};
  const vec3 BO = vec3(${BO.map((v) => v.toExponential(4)).join(',')});
  vec3 densities(float h){ return vec3(exp(-h / 8000.0), exp(-h / 1200.0), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0)); }
  vec3 extinctionOf(vec3 d){ return BR * d.x + BME * d.y + BO * d.z; }
  float sphereFar(vec3 ro, vec3 rd, float R){ float b = dot(ro, rd), c = dot(ro, ro) - R * R, k = b * b - c; return k < 0.0 ? -1.0 : -b + sqrt(k); }
  float sphereNear(vec3 ro, vec3 rd, float R){ float b = dot(ro, rd), c = dot(ro, ro) - R * R, k = b * b - c; return k < 0.0 ? -1.0 : -b - sqrt(k); }
`;

// transmittance of sunlight from sea level along direction d (CPU, for lights and the visible disk)
function transmittance(d, out) {
  const ox = 0, oy = RE + 2, oz = 0;
  const b = oy * d.y, c = oy * oy - RE * RE, k = b * b - c;
  if (k > 0 && -b - Math.sqrt(k) > 0) return out.set(0, 0, 0);
  const cA = oy * oy - RA * RA, tmax = -b + Math.sqrt(b * b - cA);
  const N = 80, dt = tmax / N;
  let r = 0, g = 0, bl = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * dt, x = ox + d.x * t, y = oy + d.y * t, z = oz + d.z * t;
    const h = Math.max(Math.hypot(x, y, z) - RE, 0);
    const dR = Math.exp(-h / 8000), dM = Math.exp(-h / 1200), dO = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
    r += (BR[0] * dR + BME * dM + BO[0] * dO) * dt;
    g += (BR[1] * dR + BME * dM + BO[1] * dO) * dt;
    bl += (BR[2] * dR + BME * dM + BO[2] * dO) * dt;
  }
  return out.set(Math.exp(-r), Math.exp(-g), Math.exp(-bl));
}
const lum = (v) => v.x * 0.2126 + v.y * 0.7152 + v.z * 0.0722;
// diffuse skylight on a horizontal surface (log10 lux) against solar elevation: measured twilight illuminance
const SKYLUX = [[-90, -3.3], [-18, -3.2], [-15, -2.85], [-12, -2.1], [-9, -0.9], [-6, 0.55], [-4, 1.25], [-2, 1.9], [0, 2.55], [2, 3.0], [5, 3.5], [10, 3.9], [20, 4.15], [30, 4.25], [90, 4.4]];
// Eye adaptation. The exposure is solved so that the overhead sky reads on screen as LOOK says: an even, unhurried
// fall from the bright afternoon to a deep navy night that never dips through black on the way (a sky that fades
// to black and comes back reads as someone dimming the screen). ZENITH is the overhead brightness of the rendered
// atmosphere (log10, measured from the sky tables); NIGHT_SKY is airglow and unresolved starlight, which take over
// once the twilight has gone. The horizon afterglow is far brighter than the zenith, so the dome compresses its
// highlights (uClip) rather than letting it burn out.
const ZENITH = [[-90, -12], [-10, -7], [-8.67, -5.78], [-7.34, -4.66], [-6, -3.72], [-4.67, -2.97], [-3.34, -2.34], [-2.34, -1.97], [-1.39, -1.67], [0.2, -1.31], [4.43, -0.86], [27, -0.5], [90, -0.46]];
const LOOK = [[-90, -2.05], [-12, -2.05], [-9, -2.02], [-6, -1.95], [-4.5, -1.88], [-3, -1.81], [0, -1.68], [5, -1.52], [20, -1.4], [90, -1.38]];
const NIGHT_SKY = 5.7e-6;
const adaptGain = (h) => THREE.MathUtils.clamp(Math.pow(10, interp(LOOK, h)) / (0.22 * (Math.pow(10, interp(ZENITH, h)) + NIGHT_SKY)), 0.4, 9000);
// colour of the diffuse skylight: blue day sky, warm at sunset, the blue hour, then night
const SKYCOL = [[-90, [0.6, 0.7, 1.2]], [-12, [0.6, 0.7, 1.2]], [-4, [0.5, 0.7, 1.55]], [2, [1.0, 0.85, 0.8]], [12, [0.8, 0.93, 1.22]], [90, [0.8, 0.93, 1.22]]];
function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, a] = table[i - 1], [x1, b] = table[i], t = (x - x0) / (x1 - x0);
      return Array.isArray(a) ? a.map((v, j) => v + (b[j] - v) * t) : a + (b - a) * t;
    }
  }
  return table[table.length - 1][1];
}
// atmospheric refraction (arc-minutes) for a true elevation (Saemundsson), tapering off once the sun is well down
function refraction(h) { if (h < -2) return 0; const hh = Math.max(h, -0.9); return (1.02 / Math.tan((hh + 10.3 / (hh + 5.11)) * D2R)) * THREE.MathUtils.smoothstep(h, -2, -0.9); }
const hourAngleFor = (hDeg) => Math.acos(THREE.MathUtils.clamp((Math.sin(hDeg * D2R) - sinD * sinL) / (cosD * cosL), -1, 1));
function sunVector(H, out) {
  return out.copy(POLE).multiplyScalar(sinD).addScaledVector(MERID, cosD * Math.cos(H)).addScaledVector(EAST, -cosD * Math.sin(H));
}
// world → celestial frame (stars are fixed there)
function celestial(H, out) {
  const c = Math.cos(H), s = Math.sin(H);
  const r0 = MERID.clone().multiplyScalar(c).addScaledVector(EAST, -s), r1 = MERID.clone().multiplyScalar(-s).addScaledVector(EAST, -c);
  return out.set(r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, POLE.x, POLE.y, POLE.z);
}

// ---------------------------------------------------------------- shaders
const LUT_FRAG = /* glsl */`
  precision highp float;
  ${ATMOS}
  uniform vec3 uSun; uniform float uMie, uTwi;
  varying vec2 vUv;
  vec3 sunT(vec3 p){
    if (sphereNear(p, uSun, RE) > 0.0) return vec3(0.0);    // in the planet's shadow
    float tmax = sphereFar(p, uSun, RA), dt = tmax / 8.0;
    vec3 od = vec3(0.0);
    for (int i = 0; i < 8; i++) { vec3 q = p + uSun * (float(i) + 0.5) * dt; od += extinctionOf(densities(max(length(q) - RE, 0.0))) * dt; }
    return exp(-od);
  }
  void main(){
    // texel → view direction: azimuth measured from the sun (the sky is mirror-symmetric about it),
    // elevation squeezed towards the horizon where the colour changes fastest
    float t = vUv.y * 2.0 - 1.0;
    float el = sign(t) * t * t * 1.5707963;
    float az = vUv.x * 3.14159265;
    vec2 sh = normalize(uSun.xz + vec2(1e-6, 0.0)), sp = vec2(-sh.y, sh.x);
    vec2 hz = cos(az) * sh + sin(az) * sp;
    vec3 rd = vec3(hz.x * cos(el), sin(el), hz.y * cos(el));
    vec3 ro = vec3(0.0, RE + 2.0, 0.0);
    float tmax = sphereFar(ro, rd, RA), tg = sphereNear(ro, rd, RE);
    if (tg > 0.0) tmax = tg;
    vec3 T = vec3(1.0), sR = vec3(0.0), sM = vec3(0.0), sMS = vec3(0.0);
    float prev = 0.0;
    for (int i = 0; i < 30; i++) {
      float f = (float(i) + 1.0) / 30.0, tc = tmax * f * f, dt = tc - prev, tm = 0.5 * (prev + tc);
      prev = tc;
      vec3 p = ro + rd * tm;
      vec3 dn = densities(max(length(p) - RE, 0.0));
      vec3 ext = extinctionOf(dn), stepT = exp(-ext * dt);
      vec3 integ = T * (1.0 - stepT) / max(ext, vec3(1e-12));
      vec3 Ts = sunT(p);
      sR += integ * Ts * dn.x;
      sM += integ * Ts * dn.y;
      // light scattered more than once: sunlit air re-lights its surroundings, and air already in the Earth's
      // shadow is lit by the blue twilight sky around it (scaled by the measured twilight illuminance, uTwi)
      sMS += integ * (Ts * 0.5 + vec3(0.4, 0.62, 1.0) * uTwi) * (BR * dn.x + BMS * dn.y);
      T *= stepT;
    }
    float mu = dot(rd, uSun);
    vec3 col = uMie > 0.5 ? sM * BMS : sR * BR * 0.0596831 * (1.0 + mu * mu) + sMS * 0.0795775;
    gl_FragColor = vec4(col, 1.0);
  }`;

const DOME_VERT = /* glsl */`
  varying vec3 vDir;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w;   // on the far plane
  }`;

const DOME_FRAG = /* glsl */`
  precision highp float;
  ${GLSL_NOISE}
  ${ATMOS}
  uniform sampler2D uLutR, uLutM;
  uniform vec3 uSun, uSunDisk, uGalPole, uGalCenter;
  uniform mat3 uCel;
  uniform vec2 uWind;
  uniform float uTime, uPix, uNight, uCube, uScale, uCover, uSunFlat, uClip;
  varying vec3 vDir;
  const float PI = 3.14159265;
  // the eye's local adaptation: bright glows are compressed towards a ceiling, keeping their hue
  vec3 soft(vec3 c){ return c / (1.0 + max(max(c.r, c.g), c.b) / uClip); }

  vec3 skyAt(vec3 d){
    float el = asin(clamp(d.y, -1.0, 1.0));
    float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963);
    vec2 hd = d.xz / max(length(d.xz), 1e-5), hs = normalize(uSun.xz + vec2(1e-6, 0.0));
    vec2 uv = vec2(acos(clamp(dot(hd, hs), -1.0, 1.0)) / PI, v);
    float mu = dot(d, uSun), g = 0.76, g2 = g * g;
    float pM = 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));   // Cornette-Shanks
    vec3 c = (texture2D(uLutR, uv).rgb + texture2D(uLutM, uv).rgb * pM) * uScale;
    // airglow and unresolved starlight, always there, only noticed once the twilight has gone
    c += vec3(0.45, 0.55, 1.0) * 1.0e-5 + vec3(0.55, 1.0, 0.5) * 4e-6 * exp(-max(d.y, 0.0) * 9.0);
    return soft(c);
  }
  float hg(float mu, float g){ float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5); }
  // sunlight reaching a point high in the atmosphere: optical depth from the lowest altitude the sun ray passes
  // (the grazing path is what turns cloud undersides red and then dark as the Earth's shadow climbs)
  float column(float h, float H, float cz){ return H * exp(-h / H) / (cz + sqrt(2.0 * H / (PI * (RE + h)))); }
  vec3 sunlightAt(vec3 p){
    float ps = dot(p, uSun), r = length(p), cz = ps / r;
    float h = r - RE, grazing = 1.0;
    if (ps < 0.0) { h = length(p - ps * uSun) - RE; cz = 0.0; grazing = 2.0; }
    float lit = smoothstep(-400.0, 400.0, h);
    h = max(h, 0.0);
    vec3 tau = (BR * column(h, 8000.0, cz) + BME * column(h, 1200.0, cz)) * grazing + BO * 15000.0 * min(grazing / max(cz, 0.03), 40.0);
    return exp(-tau) * lit;
  }
  vec3 hash33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
  vec3 starTint(float t){
    return t < 0.1 ? vec3(0.62, 0.74, 1.0) : t < 0.32 ? vec3(0.82, 0.88, 1.0) : t < 0.62 ? vec3(1.0, 0.97, 0.93) : t < 0.86 ? vec3(1.0, 0.86, 0.68) : vec3(1.0, 0.68, 0.46);
  }
  // one octave of stars: at most one per cell of a 3D grid, kept away from cell edges so none get clipped
  vec3 starLayer(vec3 c, float S, float prob, float k, float bright, float seed){
    vec3 cell = floor(c * S);
    vec3 h = hash33(cell + seed);
    if (h.x > prob) return vec3(0.0);
    vec3 sd = normalize((cell + 0.35 + 0.3 * hash33(cell * 1.37 + seed + 7.0)) / S);
    float a = length(c - sd), r = uPix * 0.8;
    float tw = 1.0 + 0.5 * sin(uTime * (9.0 + 9.0 * h.y) + h.z * 60.0);
    return starTint(h.z) * bright * pow(h.y, k) * exp(-a * a / (r * r)) * tw;
  }
  // brightness of the Milky Way along the galactic plane: brighter towards the centre, clumpy, split by dust
  float milkyWay(vec3 c, out vec3 tint){
    float b = dot(c, uGalPole);
    vec3 inPlane = normalize(c - b * uGalPole);
    float l = dot(inPlane, uGalCenter);
    float core = 0.3 + 0.7 * pow(0.5 + 0.5 * l, 3.0);
    float width = mix(0.1, 0.2, core);
    float band = exp(-b * b / (width * width)) * core;
    band += exp(-((1.0 - l) * 18.0 + b * b / 0.012)) * 1.6;   // the bulge
    float clump = fbm3(c * 11.0 + 3.0);
    band *= 0.45 + 1.1 * clump;
    float dust = smoothstep(0.42, 0.68, fbm3(c * 7.0 + 17.0)) * exp(-b * b / 0.004);
    band *= 1.0 - 0.8 * dust;
    tint = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.68), smoothstep(0.2, 0.9, 0.5 + 0.5 * l));
    return band;
  }
  vec3 cloud(vec3 bg, vec3 d, vec3 p, float a, float t, float thick){
    if (a < 0.003) return bg;
    vec3 sunC = sunlightAt(p) * uScale;
    float ph = mix(0.0795775, hg(dot(d, uSun), 0.6), 0.6);                  // silver lining towards the sun
    float shade = mix(1.0, 0.4, clamp(thick * 3.5, 0.0, 1.0));               // thick cells shade themselves
    vec3 amb = skyAt(vec3(0.0, 1.0, 0.0)) * 1.6 + skyAt(normalize(vec3(d.x, 0.06, d.z))) * 0.5 + vec3(2.5e-6, 3e-6, 4.5e-6);
    vec3 c = soft(sunC * ph * shade + amb);
    c = mix(c, bg, 1.0 - exp(-t / 90000.0));                                 // distance fades into the haze
    return mix(bg, c, a);
  }

  void main(){
    vec3 d = normalize(vDir);
    vec3 col = skyAt(d);
    // night sky: faint airglow, the Milky Way and thousands of stars, dimmed by the air near the horizon
    if (uNight > 0.001) {
      vec3 c = uCel * d;
      vec3 mwTint;
      float mw = milkyWay(c, mwTint);
      float up = max(d.y, 0.0);
      float ext = exp(-0.11 * min(1.0 / (up + 0.03), 30.0)) * smoothstep(-0.02, 0.03, d.y);
      // (scaled for the fully dark-adapted exposure: ×~1600 to display; the airglow is part of skyAt)
      vec3 night = mwTint * mw * 2.6e-5;
      // a few brilliant stars, a few thousand ordinary ones, and a fine dust of faint ones thickest in the Milky Way
      vec3 st = starLayer(c, 70.0, 0.045, 14.0, 3.2e-3, 1.0)
              + starLayer(c, 110.0, 0.05, 8.0, 4e-4, 2.0)
              + starLayer(c, 170.0, 0.07 + 0.25 * mw, 4.0, 1.1e-4, 3.0)
              + starLayer(c, 260.0, 0.04 + 0.5 * mw, 2.0, 5e-5, 4.0);
      col += (night + st) * ext * uNight;
    }
    // the sun's disk, limb-darkened and flattened by refraction on the horizon (not in the reflection probe:
    // the water draws its own sun glint)
    if (uCube < 0.5 && dot(d, uSun) > 0.9995) {
      vec3 sx = normalize(cross(uSun, vec3(0.0, 1.0, 0.0))), sy = cross(sx, uSun);
      float r = length(vec2(dot(d, sx), dot(d, sy) / uSunFlat)) / 0.00465;
      float edge = 1.0 - smoothstep(1.0 - uPix / 0.00465, 1.0, r);
      col += uSunDisk * (1.0 - 0.55 * (1.0 - sqrt(max(1.0 - r * r, 0.0)))) * edge;
    }
    // clouds: thin cirrus streaks high up, a broken layer of altocumulus below
    if (d.y > 0.0) {
      vec3 ro = vec3(0.0, RE + 2.0, 0.0);
      float fadeH = smoothstep(0.012, 0.13, d.y);
      float t2 = sphereFar(ro, d, RE + 9000.0);
      vec3 p2 = ro + d * t2;
      vec2 q2 = mat2(0.8, -0.6, 0.6, 0.8) * (p2.xz + uWind * 2.0 * uTime) / vec2(16000.0, 2400.0);
      float a2 = smoothstep(0.52, 0.82, fbm3(vec3(q2, 9.3))) * 0.5 * fadeH;
      col = cloud(col, d, p2, a2, t2, 0.0);
      float t1 = sphereFar(ro, d, RE + 4500.0);
      vec3 p1 = ro + d * t1;
      vec2 q1 = (p1.xz + uWind * uTime) / 2600.0;
      float n1 = fbm3(vec3(q1, 1.7)) + 0.3 * (fbm3(vec3(q1 * 2.9, 5.1)) - 0.5);
      float a1 = smoothstep(uCover, uCover + 0.18, n1) * 0.95 * fadeH;
      col = cloud(col, d, p1, a1, t1, n1 - uCover);
    }
    gl_FragColor = vec4(min(col, vec3(3000.0)), 1.0);
  }`;

// ---------------------------------------------------------------- the sky object
export function createSky(renderer) {
  const lutOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const lutR = new THREE.WebGLRenderTarget(256, 128, lutOpts), lutM = new THREE.WebGLRenderTarget(256, 128, lutOpts);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const lutMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uMie: { value: 0 }, uTwi: { value: 0.3 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: LUT_FRAG, depthTest: false, depthWrite: false,
  });
  const lutQuad = new THREE.Mesh(tri, lutMat);
  lutQuad.frustumCulled = false;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const U = {
    uLutR: { value: lutR.texture }, uLutM: { value: lutM.texture },
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunDisk: { value: new THREE.Vector3() }, uSunFlat: { value: 1 },
    uCel: { value: new THREE.Matrix3() }, uGalPole: { value: new THREE.Vector3() }, uGalCenter: { value: new THREE.Vector3() },
    // solar irradiance in scene units: puts the afternoon horizon where the old sky had it, with real contrast above
    uWind: { value: new THREE.Vector2(5.5, 2.0) }, uTime: { value: 0 }, uNight: { value: 0 }, uScale: { value: 28 }, uCover: { value: 0.45 },
    uClip: { value: 10 },   // soft ceiling (scene units) for the sky's highlights at the current adaptation
  };
  const domeMat = (pix, cube) => new THREE.ShaderMaterial({
    uniforms: { ...U, uPix: { value: pix }, uCube: { value: cube } },
    vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), domeMat(0.001, 0));
  sky.scale.setScalar(30000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;

  // reflection probe for the water (and the view up through Snell's window)
  const CUBE = 512;
  const cubeRT = new THREE.WebGLCubeRenderTarget(CUBE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 100000, cubeRT);
  const probeScene = new THREE.Scene();
  const probeDome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), domeMat((Math.PI / 2) / CUBE * 1.4, 1));
  probeDome.scale.setScalar(50000);
  probeScene.add(probeDome);

  // the Milky Way arches up out of the western sea and across the southern sky at nightfall
  {
    const Hn = hourAngleFor(SCHEDULE[SCHEDULE.length - 1][1]);
    const M = celestial(Hn, new THREE.Matrix3());
    const pole = new THREE.Vector3(1, 0.5, 0).normalize();
    const centre = new THREE.Vector3(-0.5, 0.6, -0.6);
    centre.addScaledVector(pole, -centre.dot(pole)).normalize();
    U.uGalPole.value.copy(pole.applyMatrix3(M)).normalize();
    U.uGalCenter.value.copy(centre.applyMatrix3(M)).normalize();
  }

  // ---------------------------------------------------------------- day cycle
  const sEnd = SCHEDULE[SCHEDULE.length - 1][0];
  const Hend = hourAngleFor(SCHEDULE[SCHEDULE.length - 1][1]);
  const Hrate = (Hend - hourAngleFor(SCHEDULE[SCHEDULE.length - 2][1])) / (sEnd - SCHEDULE[SCHEDULE.length - 2][0]);
  const tmpT = new THREE.Vector3(), trueDir = new THREE.Vector3();
  function solve(seconds, st) {
    const H = seconds <= sEnd ? hourAngleFor(interp(SCHEDULE, seconds)) : Math.min(Math.PI, Hend + Hrate * (seconds - sEnd));
    sunVector(H, trueDir);
    const hTrue = Math.asin(trueDir.y) / D2R, hApp = hTrue + refraction(hTrue) / 60;
    const horiz = Math.hypot(trueDir.x, trueDir.z);
    st.sunDir.set((trueDir.x / horiz) * Math.cos(hApp * D2R), Math.sin(hApp * D2R), (trueDir.z / horiz) * Math.cos(hApp * D2R));
    st.H = H; st.h = hApp;
    transmittance(st.sunDir, st.sunT);
    const vis = THREE.MathUtils.smoothstep(hApp, -0.27, 0.27);
    st.vis = vis;
    // illuminance on the sea: direct sun + diffuse sky (lux)
    st.eDir = 1.05e5 * Math.max(Math.sin(hApp * D2R), 0) * lum(st.sunT) * vis;
    st.eSky = Math.pow(10, interp(SKYLUX, hApp)); // diffuse skylight on a horizontal surface
    const sc = interp(SKYCOL, hApp), sl = sc[0] * 0.2126 + sc[1] * 0.7152 + sc[2] * 0.0722;
    st.skyCol.set(sc[0] / sl, sc[1] / sl, sc[2] / sl); // normalised to a luminance of 1
    return st;
  }
  const blank = () => ({ H: 0, h: 0, vis: 1, eDir: 0, eSky: 0, sunDir: new THREE.Vector3(), sunT: new THREE.Vector3(), skyCol: new THREE.Vector3() });
  const ref = solve(0, blank());   // the afternoon the session starts in: every light factor is relative to it
  const refSunT = ref.sunT.clone(), refE = ref.eDir + ref.eSky, refGain = adaptGain(ref.h);
  const refMix = ref.sunT.clone().divideScalar(lum(ref.sunT)).multiplyScalar(ref.eDir).addScaledVector(ref.skyCol, ref.eSky).divideScalar(refE);
  const cur = blank();

  const state = {
    sky, skyCube: cubeRT.texture,
    seconds: 0, timeScale: 1,
    sunDir: new THREE.Vector3(), sunDirWater: new THREE.Vector3(),
    sunRel: new THREE.Vector3(1, 1, 1),     // direct sunlight colour/strength relative to the start
    skyRel: new THREE.Vector3(1, 1, 1),     // diffuse skylight relative to the start
    daylight: new THREE.Vector3(1, 1, 1),   // total light on the sea relative to the start (drives the water column)
    airGain: 1,                              // eye adaptation above the water
    night: 0, elevation: 27, clock: '',
    update, debug: { lutR, lutM, U },
  };
  let lutSun = new THREE.Vector3(9, 9, 9), probeAge = 1e9, lastStarT = 0;

  function update(dt, { under, depth, pixelAngle, gain }) {
    state.seconds += dt * state.timeScale;
    solve(state.seconds, cur);
    state.sunDir.copy(cur.sunDir);
    state.elevation = cur.h;
    // refracted into the water (Snell, n = 1.333); never lower than the critical angle
    {
      const s = cur.sunDir, cosi = Math.max(s.y, 0.0), eta = 1 / 1.333;
      const hx = s.x, hz = s.z, hl = Math.hypot(hx, hz) || 1, sinT = Math.min(eta * Math.sqrt(1 - cosi * cosi), 0.999);
      state.sunDirWater.set((hx / hl) * sinT, Math.sqrt(1 - sinT * sinT), (hz / hl) * sinT);
    }
    state.sunRel.copy(cur.sunT).divide(refSunT).multiplyScalar(cur.vis);
    state.skyRel.copy(cur.skyCol).multiplyScalar(cur.eSky / ref.eSky).divide(ref.skyCol);
    const eTot = cur.eDir + cur.eSky;
    state.daylight.copy(cur.sunT).divideScalar(Math.max(lum(cur.sunT), 1e-6)).multiplyScalar(cur.eDir).addScaledVector(cur.skyCol, cur.eSky).divideScalar(Math.max(eTot, 1e-12))
      .divide(refMix).multiplyScalar(eTot / refE);
    state.airGain = adaptGain(cur.h);
    state.airBoost = state.airGain / refGain;   // how much the eye has opened up since the afternoon
    state.night = 1 - THREE.MathUtils.smoothstep(cur.h, -14, -1);
    // how far into night vision the eye has gone (colour drains from dim things, which turn blue-grey)
    state.scotopic = 1 - THREE.MathUtils.smoothstep(cur.h, -10, -1);
    // direct sunlight on the water fades out as the sun sinks: shafts, glints and the bright spot overhead go with it
    state.sunAmt = THREE.MathUtils.smoothstep(cur.h, -0.5, 8);
    U.uClip.value = 2.2 / (0.22 * state.airGain);
    const solar = 12 + (cur.H / D2R) / 15 + 1;   // local (daylight-saving) clock from the hour angle
    const hh = Math.floor(solar) % 24, mm = Math.floor((solar % 1) * 60);
    state.clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    // sky uniforms
    U.uSun.value.copy(cur.sunDir);
    U.uTime.value = state.seconds;
    U.uNight.value = state.night;
    U.uCover.value = THREE.MathUtils.lerp(0.45, 0.66, state.night);   // the convective cloud thins out after dark
    U.uSunFlat.value = 1 - 0.22 * (1 - THREE.MathUtils.smoothstep(cur.h, 0, 3));
    celestial(cur.H, U.uCel.value);
    // the disk: real colour, brightness held where the eye would see it (white at day, deep orange on the horizon)
    {
      const T = cur.sunT, mx = Math.max(T.x, T.y, T.z, 1e-6), low = 1 - THREE.MathUtils.smoothstep(cur.h, 2, 12);
      const peak = Math.min(2.35e6 * mx, THREE.MathUtils.lerp(7, 2.4, low) / (0.22 * Math.max(gain, 0.5)));
      U.uSunDisk.value.copy(T).divideScalar(mx).multiplyScalar(peak * cur.vis);
    }
    sky.material.uniforms.uPix.value = pixelAngle;

    // re-render the sky tables and the reflection probe only while the sky can be seen, and only as needed
    const visible = !under || depth < 400;
    if (!visible) return state;
    const prevTarget = renderer.getRenderTarget();
    if (lutSun.angleTo(cur.sunDir) > 0.0004) {
      lutSun.copy(cur.sunDir);
      lutMat.uniforms.uSun.value.copy(cur.sunDir);
      lutMat.uniforms.uTwi.value = 0.3 * cur.eSky / ref.eSky;
      for (const [rt, mie] of [[lutR, 0], [lutM, 1]]) {
        lutMat.uniforms.uMie.value = mie;
        renderer.setRenderTarget(rt);
        renderer.render(lutQuad, quadCam);
      }
      probeAge = 1e9;
    }
    probeAge += dt;
    if (probeAge > 0.6 || Math.abs(state.seconds - lastStarT) > 30) {
      probeAge = 0; lastStarT = state.seconds;
      cubeCam.update(renderer, probeScene);
    }
    renderer.setRenderTarget(prevTarget);
    return state;
  }
  return state;
}
