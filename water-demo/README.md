# Ripple Water

Real-time procedural water surface with interactive ripple physics, in WebGL (Three.js).
Gerstner wave geometry, physically-motivated water shading, and a GPU wave-equation solver you can disturb with the mouse.

## How to open the project

The project runs in a web browser, but it **cannot be opened by double-clicking `index.html`**. Browsers block JavaScript modules and WebGL textures on pages opened directly from disk (`file://`), so you would see a blank page. It has to be opened through a small local web server. This runs entirely on your own computer; nothing is uploaded anywhere. The easiest option is below; the others are equivalent.

**Requirements**

- A recent desktop browser: Chrome, Edge, Firefox, or Safari 15 or later (WebGL 2 is required).
- An internet connection when the page first loads (Three.js and lil-gui are loaded from the jsDelivr CDN).
- Any graphics card from the last several years, including integrated laptop graphics.

### Option 1 (recommended): VS Code with the Live Server extension

1. Install [Visual Studio Code](https://code.visualstudio.com/) if it isn't already installed.
2. Unzip the project. In VS Code choose **File → Open Folder…** and select the `water-demo` folder, the one that directly contains `index.html`, `src/` and `textures/`.
3. Open the Extensions panel (**View → Extensions**, or `Ctrl+Shift+X` / `Cmd+Shift+X` on macOS). Search for **Live Server**, choose the one by **Ritwick Dey**, and click **Install**.
4. In the Explorer panel on the left, right-click `index.html` and choose **Open with Live Server**. (Alternatively, click **Go Live** in the blue status bar at the bottom-right of the window.)
5. Your browser opens the demo at an address like `http://127.0.0.1:5500/index.html`.

To stop the server, click **Port: 5500** in the status bar.

### Option 2: Python, if it is already installed

Open a terminal in the `water-demo` folder and run:

```bash
python3 -m http.server 8000     # Windows: py -m http.server 8000
```

Then open <http://localhost:8000> in the browser. Press `Ctrl+C` in the terminal to stop.

### Option 3: Node.js

If Node.js is installed, run this in the `water-demo` folder and open the address it prints:

```bash
npx serve .
```

### Option 4: online, nothing to install

<!-- TODO: replace with the team's GitHub Pages link before submitting -->
The project is also published at **https://USERNAME.github.io/REPOSITORY/**. Opening that link in a browser runs the same code with no setup.

### What you should see

A lake at sunset under a bridge, with moving waves, a few kayaks paddling in loops, red mooring buoys and drifting logs. A **Controls** panel sits at the top right, and a short hint card at the bottom left.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Blank white or black page | The file was opened directly (the address bar starts with `file://`). Use one of the options above. |
| Page loads, but no sky and the water looks black | The server was started in the wrong folder, so `textures/` isn't found. Start it in the folder that contains `index.html`. |
| "WebGL 2 is not supported" or nothing renders | Use an up-to-date Chrome, Edge or Firefox, and check that hardware acceleration is enabled in the browser settings. |
| Low frame rate | Close other heavy tabs. In Chrome, check that `chrome://gpu` reports hardware acceleration as enabled. |
| Live Server says the port is in use | Close the other Live Server window, or use Option 2. |

For anything else, open the browser's developer console (`F12`, then the **Console** tab) and look for a red error message.

## Controls

| Input | Action |
|---|---|
| Click / tap | Drop a stone where you clicked |
| Shift + drag | Stir: a continuous wake of small drops |
| Right-click | Open a wormhole (whirlpool) at the cursor; right-drag still pans |
| Drag · scroll / pinch | Orbit · zoom |
| `R` | Toggle rain |
| `C` | Calm the water (clear all ripples) |
| `X` | Close all wormholes |
| `W` / `N` | Wireframe / normal-map debug views |

The **Controls** panel has sliders for wave amplitude, steepness and speed; ripple damping (shown with its half-life), ripple speed and drop strength; the shading parameters; and an **Objects** section that can switch the kayaks' reflections and shadows on the water off and on, for side-by-side comparison.

Developers: there is no build step. The import map in `index.html` loads Three.js and lil-gui from jsDelivr. To publish on GitHub Pages, push the folder to a repository and choose *Settings → Pages → Deploy from branch → main / root*.

## Structure

```
index.html                  page shell + import map
style.css                   HUD and panel styling
src/main.js                 renderer, camera, skybox, pointer interaction, rain, loop
src/water.js                graded plane geometry, wave parameters, CPU surface for picking
src/ripples.js              ping-pong wave-equation simulation
src/gui.js                  lil-gui control panel
src/floaters.js             kayaks, buoys, logs: geometry, flotation, wakes, ripple readback
src/reflection.js           planar mirror pass for object reflections
src/wormholes.js            wormhole lifecycle and the flow field that drags objects
src/shaders/water.vert.js   Gerstner displacement, analytic tangents, ripple height
src/shaders/water.frag.js   Fresnel, reflection, Beer–Lambert depth color, sun glint
src/shaders/ripple.frag.js  one wave-equation step
textures/bridge2/           skybox cubemap (see Credits)
```

## 1. Wave geometry: summed Gerstner waves

A subdivided plane (800 × 800 segments over a 400 × 400-unit core, plus a coarser skirt out to the horizon; 863k vertices in total) is displaced in the vertex shader by four Gerstner waves. For wave *i* with direction **D**ᵢ, wavelength λᵢ, amplitude Aᵢ and phase φᵢ:

```
kᵢ = 2π / λᵢ          ωᵢ = √(g kᵢ)   (deep-water dispersion)
θᵢ = kᵢ (Dᵢ · (x, z)) − ωᵢ t + φᵢ

x' = x + Σ Q Aᵢ Dᵢₓ cos θᵢ
y  =     Σ   Aᵢ     sin θᵢ
z' = z + Σ Q Aᵢ D_iz cos θᵢ
```

Wave speed is never a free parameter: ω follows from wavelength, so long swells outrun short chop as on real water. The speed slider scales time, which preserves this.

**Steepness without folding.** The surface self-intersects when Σ Q kᵢ Aᵢ > 1. All waves share one Q = *steepness* / Σ kᵢ Aᵢ, recomputed whenever amplitudes change. A steepness of 1 is exactly the fold limit, and no amplitude setting can make the surface loop.

**Analytic normals.** These are exact partial derivatives with respect to the undisplaced (x, z), not finite differences:

```
∂P/∂x = ( 1 − Σ Q A k Dₓ² sin θ,   Σ A k Dₓ cos θ,   −Σ Q A k Dₓ D_z sin θ )
∂P/∂z = ( −Σ Q A k Dₓ D_z sin θ,   Σ A k D_z cos θ,   1 − Σ Q A k D_z² sin θ )
N = normalize( ∂P/∂z × ∂P/∂x )
```

*Verification:* against central finite differences of the same displacement at 20,000 random (x, z, t) samples with steepness 0.999 (the worst case), the maximum angular error is 1.9 × 10⁻⁶°.

**Horizon skirt and a round edge.** Outside the dense core the grid spacing grows smoothly (a·t + b·t⁴, matched to the core cell size at the seam). Each wave fades out where the grid becomes too coarse for it, between 8 and 4 vertices per wavelength (a geometric Nyquist limit). The fade uses the grid spacing as a function of *radial* distance: every point at radius r has |x|, |z| ≤ r, so its cells are never coarser than the on-axis cell at r. The fade is therefore always safe, and its contours are circles instead of the grid's squares. Every wave is at full strength out to r ≈ 200 (the core's 0.5-unit cells give even the shortest wave ≥ 8 vertices per wavelength); beyond that, short chop is gone by r ≈ 207 and the long swell by r ≈ 240. There is no square patch and no single line where the waves stop. Inside the core the fade is exactly 1, so the normals there are exact.

