// Water surface fragment shader.
// Stage 4: physically-motivated water shading, all in linear space.
//
//   1. Fresnel (Schlick):  F(θ) = F0 + (1 − F0)(1 − cos θ)^5,
//      F0 = ((n1 − n2)/(n1 + n2))² = ((1 − 1.333)/(1 + 1.333))² ≈ 0.02 for water.
//      Looking straight down ~2% is reflected; at grazing angles almost all.
//
//   2. Reflection: R = reflect(−V, N) looks up the skybox cubemap; the mip
//      level rises with distance to stand in for sub-pixel wave roughness.
//
//   3. Water body (what Fresnel lets through): refract the view ray with
//      Snell's law, walk it down to an analytic seabed floorY(x,z), and
//      attenuate the seabed color per channel with Beer–Lambert:
//         T = exp(−σ · pathLength)
//      Red is absorbed fastest, so shallow water reads turquoise over sand
//      and deep water converges to the deep-water color.
//
//   4. Sun glint: Blinn–Phong lobe pow(N·H, shininess), weighted by Fresnel
//      at the half vector, with the sun direction matched to the sun in
//      the skybox so the highlight sits under the visible sun.
//
//   final = mix(body, reflection, F) + glint
//
// The normal combines the analytic Gerstner tangents (from the vertex
// shader) with the ripple height field's slope, sampled per fragment.
//
// Floating objects feed two more terms:
//   - Object reflections: a planar mirror pass (reflection.js) renders the
//     objects from below the surface. Projecting the fragment through that
//     mirror camera gives where its reflection lands; the lookup is offset
//     by N.xz so the reflection wobbles with the waves. It replaces the sky
//     in the reflection term wherever an object is, so Fresnel weights it
//     exactly like the sky reflection.
//   - Sun shadows: each object is an ellipse lying flat at its height h.
//     The fragment is shadowed if the ray toward the sun passes through one:
//       q = P.xz + L.xz · (h − P.y) / L.y,   inside if (q_side/a)² + (q_fwd/b)² < 1
//     Shadow removes the sun glint and some sunlit in-scatter of the body;
//     it does not touch the reflection (a shadow can't darken a mirror image).

