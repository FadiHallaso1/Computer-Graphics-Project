// Ripple simulation step: 2D wave equation  u_tt = c² ∇²u
// on a ping-pong texture, explicit leapfrog finite differences.
//
// State texel: R = u (height now), G = u_prev (height one step ago).
//
//   ∇²u    ≈ u_E + u_W + u_N + u_S − 4u            (5-point Laplacian, Δx = 1 texel)
//   u_next = (2u − u_prev + C² ∇²u) · (1 − ε)      C = cΔt/Δx,  ε = damping
//   write (u_next, u)
//
// Stability (CFL): C ≤ 1/√2 in 2D. C is computed on the CPU from the target
// wave speed and the fixed simulation step, and clamped.
//
// Border: clamp-to-edge sampling alone makes the edges reflective walls.
// A sponge layer ramps damping up over the outer uSponge of the texture,
// so ripples leaving the core fade out instead of bouncing back.
//
// Drops: Gaussian impulses added to u_next on the step they're injected.

export const rippleVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);   // full-screen triangle, clip space
}
`;

export const rippleFragment = /* glsl */ `
#define MAX_DROPS 8

uniform sampler2D uState;
uniform vec2  uTexel;          // 1 / resolution
uniform float uC2;             // Courant number squared
uniform float uDamping;        // ε per step
uniform float uSponge;         // sponge width in uv
uniform vec4  uDrops[MAX_DROPS]; // (u, v, radius in uv, strength)
uniform int   uDropCount;

varying vec2 vUv;

void main() {
  vec2 s = texture2D(uState, vUv).rg;
  float u  = s.r;
  float up = s.g;

  float uE = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r;
  float uW = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r;
  float uN = texture2D(uState, vUv + vec2(0.0, uTexel.y)).r;
  float uS = texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;

  float lap  = uE + uW + uN + uS - 4.0 * u;
  float next = 2.0 * u - up + uC2 * lap;

  // Damping, ramping up inside the absorbing border
  vec2  e = min(vUv, 1.0 - vUv);
  float edge = min(e.x, e.y);
  float damp = uDamping + 0.1 * (1.0 - smoothstep(0.0, uSponge, edge));
  next *= 1.0 - damp;

  for (int i = 0; i < MAX_DROPS; i++) {
    if (i >= uDropCount) break;
    vec4 d = uDrops[i];
    vec2 q = (vUv - d.xy) / d.z;
    next += d.w * exp(-dot(q, q));
  }

  gl_FragColor = vec4(next, u, 0.0, 1.0);
}
`;