## 2. Water shading

All shading happens in linear color space:

- **Fresnel (Schlick):** F(θ) = F₀ + (1 − F₀)(1 − cos θ)⁵, with F₀ = ((1 − 1.333)/(1 + 1.333))² ≈ 0.02 for water. About 2% of light reflects looking straight down and nearly all of it at grazing angles.
- **Reflection:** R = reflect(−V, N) samples the skybox cubemap. The mip level rises with distance to stand in for wave roughness too small for the mesh, so distant water is a softened reflection rather than a perfect mirror.
- **Depth color:** the view ray is refracted with Snell's law (n = 1.333) down to an analytic seabed (a flat floor plus two Gaussian shoals). The seabed color is attenuated per channel with Beer–Lambert, T = exp(−σ · path). Red is absorbed fastest, so shallow water reads turquoise over sand and deep water converges to the deep-water color.
- **Sun glint:** a Blinn–Phong lobe pow(N·H, shininess) weighted by Fresnel at the half vector. The sun direction was measured from the sun disc in the skybox, so the glint path sits directly under the visible sun.

```
color = mix(body, reflection, F) + glint
```

## 3. Interactive ripples: the 2D wave equation

u_tt = c² ∇²u is solved on two 768² ping-pong float render targets covering a 160-unit area in the centre of the wave field (about 0.21 units per texel; stretching it over the full 400 units would make ripples blocky or cost ~6× the GPU time), using explicit leapfrog finite differences. Each texel stores (u, u_prev):

