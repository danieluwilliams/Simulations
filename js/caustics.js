// Sun caustics, rendered on the GPU every frame into a small tiling texture that the seabed, reefs and wrecks sample.
// The pattern is physical rather than painted. The water surface over one tile is two layers of ripples: a longer
// one riding the swell (1.2–3 m) and a short wind chop crossing it (0.4–1 m), each a set of gravity waves that move
// with the real deep-water dispersion ω = √(g·k), so the pattern flows and re-forms the way it does on a sandy
// bottom. (A Fourier sum rather than Perlin or simplex noise: the caustic depends on the surface's curvature, and the
// second derivatives of lattice noise show the lattice as straight seams across the pattern.) The slope of the
// surface bends the sunlight, and the light arriving below is concentrated wherever that bending converges: the
// irradiance at a point is 1 / |det J|, J = I − k·∇∇h the Jacobian of the refraction map (h the surface height,
// k how far below the light lands times 1 − 1/n). Where det J crosses zero the rays cross, and those are the bright
// lines. The texture is mipmapped, so each receiver can take it as blurred as its depth requires.
import * as THREE from 'three';
import { rng } from './common.js';

export const CAUSTIC_TILE = 16;   // metres of seabed one tile covers (large, so the repeat is not noticed)
const N = 512;                    // texels across a tile (3 cm each)
const FOCUS = 1.0;                // k in the Jacobian (m): how hard the ripples focus the light
const NW = 32;                    // waves (16 per layer)

const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Two wave layers. Wave vectors sit on the tile's reciprocal lattice (2π·(m, n) / tile) so the tile repeats seamlessly.
// Each wave is given the same curvature a·k² (amplitude ∝ 1/k²): heights are carried by the longer ripples, while
// every wave shapes the pattern, so it reads as one interlaced network rather than stripes of the shortest chop.
export function waveSet() {
  const r = rng(4711), waves = [], used = new Set();
  const layer = (count, lmin, lmax, dir, spread, curv) => {
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const lam = lmin * Math.pow(lmax / lmin, r()), a = dir + (r() - 0.5) * 2 * spread;
        const m = Math.round((CAUSTIC_TILE / lam) * Math.cos(a)), n = Math.round((CAUSTIC_TILE / lam) * Math.sin(a));
        const key = `${m},${n}`;
        if ((m === 0 && n === 0) || used.has(key) || used.has(`${-m},${-n}`)) continue;
        used.add(key);
        const kx = (2 * Math.PI * m) / CAUSTIC_TILE, ky = (2 * Math.PI * n) / CAUSTIC_TILE, k = Math.hypot(kx, ky);
        waves.push({ kx, ky, amp: (curv * (0.7 + 0.6 * r())) / (k * k), omega: Math.sqrt(9.81 * k), phase: r() * Math.PI * 2 });
        break;
      }
    }
  };
  layer(NW / 2, 1.2, 3.2, 0.35, 1.5, 0.085);  // swell ripples (curvature a·k², 1/m)
  layer(NW / 2, 0.45, 1.0, 2.0, 1.6, 0.15);   // wind chop, from another quarter
  return waves;
}

export function createCaustics(renderer) {
  const waves = waveSet();
  const uW = { value: waves.map((w) => new THREE.Vector4(w.kx, w.ky, w.amp, w.phase)) };
  const rt = new THREE.WebGLRenderTarget(N, N, {
    depthBuffer: false, type: THREE.HalfFloatType, generateMipmaps: true,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const uniforms = { uW, uK: { value: FOCUS } };
  const pass = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec4 uW[${NW}];   // wave vector (rad/m), amplitude (m), phase now (rad)
      uniform float uK; varying vec2 vUv;
      float irradiance(vec2 x){
        float hxx = 0.0, hyy = 0.0, hxy = 0.0;
        for (int i = 0; i < ${NW}; i++) {
          vec4 w = uW[i];
          float c = w.z * cos(dot(w.xy, x) + w.w);   // the surface's curvature, analytically
          hxx -= c * w.x * w.x; hyy -= c * w.y * w.y; hxy -= c * w.x * w.y;
        }
        float det = (1.0 - uK * hxx) * (1.0 - uK * hyy) - uK * uK * hxy * hxy;
        return 1.0 / max(abs(det), 0.1);   // where rays cross, capped rather than infinite
      }
      void main(){
        // two samples per texel, so lines thinner than a texel are not aliased into the mips
        vec2 x = vUv * ${CAUSTIC_TILE.toFixed(1)}, e = vec2(${(CAUSTIC_TILE / N).toFixed(6)});
        float I = irradiance(x + e * vec2(0.25, -0.25)) + irradiance(x + e * vec2(-0.25, 0.25));
        gl_FragColor = vec4(vec3(I * 0.5), 1.0);
      }`,
  }));
  pass.frustumCulled = false;

  // phases are advanced on the CPU in double precision (ω·t grows without bound; the GPU only sees it mod 2π)
  function update(time) {
    for (let i = 0; i < waves.length; i++) uW.value[i].w = (waves[i].phase - waves[i].omega * time) % (Math.PI * 2);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(pass, quadCam);   // three regenerates the mip chain after this
    renderer.setRenderTarget(prev);
  }
  return { texture: rt.texture, update, rt, uniforms };
}

// Sampled by every patched surface (materials.js) to modulate direct sunlight. Deeper receivers see a larger, softer
// pattern: the cells grow with depth (light from the longer ripples converges further down) and the lines blur (the
// sun's 0.5° disc and forward scattering smear them: about 2 cm at 1 m, 0.3 m at 25 m, 1.3 m at 60 m). The whole
// effect fades as it does so and is gone entirely by 200 ft (61 m).
export const GLSL_CAUSTIC = /* glsl */`
  uniform sampler2D uCausTex; uniform float uCausAmt;
  float causticAt(vec3 wpos, vec3 sunW, float amount){
    float z = max(-wpos.y, 0.0), grow = 1.0 + z / 50.0;
    // where on the surface the sunlight reaching this point came through: straight up along the refracted sun
    vec2 uv = (wpos.xz + sunW.xz / max(sunW.y, 0.2) * z) / (${CAUSTIC_TILE.toFixed(1)} * grow);
    vec2 gx = dFdx(uv), gy = dFdy(uv);
    float blur = (0.01 + 0.006 * z + 0.00025 * z * z) / (${CAUSTIC_TILE.toFixed(1)} * grow);   // blur width, in tiles
    float s = max(1.0, blur / max(max(length(gx), length(gy)), 1e-6));
    float I = textureGrad(uCausTex, uv, gx * s, gy * s).r;
    float k = clamp(amount, 0.0, 1.0) * (1.0 - smoothstep(12.0, 61.0, z));
    return mix(1.0, I, k);
  }`;
