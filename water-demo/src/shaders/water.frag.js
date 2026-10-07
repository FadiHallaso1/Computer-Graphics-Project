// Water surface fragment shader.
// Stage 1: flat base color + an anti-aliased reference grid (one line every
// N mesh segments) so the plane's scale and orientation are easy to read,
// faded into the horizon color with exponential distance fog.

export default /* glsl */ `
uniform vec3  uColor;
uniform vec3  uGridColor;
uniform float uGridStep;   // world units between grid lines
uniform vec3  uFogColor;
uniform float uFogDensity;

varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  // Screen-space anti-aliased grid lines
  vec2 g = vWorldPos.xz / uGridStep;
  vec2 w = fwidth(g);
  vec2 d = abs(fract(g - 0.5) - 0.5) / max(w, 1e-4);
  float line = 1.0 - min(min(d.x, d.y), 1.0);

  vec3 col = mix(uColor, uGridColor, line * 0.6);

  float dist = length(vWorldPos - cameraPosition);
  float fog = 1.0 - exp(-uFogDensity * dist);

  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);

  // All shading math happens in linear space; convert to the output
  // color space (sRGB) exactly like Three's built-in materials do.
  #include <colorspace_fragment>
}
`;
