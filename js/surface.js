// The ocean surface: Gerstner swell, wind waves and chop, lit by the sun and reflecting the sky probe.
// (The sky itself, with its day cycle, lives in sky.js.)
import * as THREE from 'three';
import { SUN_DIR, GLSL_WAVES, GLSL_NOISE } from './common.js';

function radialGrid(angles = 320, rings = 230) {
  const a = 0.45, b = 0.0505; // r(i) = a (e^{bi} - 1) → ~45 km
  const pos = [];
  const idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = a * (Math.exp(b * i) - 1);
    for (let j = 0; j < angles; j++) {
      const t = (j / angles) * Math.PI * 2;
      pos.push(Math.cos(t) * r, 0, Math.sin(t) * r);
    }
  }
  for (let j = 0; j < angles; j++) idx.push(0, 1 + ((j + 1) % angles), 1 + j);
  for (let i = 1; i < rings; i++) {
    const r0 = 1 + (i - 1) * angles, r1 = 1 + i * angles;
    for (let j = 0; j < angles; j++) {
      const j1 = (j + 1) % angles;
      idx.push(r0 + j, r0 + j1, r1 + j, r0 + j1, r1 + j1, r1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function createOcean(skyCube) {
  const uniforms = {
    uTime: { value: 0 },
    uSky: { value: skyCube },
    uSun: { value: SUN_DIR.clone() },
    uSunRadiance: { value: 900.0 },
    uSunTint: { value: new THREE.Vector3(1, 1, 1) },   // colour and strength of the sunlight that reaches the sea
    uAmb: { value: 1 },                                  // skylight relative to the afternoon
    uWinScale: { value: 1 },                             // brightness of the sky seen from below (see main.js)
    uCenter: { value: new THREE.Vector2() },
    uPixelAngle: { value: 0.0012 },
    uUnderColor: { value: new THREE.Vector3(0.0, 0.08, 0.14) },
    uSea: { value: 1 },                                  // wave height: 1 in the afternoon breeze, lower on a calm night
    // the submersible's floodlights, so they glint and glow on the water when shone at it from above
    uLampPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uLampDir: { value: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)] },
    uLampI: { value: 0 }, uLampCos: { value: new THREE.Vector2(0.9, 0.95) }, uLampCol: { value: new THREE.Vector3(1, 0.9, 0.8) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${GLSL_WAVES}
      uniform float uTime; uniform vec2 uCenter; uniform float uPixelAngle, uSea;
      varying vec3 vWorld; varying float vHeight;
      void main(){
        vec3 p = position + vec3(uCenter.x, 0.0, uCenter.y);
        float dist = length(position.xz);
        float foot = max(dist * uPixelAngle * 6.0, 0.05);
        vec3 disp = vec3(0.0);
        for (int i = 0; i < NW; i++) {
          vec4 w = WV[i]; float L = 6.28318 / w.z;
          float fade = smoothstep(L * 0.5, L * 0.12, foot * 2.0 + dist * 0.004);
          float ph = w.z * dot(w.xy, p.xz) - WQ[i].y * uTime;
          float A = w.w * fade * uSea;
          disp.y += A * sin(ph);
          disp.xz -= WQ[i].x * A * w.xy * cos(ph);
        }
        p += disp;
        vWorld = p; vHeight = disp.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_WAVES}
      ${GLSL_NOISE}
      uniform float uTime; uniform samplerCube uSky; uniform vec3 uSun; uniform float uSunRadiance;
      uniform float uPixelAngle; uniform vec3 uUnderColor; uniform vec3 uSunTint; uniform float uAmb, uWinScale, uSea;
      uniform vec3 uLampPos[2]; uniform vec3 uLampDir[2]; uniform float uLampI; uniform vec2 uLampCos; uniform vec3 uLampCol;
      varying vec3 vWorld; varying float vHeight;

      vec3 noised(vec2 x){
        vec2 i = floor(x), f = fract(x);
        vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
        vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
        float a = hash12(i), b = hash12(i+vec2(1,0)), c = hash12(i+vec2(0,1)), d = hash12(i+vec2(1,1));
        float k1 = b-a, k2 = c-a, k4 = a-b-c+d;
        return vec3(a+k1*u.x+k2*u.y+k4*u.x*u.y, du*(vec2(k1,k2)+k4*u.yx));
      }
      // slope (dh/dx, dh/dz) with the variance lost to distance filtering
      vec3 slopes(vec2 p, float foot){
        vec2 s = vec2(0.0); float lost = 0.0;
        for (int i = 0; i < NW; i++) {
          vec4 w = WV[i]; float L = 6.28318 / w.z;
          float fade = smoothstep(L * 0.25, L * 0.06, foot);
          float ph = w.z * dot(w.xy, p) - WQ[i].y * uTime;
          float sl = w.z * w.w * uSea;
          s += sl * fade * w.xy * cos(ph);
          lost += (1.0 - fade) * sl * sl * 0.5;
        }
        float chop = 0.25 + 0.75 * uSea;   // wind ripples die away with the breeze
        // chop and capillary ripples: rotated, wind-stretched gradient-noise octaves
        float L = 7.0;
        mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
        vec2 q = p;
        mat2 acc = mat2(1.0);
        for (int i = 0; i < 7; i++) {
          vec2 uv = q / L * vec2(1.0, 1.8) + vec2(uTime * 0.35 / sqrt(L), uTime * 0.12);
          vec3 n = noised(uv);
          vec2 g = (acc * (n.yz * vec2(1.0, 1.8))) * (0.16 * pow(L, 0.08));
          float fade = smoothstep(L * 0.3, L * 0.07, foot);
          s += g * fade * chop;
          lost += (1.0 - fade) * 0.008 * chop * chop;
          q = rot * q; acc = acc * transpose(rot);
          L *= 0.52;
        }
        return vec3(s, lost);
      }

      float D_GGX(float NoH, float a){ float a2 = a*a; float d = NoH*NoH*(a2-1.0)+1.0; return a2/(3.14159*d*d); }

      void main(){
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float foot = dist * uPixelAngle / max(abs(V.y), 0.05);
        vec3 sl = slopes(vWorld.xz, foot);
        vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
        float rough = clamp(sqrt(0.0025 + sl.z * 1.6), 0.03, 0.5);
        bool above = cameraPosition.y > vWorld.y;
        vec3 col;
        if (above) {
          float NoV = max(dot(N, V), 0.001);
          vec3 R = reflect(-V, N);
          float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
          // what the water mirrors is the sky above it; a facet whose reflection points down into the sea sees the far
          // side of the trough instead, which itself mirrors the low sky: dimmer horizon light, never bright sky
          vec3 skyR = textureLod(uSky, normalize(vec3(R.x, max(R.y, 0.01), R.z)), rough * 6.0).rgb;
          vec3 zen = textureLod(uSky, vec3(0.0, 1.0, 0.0), 8.0).rgb;
          vec3 trough = textureLod(uSky, normalize(vec3(R.x, 0.03, R.z)), 4.0).rgb * 0.4;
          skyR = mix(trough, skyR, smoothstep(-0.2, 0.03, R.y));
          // light scattered up out of the deep water column: darker in the troughs, brighter where the water is
          // shallow over a crest
          float crest = clamp(vHeight * 0.55 / max(uSea, 0.3) + 0.5, 0.0, 1.0);
          vec3 body = vec3(0.002, 0.016, 0.048) * (zen * 3.2 + 0.05 * uAmb) * mix(0.7, 1.25, crest);
          // sunlight shining through the thin top of a wave towards the viewer: the turquoise glow of real seas
          float thin = smoothstep(-0.2, 0.9, vHeight) * (1.0 - smoothstep(0.55, 0.95, N.y));
          float back = pow(max(dot(V, -uSun + vec3(0.0, 0.25, 0.0)), 0.0), 3.0);
          vec3 sunIn = uSunTint * max(uSun.y + 0.08, 0.0);
          body += vec3(0.0, 0.11, 0.1) * (back * 1.6 + 0.25) * thin * sunIn * 0.6 + vec3(0.0, 0.035, 0.04) * crest * zen * 0.6;
          col = mix(body, skyR * 0.68, F);
          // the odd whitecap breaking on the very tops of the highest crests in the afternoon breeze (none once the
          // sea has calmed); lit only by the actual sky and sun
          float fn = fbm3(vec3(vWorld.xz * 0.28, uTime * 0.12));
          float foam = smoothstep(1.35, 1.6, vHeight * 0.7 + fn * 1.0) * smoothstep(1200.0, 100.0, dist) * uSea * uSea * uSea;
          foam *= 0.4 + 0.6 * vnoise(vec3(vWorld.xz * 1.7, uTime * 0.4));
          vec3 foamCol = zen * 1.6 + vec3(1.0, 0.97, 0.9) * uSunTint * max(dot(N, uSun), 0.0) * uSunRadiance * 0.0004;
          col = mix(col, foamCol, foam * 0.6);
          vec3 H = normalize(V + uSun);
          float NoL = max(dot(N, uSun), 0.0);
          float spec = D_GGX(max(dot(N, H), 0.0), rough * rough * 0.9 + 0.0012) * F * NoL / (4.0 * NoV * max(NoL, 0.05) + 0.001);
          float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
          spec *= Fs / max(F, 0.02);
          col += vec3(1.0, 0.95, 0.86) * uSunTint * uSunRadiance * spec * 0.0025;
          // the sub's floodlights shone onto the water: a glitter of reflections where the facets face back at the
          // lamps, and a green-blue glow from light scattered back out of the water beneath
          if (uLampI > 0.0) {
            for (int k = 0; k < 2; k++) {
              vec3 Lv = uLampPos[k] - vWorld;
              float dl = length(Lv);
              vec3 Ld = Lv / dl;
              float cone = smoothstep(uLampCos.x, uLampCos.y, dot(-Ld, uLampDir[k]));
              if (cone <= 0.0) continue;
              float range = pow(clamp(1.0 - pow(dl / 170.0, 4.0), 0.0, 1.0), 2.0);
              float E = uLampI * cone * range / max(pow(dl, 0.7), 0.01);
              float NoLl = max(dot(N, Ld), 0.0);
              vec3 Hl = normalize(V + Ld);
              float Fl = 0.02 + 0.98 * pow(1.0 - max(dot(Hl, V), 0.0), 5.0);
              float specL = D_GGX(max(dot(N, Hl), 0.0), rough * rough * 0.9 + 0.003) * Fl / (4.0 * NoV + 0.001) * step(0.0, dot(N, Ld));
              // (open-ocean water sends back only a few percent of the light that enters it, blue-green)
              col += uLampCol * E * (specL + NoLl * (1.0 - Fl) * vec3(0.0012, 0.0045, 0.005) + foam * NoLl * 0.25);
            }
          }
          // aerial perspective toward the horizon haze
          vec3 haze = textureLod(uSky, normalize(vec3(-V.x, 0.035, -V.z)), 3.0).rgb;
          col = mix(col, haze, 1.0 - exp(-dist / 16000.0));
        } else {
          // looking up from below: Snell's window and total internal reflection
          vec3 Nd = -N;
          vec3 I = -V;
          float cosi = dot(-I, Nd);
          vec3 T = refract(I, Nd, 1.333);
          float F = 0.02 + 0.98 * pow(1.0 - max(cosi, 0.0), 5.0);
          if (dot(T, T) < 0.001) {
            col = uUnderColor; // total internal reflection mirrors the water below
          } else {
            vec3 sky = textureLod(uSky, normalize(T), 1.0).rgb * uWinScale;
            float sunGlow = (pow(max(dot(normalize(T), uSun), 0.0), 900.0) * 60.0 + pow(max(dot(normalize(T), uSun), 0.0), 18.0) * 1.5) * uWinScale;
            col = mix(sky * 1.3 + sunGlow * vec3(1.0, 0.95, 0.85) * uSunTint, uUnderColor, F);
            // dark rim near the window edge
            col = mix(uUnderColor, col, smoothstep(0.0, 0.25, length(T.xz) < 0.999 ? T.y : 0.0));
          }
        }
        // a mirror-flat facet can focus the sun past what a half-float target holds; one inf pixel would be
        // smeared over the whole frame by the bloom (a black flash), so cap glints well above anything visible
        gl_FragColor = vec4(min(col, vec3(3000.0)), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(radialGrid(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  return { mesh, uniforms };
}
