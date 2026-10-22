# Surface assets

The project includes 1K photographic material sets from Poly Haven, licensed under [CC0](https://polyhaven.com/license). Each set contains an sRGB diffuse photograph, an OpenGL normal map, and a linear packed ambient-occlusion/roughness/metalness map (R/G/B). `textures/manifest.json` records the original download URLs and verified MD5 checksums.

| Material | Use | Source |
| --- | --- | --- |
| Rock Face 03 | Cave shells, eroded limestone forms and boulders | [Poly Haven](https://polyhaven.com/a/rock_face_03), Dario Barresi / Rico Cilliers |
| Coral Ground 02 | Porous reef substrate and cave-floor sediment | [Poly Haven](https://polyhaven.com/a/coral_ground_02), Rob Tuytel |
| Rusty Metal 03 | Oxidised hull plating, steel, iron and rusticles | [Poly Haven](https://polyhaven.com/a/rusty_metal_03) |
| Weathered Planks | Waterlogged decks and damaged furniture | [Poly Haven](https://polyhaven.com/a/weathered_planks) |

`js/pbr.js` applies the maps with triplanar projection at a consistent world scale, preserving the existing procedural sediment and weathering. The packed AO channel affects indirect lighting; the normal map supplies pores, grain and cracks. A failed material download falls back to the existing procedural material. The standalone build embeds the twelve JPEGs, so moving the HTML does not break its textures.

Corals, fish, cave shapes and damaged furniture are authored procedural geometry. No third-party scanned mesh or generated 3D asset is included.
