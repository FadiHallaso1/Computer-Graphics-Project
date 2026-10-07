import * as THREE from 'three';
import vertexShader from './shaders/water.vert.js';
import fragmentShader from './shaders/water.frag.js';

const DEG = Math.PI / 180;

/** Max number of objects casting sun shadows on the water (see water.frag.js). */
export const MAX_CASTERS = 12;

/**
 * Base wave set: long swell plus shorter cross-chop. Directions are spread so
 * crests don't line up into an obviously periodic pattern, and wavelengths
 * aren't integer multiples of each other for the same reason.
 * Amplitudes fall off with wavelength roughly like a real sea state.
 */
export const BASE_WAVES = [
  { angle:   0 * DEG, wavelength: 22.0, amplitude: 0.55, phase: 0.0 },
  { angle:  35 * DEG, wavelength: 13.0, amplitude: 0.35, phase: 1.7 },
  { angle: -50 * DEG, wavelength:  8.0, amplitude: 0.18, phase: 4.1 },
  { angle: 110 * DEG, wavelength:  4.5, amplitude: 0.08, phase: 2.6 },
];

/**
 * Analytic seabed: flat floor at FLOOR_BASE plus Gaussian shoals
 * (cx, cz, sigma, height). The first shoal peaks just below the surface so
 * the deep -> shallow color transition is easy to see.
 */
const FLOOR_BASE = -14;
const MOUNDS = [
  [ 14,  6, 9.0, 13.4],   // peaks at y = -0.6
  [-18, -14, 6.0, 10.0],  // peaks at y = -4.0
];

/**
 * One mesh, two grid densities, laid in XZ:
 *  - a dense core (coreSize, coreSegments): the full-detail wave field
 *    (the ripple area sits in its centre);
 *  - a skirt of outerSegments rings per side reaching farSize, whose
 *    coordinate grows as a·t + b·t⁴. a is chosen so the first skirt cell
 *    matches the core cell, so spacing grows smoothly with no seam.
 * The skirt exists so the water reaches the skybox horizon; waves fade out
 * across it as the cells become too coarse for each wavelength.
 *
 * The fade is driven by aCell, the grid spacing as a function of *radial*
 * distance r from the centre: the spacing the axis-aligned grid has at
 * distance r along an axis. Every point at radius r has |x|, |z| ≤ r, so its
 * real cells are never coarser than that; the fade is therefore always
 * safe, and its contours are circles rather than the grid's squares.
 */
function createGradedPlane(coreSize, coreSegments, farSize, outerSegments) {
  const n = coreSegments + 2 * outerSegments;
  const geometry = new THREE.PlaneGeometry(1, 1, n, n);
  geometry.rotateX(-Math.PI / 2);          // XY facing +Z -> XZ facing +Y

  const coreHalf = coreSize / 2;
  const cell = coreSize / coreSegments;
  const a = cell * outerSegments;
  const b = farSize / 2 - coreHalf - a;

  // grid index k (0..n) -> world coordinate
  const coord = (k) => {
    const j = k - outerSegments;                    // index from core edge
    if (j >= 0 && j <= coreSegments) return -coreHalf + j * cell;
    const t = (j < 0 ? -j : j - coreSegments) / outerSegments;
    const d = coreHalf + a * t + b * t ** 4;
    return j < 0 ? -d : d;
  };
  // Grid spacing at distance r from the centre along an axis:
  // d(t) = coreHalf + a t + b t⁴  ->  spacing = d'(t) / outerSegments.
  // Invert d(t) = r by bisection (d is monotonic in t).
  const cellAtRadius = (r) => {
    if (r <= coreHalf) return cell;
    let lo = 0, hi = 1;
    if (coreHalf + a + b <= r) return (a + 4 * b) / outerSegments;
    for (let i = 0; i < 40; i++) {
      const t = 0.5 * (lo + hi);
      if (coreHalf + a * t + b * t ** 4 < r) lo = t; else hi = t;
    }
    const t = 0.5 * (lo + hi);
    return (a + 4 * b * t ** 3) / outerSegments;
  };
  const index = (s) => Math.round((s + 0.5) * n);  // unit-plane coord -> k

  const pos = geometry.attributes.position;
  const cellAttr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = coord(index(pos.getX(i)));
    const z = coord(index(pos.getZ(i)));
    pos.setX(i, x);
    pos.setZ(i, z);
    cellAttr[i] = cellAtRadius(Math.hypot(x, z));
  }
  // Per-vertex grid spacing: the vertex shader fades each wave out where
  // the mesh is too coarse to represent it (see water.vert.js).
  geometry.setAttribute('aCell', new THREE.BufferAttribute(cellAttr, 1));
  return geometry;
}