```
∇²u    ≈ u_E + u_W + u_N + u_S − 4u
u_next = (2u − u_prev + C² ∇²u) · (1 − ε)      C = cΔt/Δx
```

- **Stability.** The CFL condition in 2D is C ≤ 1/√2. The sim runs at a fixed 120 Hz with a time accumulator, so speed and decay don't depend on frame rate. C is derived from the target wave speed (8 units/s gives C ≈ 0.32) and clamped to 0.7.
- **Border.** A circular sponge ring ramps damping up quadratically over the outer 4% radius of the texture, matching the round edge of the wave field. Drops are only accepted inside it, and the hover marker hides where a click wouldn't take.
- **Coupling.** Ripple height is added to y in the vertex shader. Ripple slope, taken by central differences on the sim grid, is added to the Gerstner tangents *per fragment* before the cross product, so ripples render sharper than the mesh resolution alone allows.
- **Picking.** Clicks ray-march the actual displaced Gerstner surface on the CPU (the same math as the shader), then bisect the crossing. The horizontal displacement is inverted with a fixed-point iteration, which converges because Σ Q k A = steepness < 1. The drop lands exactly under the cursor even at grazing angles.

*Verification:* the measured ring speed is 7.9–8.3 units/s against a target of 8 (leading edge and peak, between t = 1 s and 1.5 s). Projecting the picked point back to the screen gives 0.000 px error.

*Known limitation: the border is not a true absorbing boundary.* At the default damping (half-life 2.3 s), a ring has lost about 94% of its amplitude before it reaches the edge, so the border has no measurable effect. With fully reflective walls instead, energy in the disc at 12 s was the same order (2.4 vs 3.2, arbitrary units). At the lowest damping setting (half-life about 29 s), measurable energy does return into the disc 20–28 s after a drop. A sweep of sponge widths (4–12% of the radius) and strengths (0.002–0.1 per step) did not remove it: a steep damping ramp reflects off its own gradient, and a gentle one lets waves through to the texture walls. Fixing this properly needs an absorbing boundary condition (e.g. Mur / Engquist–Majda) rather than a damping sponge.

## 4. Floating objects

Three kayaks with paddlers, five mooring buoys and two drifting logs, all procedural geometry (the kayak hull is a sphere reshaped with sharper ends, a flatter deck and rocker). They are lit by the same sky as the water (image-based lighting from the cubemap) and by a sun light from the same direction as the glint.

