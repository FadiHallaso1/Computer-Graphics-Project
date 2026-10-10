# Ripple Water: Project Report

## 1. Overview

Ripple Water is a real-time water simulation that runs in the browser. It uses WebGL 2 through Three.js. The scene is a lake at sunset under a bridge. The water has rolling waves, and you can disturb it with the mouse: drop stones, stir it, make it rain, or open whirlpools ("wormholes"). Kayaks, buoys and logs float on the surface. They bob on the waves, are reflected in the water, cast shadows on it, and get pulled into the whirlpools.

The project was built in seven stages. Each stage added one feature, and most features have their own source file:

| Stage | Feature | Main files |
|---|---|---|
| 1–3 | Water mesh and Gerstner waves | `src/water.js`, `src/shaders/water.vert.js` |
| 4 | Water shading | `src/shaders/water.frag.js` |
| 5 | Interactive ripples | `src/ripples.js`, `src/shaders/ripple.frag.js`, `src/main.js` |
| 6 | Floating objects | `src/floaters.js` |
| 6 | Object reflections and shadows | `src/reflection.js`, `src/shaders/water.frag.js` |
| 6 | Control panel | `src/gui.js` |
| 7 | Wormholes (whirlpools) | `src/wormholes.js`, `src/shaders/water.vert.js` |

`src/main.js` ties everything together. It sets up the renderer, camera and skybox, handles mouse and keyboard input, and runs the frame loop. Each frame it advances the waves, wormholes, floating objects and ripple simulation, renders the reflection pass, and then renders the scene.

**Technology:** Three.js 0.186.1 and lil-gui 0.21.0, loaded from a CDN through an import map. There is no build step. The sky is the "Bridge2" cubemap by Emil Persson (Humus).

---

## 2. Water surface and Gerstner waves

**Files:** `src/water.js`, `src/shaders/water.vert.js`

**What it does.** The water surface moves with four overlapping waves: a long swell plus shorter cross-chop from different directions. The crests are sharp and the troughs are wide, like real water rather than a smooth sine curve. The water reaches all the way to the horizon with no visible edge.

**How it was implemented.**

- **Mesh.** The surface is one plane mesh with 863k vertices. The centre is a dense 400 × 400-unit grid with 0.5-unit cells. Around it is a coarser "skirt" whose cell size grows smoothly out to the horizon. Each vertex stores its local cell size, so the shader knows how fine the mesh is at that point.
- **Gerstner waves.** The vertex shader moves every vertex with the sum of four Gerstner waves. A Gerstner wave moves points in circles, up and down and also sideways, which bunches vertices together at the crests:

  ```
  k_i = 2π / λ_i,   ω_i = sqrt(g k_i),   θ_i = k_i (D_i · (x,z)) − ω_i t + φ_i

  x' = x + Σ Q A_i D_ix cos θ_i
  y  =     Σ   A_i      sin θ_i
  z' = z + Σ Q A_i D_iz cos θ_i
  ```

- **Realistic wave speed.** The wave speed comes from deep-water physics, `ω_i = sqrt(g k_i)`, so long waves travel faster than short ones.
- **No self-intersection.** Crests that are too sharp make the surface fold over itself. The shared steepness Q (the uniform `uQ`) is recalculated in `syncWaves()` from the current amplitudes so that `Σ Q k_i A_i ≤ 1`. Because of this, no slider setting can break the surface.
- **Exact normals.** The surface normals come from the exact partial derivatives of the wave formula, not from neighbouring vertices. Tested against finite differences, the maximum error is 1.9 × 10⁻⁶°.
- **Fading at the horizon.** Each wave fades out where the mesh becomes too coarse to draw it (fewer than about 8 vertices per wavelength). Short chop fades first and long swell carries further, so there is no single line where the waves stop.
- **CPU copy.** `water.js` also contains a JavaScript copy of the same wave formula. It is used for mouse picking and for making objects float (sections 4 and 5).




https://github.com/user-attachments/assets/e1e85587-9d76-4d87-a090-ba99a416332c




https://github.com/user-attachments/assets/fcf150ae-89af-4918-be1e-c312843d6cec



https://github.com/user-attachments/assets/08a3d613-0132-4474-aa81-e64c19efb2af





---

## 3. Water shading

**File:** `src/shaders/water.frag.js`

**What it does.** The water reflects the sky, is see-through when you look straight down, shows a bright sun glint under the setting sun, and turns turquoise over shallow sandbanks.

**How it was implemented.** All lighting is calculated in linear colour space in the fragment shader:

