// Water surface vertex shader.
// Stage 2: a single traveling sine wave displacing y.
//
//   θ(x,z,t) = k (D · (x,z)) − ω t
//   y        = A sin θ
//   k = 2π / λ          (wavenumber)
//   ω = sqrt(g k)        (deep-water dispersion: long waves travel faster)
//
// Its normal is analytic: the surface is y = f(x,z), so
//   N = normalize(−∂f/∂x, 1, −∂f/∂z),   ∂f/∂x = A k Dx cos θ,  ∂f/∂z = A k Dz cos θ.
// (This is the Q = 0, single-wave special case of the Gerstner normal in stage 3.)

export default /* glsl */ `
uniform float uTime;
uniform float uAmplitude;   // A, world units
uniform float uWavelength;  // λ, world units
uniform vec2  uDirection;   // D, unit vector in XZ
uniform float uGravity;     // g

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vec3 p = position;

  float k = 6.28318530718 / uWavelength;
  float omega = sqrt(uGravity * k);
  vec2  D = normalize(uDirection);
  float theta = k * dot(D, p.xz) - omega * uTime;

  p.y += uAmplitude * sin(theta);

  float slope = uAmplitude * k * cos(theta);
  vec3 n = normalize(vec3(-D.x * slope, 1.0, -D.y * slope));

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vUv = uv;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
