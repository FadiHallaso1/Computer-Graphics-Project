# Ripple Water

**A real-time procedural water surface with interactive ripple physics, built in WebGL 2 with Three.js.**

A lake at sunset under a bridge. Rolling waves are generated procedurally on the GPU, and you can disturb the water with the mouse: drop stones, stir a wake, make it rain, or open whirlpools. Kayaks, buoys and logs float on the surface, bob with the waves, are reflected in the water and cast shadows on it.

**Authors:** Fadi Hallaso · Haitam Shahin · Farid Farah

---

## Try it

**[Open the live demo](https://fadihallaso1.github.io/Computer-Graphics-Project/water-demo/)**. It runs in any recent desktop browser (Chrome, Edge, Firefox or Safari 15+), with nothing to install.

| Input | Action |
|---|---|
| Click | Drop a stone |
| Shift + drag | Stir the water |
| Right-click | Open a whirlpool ("wormhole") |
| Drag · scroll | Orbit · zoom the camera |
| `R` · `C` · `X` | Rain · calm the water · close all whirlpools |
| `W` · `N` | Wireframe · surface-normal debug views |

The **Controls** panel at the top right changes the waves, ripples, shading and objects while the scene runs.

## Features

- **Gerstner wave surface.** Four summed Gerstner waves displace an 863k-vertex mesh in the vertex shader, with exact analytic normals and a horizon that fades with no visible edge.
- **Physically motivated water shading.** Fresnel reflection, sky reflection, refraction down to a sandy seabed with depth-dependent colour, and a sun glint aligned with the sun in the sky.
- **Interactive ripples.** The 2D wave equation is solved on the GPU in real time, and the ripples are coupled into both the geometry and the lighting of the surface.
- **Floating objects.** Procedurally modelled kayaks, buoys and logs float on the waves, are reflected in the water through a planar reflection pass, and cast analytic sun shadows that cut through the glint.
- **Whirlpools.** Right-click opens a spiral funnel with analytic normals that drags nearby objects in and swallows them.

The [project report](REPORT.md) explains each feature in detail, with videos.

---

## Connection to the course material

The project was designed around two core topics of the course: **curves and surfaces**, and **shading**. Most of the work went into shading and reflection, so that section is the most detailed below.

### Shading and illumination

| Course topic | How the project uses it | Code |
|---|---|---|
| Phong illumination model | The sun glint is a Blinn–Phong specular term, `(N·H)^n` with the half vector `H = normalize(L + V)` and a very high exponent (900 by default) for a tight, mirror-like highlight. | [`water.frag.js`](water-demo/src/shaders/water.frag.js) |
| Phong vs. Gouraud shading | Lighting is evaluated per pixel, not per vertex: the surface normal is rebuilt in the fragment shader from the interpolated tangents. Per-vertex (Gouraud) lighting would lose the narrow glint highlights that fall between vertices. | [`water.frag.js`](water-demo/src/shaders/water.frag.js) |
| Normals and their role in lighting | All lighting depends on exact normals: the cross product of the surface's analytic partial derivatives, plus the ripple slope added per pixel (similar in spirit to normal mapping). The `N` key displays them as colours. | [`water.vert.js`](water-demo/src/shaders/water.vert.js), [`water.frag.js`](water-demo/src/shaders/water.frag.js) |
| Light sources | A single directional light (the sun), whose direction was measured from the sun's position in the skybox photo so that the highlight, the shadows and the sky all agree. | [`main.js`](water-demo/src/main.js) |
| Shadows | Each floating object is approximated by an ellipse. For every water pixel, a ray is cast toward the sun and tested against the ellipses; shadowed water loses its glint but keeps its reflection. | [`water.frag.js`](water-demo/src/shaders/water.frag.js), [`floaters.js`](water-demo/src/floaters.js) |
| Colour and gamma | All lighting is computed in linear colour space and converted to sRGB only at output, so highlights and colour blends are physically consistent. | [`water.frag.js`](water-demo/src/shaders/water.frag.js) |

### Reflection, refraction and the Fresnel effect

| Course topic | How the project uses it | Code |
|---|---|---|
| Fresnel effect | Schlick's approximation, `F = F₀ + (1 − F₀)(1 − cos θ)⁵`, with `F₀ ≈ 0.02` derived from water's refractive index 1.333. Water looking straight down is mostly see-through; at grazing angles it is almost a mirror. `F` blends the reflected and transmitted light. | [`water.frag.js`](water-demo/src/shaders/water.frag.js) |
| Environment mapping | The reflected view vector `R = reflect(−V, N)` samples a cube-map skybox. Higher mip levels are used with distance to imitate waves too small for the mesh. | [`water.frag.js`](water-demo/src/shaders/water.frag.js) |
| Planar reflection | A second camera, mirrored through the water plane `y = 0`, renders the floating objects into a texture. The water projects each pixel into that texture, offsets it by the wave normal so the reflection wobbles, and weights it with the same Fresnel term as the sky. | [`reflection.js`](water-demo/src/reflection.js) |
| Refraction | The view ray is bent with Snell's law, followed to an analytic seabed, and attenuated with the Beer–Lambert law (red is absorbed fastest). Shallow water over sand turns turquoise; deep water turns dark blue-green. | [`water.frag.js`](water-demo/src/shaders/water.frag.js) |

The *Objects* panel can switch the reflections and shadows off and on, to compare the shading with and without each term.

### Curves and surfaces

| Course topic | How the project uses it | Code |
|---|---|---|
| Parametric surfaces | The water is a time-varying parametric surface `P(x, z, t)`: a sum of Gerstner waves that move points along circles, not just up and down. | [`water.vert.js`](water-demo/src/shaders/water.vert.js) |
| Tangents and normals | The tangents are the exact partial derivatives `∂P/∂x` and `∂P/∂z`; the normal is their cross product. Checked against finite differences to within 2 × 10⁻⁶ degrees. | [`water.vert.js`](water-demo/src/shaders/water.vert.js) |
| Surface validity | A Gerstner surface folds over itself when its crests are too steep. The steepness is bounded (`Σ Q·kᵢ·Aᵢ ≤ 1`) so that no slider setting can make it self-intersect. | [`water.js`](water-demo/src/water.js) |
| Tessellation and sampling | Each wave fades out where the mesh has fewer than about 8 vertices per wavelength (a geometric Nyquist limit), so the coarse mesh near the horizon never aliases. | [`water.js`](water-demo/src/water.js), [`water.vert.js`](water-demo/src/shaders/water.vert.js) |
| Height fields | Each whirlpool is a funnel plus spiral arms, with an analytic gradient that stays finite even at the centre. | [`water.vert.js`](water-demo/src/shaders/water.vert.js) |
| Procedural modelling | The kayak hull is a sphere deformed into a hull shape (pointed ends, flat deck, upward-curved ends). | [`floaters.js`](water-demo/src/floaters.js) |

### Other course topics

| Course topic | How the project uses it |
|---|---|
| Transformations and viewing | Model, view and perspective-projection matrices; a reflection transformation for the mirror camera; yaw–pitch–roll rotations for the floating objects. |
| Ray casting | A mouse click becomes a ray from the camera, which is intersected with the moving wave surface (ray marching followed by bisection), so drops and whirlpools land exactly under the cursor. |
| Texture mapping | Cube maps, mipmapping, render-to-texture, floating-point textures and projective texture lookup. |
| The programmable GPU pipeline | Custom GLSL vertex and fragment shaders, plus a GPU simulation that alternates between two render targets ("ping-pong") every step. |
| Interaction and GUI | A live control panel, a hover marker showing where a drop will land, and keyboard shortcuts that stay in sync with the panel. |

---

## Running it locally

The live demo needs no setup. To run your own copy, note that the project **cannot be opened by double-clicking `index.html`**: browsers block JavaScript modules and WebGL textures on pages opened from disk (`file://`). Serve the `water-demo` folder with a small local web server instead:

- **VS Code:** install the *Live Server* extension, then right-click `water-demo/index.html` and choose **Open with Live Server**.
- **Python:** run `python3 -m http.server 8000` (on Windows, `py -m http.server 8000`) inside `water-demo`, then open <http://localhost:8000>.

## Credits and references

- J. Tessendorf, *Simulating Ocean Water*, 2001.
- M. Finch, "Effective Water Simulation from Physical Models," *GPU Gems*, ch. 1, 2004.
- C. Schlick, "An Inexpensive BRDF Model for Physically-based Rendering," *Computer Graphics Forum*, 1994.
- Skybox "Bridge2" by Emil Persson (Humus), <http://www.humus.name>. Its licence is included in `water-demo/textures/bridge2/readme.txt`.
- [Three.js](https://threejs.org) and [lil-gui](https://lil-gui.georgealways.com), MIT licence.
