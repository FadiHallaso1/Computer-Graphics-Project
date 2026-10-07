import * as THREE from 'three';
import vertexShader from './shaders/water.vert.js';
import fragmentShader from './shaders/water.frag.js';

/**
 * The water surface: a subdivided plane in XZ driven entirely by shaders.
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

  const uniforms = {
    uTime:       { value: 0 },
    uColor:      { value: new THREE.Color(0x1d5a73) },
    uGridColor:  { value: new THREE.Color(0x9fdcec) },
    uGridStep:   { value: (size / segments) * 16 },   // a line every 16 segments
    uFogColor:   { value: new THREE.Color(fogColor ?? 0x0b1a24) },
    uFogDensity: { value: 0.012 },
    uSunDir:     { value: new THREE.Vector3(-0.4, 0.55, -0.73).normalize() },

    // Single sine wave (stage 2)
    uAmplitude:  { value: 0.8 },
    uWavelength: { value: 14.0 },
    uDirection:  { value: new THREE.Vector2(1.0, 0.35).normalize() },
    uGravity:    { value: 9.81 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Vertices are displaced in the shader, so the CPU-side bounds are wrong
  // from stage 2 onwards; never cull the surface.
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms,
    size,
    segments,
    vertexCount: geometry.attributes.position.count,
    triangleCount: geometry.index.count / 3,
    setWireframe(on) { material.wireframe = on; },
    update(time) { uniforms.uTime.value = time; },
  };
}
