import * as THREE from 'three';

/**
 * Floating objects: kayaks (with paddlers), mooring buoys and drifting logs.
 *
 * Flotation. Each object samples the CPU copy of the Gerstner surface at a
 * few points (bow / stern / port / starboard). Their mean gives the target
 * height, their differences the target pitch and roll. A damped spring
 * chases those targets, so objects bob and lag like things with mass rather
 * than snapping to the surface. Horizontally, each object sits on the
 * Gerstner image of its anchor point, P(base), so it rides the waves'
 * orbital motion the way a real floating body does.
 *
 * Ripples, both ways:
 *  - kayaks inject drops into the wave-equation sim (paddle strokes, bow wave);
 *  - every object reads the ripple height under it back from the GPU
 *    (asynchronously, one frame late) and adds it to its target height,
 *    so a stone dropped next to a buoy rocks it.
 *
 * Wormholes. Objects are carried by the wormhole flow field (an offset
 * added to their normal position, plus a spin added to their heading).
 * Moored buoys are held back by their lines; kayaks and logs drift freely
 * and, once the wormholes are gone, paddle or drift back home. Anything
 * that reaches a throat is swallowed (shrinks and sinks) and reappears at
 * home after all wormholes have closed.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Kayak hull: a unit sphere reshaped. Cross-section radius goes from the
 * sphere's (1 − z²)^0.5 to (1 − z²)^0.75 for sharper ends, the deck is
 * flatter than the hull, and the ends lift slightly (rocker).
 * Forward is +z. y = 0 is the sheer line (deck edge).
 */
function kayakHullGeometry({ halfLength = 2.3, halfWidth = 0.34, deck = 0.14, hull = 0.22, rocker = 0.14 } = {}) {
  const g = new THREE.SphereGeometry(1, 64, 24);
  g.rotateX(Math.PI / 2);                       // poles from ±y to ±z
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rc = Math.hypot(x, y);
    const dx = rc > 1e-6 ? x / rc : 0;
    const dy = rc > 1e-6 ? y / rc : 0;
    const profile = Math.pow(Math.max(1 - z * z, 0), 0.75);
    p.setXYZ(
      i,
      dx * profile * halfWidth,
      dy * profile * (dy > 0 ? deck : hull) + rocker * z ** 4,
      z * halfLength,
    );
  }
  g.computeVertexNormals();
  return g;
}

function makeKayak({ hullColor, jacketColor }) {
  const group = new THREE.Group();

  const hull = new THREE.Mesh(
    kayakHullGeometry(),
    new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.32, metalness: 0 }),
  );
  group.add(hull);

  // Cockpit: dark opening with a raised rim
  const cockpit = new THREE.Mesh(
    new THREE.CircleGeometry(0.27, 32).rotateX(-Math.PI / 2).scale(1, 1, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.8 }),
  );
  cockpit.position.set(0, 0.125, -0.15);
  group.add(cockpit);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.27, 0.035, 8, 40).rotateX(Math.PI / 2).scale(1, 1, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.5 }),
  );
  rim.position.copy(cockpit.position).setY(0.14);
  group.add(rim);

  // Paddler
  const jacket = new THREE.MeshStandardMaterial({ color: jacketColor, roughness: 0.65 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.32, 4, 14), jacket);
  torso.position.set(0, 0.42, -0.2);
  group.add(torso);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.115, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.7 }),
  );
  head.position.set(0, 0.79, -0.2);
  group.add(head);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.128, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.35 }),
  );
  helmet.position.copy(head.position).add(new THREE.Vector3(0, 0.02, 0));
  group.add(helmet);

  // Paddle: shaft along local x with a blade at each end
  const paddle = new THREE.Group();
  paddle.position.set(0, 0.62, -0.05);
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 2.2, 8).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.4, metalness: 0.3 }),
  );
  paddle.add(shaft);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.35 });
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.17), bladeMat);
    blade.position.x = side * 1.12;
    blade.rotation.x = side * 0.5;              // feathered blades
    paddle.add(blade);
  }
  group.add(paddle);

  return { group, paddle };
}

function makeBuoy() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 32, 20),
    new THREE.MeshStandardMaterial({ color: 0xd1342b, roughness: 0.45 }),
  );
  group.add(body);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.07, 10, 40).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.5 }),
  );
  band.position.y = 0.22;
  group.add(band);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.035, 0.85, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.4 }),
  );
  mast.position.y = 0.95;
  group.add(mast);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 16, 10),
    new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xffc23d, emissiveIntensity: 0 }),
  );
  lamp.position.y = 1.42;
  group.add(lamp);
  return { group, lamp };
}