- **Fresnel effect (Schlick's approximation).** About 2% of light reflects when you look straight down at water, and almost 100% at grazing angles. This is why distant water looks like a mirror and nearby water looks clear.
- **Sky reflection.** The reflected view ray is looked up in the skybox. Distant water uses a blurrier version of the sky to imitate small waves that are too small for the mesh.
- **Water colour and depth.** The view ray is bent with Snell's law (refractive index 1.333) and followed down to a seabed. The seabed is a flat floor with two sandbanks. Light is absorbed along the way (Beer–Lambert law), with red absorbed fastest. Shallow water over sand therefore looks turquoise, and deep water looks dark blue-green.
- **Sun glint.** A Blinn–Phong highlight is weighted by Fresnel. The sun direction was measured from the sun in the skybox image, so the glint sits exactly under the visible sun.
- **Final colour:** `vec3 col = mix(body, reflection, F) + glint;`. Far away, the colour blends into the sky's horizon colour so the water meets the sky without a seam.

**[Video: include video for the water shading. Orbit the camera from a low angle (mirror-like water and sun glint) to looking straight down (see-through water and the turquoise sandbank), then toggle the normal view (`N`).]**

---

## 4. Interactive ripples

**Files:** `src/ripples.js`, `src/shaders/ripple.frag.js`, `src/main.js`

**What it does.** Clicking the water drops a stone and sends out rings of ripples. Shift + drag stirs the water and leaves a wake. `R` turns on rain and `C` calms the water. A ring under the cursor shows where a drop will land.

**How it was implemented.**

- **The wave equation on the GPU.** Ripples are a simulation of the 2D wave equation, `u_tt = c² ∇²u`. The state is stored in two 768 × 768 float textures that cover a 160-unit disc in the centre of the lake. Each step reads one texture and writes the other ("ping-pong"). Each texel stores the height now and one step ago:

  ```
  ∇²u    ≈ u_E + u_W + u_N + u_S − 4u            (5-point Laplacian, Δx = 1 texel)
  u_next = (2u − u_prev + C² ∇²u) · (1 − ε)      C = cΔt/Δx,  ε = damping
  ```

- **Stable and frame-rate independent.** The simulation runs at a fixed 120 steps per second with a time accumulator. The Courant number C is kept below the 2D stability limit (1/√2), so the simulation never blows up.
- **Edge.** A soft "sponge" ring at the edge of the disc adds extra damping, so ripples fade out instead of bouncing off a square wall.
- **Drops.** A drop is a Gaussian dip added to the height field. Stirring adds a line of small drops and fills in gaps when the mouse moves fast. Rain adds about 12 random drops per second.
- **Connecting to the waves.** The vertex shader adds the ripple height to the Gerstner waves. The fragment shader adds the ripple slope to the wave tangents for every pixel. This makes ripples look sharper than the mesh alone could show.
- **Accurate clicking.** A click casts a ray from the camera and steps along it against the moving wave surface on the CPU, then narrows down the crossing point. The drop lands exactly under the cursor (measured error 0.000 px). The measured ripple speed is 7.9–8.3 units/s, against a target of 8.

**[Video: include video for the interactive ripples. Click a few times to drop stones, Shift + drag to stir, then press `R` for rain and `C` to calm the water.]**

---

## 5. Floating objects

**File:** `src/floaters.js`

**What it does.** Three kayaks with paddlers paddle in loops. Five red mooring buoys with blinking lamps and two drifting logs also float on the water. They bob and tilt with the waves, and kayaks leave ripples behind them. Dropping a stone next to a buoy makes it rock.

**How it was implemented.**

- **Procedural models.** All objects are built in code from basic shapes. The kayak hull is a sphere reshaped to get pointed ends, a flat deck and a slight upward curve.
- **Flotation.** Each object checks the water height at four points: front, back, left and right. The average gives the target height, and the differences give the target forward and sideways tilt. A damped spring moves the object towards these targets, so it lags and bobs like something with mass instead of snapping to the surface. Each object type has its own spring: buoys are bouncy, logs are slow.
- **Riding the waves.** Each object is also moved sideways with the circular motion of the Gerstner wave under it, just like a real floating object.
- **Ripples work both ways.** Kayak paddle strokes and bow waves add drops to the ripple simulation. Each object also reads the ripple height under it back from the GPU with a 1-pixel asynchronous read, so it doesn't stall the GPU. That height is added to the object's target height. In testing, a drop 1 unit from a buoy moved it 0.82 units.

**[Video: include video for the floating objects. Follow a kayak as it paddles and leaves a wake, then click right next to a buoy to show it rocking on the ripples.]**

---

## 6. Object reflections and shadows on the water

**Files:** `src/reflection.js`, `src/shaders/water.frag.js`

**What it does.** The kayaks, buoys and logs appear upside down in the water, and the reflection wobbles with the waves. They also cast shadows on the water. With the sun low in the sky, the kayaks cut long dark streaks through the sun glint.

**How it was implemented.**

- **Planar reflection.** Before the main render, a second camera is mirrored below the water plane (y = 0). It renders only the floating objects, at half resolution, into a texture with a transparent background. The water shader projects each pixel through this mirror camera to find its reflection and shifts it slightly by the wave normal to make it wobble. The result is blended over the sky reflection, so Fresnel affects it the same way it affects the sky.
- **Keeping reflections attached.** The water is not flat, so an object on a wave crest would have its reflection in the wrong place. For the mirror pass, each object is moved down by the water height under it. A clipping plane removes the parts under the water.
- **Analytic shadows.** Each object is described as a flat ellipse at its height. For each water pixel, the shader follows a ray towards the sun and checks whether it passes through any ellipse. Shadowed water loses the sun glint and some brightness, but keeps its reflection, because a shadow can't darken a mirror image.
- Both effects can be switched off in the Objects panel to compare with and without.

**[Video: include video for the reflections and shadows. Show a kayak crossing the sun glint, then turn "Reflections in water" and "Shadows on water" off and on in the Objects panel.]**

---

## 7. Control panel

**File:** `src/gui.js`

**What it does.** A Controls panel (lil-gui) at the top right lets you change the scene while it runs:

| Folder | Controls |
|---|---|
| Waves | Amplitude, Steepness, Speed |
| Ripples | Damping, Half-life, Ripple speed, Drop strength, Rain [R], Calm the water [C] |
| Objects | Show objects, Kayaks paddle, Reflections in water, Shadows on water, Reflection wobble |
| Wormholes (right-click) | Size, Depth, Lifetime (s), Pull inward, Swirl speed, Core glow, Close all [X] |
| Shading | Sun glint, Glint sharpness, Water clarity, Deep water, Seabed |
| View | Wireframe [W], Show normals [N], Reset camera |

**How it was implemented.** The sliders write directly into the parameter objects and shader uniforms, so every change is visible on the next frame. Ripple damping is shown on a logarithmic 0–1 slider with the half-life underneath ("ripples halve every 2.3 s"), which is easier to understand than the raw damping value. Colours are converted through sRGB hex values so the colour picker doesn't look too dark. The keyboard shortcuts update the panel so the checkboxes stay in sync.

**[Video: include video for the control panel. Open a few folders and change some sliders, for example Water clarity, Deep water and Sun glint.]**

---

## 8. Wormholes (whirlpools)

**Files:** `src/wormholes.js`, `src/shaders/water.vert.js`, `src/shaders/water.frag.js`, `src/floaters.js`

**What it does.** Right-clicking the water opens a swirling whirlpool under the cursor. It opens over 1.5 seconds, spins with three spiral arms and a glowing core, and closes after a set time. Nearby kayaks and logs are pulled in, spiral towards the centre, and are swallowed: they spin, shrink and sink. When all wormholes have closed, the objects reappear and the kayaks paddle back to their loops. Buoys are held back by their mooring lines. Up to four wormholes can be open at once, and `X` closes them all.

**How it was implemented.**

- **Lifecycle.** `wormholes.js` tracks each wormhole's age and a strength value that rises from 0 to 1 as it opens and falls back to 0 as it closes.
- **Shape.** In the vertex shader, each wormhole adds a height field on top of the waves: a funnel, plus three spiral arms that rotate over time. Its exact gradient is added to the surface tangents, the same way as for the waves, so the lighting is correct. The formula was designed so the gradient stays finite at the very centre. Tested against finite differences, the maximum error is 2.5 × 10⁻⁸.
- **Look.** Inside the funnel the sky reflection fades and the water darkens with depth. Foam follows the spiral-arm crests, and a coloured glow marks the centre.
- **Flow and physics.** The water around a wormhole follows a smoothed Rankine vortex: it swirls fastest at the funnel's radius and slower further out, with a pull inwards. Floating objects are carried by this flow and turned by its rotation. Opening a wormhole also sends a ripple ring through the ripple simulation. The CPU copy of the funnel height is used for flotation and clicking, so objects tilt into the funnel and clicks land on its walls.

**[Video: include video for the wormhole effect. Right-click near a kayak to open a wormhole, show the kayak being pulled in and swallowed, then show it reappearing after the wormhole closes.]**

---

## 9. Controls summary

| Input | Action |
|---|---|
| Click | Drop a stone |
| Shift + drag | Stir the water |
| Right-click | Open a wormhole |
| Drag / scroll | Orbit / zoom the camera |
| `R` | Toggle rain |
| `C` | Calm the water |
| `X` | Close all wormholes |
| `W` / `N` | Wireframe / normal debug views |

## 10. Known limitations

- The sponge ring at the edge of the ripple disc is not a true absorbing boundary. At the lowest damping setting, some ripple energy comes back into the disc 20–28 seconds after a drop. Fixing this properly needs an absorbing boundary condition such as Mur's.
- Object reflections use a single flat mirror, so they are only exact near each object's waterline.
- The water is opaque to objects, so the parts of objects under the water are hidden instead of being seen through it.

## 11. References

- J. Tessendorf, *Simulating Ocean Water*, 2001.
- M. Finch, "Effective Water Simulation from Physical Models," *GPU Gems*, ch. 1, 2004.
- Skybox "Bridge2" by Emil Persson (Humus), http://www.humus.name
- [Three.js](https://threejs.org) and [lil-gui](https://lil-gui.georgealways.com), MIT licence.
