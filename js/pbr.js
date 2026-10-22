// CC0 photographic surfaces. Triplanar mapping keeps metre-scale detail on the
// procedural shells and merged wrecks without stretching it over their UVs.
import * as THREE from 'three';

const surfaces = new Map();
export const textureStatus = { loaded: 0, failed: [], total: 12 };

export async function loadSurfaces(renderer) {
  const embedded = document.getElementById('ocean-textures');
  const sources = embedded ? JSON.parse(embedded.textContent) : {};
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  await Promise.all(['rock_face_03', 'rusty_metal_03', 'weathered_planks', 'coral_ground_02'].map(async (id) => {
    const maps = await Promise.all(['diffuse', 'nor_gl', 'arm'].map(async (channel) => {
      const file = `${id}_${channel}.jpg`;
      try {
        const texture = await loader.loadAsync(sources[file] || new URL(`assets/textures/${file}`, document.baseURI).href);
        texture.colorSpace = channel === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = anisotropy;
        textureStatus.loaded++;
        return texture;
      } catch (error) {
        textureStatus.failed.push(file);
        console.warn(`Photographic texture unavailable: ${file}`, error);
        return null;
      }
    }));
    // A missing channel leaves the existing procedural material intact.
    if (maps.every(Boolean)) surfaces.set(id, maps);
    else maps.forEach((map) => map?.dispose());
  }));
}

export function photographic(material, id, { scale = 0.5, strength = 0.8, normal = 0.7, tint = 0xffffff } = {}) {
  const maps = surfaces.get(id);
  if (!maps) return material;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.userData.photographic = id;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      uPhotoColor: { value: maps[0] }, uPhotoNormal: { value: maps[1] }, uPhotoARM: { value: maps[2] },
      uPhotoScale: { value: scale }, uPhotoStrength: { value: strength },
      uPhotoNormalStrength: { value: normal }, uPhotoTint: { value: new THREE.Color(tint) },
    });
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `
      uniform sampler2D uPhotoColor, uPhotoNormal, uPhotoARM;
      uniform float uPhotoScale, uPhotoStrength, uPhotoNormalStrength;
      uniform vec3 uPhotoTint;
      vec3 photoWeights() {
        vec3 w = pow(abs(normalize(vWNrm)), vec3(6.0));
        return w / max(w.x + w.y + w.z, 0.0001);
      }
      vec3 photoSample(sampler2D map) {
        vec3 p = vWPos * uPhotoScale, w = photoWeights();
        return texture2D(map, p.zy).rgb * w.x + texture2D(map, p.xz).rgb * w.y + texture2D(map, p.xy).rgb * w.z;
      }
      void main() {`);
    // Insert before the existing colour/weathering patch so silt and mineral
    // stains sit on top of the photograph, instead of disappearing under it.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, photoSample(uPhotoColor) * uPhotoTint, uPhotoStrength);
      vec3 photoARM = photoSample(uPhotoARM);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = clamp(mix(roughnessFactor, photoARM.g, 0.85), 0.38, 1.0);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `
      #include <metalnessmap_fragment>
      metalnessFactor *= photoARM.b;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      {
        vec3 p = vWPos * uPhotoScale, w = photoWeights(), n = normalize(vWNrm);
        vec3 nx = texture2D(uPhotoNormal, p.zy).xyz * 2.0 - 1.0;
        vec3 ny = texture2D(uPhotoNormal, p.xz).xyz * 2.0 - 1.0;
        vec3 nz = texture2D(uPhotoNormal, p.xy).xyz * 2.0 - 1.0;
        vec3 slope = vec3(0.0, nx.y, nx.x) * w.x + vec3(ny.x, 0.0, ny.y) * w.y + vec3(nz.x, nz.y, 0.0) * w.z;
        slope -= n * dot(n, slope);
        normal = normalize(normal + mat3(viewMatrix) * slope * uPhotoNormalStrength * faceDirection);
      }
    `);
    // AO affects indirect light only: the headlamps can still reveal a crevice.
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `
      #include <aomap_fragment>
      reflectedLight.indirectDiffuse *= mix(1.0, photoARM.r, 0.85);
      reflectedLight.indirectSpecular *= mix(1.0, photoARM.r, 0.65);
    `);
  };
  material.customProgramCacheKey = () => `${previousKey()}|photo:${id}`;
  return material;
}
