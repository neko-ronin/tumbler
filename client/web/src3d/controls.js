/** Simple orbit controls for the 3D scene.
 *
 * No external dependencies beyond three.js. The controls are deliberately
 * minimal: they do not pretend to be OrbitControls.js, and they refuse to
 * guess at anything. The signature is one function that returns an object
 * with `update()` and `dispose()`.
 *
 * The camera orbits a target point. Left drag rotates, right/middle drag pans, wheel
 * zooms. The controls are not a full substitute for three's OrbitControls, but
 * they are small, auditable, and do exactly what this scene needs.
 */

import { EventDispatcher, Spherical, Vector2, Vector3 } from "../vendor/three.module.min.js";

/** Create orbit controls bound to a camera and a canvas. */
export function createOrbitControls(camera, canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Controls require a valid canvas element");
  }
  const scope = new EventDispatcher();

  // Internal state
  const target = new Vector3();
  const spherical = new Spherical();
  const sphericalDelta = new Spherical(0, 0, 0);
  const panOffset = new Vector3();
  const rotateStart = new Vector2();
  const rotateEnd = new Vector2();
  const rotateDelta = new Vector2();
  const panStart = new Vector2();
  const panEnd = new Vector2();
  const panDelta = new Vector2();
  const dollyStart = new Vector2();
  const dollyEnd = new Vector2();
  const dollyDelta = new Vector2();

  let enabled = true;
  let state = -1;
  const STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2 };

  // Configurable limits
  const minDistance = 5;
  const maxDistance = 12000;
  const minPolarAngle = 0;
  const maxPolarAngle = Math.PI - 0.01; // allow looking up into the village; avoid the pole
  const enableDamping = true;
  const dampingFactor = 0.05;
  const enablePan = true;
  const panSpeed = 1.0;
  const rotateSpeed = 1.0;
  const zoomSpeed = 1.0;

  function getZoomScale() {
    return Math.pow(0.95, -sphericalDelta.radius * (enableDamping ? dampingFactor : 1));
  }

  const offset = new Vector3();
  function update() {
    if (!enabled) return;
    offset.subVectors(camera.position, target);

    // In spherical coordinates
    spherical.setFromVector3(offset);

    // Apply rotation
    spherical.theta += sphericalDelta.theta * (enableDamping ? dampingFactor : 1);
    spherical.phi += sphericalDelta.phi * (enableDamping ? dampingFactor : 1);

    // Clamp
    spherical.theta = Math.max(-Infinity, Math.min(Infinity, spherical.theta));
    spherical.phi = Math.max(minPolarAngle, Math.min(maxPolarAngle, spherical.phi));
    spherical.makeSafe();

    // Apply zoom
    spherical.radius *= getZoomScale();
    spherical.radius = Math.max(minDistance, Math.min(maxDistance, spherical.radius));

    // Apply pan
    target.addScaledVector(panOffset, enableDamping ? dampingFactor : 1);

    // Update camera
    offset.setFromSpherical(spherical);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);

    // Damping
    if (enableDamping) {
      sphericalDelta.theta *= 1 - dampingFactor;
      sphericalDelta.phi *= 1 - dampingFactor;
      sphericalDelta.radius *= 1 - dampingFactor;
      panOffset.multiplyScalar(1 - dampingFactor);
    } else {
      sphericalDelta.set(0, 0, 0);
      panOffset.set(0, 0, 0);
    }

    return true;
  }

  function handleMouseDown(event) {
    if (!enabled) return;
    if (event.button === 0 && !event.ctrlKey && !event.shiftKey) {
      // Left click: rotate
      state = STATE.ROTATE;
      rotateStart.set(event.clientX, event.clientY);
    } else if (event.button === 1 || event.button === 2 || (event.button === 0 && (event.ctrlKey || event.shiftKey))) {
      // Middle click (or ctrl+left): pan
      state = STATE.PAN;
      panStart.set(event.clientX, event.clientY);
    } else if (event.button === 2) {
      // Right click: dolly
      state = STATE.DOLLY;
      dollyStart.set(event.clientX, event.clientY);
    }
    if (state !== STATE.NONE) {
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      scope.dispatchEvent({ type: "start" });
    }
  }

  function handleMouseWheel(event) {
    if (!enabled) return;
    event.preventDefault();
    if (event.deltaY < 0) {
      sphericalDelta.radius -= 1.2 * zoomSpeed;
    } else if (event.deltaY > 0) {
      sphericalDelta.radius += 1.2 * zoomSpeed;
    }
    scope.dispatchEvent({ type: "change" });
  }

  function onMouseMove(event) {
    if (!enabled) return;
    if (state === STATE.ROTATE) {
      rotateEnd.set(event.clientX, event.clientY);
      rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(rotateSpeed * 0.005);
      sphericalDelta.theta -= rotateDelta.x;
      sphericalDelta.phi -= rotateDelta.y;
      rotateStart.copy(rotateEnd);
    } else if (state === STATE.DOLLY) {
      dollyEnd.set(event.clientX, event.clientY);
      dollyDelta.subVectors(dollyEnd, dollyStart);
      if (dollyDelta.y > 0) sphericalDelta.radius += 0.02 * zoomSpeed;
      else if (dollyDelta.y < 0) sphericalDelta.radius -= 0.02 * zoomSpeed;
      dollyStart.copy(dollyEnd);
    } else if (state === STATE.PAN && enablePan) {
      panEnd.set(event.clientX, event.clientY);
      panDelta.subVectors(panEnd, panStart).multiplyScalar(panSpeed);
      pan(panDelta.x, panDelta.y);
      panStart.copy(panEnd);
    }
    scope.dispatchEvent({ type: "change" });
  }

  function onMouseUp() {
    if (state !== STATE.NONE) {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      state = STATE.NONE;
      scope.dispatchEvent({ type: "end" });
    }
  }

  function pan(deltaX, deltaY) {
    const offset = new Vector3().subVectors(camera.position, target);
    const distance = offset.length();
    const fov = camera.fov * (Math.PI / 180);
    const targetDistance = distance * Math.tan(fov / 2);
    const panLeft = new Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar(-2 * deltaX * targetDistance / canvas.clientHeight);
    const panUp = new Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(2 * deltaY * targetDistance / canvas.clientHeight);
    panOffset.add(panLeft).add(panUp);
  }

  function handleTouchStart(event) {
    if (!enabled) return;
    if (event.touches.length === 1) {
      state = STATE.ROTATE;
      rotateStart.set(event.touches[0].clientX, event.touches[0].clientY);
    } else if (event.touches.length === 2) {
      state = STATE.DOLLY;
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      dollyStart.set(0, Math.sqrt(dx * dx + dy * dy));
    } else if (event.touches.length === 3) {
      state = STATE.PAN;
      panStart.set(event.touches[0].clientX, event.touches[0].clientY);
    }
    if (state !== STATE.NONE) scope.dispatchEvent({ type: "start" });
  }

  function handleTouchMove(event) {
    if (!enabled) return;
    if (event.touches.length === 1 && state === STATE.ROTATE) {
      rotateEnd.set(event.touches[0].clientX, event.touches[0].clientY);
      rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(rotateSpeed * 0.005);
      sphericalDelta.theta -= rotateDelta.x;
      sphericalDelta.phi -= rotateDelta.y;
      rotateStart.copy(rotateEnd);
    } else if (event.touches.length === 2 && state === STATE.DOLLY) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      dollyEnd.set(0, Math.sqrt(dx * dx + dy * dy));
      const dist = dollyEnd.y - dollyStart.y;
      sphericalDelta.radius += Math.max(-4, Math.min(4, dist * .1)) * zoomSpeed;
      dollyStart.copy(dollyEnd);
    } else if (event.touches.length === 3 && state === STATE.PAN && enablePan) {
      panEnd.set(event.touches[0].clientX, event.touches[0].clientY);
      panDelta.subVectors(panEnd, panStart).multiplyScalar(panSpeed);
      pan(panDelta.x, panDelta.y);
      panStart.copy(panEnd);
    }
    scope.dispatchEvent({ type: "change" });
  }

  function handleTouchEnd() {
    if (state !== STATE.NONE) {
      state = STATE.NONE;
      scope.dispatchEvent({ type: "end" });
    }
  }

  function handleContextMenu(event) {
    event.preventDefault();
  }

  function setTarget(x, y, z) {
    target.set(x, y, z);
    sphericalDelta.set(0, 0, 0); panOffset.set(0, 0, 0);
  }

  function getTarget() {
    return target.clone();
  }

  // Attach listeners
  window.addEventListener("blur", onMouseUp);
  canvas.addEventListener("mousedown", handleMouseDown);
  canvas.addEventListener("wheel", handleMouseWheel, { passive: false });
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleTouchEnd);
  canvas.addEventListener("contextmenu", handleContextMenu);

  // Initialize spherical from current camera
  offset.subVectors(camera.position, target);
  spherical.setFromVector3(offset);

  return {
    update,
    get enabled() { return enabled; },
    set enabled(value) { enabled = value; onMouseUp(); sphericalDelta.set(0,0,0); panOffset.set(0,0,0); },
    dispose() {
      window.removeEventListener("blur", onMouseUp);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("wheel", handleMouseWheel);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    },
    setTarget,
    getTarget,
    get spherical() { return spherical; },
    get target() { return target; },
  };
}
