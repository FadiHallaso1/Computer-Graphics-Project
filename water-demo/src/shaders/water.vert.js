// Water surface vertex shader.
// Stage 3: sum of NUM_WAVES Gerstner waves + exact analytic normals.
//
// For wave i (direction D_i, wavelength λ_i, amplitude A_i, phase φ_i):
//   k_i = 2π / λ_i,   ω_i = sqrt(g k_i),   θ_i = k_i (D_i · (x,z)) − ω_i t + φ_i
//
//   x' = x + Σ Q A_i D_ix cos θ_i
//   y  =     Σ   A_i      sin θ_i
//   z' = z + Σ Q A_i D_iz cos θ_i
//
// Q (shared steepness) is chosen on the CPU so that Σ Q k_i A_i ≤ 1,
// which is exactly the condition for the surface not to fold into loops.
//
// Normals come from the exact partial derivatives of P w.r.t. the
// undisplaced (x,z), with c_i = cos θ_i, s_i = sin θ_i:
//
//   ∂P/∂x = ( 1 − Σ Q A k Dx² s,   Σ A k Dx c,   −Σ Q A k Dx Dz s )
//   ∂P/∂z = ( −Σ Q A k Dx Dz s,    Σ A k Dz c,   1 − Σ Q A k Dz² s )
//   N     = normalize( ∂P/∂z × ∂P/∂x )
//
// Flat check: (0,0,1) × (1,0,0) = (0,1,0).

export default /* glsl */ `
#define NUM_WAVES 4

uniform float uTime;           // simulation time (already scaled by speed)
uniform vec4  uWaves[NUM_WAVES]; // (dir angle rad, wavelength, amplitude, phase)
uniform float uQ;              // shared Gerstner steepness
uniform float uGravity;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vec3 base = position;        // undisplaced point on the plane (y = 0)
  vec3 p    = base;

  vec3 dPdx = vec3(1.0, 0.0, 0.0);
  vec3 dPdz = vec3(0.0, 0.0, 1.0);

  for (int i = 0; i < NUM_WAVES; i++) {
    vec4  w = uWaves[i];
    vec2  D = vec2(cos(w.x), sin(w.x));
    float k = 6.28318530718 / w.y;
    float A = w.z;
    float omega = sqrt(uGravity * k);

    float theta = k * dot(D, base.xz) - omega * uTime + w.w;
    float c = cos(theta);
    float s = sin(theta);

    float QA = uQ * A;
    p.x += QA * D.x * c;
    p.z += QA * D.y * c;
    p.y += A * s;

    float QAk = QA * k;
    float Ak  = A * k;
    dPdx += vec3(-QAk * D.x * D.x * s,  Ak * D.x * c, -QAk * D.x * D.y * s);
    dPdz += vec3(-QAk * D.x * D.y * s,  Ak * D.y * c, -QAk * D.y * D.y * s);
  }

  vec3 n = normalize(cross(dPdz, dPdx));

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vUv = uv;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
