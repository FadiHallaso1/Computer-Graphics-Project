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
 * The water surface: a subdivided plane in XZ displaced by summed Gerstner
 * waves in the vertex shader.
 *
 * size      world-space edge length of the square plane
 * segments  subdivisions per edge -> (segments + 1)^2 vertices
 *
 * UVs run 0..1 across the plane; the ripple simulation texture (stage 5)
 * will map 1:1 onto them.
 */
export function createWater({ size = 100, segments = 256, fogColor } = {}) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  // PlaneGeometry is built in XY facing +Z; lay it flat facing +Y.
  geometry.rotateX(-Math.PI / 2);

  // User-facing parameters (the GUI in stage 6 binds to these).
  const params = {
    amplitude: 1.0,   // multiplies every wave's amplitude
    steepness: 0.6,   // 0 = sine waves, 1 = sharpest crests without folding
    speed:     1.0,   // time scale; keeps ω = sqrt(g k) dispersion intact
  };

  const uniforms = {
    uTime:        { value: 0 },
    uWaves:       { value: BASE_WAVES.map(() => new THREE.Vector4()) },
    uQ:           { value: 0 },
    uGravity:     { value: 9.81 },

    uColor:       { value: new THREE.Color(0x1d5a73) },
    uGridColor:   { value: new THREE.Color(0x9fdcec) },
    uGridStep:    { value: (size / segments) * 16 },   // a line every 16 segments
    uFogColor:    { value: new THREE.Color(fogColor ?? 0x0b1a24) },
    uFogDensity:  { value: 0.012 },
    uSunDir:      { value: new THREE.Vector3(-0.4, 0.55, -0.73).normalize() },
    uShowNormals: { value: false },
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
    size,
    segments,
    vertexCount: geometry.attributes.position.count,
    triangleCount: geometry.index.count / 3,
    syncWaves,
    setWireframe(on) { material.wireframe = on; },
    setShowNormals(on) { uniforms.uShowNormals.value = on; },
    /** Advance by dt real seconds. Time is accumulated, so changing speed
     *  never makes the surface jump. */
    update(dt) {
      uniforms.uTime.value += dt * params.speed;
    },
  };
}