function makeLog() {
  const bark = new THREE.MeshStandardMaterial({ color: 0x5e4129, roughness: 0.92 });
  const endGrain = new THREE.MeshStandardMaterial({ color: 0xb08a5c, roughness: 0.85 });
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.26, 3.2, 18).rotateX(Math.PI / 2),   // along z
    [bark, endGrain, endGrain],
  );
  const group = new THREE.Group();
  group.add(mesh);
  return { group };
}

// ---------------------------------------------------------------------------
// Scene layout (base coordinates; the ripple disc has radius ~74)
// ---------------------------------------------------------------------------

const KAYAKS = [
  // circle centre (x, z), radius, angular speed (rad/s, sign = direction), phase
  { cx: -24, cz: 20, r: 13, w: 0.12, a0: 0.0, hullColor: 0xe8452c, jacketColor: 0x24324a },
  { cx: 24, cz: 28, r: 16, w: -0.1, a0: 2.0, hullColor: 0xf2b31b, jacketColor: 0xb3262e },
  // close to the default camera, looping across the sun's glint path
  { cx: 0, cz: -24, r: 8, w: 0.19, a0: 1.3, hullColor: 0x9bd13a, jacketColor: 0x1f2a36 },
];
const BUOYS = [[-5, -11], [2, 8], [-28, -2], [30, 6], [-10, 38]];
const LOGS = [
  { ax: 22, az: -16, heading: 0.6 },
  { ax: -2, az: 30, heading: 2.1 },
];

// Spring (period T seconds, damping ratio ζ) per object kind
const SPRINGS = {
  kayak: { T: 0.9, zeta: 0.5 },
  buoy: { T: 0.7, zeta: 0.32 },
  log: { T: 1.2, zeta: 0.7 },
};

// ---------------------------------------------------------------------------

