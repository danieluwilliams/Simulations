// Shared uniforms and a material patcher that adds sun caustics, swim motion and procedural surface detail.
import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SEEN, SEEN_LUT, SUN_DIR_WATER } from './common.js';
import { GLSL_CAUSTIC } from './caustics.js';
import { CAVE_SITES } from './habitats.js';

// Local occlusion keeps a cave wall dark even while the camera is outside it.
const CAVE_OCCLUSION = `float caveOcclusion(vec3 p) { float shade = 0.0; ${CAVE_SITES.map(c => `{
  float t = (${c.z.toFixed(1)} - p.z) / ${c.length.toFixed(1)};
  if (t > 0.0 && t < 1.0) {
    float s = sin(t * 3.14159265);
    vec2 center = vec2(${c.x.toFixed(1)} + sin(t * 6.2831853) * 9.0, ${(-c.depth).toFixed(1)} - s * 7.0);
    vec2 radius = vec2(${c.width.toFixed(1)} + s*s*14.0, ${c.height.toFixed(1)} + s*s*8.0);
    float inside = 1.0 - smoothstep(1.01, 1.15, length((p.xy - center) / radius));
    float shelter = smoothstep(0.0, 0.16, min(t, 1.0-t));
    ${c.skylight ? 'shelter *= 1.0 - 0.8 * exp(-pow((t - 0.5) / 0.065, 2.0));' : ''}
    shade = max(shade, inside * shelter);
  }
}`).join('')} return shade; }`;

export const G = {
  uTime: { value: 0 },
  uCaus: { value: new THREE.Vector3() },  // (legacy) caustic light colour at the camera depth
  uCausTex: { value: null },               // the caustic irradiance tile (caustics.js), mipmapped
  uCausAmt: { value: 0 },                  // how much of the pattern shows: 0 out of the water or deep in a cave
  // Beer–Lambert per fragment: ln of the daylight reaching each depth (common.js), and at the camera's depth (the
  // light colours main.js sets are for the camera's depth; each surface is re-lit for its own)
  uSeenLUT: { value: SEEN_LUT },
  uLnSeenCam: { value: new THREE.Vector3() },
  uGlow: { value: 1 },                     // bioluminescence scale (compensates exposure)
  uSunW: { value: SUN_DIR_WATER.clone() },
  uKd: { value: new THREE.Vector3(0.42, 0.058, 0.028) },
  // second (transparent) pass: manual depth test against the opaque pass + in-shader fog and exposure
  uDepthTex: { value: null },
  uRes: { value: new THREE.Vector2(1, 1) },
  uFogT: { value: new THREE.Vector3() },
  uExpo: { value: 1 },
  // wave surge felt on the bottom: (direction x, direction z, amplitude at the surface, -) — kept current by main.js
  uSurge: { value: new THREE.Vector4(1, 0, 0.16, 0) },
  // how visible bioluminescence is: 0 in bright water (it is drowned out by daylight), 1 in caves, deep water and at night
  uBio: { value: 0 },
};

export const GLSL_TRANSP = `
  uniform sampler2D uDepthTex; uniform vec2 uRes; uniform vec3 uFogT; uniform float uExpo;
  vec3 transpFog(vec3 c, vec3 wpos){
    float sd = texture2D(uDepthTex, gl_FragCoord.xy / uRes).r;
    if (gl_FragCoord.z > sd + 1e-6) discard;
    return c * exp(-uFogT * length(wpos - cameraPosition)) * uExpo;
  }`;

/**
 * opts.swim: { amp, freq, waveLen, axis:'x', vertical:false, start }  — body undulation along local +X (head at +X)
 * opts.detail: 'rust' | 'wood' | 'sediment' | 'skin' | 'paint' | 'bone' | 'tarnish' | 'terrain' | null
 *   — procedural colour/roughness variation in world space
 * opts.clip: { value: Vector4(x, z, half, _) } — discard fragments inside that square (half < 0 disables)
 * opts.dust: amount of marine snow sediment on up-facing surfaces
 * opts.pulse: jellyfish bell pulse { amp, freq }
 * opts.glowPulse: emissive flicker frequency
 * opts.surge: { height, flex } — sway with the wave surge: bends more with height above the base (local +Y, full at
 *   `height`), by `flex` (0 rigid … 1.5 limp); amplitude falls off with depth like real wave motion
 * opts.bio: the emissive glow is bioluminescence, only seen where the water is dark (G.uBio)
 */
