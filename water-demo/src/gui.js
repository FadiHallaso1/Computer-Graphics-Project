import GUI from 'lil-gui';

/**
 * Control panel. Sliders write straight into the water / ripple params and
 * shader uniforms, so every change is visible on the next frame.
 *
 * Ripple damping is shown as a 0–1 slider on a log scale, with the
 * resulting half-life displayed underneath: ε itself (~0.0025 per step) is
 * meaningless to a user, "ripples halve every 2.3 s" is not.
 */
const EPS_MIN = 0.0002;   // damping 0  -> half-life ~29 s
const EPS_MAX = 0.02;     // damping 1  -> half-life ~0.3 s
const toSlider = (eps) => Math.log(eps / EPS_MIN) / Math.log(EPS_MAX / EPS_MIN);
const toEps = (s) => EPS_MIN * (EPS_MAX / EPS_MIN) ** s;

export function createGui({ water, ripples, view, actions, floaters, wormholes }) {
  const gui = new GUI({ title: 'Controls', width: 290 });

  // --- Waves (Gerstner) -----------------------------------------------------
  const waves = gui.addFolder('Waves');
  waves.add(water.params, 'amplitude', 0, 2, 0.01).name('Amplitude')
    .onChange(water.syncWaves);
  waves.add(water.params, 'steepness', 0, 0.95, 0.01).name('Steepness')
    .onChange(water.syncWaves);
  waves.add(water.params, 'speed', 0, 3, 0.01).name('Speed');

  // --- Ripples (wave equation) ----------------------------------------------
  const rip = gui.addFolder('Ripples');
  const halfLife = () =>
    `${(Math.LN2 / (ripples.params.damping * ripples.stepRate)).toFixed(1)} s`;
  const rippleUi = {
    damping: toSlider(ripples.params.damping),
    get halfLife() { return halfLife(); },
  };
  const dampingCtrl = rip.add(rippleUi, 'damping', 0, 1, 0.01).name('Damping');
  const halfLifeCtrl = rip.add(rippleUi, 'halfLife').name('Half-life').disable();
  dampingCtrl.onChange((s) => {
    ripples.params.damping = toEps(s);
    halfLifeCtrl.updateDisplay();
  });
  rip.add(ripples.params, 'waveSpeed', 2, Math.floor(ripples.maxWaveSpeed), 0.1)
    .name('Ripple speed');
  rip.add(ripples.params, 'dropStrength', 0.05, 1, 0.01).name('Drop strength');
  rip.add(view, 'rain').name('Rain  [R]');
  rip.add(actions, 'calm').name('Calm the water  [C]');

  // --- Floating objects -------------------------------------------------------
  // The two shading toggles exist for A/B comparison: each switches off one
  // water term the objects contribute, leaving everything else identical.
  const objects = gui.addFolder('Objects');
  objects.add(floaters.settings, 'visible').name('Show objects');
  objects.add(floaters.settings, 'paddling').name('Kayaks paddle');
  objects.add(view, 'objectReflections').name('Reflections in water');
  objects.add(view, 'objectShadows').name('Shadows on water');
  objects.add(water.uniforms.uReflDistort, 'value', 0, 0.1, 0.001).name('Reflection wobble');

  // --- Wormholes (right-click) -----------------------------------------------
  // Size, depth and lifetime apply to wormholes opened after the change;
  // pull, swirl and glow apply immediately.
  const holes = gui.addFolder('Wormholes  (right-click)').close();
  holes.add(wormholes.params, 'radius', 3, 12, 0.1).name('Size');
  holes.add(wormholes.params, 'depth', 1, 8, 0.1).name('Depth');
  holes.add(wormholes.params, 'lifetime', 5, 30, 0.5).name('Lifetime (s)');
  holes.add(wormholes.params, 'pull', 0, 1.5, 0.01).name('Pull inward');
  holes.add(wormholes.params, 'swirl', 0, 10, 0.1).name('Swirl speed');
  holes.add(water.uniforms.uGlow, 'value', 0, 6, 0.1).name('Core glow');
  holes.add({ close: () => wormholes.closeAll() }, 'close').name('Close all  [X]');

  // --- Shading --------------------------------------------------------------
  const shading = gui.addFolder('Shading').close();
  const u = water.uniforms;
  // Colors go through sRGB hex strings: THREE.Color stores linear values,
  // which a color picker would display too dark.
  const shadingUi = {
    clarity: 1,
    deep: `#${u.uDeepColor.value.getHexString()}`,
    sand: `#${u.uSandColor.value.getHexString()}`,
  };
  const baseAbsorption = u.uAbsorption.value.clone();
  shading.add(u.uSunIntensity, 'value', 0, 150, 1).name('Sun glint');
  shading.add(u.uShininess, 'value', 50, 3000, 10).name('Glint sharpness');
  shading.add(shadingUi, 'clarity', 0.25, 3, 0.01).name('Water clarity')
    .onChange((c) => u.uAbsorption.value.copy(baseAbsorption).divideScalar(c));
  shading.addColor(shadingUi, 'deep').name('Deep water')
    .onChange((hex) => u.uDeepColor.value.set(hex));
  shading.addColor(shadingUi, 'sand').name('Seabed')
    .onChange((hex) => u.uSandColor.value.set(hex));

  // --- View / debug ----------------------------------------------------------
  const debug = gui.addFolder('View').close();
  debug.add(view, 'wireframe').name('Wireframe  [W]')
    .onChange((on) => water.setWireframe(on));
  debug.add(view, 'normals').name('Show normals  [N]')
    .onChange((on) => water.setShowNormals(on));
  debug.add(actions, 'resetView').name('Reset camera');

  // Narrow screens: start collapsed so the water is visible first
  if (window.innerWidth < 700) gui.close();

  return {
    gui,
    /** Re-read every control from its object (after keyboard shortcuts). */
    refresh() { gui.controllersRecursive().forEach((c) => c.updateDisplay()); },
  };
}
