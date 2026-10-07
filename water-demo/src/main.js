import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWater } from './water.js';
import { createRipples } from './ripples.js';
import { createGui } from './gui.js';
import { createFloaters } from './floaters.js';
import { createObjectReflection } from './reflection.js';
import { createWormholes } from './wormholes.js';

// Direction toward the sun disc in the Bridge2 skybox (measured from the
// brightest region of posz.jpg, x mirrored to match Three's cubemap
// convention). The specular glint uses the same vector.
const SUN_DIR = new THREE.Vector3(0.154, 0.161, 0.975).normalize();

const HOME_POSITION = new THREE.Vector3(-6, 12, -46);   // looking into the low sun
const HOME_TARGET = new THREE.Vector3(0, 0, 4);

// --- Renderer / scene / camera -------------------------------------------
const container = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Skybox: "Bridge2" by Emil Persson (Humus), see textures/bridge2/readme.txt
const envMap = new THREE.CubeTextureLoader()
  .setPath('textures/bridge2/')
  .load(['posx.jpg', 'negx.jpg', 'posy.jpg', 'negy.jpg', 'posz.jpg', 'negz.jpg']);
envMap.colorSpace = THREE.SRGBColorSpace;   // sampled as linear in shaders
scene.background = envMap;
// The same sky lights the floating objects (image-based ambient + reflections)
scene.environment = envMap;

// Sun light for the objects, from the same direction as the water's glint
const sun = new THREE.DirectionalLight(0xffe4c0, 2.4);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 6000);
camera.position.copy(HOME_POSITION);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;   // keep the camera above the water
controls.minDistance = 5;
controls.maxDistance = 220;               // keeps the wave field's edge near the horizon

// --- Water + ripples --------------------------------------------------------
const water = createWater({ sunDir: SUN_DIR });
water.setEnvMap(envMap);
scene.add(water.mesh);

// The simulation texture covers exactly the water's dense core.
// The ripple sim covers a 160-unit area in the centre of the 400-unit wave
// field: 768² over 160 units ≈ 0.21 units per texel. Stretching it over
// the whole field would make ripples blocky (or cost ~6× the GPU time).
const RIPPLE_SIZE = 160;
const ripples = createRipples(renderer, { resolution: 768, size: RIPPLE_SIZE });
water.setRipples(ripples);

// --- Floating objects -----------------------------------------------------
// Wormholes (right-click): whirlpool funnels that drag the floating objects
const wormholes = createWormholes({ water, ripples });
const floaters = createFloaters({ water, ripples, renderer, wormholes });
scene.add(floaters.root);
const reflection = createObjectReflection(renderer, { scale: 0.5 });
reflection.setSize(window.innerWidth, window.innerHeight);

// --- UI state ---------------------------------------------------------------
const view = {
  wireframe: false, normals: false, rain: false,
  objectReflections: true, objectShadows: true,
};
const actions = {
  calm: () => ripples.reset(),
  resetView: () => {
    camera.position.copy(HOME_POSITION);
    controls.target.copy(HOME_TARGET);
    controls.update();
  },
};
const ui = createGui({ water, ripples, view, actions, floaters, wormholes });

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key.toLowerCase()) {
    case 'w': view.wireframe = !view.wireframe; water.setWireframe(view.wireframe); break;
    case 'n': view.normals = !view.normals; water.setShowNormals(view.normals); break;
    case 'r': view.rain = !view.rain; break;
    case 'c': actions.calm(); break;
    case 'x': wormholes.closeAll(); break;
    default: return;
  }
  ui.refresh();   // keep the panel's checkboxes in sync with the shortcut
});

// --- Pointer interaction ------------------------------------------------------
//   click / tap      drop a stone where you clicked
//   Shift + drag     stir: a continuous trail of small drops
//   drag             orbit (OrbitControls)
//
// A ring marker follows the cursor on the moving surface, showing where a
// drop will land and how big it is; it turns amber while Shift (stir) is held.
const canvas = renderer.domElement;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

const MARKER_IDLE = new THREE.Color(0xe8fbff);
const MARKER_STIR = new THREE.Color(0xffc46b);
const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.8, 1.0, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({
    color: MARKER_IDLE, transparent: true, opacity: 0.8,
    depthTest: false, depthWrite: false,
  }),
);
marker.renderOrder = 10;
marker.visible = false;
scene.add(marker);

const pointer = {
  x: 0, y: 0,
  over: false,          // a mouse is over the canvas
  shift: false,
  down: false, downX: 0, downY: 0, downTime: 0,
  orbiting: false,      // dragged far enough to count as an orbit
  stirring: false,
  lastStirUv: null,
};

function castFrom(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const hit = water.raycast(raycaster.ray);
  // Only where a drop will actually take (inside the ripple disc)
  return hit && ripples.contains(hit.uv.x, hit.uv.y) ? hit : null;
}

