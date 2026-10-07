import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWater } from './water.js';

const SKY = 0x0b1a24;

// --- Renderer / scene / camera -------------------------------------------
const container = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 22, 55);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;   // keep the camera above the water
controls.minDistance = 5;
controls.maxDistance = 200;

// --- Water ------------------------------------------------------------------
const water = createWater({ size: 100, segments: 256, fogColor: SKY });
scene.add(water.mesh);

// --- HUD --------------------------------------------------------------------
const fmt = (n) => n.toLocaleString('en-US');
document.getElementById('hud-stats').textContent =
  `${water.segments}×${water.segments} segments · ${fmt(water.vertexCount)} verts · ${fmt(water.triangleCount)} tris`;

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
