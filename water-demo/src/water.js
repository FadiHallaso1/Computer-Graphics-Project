import * as THREE from 'three';
import vertexShader from './shaders/water.vert.js';
import fragmentShader from './shaders/water.frag.js';

const DEG = Math.PI / 180;

/**
 * Base wave set: long swell plus shorter cross-chop. Directions are spread so
 * crests don't line up into an obviously periodic pattern, and wavelengths
 * aren't integer multiples of each other for the same reason.
 * Amplitudes fall off with wavelength roughly like a real sea state.
 */
export const BASE_WAVES = [
  { angle:   0 * DEG, wavelength: 22.0, amplitude: 0.55, phase: 0.0 },
  { angle:  35 * DEG, wavelength: 13.0, amplitude: 0.35, phase: 1.7 },
  { angle: -50 * DEG, wavelength:  8.0, amplitude: 0.18, phase: 4.1 },
  { angle: 110 * DEG, wavelength:  4.5, amplitude: 0.08, phase: 2.6 },
];

/**
 * Analytic seabed: flat floor at FLOOR_BASE plus Gaussian shoals
 * (cx, cz, sigma, height). The first shoal peaks just below the surface so
 * the deep -> shallow color transition is easy to see.
 */
const FLOOR_BASE = -14;
const MOUNDS = [
  [ 14,  6, 9.0, 13.4],   // peaks at y = -0.6
  [-18, -14, 6.0, 10.0],  // peaks at y = -4.0
];

/**
 * One mesh, two grid densities, laid in XZ:
 *  - a dense core (coreSize, coreSegments): this is where waves, ripples
 *    and shading detail live;
 *  - a skirt of outerSegments rings per side reaching farSize, whose
 *    coordinate grows as a·t + b·t⁴. a is chosen so the first skirt cell
 *    matches the core cell, so spacing grows smoothly with no seam.
 * The skirt exists so the water reaches the skybox horizon; waves fade out
 * across it as the cells become too coarse for each wavelength.
 */
function createGradedPlane(coreSize, coreSegments, farSize, outerSegments) {
  const n = coreSegments + 2 * outerSegments;
  const geometry = new THREE.PlaneGeometry(1, 1, n, n);
  geometry.rotateX(-Math.PI / 2);          // XY facing +Z -> XZ facing +Y

  const coreHalf = coreSize / 2;
  const cell = coreSize / coreSegments;
  const a = cell * outerSegments;
  const b = farSize / 2 - coreHalf - a;

  // grid index k (0..n) -> world coordinate
  const coord = (k) => {
    const j = k - outerSegments;                    // index from core edge
    if (j >= 0 && j <= coreSegments) return -coreHalf + j * cell;
    const t = (j < 0 ? -j : j - coreSegments) / outerSegments;
    const d = coreHalf + a * t + b * t ** 4;
    return j < 0 ? -d : d;
  };
  // local cell size around index k (average of the two neighbouring cells)
  const spacing = (k) => {
    const lo = Math.max(k - 1, 0), hi = Math.min(k + 1, n);
    return (coord(hi) - coord(lo)) / (hi - lo);
  };
  const index = (s) => Math.round((s + 0.5) * n);  // unit-plane coord -> k

  const pos = geometry.attributes.position;
  const cellAttr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const kx = index(pos.getX(i));
    const kz = index(pos.getZ(i));
    pos.setX(i, coord(kx));
    pos.setZ(i, coord(kz));
    cellAttr[i] = Math.max(spacing(kx), spacing(kz));
  }
  // Per-vertex grid spacing: the vertex shader fades each wave out where
  // the mesh is too coarse to represent it (see water.vert.js).
  geometry.setAttribute('aCell', new THREE.BufferAttribute(cellAttr, 1));
  return geometry;
}

/**
 * The water surface: graded plane displaced by summed Gerstner waves in the
 * vertex shader and shaded with Fresnel / reflection / glint / depth color.
 *
 * Ripple texture space (stage 5): vUv = 0..1 across the dense core.
 */
export function createWater({
  coreSize = 100,
  coreSegments = 256,
  farSize = 4000,
  outerSegments = 96,
  sunDir = new THREE.Vector3(0.154, 0.161, 0.975),
} = {}) {
  const geometry = createGradedPlane(coreSize, coreSegments, farSize, outerSegments);

  // User-facing parameters (the GUI in stage 6 binds to these).
  const params = {
    amplitude: 1.0,   // multiplies every wave's amplitude
    steepness: 0.6,   // 0 = sine waves, 1 = sharpest crests without folding
    speed:     1.0,   // time scale; keeps ω = sqrt(g k) dispersion intact
  };

  const uniforms = {
    // Geometry
    uTime:         { value: 0 },
    uWaves:        { value: BASE_WAVES.map(() => new THREE.Vector4()) },
    uQ:            { value: 0 },
    uGravity:      { value: 9.81 },
    uCoreHalf:     { value: coreSize / 2 },

    // Shading
    uEnvMap:       { value: null },
    uF0:           { value: 0.02 },
    uSunDir:       { value: sunDir.clone().normalize() },
    uSunColor:     { value: new THREE.Color(1.0, 0.92, 0.78) },
    uSunIntensity: { value: 60.0 },
    uShininess:    { value: 900.0 },
    uDeepColor:    { value: new THREE.Color(0x0a2c3a) },
    uSandColor:    { value: new THREE.Color(0xc9b48a) },
    uAbsorption:   { value: new THREE.Vector3(0.45, 0.12, 0.08) },
    uFloorBase:    { value: FLOOR_BASE },
    uMounds:       { value: MOUNDS.map((m) => new THREE.Vector4(...m)) },

    uShowNormals:  { value: false },
  };

  /**
   * Push wave parameters into uniforms and pick the shared steepness Q.
   * The loop-free limit is Σ Q k_i A_i ≤ 1, so Q_max = 1 / Σ k_i A_i and
   * Q = steepness · Q_max. Because Q is derived from the *current* amplitudes,
   * raising the amplitude slider can never make the surface self-intersect.
   */
  function syncWaves() {
    let sumKA = 0;
    BASE_WAVES.forEach((w, i) => {
      const A = w.amplitude * params.amplitude;
      const k = (2 * Math.PI) / w.wavelength;
      sumKA += k * A;
      uniforms.uWaves.value[i].set(w.angle, w.wavelength, A, w.phase);
    });
    uniforms.uQ.value = sumKA > 0 ? params.steepness / sumKA : 0;
  }
  syncWaves();

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Vertices are displaced in the shader, so CPU-side bounds are wrong;
  // never cull the surface.
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms,
    params,
    coreSize,
    coreSegments,
    vertexCount: geometry.attributes.position.count,
    triangleCount: geometry.index.count / 3,
    syncWaves,
    setEnvMap(tex) { uniforms.uEnvMap.value = tex; },
    setWireframe(on) { material.wireframe = on; },
    setShowNormals(on) { uniforms.uShowNormals.value = on; },
    /** Advance by dt real seconds. Time is accumulated, so changing speed
     *  never makes the surface jump. */
    update(dt) {
      uniforms.uTime.value += dt * params.speed;
    },
  };
}
