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

export default /* glsl */ `
#define NUM_MOUNDS 2

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
uniform float uCoreSize;      // world size covered by the ripple texture

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

void main() {
  // Normal = Gerstner tangents + ripple slope, crossed per fragment.
  // Ripple slope by central differences on the simulation grid:
  //   ∂h/∂x = (h(u+Δ) − h(u−Δ)) / (2Δ · coreSize)
  vec3 tx = vTangentX;
  vec3 tz = vTangentZ;
  if (all(greaterThanEqual(vUv, vec2(0.0))) && all(lessThanEqual(vUv, vec2(1.0)))) {
    vec2 du = vec2(uRippleTexel, 0.0);
    vec2 dv = vec2(0.0, uRippleTexel);
    float scale = 1.0 / (2.0 * uRippleTexel * uCoreSize);
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

  // 3. Water body: refracted ray -> seabed -> Beer–Lambert
  float depth = max(vWorldPos.y - floorHeight(vWorldPos.xz), 0.0);
  vec3  T = refract(-V, N, 1.0 / 1.333);
  float path = depth / max(-T.y, 0.1);
  vec3  transmittance = exp(-uAbsorption * path);
  vec3  seabed = uSandColor * (0.35 + 0.65 * max(uSunDir.y, 0.0));
  vec3  body = mix(uDeepColor, seabed, transmittance);

  // 4. Sun glint
  vec3  H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), uShininess);
  vec3  glint = uSunColor * uSunIntensity * spec * schlick(dot(H, V));

  vec3 col = mix(body, reflection, F) + glint;

  // Near the horizon, blend into the sky's horizon color so the water
  // meets the skybox without a visible edge.
  vec3 horizonDir = normalize(vec3(-V.x, 0.02, -V.z));
  col = mix(col, sampleEnv(horizonDir), smoothstep(250.0, 1800.0, dist));

  gl_FragColor = vec4(col, 1.0);

  #include <colorspace_fragment>
}
`;
