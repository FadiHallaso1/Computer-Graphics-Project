import * as THREE from 'three';

/**
 * Planar reflection of the floating objects.
 *
 * A mirror camera (the main camera reflected through the plane y = 0)
 * renders ONLY the floating objects into a half-resolution target with a
 * transparent background. The water shader projects each fragment through
 * the same mirror camera to find its reflection, and blends it over the
 * skybox reflection by the target's alpha (see water.frag.js).
 *
 * The water is not flat, so a single mirror plane at y = 0 would put a
 * reflection 2h away from an object riding a crest of height h. Instead,
 * for this pass each object is lowered by its own local water level, so its
 * waterline sits exactly on y = 0. A clip plane at y = 0 removes the
 * submerged part, which would otherwise show up in the reflection.
 */
export function createObjectReflection(renderer, { scale = 0.5 } = {}) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,     // linear values, alpha = coverage
    depthBuffer: true,
  });
  const mirrorCamera = new THREE.PerspectiveCamera();
  const viewProj = new THREE.Matrix4();
  const keepAbove = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];   // keeps y ≥ 0
  const dir = new THREE.Vector3();
  const clearColor = new THREE.Color();

  function setSize(width, height) {
    const pr = renderer.getPixelRatio();
    target.setSize(
      Math.max(1, Math.floor(width * pr * scale)),
      Math.max(1, Math.floor(height * pr * scale)),
    );
  }

  /**
   * scene      the full scene
   * camera     the main camera
   * floaters   objects with .group and .waterLevel
   * hidden     other objects to hide for the pass (water, cursor marker, ...)
   */
  function render(scene, camera, floaters, hidden) {
    // Mirror the camera through y = 0
    mirrorCamera.copy(camera);
    mirrorCamera.position.y = -camera.position.y;
    camera.getWorldDirection(dir);
    dir.y = -dir.y;
    mirrorCamera.up.set(0, 1, 0);
    mirrorCamera.lookAt(mirrorCamera.position.clone().add(dir));
    mirrorCamera.updateMatrixWorld();
    viewProj.multiplyMatrices(mirrorCamera.projectionMatrix, mirrorCamera.matrixWorldInverse);

    // Put each object's waterline on the mirror plane
    for (const f of floaters) f.group.position.y -= f.waterLevel;
    const wasVisible = hidden.map((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    const background = scene.background;
    scene.background = null;

    const prevTarget = renderer.getRenderTarget();
    const prevClip = renderer.clippingPlanes;
    renderer.getClearColor(clearColor);
    const prevAlpha = renderer.getClearAlpha();

    renderer.clippingPlanes = keepAbove;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, mirrorCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.clippingPlanes = prevClip;
    renderer.setClearColor(clearColor, prevAlpha);
    scene.background = background;
    hidden.forEach((o, i) => { o.visible = wasVisible[i]; });
    for (const f of floaters) f.group.position.y += f.waterLevel;
  }

  return {
    texture: target.texture,
    viewProj,
    setSize,
    render,
  };
}
