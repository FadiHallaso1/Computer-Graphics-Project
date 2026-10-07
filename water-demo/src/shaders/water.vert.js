// Water surface vertex shader.
// Stage 3–4: sum of NUM_WAVES Gerstner waves + exact analytic normals.
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
//
// Horizon skirt: outside the dense core the grid spacing grows, so each
// wave is faded out as the mesh becomes too coarse to sample it, between
// 8 and 4 vertices per wavelength (a geometric Nyquist limit). aCell is
// that spacing as a function of radial distance (see water.js), so the
// fade contours are circles, not the grid's squares. Short chop fades
// just past the core, long swell carries much further, so there is no
// single visible line where the waves stop.
// In the core every wave has ≥ 8 vertices per wavelength, the fade is
// exactly 1 and the normals are exact; in the skirt ∂fade/∂x is ignored.
//
// Ripples (stage 5): the wave-equation height field h(u,v) is added to y
// here. Its slope is added to the tangents per *fragment* (the ripple
// texture is finer than the mesh), so the tangents, not the normal, are
// passed down and the cross product happens in the fragment shader.

// Wormholes / whirlpools (right-click): each is a height field added on
// top of the waves, with its analytic gradient folded into the tangents:
//
//   funnel   f(r)   = −D·S · R²/(r² + R²)                 (1 at the centre → depth D)
//            ∇f     = D·S · R² · 2d / (r² + R²)²
//   arms     g(r,φ) = A·S · w(r) · sin ψ,   ψ = n·φ + β·ln(r/R + 0.2) − Φ(t)
//            w(r)   = ρ² e^(1−ρ²),  ρ = r / 1.5R        (ring envelope, w ~ r² at 0)
//            ∇g     = A·S [ (w′ sin ψ + w cos ψ ∂ψ/∂r) d/r + w cos ψ · n · d⊥/r² ]
//
// d = (x,z) − centre, d⊥ = (−d_z, d_x). Because w ~ r² near the centre,
// w/r² stays finite, so the gradient is well-defined at the throat.
// S ∈ [0,1] is the open/close ramp, Φ the spin phase (both from the CPU).

export default /* glsl */ `
#define NUM_WAVES 4
#define MAX_VORTICES 4
#define VORTEX_ARMS 3.0
#define VORTEX_TWIST 4.0

uniform float uTime;             // simulation time (already scaled by speed)
uniform vec4  uWaves[NUM_WAVES]; // (dir angle rad, wavelength, amplitude, phase)
uniform float uQ;                // shared Gerstner steepness
uniform float uGravity;
uniform float uRippleSize;       // world size covered by the ripple texture (centred)
uniform sampler2D uRipple;       // R = ripple height (world units)

uniform vec4  uVortexA[MAX_VORTICES]; // (centre x, centre z, radius R, strength S)
uniform vec4  uVortexB[MAX_VORTICES]; // (depth D, arm amplitude A, spin phase Φ, spin direction ±1)
uniform int   uVortexCount;

attribute float aCell;           // local grid spacing at this vertex

varying vec3 vWorldPos;
varying vec3 vTangentX;          // ∂P/∂x of the surface (waves + wormholes)
varying vec3 vTangentZ;          // ∂P/∂z of the surface (waves + wormholes)
varying vec2 vUv;                // ripple texture space: 0..1 across the central ripple area
varying float vVortexCore;       // 0..1, 1 at the centre of a fully open wormhole
varying float vVortexDepth;      // how far the funnel has pulled the surface down
varying float vSpiral;           // spiral-arm crest signal (drives foam)

// Sum of all wormholes at xz: returns height, writes gradient and shading signals.
float vortexField(vec2 xz, out vec2 grad, out float core, out float spiral) {
  float h = 0.0;
  grad = vec2(0.0);
  core = 0.0;
  spiral = 0.0;
  for (int i = 0; i < MAX_VORTICES; i++) {
    if (i >= uVortexCount) break;
    vec4 a = uVortexA[i];
    vec4 b = uVortexB[i];
    float R = a.z, S = a.w;
    vec2  d = xz - a.xy;
    float r2 = dot(d, d);
    float r = sqrt(r2);
    float R2 = R * R;

    // Funnel
    float den = r2 + R2;
    float q = R2 / den;
    h    -= b.x * S * q;
    grad += b.x * S * R2 * 2.0 * d / (den * den);
    core  = max(core, S * q);

    // Spiral arms
    float rho = r / (1.5 * R);
    float e   = exp(1.0 - rho * rho);
    float w   = rho * rho * e;
    float dw  = 2.0 * rho * (1.0 - rho * rho) * e / (1.5 * R);
    float wOverR2 = e / (2.25 * R2);                 // w / r², finite at r = 0
    float phi = r2 > 1e-8 ? atan(d.y, d.x) : 0.0;
    float dPsiDr = b.w * VORTEX_TWIST / (r + 0.2 * R);
    float psi = VORTEX_ARMS * phi + b.w * VORTEX_TWIST * log(r / R + 0.2) - b.z;
    float s = sin(psi), c = cos(psi);
    float AS = b.y * S;
    h += AS * w * s;
    vec2 radial = r > 1e-6 ? d / r : vec2(0.0);
    grad += AS * ((dw * s + w * c * dPsiDr) * radial
                  + c * VORTEX_ARMS * wOverR2 * vec2(-d.y, d.x));
    spiral = max(spiral, S * w * pow(max(s, 0.0), 8.0));   // narrow crest line
  }
  return h;
}

void main() {
  vec3 base = position;          // undisplaced point on the plane (y = 0)
  vec3 p    = base;

  vec3 dPdx = vec3(1.0, 0.0, 0.0);
  vec3 dPdz = vec3(0.0, 0.0, 1.0);

  for (int i = 0; i < NUM_WAVES; i++) {
    vec4  w = uWaves[i];
    vec2  D = vec2(cos(w.x), sin(w.x));
    float k = 6.28318530718 / w.y;
    float A = w.z * (1.0 - smoothstep(0.125 * w.y, 0.25 * w.y, aCell));
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

  // Ripple height, indexed by the undisplaced position (zero outside the core)
  vec2 ruv = base.xz / uRippleSize + 0.5;
  float inCore = step(0.0, ruv.x) * step(ruv.x, 1.0) * step(0.0, ruv.y) * step(ruv.y, 1.0);
  p.y += texture2D(uRipple, ruv).r * inCore;

  // Wormholes: height + exact gradient into the tangents
  vec2 vGrad;
  float core, spiral;
  float vh = vortexField(base.xz, vGrad, core, spiral);
  p.y += vh;
  dPdx.y += vGrad.x;
  dPdz.y += vGrad.y;
  vVortexCore = core;
  vVortexDepth = max(-vh, 0.0);
  vSpiral = spiral;

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vTangentX = mat3(modelMatrix) * dPdx;
  vTangentZ = mat3(modelMatrix) * dPdz;
  vUv = ruv;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