- **Flotation.** Each object samples the CPU copy of the Gerstner surface at bow, stern, port and starboard. The mean gives the target height and the differences give pitch and roll. A damped spring (period 0.7–1.2 s by object type) chases those targets, so objects bob and lag instead of snapping to the surface. Horizontally each object sits on the Gerstner image P(base) of its anchor point, so it rides the waves' orbital motion as a real floating body does.
- **Reflections in the water.** A planar mirror pass renders only the objects, seen from the camera mirrored through y = 0, into a half-resolution target. The water shader projects each fragment through that mirror camera, offsets the lookup by the wave normal so the reflection wobbles, and blends it over the sky reflection by its alpha, so Fresnel weights it exactly like the sky. Because the surface isn't flat, each object is lowered by its own local water height for this pass, which keeps its reflection attached at the waterline even on a crest. A clip plane removes the submerged part.
- **Shadows on the water.** Each object is an ellipse lying flat at its height. A fragment is shadowed if its ray toward the sun passes through one: q = P.xz + L.xz·(h − P.y)/L.y. Shadow removes the sun glint and some sunlit in-scatter of the water body, but not the reflection (a shadow can't darken a mirror image). With the sun about 9° up, kayaks crossing the glint path cut long dark streaks through it.
- **Ripples, both ways.** Paddle strokes and bow waves inject drops into the wave-equation sim. Each object reads the ripple height under it back from the GPU with an asynchronous 1-pixel read (one frame of latency, no stall) and adds it to its target height, so a stone dropped next to a buoy rocks it.

The *Objects* panel can switch reflections and shadows off independently for A/B comparison.

*Verification:* with waves and kayaks frozen, toggling reflections changes only a mirrored kayak, paddler and paddle directly under the boat, and toggling shadows changes only a streak running from the kayak away from the sun. A drop 1 unit from a buoy (waves frozen) put 0.62 units of ripple under it and moved the buoy 0.82 units.

*Limitation:* the mirror pass is planar, so reflections are exact only near each object's waterline and approximate farther from it on a steep wave. Objects are opaque against an opaque water surface, so their submerged parts are hidden rather than seen through the water.

## 5. Wormholes (right-click)

A right-click opens a whirlpool funnel centred exactly under the cursor (the click is picked on the moving surface and the funnel is placed in the undisplaced coordinates the shaders use). Up to four can be open at once. Each opens over 1.5 s, holds, and closes over 2.5 s; size, depth, lifetime, pull, swirl and glow are in the *Wormholes* panel.

**Geometry, with analytic normals.** Each wormhole is a height field added on top of the waves, and its exact gradient is added to the surface tangents, exactly like the Gerstner terms. With d = (x, z) − centre, r = |d|, φ = atan2(d_z, d_x), and S the open/close ramp:

```
funnel   f = −D·S · R² / (r² + R²)                    ∇f = D·S · R² · 2d / (r² + R²)²
arms     g = A·S · w(r) · sin ψ,   ψ = 3φ + 4·ln(r/R + 0.2) − Φ(t)
         w(r) = ρ² e^(1−ρ²),  ρ = r / 1.5R
         ∇g = A·S [ (w′ sin ψ + w cos ψ ∂ψ/∂r) d/r + w cos ψ · 3 · d⊥/r² ]
```

The envelope w grows as r² near the centre, which cancels the 1/r² in the angular term, so the gradient stays finite at the throat.

*Verification:* against central finite differences of the height at 50,000 points, half of them within 1.5 units of a centre, the maximum relative gradient error is 2.5 × 10⁻⁸, and the gradient is finite at the exact centre.

**Shading.** Inside the funnel the sky reflection fades (the walls occlude the sky) and the water body darkens with depth (less light returns from the throat). Foam gathers in thin lines along the spiral-arm crests, and a faint glow marks the centre.

**Physics.** The water around each wormhole flows in a smoothed Rankine-style vortex: tangential speed v_t = S·V·2(r/R)/(1 + (r/R)²), peaking at r = R and falling off as 1/r, plus an inflow of v_r = −pull·v_t. Floating objects are carried by this flow and turned by its angular velocity. Moored buoys are held back by their lines; kayaks and logs spiral in. Anything that reaches the throat is swallowed (it spins, shrinks and sinks), then reappears at home once all wormholes have closed, and kayaks paddle back to their loops. Opening a wormhole also sends a ripple ring through the wave-equation sim, and flotation and click-picking both use the CPU copy of the funnel height, so objects tilt into the funnel and clicks land on its walls.

*Verification:* a kayak starting 7 units from a wormhole was swallowed after 7.1 s, reappeared after the wormhole closed, and ended back on its loop with zero position error. With the waves frozen, the wormhole opened exactly at the picked point.

## Credits

- Skybox: "Bridge2" by Emil Persson (Humus), http://www.humus.name. Its license is in `textures/bridge2/readme.txt` and must ship with it.
- [Three.js](https://threejs.org) (MIT) and [lil-gui](https://lil-gui.georgealways.com) (MIT).
- Gerstner wave formulation following Tessendorf, *Simulating Ocean Water* (2001), and Finch, "Effective Water Simulation from Physical Models," *GPU Gems* ch. 1 (2004). Our normals use the exact tangent cross product rather than the GPU Gems approximation.