export default /* glsl */ `
#define NUM_MOUNDS 2
#define MAX_CASTERS 12

uniform samplerCube uEnvMap;
uniform float uF0;

uniform vec3  uSunDir;        // unit vector toward the sun
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform float uShininess;

uniform vec3  uDeepColor;     // color of infinitely deep water
uniform vec3  uSandColor;     // seabed albedo
uniform vec3  uAbsorption;    // Beer–Lambert σ per channel (1 / world units)
uniform float uFloorBase;     // seabed depth away from the shoals
uniform vec4  uMounds[NUM_MOUNDS]; // (center x, center z, sigma, height)

uniform sampler2D uRipple;    // R = ripple height (world units)
uniform float uRippleTexel;   // 1 / ripple resolution
uniform float uRippleSize;    // world size covered by the ripple texture

uniform sampler2D uObjReflection; // objects seen from the mirror camera (alpha = coverage)
uniform mat4  uMirrorViewProj;
uniform bool  uObjReflOn;
uniform float uReflDistort;       // how far wave normals push the reflection lookup

uniform vec4  uCasterA[MAX_CASTERS]; // (x, z, height, heading)
uniform vec4  uCasterB[MAX_CASTERS]; // (half width, half length, -, -)
uniform int   uCasterCount;

uniform bool  uShowNormals;   // debug: render N as RGB

varying vec3 vWorldPos;
varying vec3 vTangentX;
varying vec3 vTangentZ;
varying vec2 vUv;

// Analytic seabed: flat floor plus Gaussian shoals.
float floorHeight(vec2 xz) {
  float h = uFloorBase;
  for (int i = 0; i < NUM_MOUNDS; i++) {
    vec4 m = uMounds[i];
    vec2 d = xz - m.xy;
    h += m.w * exp(-dot(d, d) / (2.0 * m.z * m.z));
  }
  return h;
}

// Three.js renders CubeTexture backgrounds with x mirrored (cubemaps are
// left-handed); sample the same way so reflections match the sky.
vec3 sampleEnv(vec3 dir) {
  return textureCube(uEnvMap, vec3(-dir.x, dir.y, dir.z)).rgb;
}
vec3 sampleEnvLod(vec3 dir, float lod) {
  return textureLod(uEnvMap, vec3(-dir.x, dir.y, dir.z), lod).rgb;
}

float schlick(float cosTheta) {
  return uF0 + (1.0 - uF0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}

// 1 = fully sunlit, 0 = fully in an object's shadow (soft-edged).
float sunVisibility(vec3 P) {
  float lit = 1.0;
  for (int i = 0; i < MAX_CASTERS; i++) {
    if (i >= uCasterCount) break;
    vec4 a = uCasterA[i];
    vec2 halfAxes = uCasterB[i].xy;
    float t = (a.z - P.y) / uSunDir.y;          // along the ray toward the sun
    if (t <= 0.0) continue;
    vec2 q    = P.xz + uSunDir.xz * t - a.xy;
    vec2 fwd  = vec2(sin(a.w), cos(a.w));
    vec2 side = vec2(cos(a.w), -sin(a.w));
    vec2 l = vec2(dot(q, side), dot(q, fwd)) / halfAxes;
    lit = min(lit, smoothstep(0.55, 1.15, dot(l, l)));
  }
  return lit;
}

void main() {
  // Normal = Gerstner tangents + ripple slope, crossed per fragment.
  // Ripple slope by central differences on the simulation grid:
  //   ∂h/∂x = (h(u+Δ) − h(u−Δ)) / (2Δ · rippleSize)
  vec3 tx = vTangentX;
  vec3 tz = vTangentZ;
  if (all(greaterThanEqual(vUv, vec2(0.0))) && all(lessThanEqual(vUv, vec2(1.0)))) {
    vec2 du = vec2(uRippleTexel, 0.0);
    vec2 dv = vec2(0.0, uRippleTexel);
    float scale = 1.0 / (2.0 * uRippleTexel * uRippleSize);
    tx.y += (texture2D(uRipple, vUv + du).r - texture2D(uRipple, vUv - du).r) * scale;
    tz.y += (texture2D(uRipple, vUv + dv).r - texture2D(uRipple, vUv - dv).r) * scale;
  }
  vec3 N = normalize(cross(tz, tx));
  if (!gl_FrontFacing) N = -N;

  if (uShowNormals) {
    // Map [-1,1] -> [0,1]. Flat water is (0,1,0) -> mid-green.
    gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
    return;
  }

  vec3  toCam = cameraPosition - vWorldPos;
  float dist  = length(toCam);
  vec3  V     = toCam / dist;

  // Far away, per-vertex wave detail is sub-pixel; flatten the normal
  // toward +Y so the distant surface doesn't shimmer.
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(80.0, 400.0, dist)));

  float NdotV = max(dot(N, V), 0.0);

  // 1. Fresnel
  float F = schlick(NdotV);

  // 2. Reflection (mirror rays that point below the horizon back up:
  //    the cubemap's lower half is the bridge deck, not sky)
  //    Far away the waves the mesh can no longer carry still roughen the
  //    surface, so the reflection gets blurrier (higher cubemap mip) with
  //    distance instead of turning into a perfect mirror.
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float roughLod = 2.5 * smoothstep(40.0, 300.0, dist);
  vec3 reflection = sampleEnvLod(R, roughLod);

  //    Objects in the reflection: project the fragment (on the mean plane)
  //    through the mirror camera, nudged by the wave normal.
  if (uObjReflOn) {
    vec4 c = uMirrorViewProj * vec4(vWorldPos.x, 0.0, vWorldPos.z, 1.0);
    if (c.w > 0.0) {
      vec2 ruv = c.xy / c.w * 0.5 + 0.5 + N.xz * uReflDistort;
      vec4 obj = texture2D(uObjReflection, ruv);
      reflection = mix(reflection, obj.rgb, obj.a);
    }
  }

  float sunLit = sunVisibility(vWorldPos);

  // 3. Water body: refracted ray -> seabed -> Beer–Lambert
  float depth = max(vWorldPos.y - floorHeight(vWorldPos.xz), 0.0);
  vec3  T = refract(-V, N, 1.0 / 1.333);
  float path = depth / max(-T.y, 0.1);
  vec3  transmittance = exp(-uAbsorption * path);
  vec3  seabed = uSandColor * (0.35 + 0.65 * max(uSunDir.y, 0.0) * sunLit);
  vec3  body = mix(uDeepColor, seabed, transmittance) * mix(0.8, 1.0, sunLit);

  // 4. Sun glint (blocked where an object shades the water)
  vec3  H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), uShininess);
  vec3  glint = uSunColor * uSunIntensity * spec * schlick(dot(H, V)) * sunLit;

  vec3 col = mix(body, reflection, F) + glint;

  // Near the horizon, blend into the sky's horizon color so the water
  // meets the skybox without a visible edge.
  vec3 horizonDir = normalize(vec3(-V.x, 0.02, -V.z));
  col = mix(col, sampleEnv(horizonDir), smoothstep(250.0, 1800.0, dist));

  gl_FragColor = vec4(col, 1.0);

  #include <colorspace_fragment>
}
`;