export function patch(mat, opts = {}) {
  const swim = opts.swim;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, G);
    sh.uniforms.uSwim = { value: new THREE.Vector4(swim?.amp ?? 0, swim?.freq ?? 0, swim?.waveLen ?? 1, swim?.start ?? 0) };
    sh.uniforms.uPulse = { value: new THREE.Vector2(opts.pulse?.amp ?? 0, opts.pulse?.freq ?? 0) };
    sh.uniforms.uDust = { value: opts.dust ?? 0 };
    sh.uniforms.uGlowPulse = { value: opts.glowPulse ?? 0 };
    sh.uniforms.uCausMul = { value: opts.causMul ?? 1 };
    sh.uniforms.uGlowSpin = { value: opts.glowSpin ?? 0 };
    sh.uniforms.uFlap = { value: new THREE.Vector3(opts.flap?.amp ?? 0, opts.flap?.freq ?? 0, opts.flap?.span ?? 1) };
    sh.uniforms.uClip = opts.clip ?? { value: new THREE.Vector4(0, 0, -1, 0) };
    sh.uniforms.uSurgeH = { value: opts.surge?.height ?? 1 };
    sh.uniforms.uFlex = { value: opts.surge?.flex ?? 0 };
    const defs = [];
    if (opts.clip) defs.push('#define CLIP_XZ');
    if (opts.surge) defs.push('#define SURGE');
    if (opts.bio) defs.push('#define BIOLUM');
    if (swim) defs.push(swim.vertical ? '#define SWIM_V' : '#define SWIM_H');
    if (opts.flap) defs.push('#define FLAP');
    if (opts.glow) defs.push('#define HAS_GLOW');
    if (opts.sway) defs.push('#define SWAY');
    if (mat.transparent) defs.push('#define TRANSP');
    for (const b of [].concat(opts.bump ?? [])) defs.push('#define BUMP_' + b.toUpperCase());
    if (opts.bump) defs.push('#define BUMP');
    if (opts.spots) defs.push('#define SPOTS');
    if (opts.mottle) defs.push('#define MOTTLE');
    sh.uniforms.uBumpAmp = { value: opts.bumpAmp ?? 1 };
    sh.uniforms.uBumpFreq = { value: opts.bumpFreq ?? 1 };
    if (opts.pulse) defs.push('#define PULSE');
    if (opts.detail) defs.push('#define DETAIL_' + opts.detail.toUpperCase());
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${defs.join('\n')}
        uniform float uTime; uniform vec4 uSwim; uniform vec2 uPulse; uniform vec3 uFlap;
        uniform vec4 uSurge; uniform float uSurgeH, uFlex;
        varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vLPos;
        attribute float aPhase;
        #ifdef HAS_GLOW
          attribute vec3 aGlow; varying vec3 vGlow;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLPos = position;
        float ph = uTime * uSwim.y + aPhaseV();
        #if defined(SWIM_H) || defined(SWIM_V)
          float along = clamp((uSwim.w - position.x) / max(uSwim.w + 1.0, 0.001), 0.0, 1.5);
          float wv = sin(ph - (uSwim.w - position.x) / uSwim.z * 6.2832) * uSwim.x * (0.15 + along * along);
          #ifdef SWIM_H
            transformed.z += wv;
          #else
            transformed.y += wv;
          #endif
        #endif
        #ifdef HAS_GLOW
          vGlow = aGlow;
        #endif
        #ifdef FLAP
          float fz = abs(position.z) / uFlap.z;
          transformed.y += sin(uTime * uFlap.y + aPhaseV() - fz * 1.6) * uFlap.x * pow(fz, 1.6) * uFlap.z;
        #endif
        #ifdef SWAY
          // hanging tentacles / arms: local -Y is the length direction
          float sd = max(-position.y, 0.0);
          transformed.x += sin(uTime * 0.9 + aPhaseV() + sd * 0.8 + position.z) * 0.06 * sd;
          transformed.z += cos(uTime * 0.7 + aPhaseV() * 1.3 + sd * 0.6 + position.x) * 0.06 * sd;
        #endif
        #ifdef PULSE
          float pu = sin(uTime * uPulse.y + aPhaseV());
          float bell = smoothstep(-0.2, 0.6, position.y);
          transformed.xz *= 1.0 - uPulse.x * (0.5 + 0.5 * pu) * (0.3 + bell);
          transformed.y += uPulse.x * 0.4 * pu * bell;
        #endif
        #ifdef SURGE
        {
          // the to-and-fro of passing swell felt on the bottom, plus a little eddying; the swell's orbital motion
          // dies away with depth (≈ e^(-depth/14) for these wavelengths), leaving only a slow current far down
          vec3 org = vec3(0.0); mat3 im = mat3(1.0);
          #ifdef USE_INSTANCING
            org = instanceMatrix[3].xyz; im = mat3(instanceMatrix);
          #endif
          vec3 wo = (modelMatrix * vec4(org, 1.0)).xyz;
          float bend = pow(clamp(position.y / uSurgeH, 0.0, 1.6), 1.6);
          float amp = uSurge.z * (exp(min(wo.y, 0.0) / 14.0) + 0.12) * uFlex;
          float ph = dot(uSurge.xy, wo.xz) * 0.07 - uTime * 0.72;
          float eddy = sin(uTime * 1.9 + wo.x * 0.9 + wo.z * 1.3 + position.y * 1.7 + aPhaseV());
          vec2 sw = uSurge.xy * (sin(ph) + 0.25 * sin(ph * 2.3 + 1.0)) + vec2(-uSurge.y, uSurge.x) * eddy * 0.35;
          vec3 wd = vec3(sw.x, -0.12 * abs(sw.x + sw.y) * bend, sw.y) * amp * bend;
          transformed += transpose(im) * wd / max(dot(im[0], im[0]), 1e-4);   // world sway → instance space
        }
        #endif`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          vec4 wpp = vec4(transformed, 1.0);
          mat3 nm = mat3(modelMatrix);
          #ifdef USE_INSTANCING
            wpp = instanceMatrix * wpp;
            mat3 im = mat3(instanceMatrix);
            im[0] /= max(dot(im[0], im[0]), 1e-8);
            im[1] /= max(dot(im[1], im[1]), 1e-8);
            im[2] /= max(dot(im[2], im[2]), 1e-8);
            nm = nm * im;
          #endif
          vWPos = (modelMatrix * wpp).xyz;
          vWNrm = normalize(nm * objectNormal);
        }`);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>') // keep order
      .replace('void main() {', `float aPhaseV(){ return aPhase; }
      void main() {`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${defs.join('\n')}
        ${GLSL_NOISE}
        ${GLSL_SEEN}
        ${GLSL_CAUSTIC}
        uniform vec3 uLnSeenCam;
        ${CAVE_OCCLUSION}
        uniform float uTime; uniform vec3 uCaus; uniform float uGlow; uniform vec3 uSunW; uniform float uDust; uniform float uGlowPulse; uniform float uCausMul; uniform float uBio; uniform float uGlowSpin;
        varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vLPos;
        #ifdef HAS_GLOW
          varying vec3 vGlow;
        #endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef CLIP_XZ
          if (uClip.z > 0.0 && abs(vWPos.x - uClip.x) < uClip.z && abs(vWPos.z - uClip.y) < uClip.z) discard;
        #endif
        float roughMod = 1.0;
        float dn = fbm3(vWPos * 0.6);
        float dn2 = vnoise(vWPos * 4.1);
        #ifdef DETAIL_RUST
          vec3 rustA = vec3(0.13, 0.05, 0.025), rustB = vec3(0.42, 0.16, 0.05), black = vec3(0.03, 0.025, 0.02);
          float streak = fbm3(vec3(vWPos.x * 1.4, vWPos.y * 0.1, vWPos.z * 1.4));
          float r1 = smoothstep(0.52, 0.78, streak + dn2 * 0.12) + smoothstep(0.72, 0.9, dn) * 0.6;
          diffuseColor.rgb = mix(diffuseColor.rgb * mix(0.55, 1.0, dn2), mix(rustA, rustB, dn2 * dn2), clamp(r1, 0.0, 1.0) * 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, black, smoothstep(0.6, 0.9, fbm3(vWPos * 0.21 + 4.0)) * 0.7);
        #endif
        #ifdef DETAIL_WOOD
          float grain = sin(vLPos.x * 9.0 + dn * 8.0) * 0.5 + 0.5;
          diffuseColor.rgb *= mix(0.55, 1.0, grain) * mix(0.6, 1.1, dn);
          // waterlogged timber: shipworm-eaten patches gone soft and black
          float rot = smoothstep(0.58, 0.8, fbm3(vWPos * 0.35 + 9.0));
          diffuseColor.rgb *= mix(1.0, 0.42, rot);
          roughMod = mix(0.95, 1.1, rot);
        #endif
        #ifdef DETAIL_PAINT
        {
          // marine paint after decades at depth: blistered and flaking to rust, stained by rust run-off
          float peel = smoothstep(0.46, 0.53, fbm3(vWPos * 0.9 + 3.0) + dn2 * 0.08);
          vec3 rustC = mix(vec3(0.15, 0.06, 0.025), vec3(0.36, 0.14, 0.05), dn2);
          vec3 paint = diffuseColor.rgb * mix(0.72, 1.05, dn);
          paint *= mix(0.5, 1.0, smoothstep(0.3, 0.7, fbm3(vWPos * 0.3 + 7.0)));   // grime
          float run = smoothstep(0.55, 0.85, fbm3(vec3(vWPos.x * 2.2, vWPos.y * 0.25, vWPos.z * 2.2)));
          paint = mix(paint, paint * vec3(0.6, 0.48, 0.38), run * 0.65);
          diffuseColor.rgb = mix(paint, rustC, peel);
          roughMod = mix(0.8, 1.15, peel);
        }
        #endif
        #ifdef DETAIL_BONE
        {
          // bone stained by iron-rich water, darker in the porous ends
          float stain = fbm3(vWPos * 9.0);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.6, 0.47, 0.33), smoothstep(0.35, 0.8, stain));
          diffuseColor.rgb *= mix(0.8, 1.06, mix(0.5, vnoise(vWPos * 40.0), aaFade(vWPos * 40.0)));
        }
        #endif
        #ifdef DETAIL_TARNISH
          // brass and bronze: verdigris in the hollows, dull brown elsewhere
          diffuseColor.rgb = mix(diffuseColor.rgb * mix(0.55, 1.0, dn2), vec3(0.1, 0.19, 0.14), smoothstep(0.42, 0.75, dn) * 0.75);
          roughMod = mix(0.75, 1.5, dn);
        #endif
        #ifdef DETAIL_TERRAIN
        {
          float steep = 1.0 - smoothstep(0.48, 0.8, vWNrm.y);
          vec3 sed = diffuseColor.rgb * mix(0.72, 1.12, dn) * mix(0.9, 1.05, dn2);
          sed = mix(sed, sed * vec3(0.8, 0.78, 0.74), smoothstep(0.55, 0.75, fbm3(vWPos * 0.05)));
          // basalt and mudstone exposed in the scarps, banded by strata and streaked with manganese crust
          float strata = sin(vWPos.y * 0.9 + fbm3(vWPos * 0.08) * 6.0) * 0.5 + 0.5;
          vec3 rock = mix(vec3(0.06, 0.06, 0.065), vec3(0.23, 0.21, 0.19), strata * 0.6 + dn2 * 0.4);
          rock *= mix(0.4, 1.2, fbm3(vWPos * 0.35)) * mix(0.7, 1.1, fbm3(vWPos * 1.7));   // dark joints and crevices
          rock = mix(rock, vec3(0.3, 0.27, 0.22), smoothstep(0.35, 0.6, vWNrm.y) * 0.6);   // silt caught on ledges
          diffuseColor.rgb = mix(sed, rock, steep);
          roughMod = mix(1.0, 0.82, steep);
        }
        #endif
        #ifdef DETAIL_SEDIMENT
          diffuseColor.rgb *= mix(0.72, 1.12, dn) * mix(0.9, 1.05, dn2);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.78, 0.74), smoothstep(0.55, 0.75, fbm3(vWPos * 0.05)));
        #endif
        #ifdef DETAIL_SKIN
          diffuseColor.rgb *= mix(0.85, 1.08, dn2);
        #endif
        #ifdef DETAIL_CORAL
        {
          float colonies = fbm3(vWPos * 2.4);
          float polyps = vnoise(vWPos * 32.0);
          diffuseColor.rgb *= mix(0.66, 1.13, colonies) * mix(0.85, 1.05, polyps * aaFade(vWPos * 32.0) + 0.5);
          roughMod = mix(0.85, 1.15, colonies);
        }
        #endif
        #ifdef DETAIL_LIMESTONE
        {
          float bedding = sin(vWPos.y * 3.0 + fbm3(vWPos * 0.13) * 5.0) * 0.5 + 0.5;
          float cracks = smoothstep(0.47, 0.52, fbm3(vWPos * 1.8));
          diffuseColor.rgb *= mix(0.62, 1.12, bedding * 0.35 + dn * 0.65);
          diffuseColor.rgb *= mix(0.72, 1.0, cracks);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.68, 0.8, 0.65), smoothstep(0.52, 0.74, dn2) * 0.4);
        }
        #endif
        #ifdef DETAIL_SAND
        {
          float ripple = sin(vWPos.x * 4.3 + sin(vWPos.z * 0.38) * 1.8 + dn * 6.0) * 0.5 + 0.5;
          diffuseColor.rgb *= mix(0.87, 1.07, ripple) * mix(0.86, 1.07, dn);
        }
        #endif
        #ifdef SPOTS
        {
          // whale-shark checkerboard of pale spots and stripes on the back
          vec3 q = vLPos * vec3(34.0, 34.0, 34.0);
          vec3 cell = floor(q);
          vec3 rp = vec3(hash13(cell), hash13(cell + 7.1), hash13(cell + 3.3)) * 0.6 + 0.2;
          float dsp = length(fract(q) - rp);
          float top = smoothstep(-0.03, 0.03, vLPos.y);
          float spot = smoothstep(0.24, 0.16, dsp) * top * aaFade(q);
          float stripe = smoothstep(0.08, 0.02, abs(fract(vLPos.x * 14.0) - 0.5)) * top * 0.6 * aaFade(vLPos * 14.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.8), max(spot, stripe));
        }
        #endif
        #ifdef MOTTLE
        {
          float mo = fbm3(vLPos * 30.0);
          diffuseColor.rgb *= mix(0.78, 1.25, smoothstep(0.35, 0.75, mo));
        }
        #endif
        if (uDust > 0.0) {
          // marine snow settled on anything facing up: a mottled grey-brown silt, not a white powder
          float up = smoothstep(0.25, 0.85, vWNrm.y);
          vec3 silt = mix(vec3(0.22, 0.2, 0.17), vec3(0.38, 0.35, 0.3), dn);
          diffuseColor.rgb = mix(diffuseColor.rgb, silt, up * uDust * mix(0.6, 1.0, dn2));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * roughMod, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef BUMP
        {
          float bh = bumpHeight();
          vec2 dH = vec2(dFdx(bh), dFdy(bh)) * 0.012 * uBumpAmp;
          normal = perturbN(-vViewPosition, normal, dH, faceDirection);
        }
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef HAS_GLOW
          totalEmissiveRadiance += vGlow;
        #endif
        if (uGlowSpin > 0.0) totalEmissiveRadiance *= 0.08 + 0.92 * pow(0.5 + 0.5 * sin(atan(vLPos.z, vLPos.x) * 2.0 - uTime * uGlowSpin), 6.0);
        totalEmissiveRadiance *= uGlow;
        #ifdef BIOLUM
          totalEmissiveRadiance *= uBio;
        #endif
        if (uGlowPulse > 0.0) totalEmissiveRadiance *= 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * uGlowPulse + vWPos.x * 0.7 + vWPos.z * 0.3), 3.0);`)
      .replace('#include <lights_fragment_begin>', `
        // daylight as it arrives at this surface's own depth: the light colours are for the camera's depth, so scale
        // them by the Beer–Lambert ratio between the two (a reef floor 20 m below you is bluer and dimmer than the
        // water you are in), and let the caustics focus the direct sun
        vec3 beerL = exp(clamp(lnSeen(max(-vWPos.y, 0.0)) - uLnSeenCam, -60.0, 3.5));
        float causMod = causticAt(vWPos, uSunW, uCausAmt * uCausMul);
        ${THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= beerL * causMod;')}
        #if defined( RE_IndirectDiffuse )
          irradiance *= beerL;
        #endif`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        #if defined( RE_IndirectDiffuse )
          iblIrradiance *= beerL;
        #endif
        #if defined( RE_IndirectSpecular )
          radiance *= beerL;
        #endif`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float caveShadeLocal = caveOcclusion(vWPos);
        reflectedLight.indirectDiffuse *= 1.0 - caveShadeLocal * 0.9;
        reflectedLight.indirectSpecular *= 1.0 - caveShadeLocal * 0.96;`)
      .replace('#include <opaque_fragment>', `
        #include <opaque_fragment>
        #ifdef TRANSP
          gl_FragColor.rgb = transpFog(gl_FragColor.rgb, vWPos);
        #endif`)
      .replace('uniform float uGlowSpin;', `uniform float uGlowSpin; uniform float uBumpAmp, uBumpFreq; uniform vec4 uClip;
        varying vec3 vWPos; varying vec3 vLPos; varying vec3 vWNrm;
        // anti-aliased procedural relief: every pattern fades out before its cells get smaller than a few pixels
        float aaFade(vec3 p){ vec3 w = fwidth(p); return smoothstep(0.45, 0.12, max(max(w.x, w.y), w.z)); }
        float bumpHeight(){
          float h = 0.0;
          #ifdef BUMP_SCALES
          {
            vec3 q = vLPos * 95.0 * uBumpFreq;
            float row = floor(q.y + q.z);
            vec2 sp = vec2(q.x + mod(row, 2.0) * 0.5, q.y + q.z);
            vec2 f = fract(sp) - vec2(0.5, 0.3);
            h += (1.0 - smoothstep(0.0, 0.62, length(f))) * aaFade(q);
          }
          #endif
          #ifdef BUMP_SKIN
          {
            vec3 q = vLPos * 140.0 * uBumpFreq;
            h += (vnoise(q) * 0.6 + vnoise(q * 2.7) * 0.4) * aaFade(q) * 0.6;
            vec3 q2 = vLPos * 22.0 * uBumpFreq;
            h += vnoise(q2) * aaFade(q2) * 1.2;
          }
          #endif
          #ifdef BUMP_GROOVES
          {
            float m = smoothstep(0.0, -0.02, vLPos.y) * smoothstep(0.05, 0.25, vLPos.x);
            vec3 q = vec3(vLPos.z * 900.0 * uBumpFreq, 0.0, 0.0);
            h += (0.5 + 0.5 * sin(q.x)) * m * aaFade(q / 6.28) * 1.5;
          }
          #endif
          #ifdef BUMP_PLATES
          {
            vec3 q = vWPos * vec3(0.5, 0.8, 0.5);
            vec3 f = abs(fract(q) - 0.5);
            float seam = smoothstep(0.47, 0.5, max(f.x, max(f.y, f.z)));
            h -= seam * aaFade(q * 8.0) * 0.8;
            h += vnoise(vWPos * 3.0) * 0.4 * aaFade(vWPos * 3.0);
          }
          #endif
          #ifdef BUMP_PLANKS
          {
            // deck planks run fore and aft; hull strakes and wall boards are horizontal
            float ax = abs(vWNrm.y) > 0.6 ? vLPos.z : vLPos.y;
            float pf = fract(ax * 3.3);
            float seam = 1.0 - smoothstep(0.0, 0.07, pf) * (1.0 - smoothstep(0.93, 1.0, pf));
            h -= seam * aaFade(vec3(ax * 13.0)) * 1.2;
            vec3 g = vec3(vLPos.x * 1.5, ax * 26.0, 0.0);
            h += vnoise(g) * 0.35 * aaFade(g);
          }
          #endif
          #ifdef BUMP_PAINT
          {
            // raised flakes at the edge of every patch of peeled paint, and rust scale beneath
            float pe = fbm3(vWPos * 0.9 + 3.0);
            h += smoothstep(0.42, 0.48, pe) * (1.0 - smoothstep(0.5, 0.56, pe)) * aaFade(vWPos * 6.0) * 1.2;
            h += vnoise(vWPos * 7.0) * 0.3 * aaFade(vWPos * 7.0);
          }
          #endif
          #ifdef BUMP_TERRAIN
          {
            float steep = 1.0 - smoothstep(0.48, 0.8, vWNrm.y);
            vec3 q = vWPos * 1.3;
            float crag = (vnoise(q) * 0.6 + vnoise(q * 2.9) * 0.3) * aaFade(q * 2.9) + vnoise(vWPos * 0.45) * 1.6 * aaFade(vWPos * 0.45);
            float rip = sin(vWPos.x * 2.1 + vnoise(vWPos * 0.4) * 5.0) * 0.5 * aaFade(vWPos * 0.4);
            h += mix(rip * 0.25 + vnoise(vWPos * 6.0) * 0.15 * aaFade(vWPos * 6.0), crag * 2.4, steep);
          }
          #endif
          #ifdef BUMP_CORAL
          {
            vec3 q = vWPos * 28.0;
            float pores = 1.0 - smoothstep(0.12, 0.32, length(fract(q) - 0.5));
            h += (vnoise(q * 0.31) * 0.65 - pores * 0.5) * aaFade(q);
          }
          #endif
          #ifdef BUMP_LIMESTONE
          {
            vec3 q = vWPos * 2.2;
            h += fbm3(q) * 2.8 * aaFade(q);
            h += sin(vWPos.y * 12.0 + vnoise(vWPos * 0.8) * 4.0) * 0.35 * aaFade(vWPos * 2.0);
          }
          #endif
          #ifdef BUMP_SAND
          {
            vec3 q = vWPos * 4.0;
            h += sin(vWPos.x * 4.3 + sin(vWPos.z * 0.38) * 1.8 + fbm3(vWPos * 0.6) * 6.0) * 0.4 * aaFade(q);
            h += vnoise(vWPos * 75.0) * 0.15 * aaFade(vWPos * 75.0);
          }
          #endif
          return h;
        }
        vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir){
          vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos));
          vec3 R1 = cross(vSigmaY, surf_norm); vec3 R2 = cross(surf_norm, vSigmaX);
          float fDet = dot(vSigmaX, R1) * faceDir;
          vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
          return normalize(abs(fDet) * surf_norm - vGrad);
        }
        #ifdef TRANSP
        ${GLSL_TRANSP}
        #endif`)
      .replace('varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vLPos;', '');
  };
  mat.customProgramCacheKey = () => JSON.stringify([!!opts.swim, opts.swim?.vertical, !!opts.pulse, opts.detail, !!opts.flap, !!opts.glow, !!opts.sway, mat.transparent, opts.bump, !!opts.spots, !!opts.mottle, !!opts.clip, !!opts.surge, !!opts.bio]);
  return mat;
}

// every geometry patched with aPhase needs it; helper adds a default constant one
export function ensurePhase(geo, value = 0) {
  if (!geo.getAttribute('aPhase')) {
    const n = geo.getAttribute('position').count;
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(n).fill(value), 1));
  }
  return geo;
}
