# Open Ocean Descent

**[Launch the ocean simulation](https://danieluwilliams.github.io/Simulations/)**

The live site is hosted on GitHub Pages and updates when changes are pushed to `main`.

Open `ocean-descent.html` for the bundled experience, or serve this folder over HTTP and open `index.html`. Three.js and the fonts load from their existing CDNs.

The view is open edge to edge, with a 78° vertical field of vision and no frame, instrument console, glass distortion, or vignette. Press **H** to hide the remaining navigation HUD. Ten gulls circle, glide, and flap above the daytime ocean. Calls come from visible birds, with beak movement timed to the sound and stereo position following the caller. Birds and calls fade out as the sun sets and are absent underwater.

The upper ocean includes four habitats. Swim to them using the small distance, relative-bearing arrow, and target-depth instructions below the depth readout at the top left:

| Habitat | Exploration depth | Features |
| --- | --- | --- |
| Coral reef | 18 m | Coral heads of branching and brain corals, plates, sea fans, sponges, soft corals, sea whips, giant clams, anemones with clownfish, seagrass channels, tropical fish, turtles, and rays |
| Cathedral caves | 60 m | A 224 m flooded passage, a large central chamber, a roof opening, stalactites, glowing teal wall colonies and plankton, resident fish, and two open entrances |
| Coral terrace | 113 m | Mesophotic plate corals, sea fans, sea whips, glowing sea pens, sponges, and reef fish |
| Azure grotto | 101 m | A second 154 m flooded limestone passage with sponge gardens, azure bioluminescent colonies and plankton, and glassfish |

Use the arrow keys to move and turn, **D / A** to descend and ascend, and **Shift** to cruise faster. Hold the middle mouse button to look around. **F** toggles the hull lights (with a switch click), which reveal nearby coral colors. Soft corals, sea whips, anemones, and seagrass sway with the passing swell. Bioluminescence shows only where the water is dark enough: inside the caves, on the deep terrace, and on the reef at night. Plankton flare as the sub passes. Teal survey markers and an exit bearing guide you through the caves. The four habitat routes have no teleport buttons or number-key jumps.

Entering any room of a wreck switches to walking: the view settles onto the deck at eye height and **↑ / ↓** walk along the heading wherever you look. You step up stair stringers and low debris, stoop under low deckheads and sink back down through hatches. The wheel sets the walking pace (1.1 m/s at ×1, up to 8 m/s), **A** kicks up off the floor to climb a stairwell or leave by a hatch, and **D** crouches. Leaving the rooms returns you to swimming. Your exhaust breathes out a burst of bubbles every few seconds, and a stream of bubbles rises around you as you walk. Both get quicker and fuller the faster you go, and they pool briefly under the deckhead instead of passing through it.

The shallow bank sits apart from the existing wreck field; the abyssal plain, wreck interiors, and 10,935 m trench remain accessible. Corals, sand, and limestone use procedural surface detail and physically based materials. Geometry and resident wildlife are instanced, with distance culling for the separate habitats.

The habitat layout is fictional. Depth and geology references:

- [NOAA: shallow and deeper coral distribution](https://oceanservice.noaa.gov/education/tutorial_corals/coral05_distribution.html)
- [NOAA: mesophotic coral ecosystems, typically 30–150 m](https://coastalscience.noaa.gov/science-areas/coral-ecosystem/mesophotic-coral-ecosystems/)
- [NOAA: submerged karst caverns on the continental shelf](https://oceanexplorer.noaa.gov/expedition/20blue-holes/)

`build-standalone.ps1` regenerates the bundled HTML from `index.html` and all files in `js/`.

The realism update adds 35 hard-coral variants across seven growth forms, eroded rock variants and cave scallops shared with collision detection. Reef fish have more distinct body proportions, inset pupils, gill covers, mouths and tail-fin rays. Wreck chairs have missing slats, snapped legs, exposed joint pins and loose splinters; tables have separated boards and crates have broken, open sides.

Photographic rock, coral rubble, rust and timber materials include normal and ambient-occlusion/roughness/metalness maps. See [asset credits and provenance](assets/README.md). These photographs supplement authored procedural geometry; they are not scanned animal or coral meshes.

Rendering retains native display resolution (up to 2× pixel ratio), uses up to four MSAA samples, and removes artificial underwater image warping, edge blur and RGB fringing. Soft headlamp shadows, shadowed sunlight near the reef, local cave occlusion, dimmer indirect fill, reduced marine snow and restrained bloom preserve detail in dark interiors. Screen-space ambient occlusion darkens crevices, the feet of bulkheads and furniture, and the gaps between coral heads. The floodlight beams in the water are shadowed by whatever they strike, so masts and wreckage throw dark shafts through the lit haze, as in ROV footage of deep wrecks. There is no automatic resolution reduction. The additional detail costs GPU time; static wreck meshes and reef instances are spatially divided and culled to reduce unnecessary rendering.

The standalone HTML embeds all twelve photographic texture images (about 12 MB total HTML); Three.js and web fonts still require their CDNs. Rebuild on Windows with `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-standalone.ps1`.

For development checks, serve the project and open `tests/visual.html` to inspect the reef, both caves, wreck interiors, surface and trench. It reports texture loading, module errors, finite geometry, cave collision and frame rate. With Node installed, run `node --experimental-vm-modules tests/geometry.mjs` for deterministic geometry checks. The test-only vendored Three.js file matches the application's pinned 0.169.0 version.

Run `node --experimental-vm-modules tests/birds.mjs` to check gull flight, daylight and underwater visibility, audio/beak synchronization, stereo tracking, mute, and voice cleanup. The visual harness also has surface/night viewpoints and an **Enable preview sound** button for checking calls in the browser. `tests/birds-visual.html` isolates the gulls and audio for animation checks without the full ocean renderer.

## Below the Challenger Deep

Forty-five metres past the lander on the trench floor there is a square opening cut into the mud. Hover over it and hold **D** to sink down the shaft into an endless flooded backroom: catacomb corridors of charred, rusted plate and ossuary stone, streamed in around you as you walk (`js/backrooms.js`). A few ceiling tubes still work, dimly and with a flicker; a faint glow lets you find your way, and **F** turns on a flashlight that sputters, browns out and sometimes dies for a second or two. The hatch slams at a moment of its own choosing, killing your lights, and grinds open for 30 seconds every 3 minutes (the HUD counts down and points back to it; under it, hold **A** to rise out). A television hangs by its cord in the first hall showing static, and someone has written "!?" on the wall in blood. Floors and the lower columns are soaked and glossy, the walls are stained with old water lines, corner grime and rust and mineral runs, and the flashlight beam shows the silt hanging in the water.

## Light, caustics and bubbles

- **Spectral Beer–Lambert light** (`js/common.js`): sunlight is split into 11 bands, each attenuated with depth by clear-ocean coefficients, so red goes first, then orange and yellow, then green, leaving blue. Every surface is lit for its own depth through a lookup texture. Below about 150 m a deep-blue twilight fades to exactly zero at 3,000 ft (914 m).
- **GPU caustics** (`js/caustics.js`): a tiling texture re-rendered each frame from two layers of moving ripples (real deep-water wave dispersion), mipmapped so the pattern grows and blurs with depth; it is gone by 200 ft. It modulates direct sunlight, so it respects shadows.
- **God rays** (`js/post.js`): the volumetric shafts follow the same caustic pattern and are shadowed by whatever blocks the sun.
- **Bubble wake** (`js/bubbles.js`): the trail scales with speed, from a few bubbles a second at a slow walk to about 500 at a sprint or thruster boost, from a fixed pool of 4,096 that fades bubbles out rather than recycling them early.

Previous copies of the files these changes replaced are in `_previous-version/`.
