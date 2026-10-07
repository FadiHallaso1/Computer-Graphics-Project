import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWater } from './water.js';
import { createRipples } from './ripples.js';

// Direction toward the sun disc in the Bridge2 skybox (measured from the
// brightest region of posz.jpg, x mirrored to match Three's cubemap
// convention). The specular glint uses the same vector.
const SUN_DIR = new THREE.Vector3(0.154, 0.161, 0.975).normalize();

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

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 6000);
// Default view looks toward the low sun, so the glint path is in frame.
camera.position.set(-6, 12, -46);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 4);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;   // keep the camera above the water
controls.minDistance = 5;
controls.maxDistance = 200;

// --- Water ------------------------------------------------------------------
const water = createWater({ sunDir: SUN_DIR });
water.setEnvMap(envMap);
scene.add(water.mesh);

// --- Ripples ----------------------------------------------------------------
// The simulation texture covers exactly the water's dense core.
const ripples = createRipples(renderer, { resolution: 512, size: water.coreSize });
water.setRipples(ripples);

// --- Pointer interaction ------------------------------------------------------
//   click / tap      drop a stone where you clicked
//   Shift + drag     stir: a continuous trail of small drops
//   drag             orbit (OrbitControls), as before
const canvas = renderer.domElement;
canvas.style.cursor = 'crosshair';
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function hitFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  return water.raycast(raycaster.ray);
}

const press = { x: 0, y: 0, time: 0, active: false };
const stir = { active: false, pending: null, lastUv: null };

// Capture phase so this runs before OrbitControls sees the event and can
// switch the controls off for a stir (Shift+drag would otherwise pan).
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  press.x = e.clientX; press.y = e.clientY; press.time = performance.now();
  press.active = true;
  if (e.shiftKey) {
    controls.enabled = false;
    stir.active = true;
    stir.pending = e;
    stir.lastUv = null;
    canvas.setPointerCapture(e.pointerId);
  }
}, { capture: true });

canvas.addEventListener('pointermove', (e) => {
  if (stir.active) stir.pending = e;   // processed once per frame
});

canvas.addEventListener('pointerup', (e) => {
  if (stir.active) {
    stir.active = false;
    stir.pending = null;
    controls.enabled = true;
  } else if (press.active) {
    // A click is a press that barely moved; anything else was an orbit drag.
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved < 6 && performance.now() - press.time < 500) {
      const hit = hitFromEvent(e);
      if (hit) ripples.addDrop(hit.uv.x, hit.uv.y);
    }
  }
  press.active = false;
});

/** Turn the latest stir position into drops, filling gaps along fast drags. */
function processStir() {
  if (!stir.active || !stir.pending) return;
  const hit = hitFromEvent(stir.pending);
  stir.pending = null;
  if (!hit) return;
  const strength = -0.12;
  const spacing = (ripples.params.dropRadius / water.coreSize) * 0.8;
  if (stir.lastUv) {
    const gap = hit.uv.distanceTo(stir.lastUv);
    const n = Math.min(Math.floor(gap / spacing), 6);
    for (let i = 1; i <= n; i++) {
      const p = stir.lastUv.clone().lerp(hit.uv, i / (n + 1));
      ripples.addDrop(p.x, p.y, strength);
    }
  }
  ripples.addDrop(hit.uv.x, hit.uv.y, strength);
  stir.lastUv = hit.uv;
}

// --- HUD --------------------------------------------------------------------
const fmt = (n) => n.toLocaleString('en-US');
document.getElementById('hud-stats').textContent =
  `${fmt(water.vertexCount)} verts · ripple grid ${ripples.resolution}²`;

/** A HUD toggle button bound to a key. */
function bindToggle(buttonId, key, apply) {
  const btn = document.getElementById(buttonId);
  let on = false;
  const toggle = () => {
    on = !on;
    apply(on);
    btn.setAttribute('aria-pressed', String(on));
  };
  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key.toLowerCase() === key) toggle();
  });
}
bindToggle('btn-wire', 'w', (on) => water.setWireframe(on));
bindToggle('btn-normals', 'n', (on) => water.setShowNormals(on));

// Console access for tweaking, e.g. demo.water.uniforms.uShininess.value = 400
window.demo = { scene, camera, controls, renderer, water, ripples };

// --- Resize -----------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop -------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);          // pauses cleanly when the tab is hidden
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);   // clamp after stalls
  water.update(dt);
  processStir();
  ripples.update(dt);
  water.setRipples(ripples);
  controls.update();
  renderer.render(scene, camera);
});