export function createFloaters({ water, ripples, renderer, wormholes }) {
  const root = new THREE.Group();
  root.name = 'floaters';
  const floaters = [];

  function addFloater(kind, parts, opts) {
    const s = SPRINGS[kind];
    const k = (2 * Math.PI / s.T) ** 2;
    const f = {
      kind,
      ...parts,
      ...opts,
      base: new THREE.Vector2(),
      heading: opts.heading ?? 0,
      headingNominal: opts.heading ?? 0,  // heading before wormhole spin
      offset: new THREE.Vector2(),        // displacement by wormhole flow
      spin: 0,                            // heading change from wormhole flow
      state: 'float',                     // float | sinking | gone | rising
      stateT: 0,
      scale: 1,
      sink: 0,
      waterLevel: 0,          // local mean water height under the object
      rippleH: 0,             // ripple height under the object (GPU readback)
      k,
      c: 2 * s.zeta * Math.sqrt(k),
      y: 0, vy: 0, pitch: 0, vpitch: 0, roll: 0, vroll: 0,
      started: false,
    };
    root.add(f.group);
    floaters.push(f);
    return f;
  }

  KAYAKS.forEach((o) => {
    addFloater('kayak', makeKayak(o), {
      path: o,
      angle: o.a0,
      samples: { fwd: 1.8, side: 0.3 },
      lift: 0.09,                         // sheer line sits this far above water
      paddlePhase: Math.random() * Math.PI * 2,
      lastCos: 1,
      wakeDist: 0,
    });
  });
  BUOYS.forEach(([x, z]) => {
    const f = addFloater('buoy', makeBuoy(), { samples: { fwd: 0.45, side: 0.45 }, lift: 0.08 });
    f.base.set(x, z);
    f.anchor = new THREE.Vector2(x, z);
    f.blinkOffset = Math.random() * 3;
  });
  LOGS.forEach((o) => {
    const f = addFloater('log', makeLog(), { samples: { fwd: 1.4, side: 0.2 }, lift: 0.03, heading: o.heading });
    f.headingNominal = o.heading;
    f.anchor = new THREE.Vector2(o.ax, o.az);
    f.driftPhase = Math.random() * Math.PI * 2;
  });

  // --- Ripple coupling -------------------------------------------------------
  const uvOf = (bx, bz) => [bx / ripples.size + 0.5, bz / ripples.size + 0.5];

  let readPending = false;
  let readbackOk = typeof renderer.readRenderTargetPixelsAsync === 'function';
  function requestRippleHeights() {
    if (!readbackOk || readPending) return;
    readPending = true;
    const rt = ripples.target;
    const n = ripples.resolution;
    const isFloat = rt.texture.type === THREE.FloatType;
    const reads = floaters.map((f) => {
      const [u, v] = uvOf(f.base.x, f.base.y);
      if (!ripples.contains(u, v)) { f.rippleH = 0; return null; }
      const px = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
      const py = Math.min(n - 1, Math.max(0, Math.floor(v * n)));
      const buf = isFloat ? new Float32Array(4) : new Uint16Array(4);
      return renderer.readRenderTargetPixelsAsync(rt, px, py, 1, 1, buf).then(() => {
        f.rippleH = isFloat ? buf[0] : THREE.DataUtils.fromHalfFloat(buf[0]);
      });
    });
    Promise.all(reads)
      .catch(() => { readbackOk = false; })       // unsupported: float without ripples
      .finally(() => { readPending = false; });
  }

  // --- Per-frame update --------------------------------------------------------
  const settings = { visible: true, paddling: true };
  const casters = [];
  const fwd = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  const flow = { vx: 0, vz: 0, omega: 0 };
  let time = 0;

  function sampleSurface(f, cx, cz) {
    const s = f.samples;
    const fx = Math.sin(f.heading), fz = Math.cos(f.heading);   // forward
    const px = Math.cos(f.heading), pz = -Math.sin(f.heading);  // port (local +x)
    const h = (dx, dz) => water.surfaceAt(cx + dx, cz + dz).height;
    const bow = h(fx * s.fwd, fz * s.fwd);
    const stern = h(-fx * s.fwd, -fz * s.fwd);
    const port = h(px * s.side, pz * s.side);
    const star = h(-px * s.side, -pz * s.side);
    return {
      level: 0.25 * (bow + stern + port + star),
      pitch: Math.atan2(bow - stern, 2 * s.fwd),
      roll: Math.atan2(port - star, 2 * s.side),
    };
  }

  function spring(f, key, target, dt) {
    const v = 'v' + key;
    f[v] += (f.k * (target - f[key]) - f.c * f[v]) * dt;
    f[key] += f[v] * dt;
  }

  function moveKayak(f, dt) {
    const p = f.path;
    if (settings.paddling) f.angle += p.w * dt;
    f.base.set(p.cx + p.r * Math.cos(f.angle), p.cz + p.r * Math.sin(f.angle));
    // heading = direction of travel along the circle
    const vx = -Math.sin(f.angle) * Math.sign(p.w);
    const vz = Math.cos(f.angle) * Math.sign(p.w);
    f.headingNominal = Math.atan2(vx, vz);

    if (!settings.paddling || f.state !== 'float') { f.paddle.rotation.set(0, 0, 0); return; }

    // Paddle: tilt side to side and sweep; a stroke at each extreme
    f.paddlePhase += dt * 2 * Math.PI * 0.85;
    const s = Math.sin(f.paddlePhase), c = Math.cos(f.paddlePhase);
    f.paddle.rotation.set(0, 0.35 * c, 0.5 * s);
    if (Math.sign(c) !== Math.sign(f.lastCos)) {
      // sin at +1: the -x (starboard) blade is down; at -1, the +x (port) blade
      const side = s > 0 ? -1 : 1;
      tmp.set(side * 1.15, 0, 0);
      f.paddle.updateWorldMatrix(true, false);   // pose set this frame
      f.paddle.localToWorld(tmp);
      // world -> base coords: remove the orbital displacement (position
      // minus the base actually used, i.e. nominal base + wormhole offset)
      const [u, v] = uvOf(
        tmp.x - (f.group.position.x - f.base.x - f.offset.x),
        tmp.z - (f.group.position.z - f.base.y - f.offset.y),
      );
      ripples.addDrop(u, v, -0.28 * ripples.params.dropStrength, 0.4);
    }
    f.lastCos = c;

    // Bow wave: a small drop every 0.6 units travelled
    f.wakeDist += Math.abs(p.w) * p.r * dt;
    if (f.wakeDist > 0.6) {
      f.wakeDist = 0;
      fwd.set(Math.sin(f.heading), Math.cos(f.heading));
      const [u, v] = uvOf(f.base.x + f.offset.x + fwd.x * 2.1, f.base.y + f.offset.y + fwd.y * 2.1);
      ripples.addDrop(u, v, -0.1 * ripples.params.dropStrength, 0.45);
    }
  }

  /**
   * Wormhole drift, spin and swallowing. On entry f.base holds the object's
   * normal position; on exit it holds the position actually used.
   */
  function applyWormholes(f, dt) {
    const active = wormholes && wormholes.count > 0;

    if (f.state === 'float' && active) {
      wormholes.flowAt(f.base.x + f.offset.x, f.base.y + f.offset.y, flow);
      f.offset.x += flow.vx * dt;
      f.offset.y += flow.vz * dt;
      f.spin += flow.omega * dt;
    }
    if (f.kind === 'buoy') {
      // Mooring line: pulls back toward the anchor and caps the drift
      f.offset.multiplyScalar(Math.exp(-0.6 * dt));
      if (f.offset.length() > 5) f.offset.setLength(5);
    } else if (!active) {
      // Paddle / drift back home once the water is calm again
      f.offset.multiplyScalar(Math.exp(-0.35 * dt));
    }
    if (!active) f.spin *= Math.exp(-0.5 * dt);

    f.base.add(f.offset);
    f.heading = f.headingNominal + f.spin;

    // Swallow / reappear
    if (f.state === 'float' && active && wormholes.throatAt(f.base.x, f.base.y)) {
      f.state = 'sinking'; f.stateT = 0;
    }
    if (f.state === 'sinking') {
      f.stateT += dt;
      const t = Math.min(f.stateT / 1.2, 1);
      f.scale = 1 - t;
      f.sink = 2.5 * t * t;
      f.spin += 8 * dt;                         // spins as it goes down
      if (t >= 1) { f.state = 'gone'; f.group.visible = false; }
    } else if (f.state === 'gone') {
      if (!active) {
        f.offset.set(0, 0); f.spin = 0; f.sink = 0;
        f.state = 'rising'; f.stateT = 0; f.started = false;
        f.group.visible = true;
      }
    } else if (f.state === 'rising') {
      f.stateT += dt;
      f.scale = Math.min(f.stateT / 1.0, 1);
      if (f.scale >= 1) f.state = 'float';
    }
  }

  function update(dt) {
    time += dt;
    root.visible = settings.visible;
    casters.length = 0;
    if (!settings.visible) return;

    requestRippleHeights();

    for (const f of floaters) {
      if (f.kind === 'kayak') moveKayak(f, dt);
      else if (f.kind === 'log') {
        // slow drift around its anchor, slowly turning
        const a = f.driftPhase + time * 0.03;
        f.base.set(f.anchor.x + 3 * Math.cos(a), f.anchor.y + 3 * Math.sin(a));
        f.headingNominal += dt * 0.02;
      } else if (f.kind === 'buoy') {
        f.base.copy(f.anchor);
        // lamp blinks: 0.25 s on every 3 s
        const on = (time + f.blinkOffset) % 3 < 0.25;
        f.lamp.material.emissiveIntensity = on ? 3 : 0;
      }

      applyWormholes(f, dt);
      if (f.state === 'gone') continue;

      // Ride the Gerstner orbit of the base point
      const P = water.displace(f.base.x, f.base.y, tmp);
      const cx = P.x, cz = P.z;
      const surf = sampleSurface(f, cx, cz);
      f.waterLevel = surf.level + f.rippleH;
      const targetY = f.waterLevel + f.lift;

      if (!f.started) {                    // first frame: start at rest on the water
        f.y = targetY; f.pitch = surf.pitch; f.roll = surf.roll; f.started = true;
      }
      // Sub-step the springs so long frames stay stable
      const steps = Math.ceil(dt / (1 / 120));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        spring(f, 'y', targetY, h);
        spring(f, 'pitch', surf.pitch, h);
        spring(f, 'roll', surf.roll, h);
      }

      f.group.position.set(cx, f.y - f.sink, cz);
      // Euler YXZ: yaw (heading), then pitch (bow up = −x), then roll
      f.group.rotation.set(-f.pitch, f.heading, f.roll, 'YXZ');
      f.group.scale.setScalar(Math.max(f.scale, 1e-3));

      // Sun-shadow ellipses (see water.frag.js), shrinking with the object
      const k = f.scale, y = f.y - f.sink;
      if (f.kind === 'kayak') {
        casters.push({ x: cx, z: cz, h: y + 0.05 * k, heading: f.heading, halfWidth: 0.34 * k, halfLength: 2.3 * k });
        casters.push({ x: cx, z: cz, h: y + 0.6 * k, heading: f.heading, halfWidth: 0.2 * k, halfLength: 0.22 * k });
      } else if (f.kind === 'buoy') {
        casters.push({ x: cx, z: cz, h: y + 0.25 * k, heading: 0, halfWidth: 0.55 * k, halfLength: 0.55 * k });
      } else {
        casters.push({ x: cx, z: cz, h: y + 0.12 * k, heading: f.heading, halfWidth: 0.25 * k, halfLength: 1.6 * k });
      }
    }
  }

  return { root, floaters, casters, settings, update };
}