/**
 * The water surface: graded plane displaced by summed Gerstner waves in the
 * vertex shader and shaded with Fresnel / reflection / glint / depth color.
 *
 * Ripple texture space: vUv = 0..1 across the central ripple area
 * (ripples.size wide), which is smaller than the wave field.
 */
export function createWater({
  coreSize = 400,       // wave field: 400 × 400 units
  coreSegments = 800,   // 0.5-unit cells: ≥ 8 vertices on the shortest wave
  farSize = 4000,
  outerSegments = 64,
  sunDir = new THREE.Vector3(0.154, 0.161, 0.975),
} = {}) {
  const geometry = createGradedPlane(coreSize, coreSegments, farSize, outerSegments);

  // User-facing parameters (the GUI in stage 6 binds to these).
  const params = {
    amplitude: 1.0,   // multiplies every wave's amplitude
    steepness: 0.6,   // 0 = sine waves, 1 = sharpest crests without folding
    speed:     1.0,   // time scale; keeps ω = sqrt(g k) dispersion intact
  };

  const uniforms = {
    // Geometry
    uTime:         { value: 0 },
    uWaves:        { value: BASE_WAVES.map(() => new THREE.Vector4()) },
    uQ:            { value: 0 },
    uGravity:      { value: 9.81 },

    // Shading
    uEnvMap:       { value: null },
    uF0:           { value: 0.02 },
    uSunDir:       { value: sunDir.clone().normalize() },
    uSunColor:     { value: new THREE.Color(1.0, 0.92, 0.78) },
    uSunIntensity: { value: 60.0 },
    uShininess:    { value: 900.0 },
    uDeepColor:    { value: new THREE.Color(0x0a2c3a) },
    uSandColor:    { value: new THREE.Color(0xc9b48a) },
    uAbsorption:   { value: new THREE.Vector3(0.45, 0.12, 0.08) },
    uFloorBase:    { value: FLOOR_BASE },
    uMounds:       { value: MOUNDS.map((m) => new THREE.Vector4(...m)) },

    // Floating objects: planar reflection pass + analytic sun shadows
    uObjReflection:  { value: null },
    uMirrorViewProj: { value: new THREE.Matrix4() },
    uObjReflOn:      { value: false },
    uReflDistort:    { value: 0.035 },
    uCasterA:        { value: Array.from({ length: MAX_CASTERS }, () => new THREE.Vector4()) },
    uCasterB:        { value: Array.from({ length: MAX_CASTERS }, () => new THREE.Vector4()) },
    uCasterCount:    { value: 0 },

    // Ripples (stage 5)
    uRipple:       { value: null },
    uRippleTexel:  { value: 1 / 512 },
    uRippleSize:   { value: 160 },   // set from the ripple sim in setRipples()

    uShowNormals:  { value: false },
  };

  /**
   * Push wave parameters into uniforms and pick the shared steepness Q.
   * The loop-free limit is Σ Q k_i A_i ≤ 1, so Q_max = 1 / Σ k_i A_i and
   * Q = steepness · Q_max. Because Q is derived from the *current* amplitudes,
   * raising the amplitude slider can never make the surface self-intersect.
   */
  function syncWaves() {
    let sumKA = 0;
    BASE_WAVES.forEach((w, i) => {
      const A = w.amplitude * params.amplitude;
      const k = (2 * Math.PI) / w.wavelength;
      sumKA += k * A;
      uniforms.uWaves.value[i].set(w.angle, w.wavelength, A, w.phase);
    });
    uniforms.uQ.value = sumKA > 0 ? params.steepness / sumKA : 0;
  }
  syncWaves();

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Vertices are displaced in the shader, so CPU-side bounds are wrong;
  // never cull the surface.
  mesh.frustumCulled = false;

  // --- CPU mirror of the vertex shader (for picking) -----------------------

  /** Gerstner displacement of undisplaced point (x, z) at the current time.
   *  Same math as water.vert.js inside the core. */
  function displace(x, z, out = new THREE.Vector3()) {
    const t = uniforms.uTime.value;
    const Q = uniforms.uQ.value;
    const g = uniforms.uGravity.value;
    let px = x, py = 0, pz = z;
    for (const w of uniforms.uWaves.value) {           // (angle, λ, A, φ)
      const Dx = Math.cos(w.x), Dz = Math.sin(w.x);
      const k = (2 * Math.PI) / w.y;
      const theta = k * (Dx * x + Dz * z) - Math.sqrt(g * k) * t + w.w;
      const c = Math.cos(theta);
      px += Q * w.z * Dx * c;
      pz += Q * w.z * Dz * c;
      py += w.z * Math.sin(theta);
    }
    return out.set(px, py, pz);
  }

  /**
   * Surface at world (X, Z): find the undisplaced base point b whose
   * Gerstner image lands on (X, Z). b ← (X,Z) − H(b) is a contraction
   * because Σ Q k A = steepness < 1, so a few iterations converge.
   */
  const _p = new THREE.Vector3();
  function surfaceAt(X, Z) {
    let bx = X, bz = Z;
    for (let i = 0; i < 10; i++) {
      displace(bx, bz, _p);
      bx += X - _p.x;
      bz += Z - _p.z;
    }
    displace(bx, bz, _p);
    return { height: _p.y, baseX: bx, baseZ: bz };
  }

  /**
   * Intersect a ray with the displaced surface inside the ripple area (the
   * only place clicks do anything): march from above the highest possible
   * crest down to below the lowest trough, then bisect the first crossing.
   * Returns the hit point, the undisplaced base position, and the ripple
   * texture uv it maps to, or null.
   */
  function raycast(ray) {
    const o = ray.origin, d = ray.direction;
    if (d.y > -1e-4) return null;                         // looking up
    const rippleSize = uniforms.uRippleSize.value;
    const half = rippleSize / 2;
    const maxH = uniforms.uWaves.value.reduce((s, w) => s + w.z, 0) + 1.0;
    let tStart = Math.max((maxH - o.y) / d.y, 0);
    let tEnd = (-maxH - o.y) / d.y;
    // Clip to the ripple area's XZ square (slab test)
    for (const [oc, dc] of [[o.x, d.x], [o.z, d.z]]) {
      if (Math.abs(dc) < 1e-9) {
        if (Math.abs(oc) > half) return null;
        continue;
      }
      const ta = (-half - oc) / dc, tb = (half - oc) / dc;
      tStart = Math.max(tStart, Math.min(ta, tb));
      tEnd = Math.min(tEnd, Math.max(ta, tb));
    }
    if (tStart >= tEnd) return null;
    const stepLen = 0.2;
    const f = (t) => (o.y + d.y * t) - surfaceAt(o.x + d.x * t, o.z + d.z * t).height;

    let t0 = tStart, f0 = f(t0);
    for (let t1 = tStart + stepLen; t1 <= tEnd + stepLen; t1 += stepLen) {
      const f1 = f(t1);
      if (f0 > 0 && f1 <= 0) {                            // crossed the surface
        for (let i = 0; i < 20; i++) {
          const tm = 0.5 * (t0 + t1), fm = f(tm);
          if (fm > 0) t0 = tm; else t1 = tm;
        }
        const t = 0.5 * (t0 + t1);
        const X = o.x + d.x * t, Z = o.z + d.z * t;
        const s = surfaceAt(X, Z);
        return {
          point: new THREE.Vector3(X, s.height, Z),
          base: new THREE.Vector2(s.baseX, s.baseZ),
          uv: new THREE.Vector2(s.baseX / rippleSize + 0.5, s.baseZ / rippleSize + 0.5),
        };
      }
      t0 = t1; f0 = f1;
    }
    return null;
  }

  return {
    mesh,
    uniforms,
    params,
    coreSize,
    coreSegments,
    vertexCount: geometry.attributes.position.count,
    triangleCount: geometry.index.count / 3,
    syncWaves,
    displace,
    surfaceAt,
    raycast,
    /** Planar reflection of the floating objects (see reflection.js). */
    setObjectReflection(texture, viewProj, on) {
      uniforms.uObjReflection.value = texture;
      uniforms.uMirrorViewProj.value.copy(viewProj);
      uniforms.uObjReflOn.value = on && !!texture;
    },
    /**
     * Sun-shadow casters, each an ellipse lying flat at height h:
     * { x, z, h, heading, halfWidth, halfLength }. heading ψ: forward = (sin ψ, cos ψ).
     */
    setShadowCasters(casters, on) {
      const n = on ? Math.min(casters.length, MAX_CASTERS) : 0;
      for (let i = 0; i < n; i++) {
        const c = casters[i];
        uniforms.uCasterA.value[i].set(c.x, c.z, c.h, c.heading);
        uniforms.uCasterB.value[i].set(c.halfWidth, c.halfLength, 0, 0);
      }
      uniforms.uCasterCount.value = n;
    },
    setEnvMap(tex) { uniforms.uEnvMap.value = tex; },
    /** Point the shaders at the latest ripple state (call every frame). */
    setRipples(ripples) {
      uniforms.uRipple.value = ripples.texture;
      uniforms.uRippleTexel.value = 1 / ripples.resolution;
      uniforms.uRippleSize.value = ripples.size;
    },
    setWireframe(on) { material.wireframe = on; },
    setShowNormals(on) { uniforms.uShowNormals.value = on; },
    /** Advance by dt real seconds. Time is accumulated, so changing speed
     *  never makes the surface jump. */
    update(dt) {
      uniforms.uTime.value += dt * params.speed;
    },
  };
}
