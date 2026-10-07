import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWater } from './water.js';

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

// --- HUD --------------------------------------------------------------------
const fmt = (n) => n.toLocaleString('en-US');
document.getElementById('hud-stats').textContent =
  `${water.coreSegments}² core + horizon skirt · ${fmt(water.vertexCount)} verts`;

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
window.demo = { scene, camera, controls, renderer, water };

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
  controls.update();
  renderer.render(scene, camera);
});
