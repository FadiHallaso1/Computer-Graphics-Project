import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { rippleVertex, rippleFragment } from './shaders/ripple.frag.js';

const MAX_DROPS = 8;

/**
 * Interactive ripples: the 2D wave equation solved on the GPU with two
 * ping-pong render targets covering the water's dense core.
 *
 * The simulation runs at a fixed rate (stepRate Hz) using a time
 * accumulator, so ripple speed and decay don't depend on frame rate.
 *
 * resolution  texels per edge
 * size        world-space edge length the texture covers (the water core)
 */
export function createRipples(renderer, {
  resolution = 512,
  size = 100,
  stepRate = 120,
} = {}) {
  // Prefer full float; fall back to half float where float targets or
  // float linear filtering are unavailable (common on mobile).
  const fullFloat = renderer.extensions.has('EXT_color_buffer_float')
                 && renderer.extensions.has('OES_texture_float_linear');
  const targetOptions = {
    type: fullFloat ? THREE.FloatType : THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  };
  let read  = new THREE.WebGLRenderTarget(resolution, resolution, targetOptions);
  let write = new THREE.WebGLRenderTarget(resolution, resolution, targetOptions);

  const texelWorld = size / resolution;
  const dt = 1 / stepRate;

  // User-facing parameters (stage 6 GUI binds to these)
  const params = {
    waveSpeed: 8.0,      // c, world units / s
    damping:   0.0025,   // ε per step  (half-life ≈ ln2 / (ε · stepRate) ≈ 2.3 s)
    dropStrength: 0.5,   // depth of a click impulse, world units
    dropRadius:   0.7,   // world units
  };

  const uniforms = {
    uState:     { value: read.texture },
    uTexel:     { value: new THREE.Vector2(1 / resolution, 1 / resolution) },
    uC2:        { value: 0 },
    uDamping:   { value: params.damping },
    uSponge:    { value: 0.04 },
    uDrops:     { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()) },
    uDropCount: { value: 0 },
  };

  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    vertexShader: rippleVertex,
    fragmentShader: rippleFragment,
    uniforms,
    depthTest: false,
    depthWrite: false,
  }));

  // Start from rest: clear both targets to zero
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  for (const rt of [read, write]) { renderer.setRenderTarget(rt); renderer.clear(); }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);

  const pending = [];   // drops waiting for the next step
  let accumulator = 0;

  function step() {
    // Courant number from the target speed; clamp below the 2D CFL limit.
    const C = Math.min((params.waveSpeed * dt) / texelWorld, 0.7);
    uniforms.uC2.value = C * C;
    uniforms.uDamping.value = params.damping;

    const n = Math.min(pending.length, MAX_DROPS);
    for (let i = 0; i < n; i++) uniforms.uDrops.value[i].copy(pending[i]);
    uniforms.uDropCount.value = n;
    pending.splice(0, n);

    uniforms.uState.value = read.texture;
    renderer.setRenderTarget(write);
    quad.render(renderer);
    [read, write] = [write, read];
  }

  return {
    params,
    resolution,
    size,
    /** Texture holding the latest state (R = height). */
    get texture() { return read.texture; },
    /** Render target holding the latest state (for readback / debugging). */
    get target() { return read; },
    stepRate,

    /**
     * Queue a drop at water-core uv (0..1). Negative strength pushes the
     * surface down like a falling stone.
     */
    addDrop(u, v, strength = -params.dropStrength, radius = params.dropRadius) {
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      if (pending.length >= 64) pending.shift();
      pending.push(new THREE.Vector4(u, v, radius / size, strength));
    },

    /** Advance by dt real seconds in fixed steps (at most 8 per frame). */
    update(frameDt) {
      accumulator = Math.min(accumulator + frameDt, 8 * dt);
      const prev = renderer.getRenderTarget();
      while (accumulator >= dt) {
        step();
        accumulator -= dt;
      }
      renderer.setRenderTarget(prev);
    },

    dispose() {
      read.dispose(); write.dispose(); quad.dispose();
    },
  };
}
