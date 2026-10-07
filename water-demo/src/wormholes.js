import { MAX_VORTICES } from './water.js';

/**
 * Wormholes: whirlpool funnels opened with a right-click.
 *
 * Each one has a life: it opens over OPEN seconds (strength S: 0 → 1),
 * holds, then closes over CLOSE seconds. The funnel shape and spiral arms
 * are drawn by the water shaders (see water.vert.js); this module owns the
 * lifecycle, the spin, and the flow field that drags floating objects.
 *
 * Flow field (a smoothed Rankine-style vortex with inflow), around a
 * centre c, with r = |p − c|:
 *   tangential speed  v_t = S · V · 2(r/R) / (1 + (r/R)²)    peak V at r = R, ~1/r far out
 *   inflow            v_r = −pull · v_t
 *   angular velocity  ω   = v_t / max(r, R/2)                (turns objects as they circle)
 */
const OPEN = 1.5;      // seconds
const CLOSE = 2.5;

export function createWormholes({ water, ripples }) {
  const params = {
    radius: 6,         // funnel radius R, world units
    depth: 4,          // funnel depth D at full strength
    lifetime: 12,      // seconds, including opening and closing
    pull: 0.5,         // inflow as a fraction of the swirl speed
    swirl: 4,          // peak swirl speed V, units / s
  };
  const list = [];     // live wormholes
  const uniformsView = [];

  function open(x, z) {
    if (list.length >= MAX_VORTICES) list.shift();   // replace the oldest
    list.push({
      x, z,
      age: 0,
      life: params.lifetime,
      radius: params.radius,
      depth: params.depth,
      spin: Math.random() < 0.5 ? 1 : -1,
      phase: Math.random() * Math.PI * 2,
      strength: 0,
    });
    // The funnel opening sends out a ripple ring
    const u = x / ripples.size + 0.5, v = z / ripples.size + 0.5;
    ripples.addDrop(u, v, -1.2 * ripples.params.dropStrength, params.radius * 0.6);
  }

  function closeAll() {
    for (const w of list) w.age = Math.max(w.age, w.life - CLOSE);
  }

  const ease = (t) => t * t * (3 - 2 * t);

  function update(dt) {
    for (const w of list) {
      w.age += dt;
      const rise = Math.min(w.age / OPEN, 1);
      const fall = Math.min(Math.max((w.life - w.age) / CLOSE, 0), 1);
      w.strength = ease(Math.min(rise, fall));
      w.phase += w.spin * dt * 1.6;                   // arms rotate with the flow
    }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].age >= list[i].life) list.splice(i, 1);

    uniformsView.length = 0;
    for (const w of list) {
      uniformsView.push({
        x: w.x, z: w.z, radius: w.radius, strength: w.strength,
        depth: w.depth, armAmplitude: 0.09 * w.depth, phase: w.phase, spin: w.spin,
      });
    }
    water.setVortices(uniformsView);
  }

  /**
   * Velocity of the water at (x, z) and its angular velocity, summed over
   * all wormholes. out = { vx, vz, omega }.
   */
  function flowAt(x, z, out = { vx: 0, vz: 0, omega: 0 }) {
    out.vx = 0; out.vz = 0; out.omega = 0;
    for (const w of list) {
      const dx = x - w.x, dz = z - w.z;
      const r = Math.hypot(dx, dz) + 1e-6;
      const q = r / w.radius;
      const vt = w.strength * params.swirl * (2 * q) / (1 + q * q);
      const tx = (-dz / r) * w.spin, tz = (dx / r) * w.spin;   // tangential direction
      const rx = -dx / r, rz = -dz / r;                        // inward
      out.vx += tx * vt + rx * vt * params.pull;
      out.vz += tz * vt + rz * vt * params.pull;
      out.omega += w.spin * vt / Math.max(r, w.radius * 0.5);
    }
    return out;
  }

  /** The wormhole whose throat (inner 35% of the radius) contains (x, z), if open enough. */
  function throatAt(x, z) {
    for (const w of list) {
      if (w.strength > 0.6 && Math.hypot(x - w.x, z - w.z) < 0.35 * w.radius) return w;
    }
    return null;
  }

  return {
    params,
    open,
    closeAll,
    update,
    flowAt,
    throatAt,
    get count() { return list.length; },
  };
}