// Capture phase so this runs before OrbitControls sees the event and can
// switch the controls off for a stir (Shift+drag would otherwise pan).
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  Object.assign(pointer, {
    x: e.clientX, y: e.clientY, down: true, orbiting: false,
    downX: e.clientX, downY: e.clientY, downTime: performance.now(),
  });
  if (e.shiftKey && e.pointerType === 'mouse') {
    controls.enabled = false;
    pointer.stirring = true;
    pointer.lastStirUv = null;
    canvas.setPointerCapture(e.pointerId);
  }
}, { capture: true });

canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.over = e.pointerType === 'mouse';
  pointer.shift = e.shiftKey;
  if (pointer.down && !pointer.stirring &&
      Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) >= 6) {
    pointer.orbiting = true;
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (pointer.stirring) {
    pointer.stirring = false;
    controls.enabled = true;
  } else if (pointer.down && !pointer.orbiting &&
             performance.now() - pointer.downTime < 500) {
    // A click is a press that barely moved; anything else was an orbit drag.
    const hit = castFrom(e.clientX, e.clientY);
    if (hit) ripples.addDrop(hit.uv.x, hit.uv.y);
  }
  pointer.down = false;
  pointer.orbiting = false;
});

canvas.addEventListener('pointerleave', () => { pointer.over = false; });

// Right-click (press and release without dragging) opens a wormhole at the
// cursor. Right-drag still pans the camera.
const rightPress = { x: 0, y: 0, time: 0, active: false };
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return;
  Object.assign(rightPress, { x: e.clientX, y: e.clientY, time: performance.now(), active: true });
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 2 || !rightPress.active) return;
  rightPress.active = false;
  const moved = Math.hypot(e.clientX - rightPress.x, e.clientY - rightPress.y);
  if (moved < 6 && performance.now() - rightPress.time < 500) {
    const hit = castFrom(e.clientX, e.clientY);
    // the funnel is defined in undisplaced (base) coordinates
    if (hit) wormholes.open(hit.base.x, hit.base.y);
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') pointer.shift = true; });
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') pointer.shift = false; });
window.addEventListener('blur', () => { pointer.shift = false; });

/** Once per frame: hover marker, cursor, and stir drops from the latest pointer. */
function updatePointer() {
  const tracking = pointer.stirring || (pointer.over && !pointer.orbiting);
  const hit = tracking ? castFrom(pointer.x, pointer.y) : null;

  marker.visible = !!hit;
  if (hit) {
    marker.position.copy(hit.point);
    marker.scale.setScalar(ripples.params.dropRadius * 1.6);
    marker.material.color.copy(pointer.shift || pointer.stirring ? MARKER_STIR : MARKER_IDLE);
  }

  canvas.style.cursor =
    pointer.orbiting ? 'grabbing' :
    hit ? (pointer.shift || pointer.stirring ? 'cell' : 'crosshair') : 'grab';

  if (pointer.stirring && hit) {
    // Fill gaps on fast drags so the wake stays continuous.
    const strength = -0.25 * ripples.params.dropStrength;
    const spacing = (ripples.params.dropRadius / ripples.size) * 0.8;
    if (pointer.lastStirUv) {
      const gap = hit.uv.distanceTo(pointer.lastStirUv);
      const n = Math.min(Math.floor(gap / spacing), 6);
      for (let i = 1; i <= n; i++) {
        const p = pointer.lastStirUv.clone().lerp(hit.uv, i / (n + 1));
        ripples.addDrop(p.x, p.y, strength);
      }
    }
    ripples.addDrop(hit.uv.x, hit.uv.y, strength);
    pointer.lastStirUv = hit.uv;
  }
}

// --- Rain ---------------------------------------------------------------------
const RAIN_RATE = 12;  // drops per second (the disc is ~2× the old area)
let rainClock = 0;
function updateRain(dt) {
  if (!view.rain) return;
  rainClock += dt * RAIN_RATE;
  while (rainClock >= 1) {
    rainClock -= 1;
    // Uniform over the ripple disc (√ keeps the density even)
    const r = ripples.activeRadius * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    ripples.addDrop(
      0.5 + r * Math.cos(a),
      0.5 + r * Math.sin(a),
      -(0.15 + Math.random() * 0.3) * ripples.params.dropStrength,
      0.35 + Math.random() * 0.35,
    );
  }
}

// Console access for tweaking, e.g. demo.water.uniforms.uShininess.value = 400
window.demo = { scene, camera, controls, renderer, water, ripples, view, floaters, wormholes };

// --- Resize -----------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  reflection.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop -------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);          // pauses cleanly when the tab is hidden
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);   // clamp after stalls
  water.update(dt);
  updatePointer();
  updateRain(dt);
  wormholes.update(dt);
  floaters.update(dt);
  ripples.update(dt);
  water.setRipples(ripples);
  water.setShadowCasters(floaters.casters, view.objectShadows);
  controls.update();
  // Mirror pass first: the water samples it in the main render
  const reflect = view.objectReflections && floaters.settings.visible;
  if (reflect) reflection.render(scene, camera, floaters.floaters, [water.mesh, marker]);
  water.setObjectReflection(reflection.texture, reflection.viewProj, reflect);
  renderer.render(scene, camera);
});
