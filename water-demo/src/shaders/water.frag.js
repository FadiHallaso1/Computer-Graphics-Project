// Water surface fragment shader.
// Stage 2–3: base color lit by a simple half-Lambert sun term (so the wave
// shape is readable), plus the anti-aliased reference grid and distance fog.
// Real water shading (Fresnel, reflection, specular, depth color) is stage 4.

export default /* glsl */ `
uniform vec3  uColor;
uniform vec3  uGridColor;
uniform float uGridStep;   // world units between grid lines
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform vec3  uSunDir;     // unit vector toward the sun
uniform bool  uShowNormals; // debug: render N as RGB

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;

  if (uShowNormals) {
    // Map [-1,1] -> [0,1]. Flat water is (0,1,0) -> mid-green.
    // Output directly (no color-space conversion) so values read literally.
    gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
    return;
  }

  // Half-Lambert: keeps slopes facing away from the sun readable
  float diffuse = dot(N, uSunDir) * 0.5 + 0.5;
  vec3 col = uColor * (0.25 + 1.1 * diffuse * diffuse);

  // Screen-space anti-aliased grid lines
  vec2 g = vWorldPos.xz / uGridStep;
  vec2 w = fwidth(g);
  vec2 d = abs(fract(g - 0.5) - 0.5) / max(w, 1e-4);
  float line = 1.0 - min(min(d.x, d.y), 1.0);
  col = mix(col, uGridColor, line * 0.45);

  float dist = length(vWorldPos - cameraPosition);
  float fog = 1.0 - exp(-uFogDensity * dist);

  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);

  // All shading math happens in linear space; convert to the output
  // color space (sRGB) exactly like Three's built-in materials do.
  #include <colorspace_fragment>
}
`;
