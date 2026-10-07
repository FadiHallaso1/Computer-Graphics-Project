// Water surface vertex shader.
// Stage 1: pass-through. The plane is already laid in the XZ plane (y = 0),
// so later stages displace `position` directly in world-aligned XZ coordinates.

export default /* glsl */ `
uniform float uTime;

varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec3 p = position;

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vUv = uv;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
