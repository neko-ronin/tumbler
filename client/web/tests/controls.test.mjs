import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera } from "../vendor/three.module.min.js";
import { createOrbitControls } from "../src3d/controls.js";

test("orbit controls leave the camera stationary until input arrives", () => {
  // Only the DOM boundary is substituted; camera and spherical math are Three.js.
  const previousDocument = globalThis.document;
  globalThis.document = new EventTarget();
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const previousCanvas = globalThis.HTMLCanvasElement;
  class Canvas extends EventTarget {}
  globalThis.HTMLCanvasElement = Canvas;
  try {
    const canvas = new Canvas();
    canvas.clientHeight = 900;
    const camera = new PerspectiveCamera();
    camera.position.set(-1600, 200, -780);
    const initial = camera.position.clone();
    const controls = createOrbitControls(camera, canvas);
    for (let frame = 0; frame < 60; frame += 1) controls.update();
    assert.ok(camera.position.distanceTo(initial) < 1e-9, "an idle camera must not drift or zoom");

    const wheel = new Event("wheel", { cancelable: true });
    wheel.deltaY = 120;
    canvas.dispatchEvent(wheel);
    controls.update();
    assert.ok(camera.position.distanceTo(initial) > 0.1, "wheel input must still move the camera");
    controls.setTarget(0, 0, 0);
    const startTarget = controls.getTarget();
    const down = new Event('mousedown'); Object.assign(down, {button:2,clientX:300,clientY:300}); canvas.dispatchEvent(down);
    const move = new Event('mousemove'); Object.assign(move, {clientX:450,clientY:300}); document.dispatchEvent(move);
    document.dispatchEvent(new Event('mouseup')); controls.update();
    assert.ok(controls.getTarget().distanceTo(startTarget)>1, 'right drag must pan at a usable speed');
    controls.setTarget(0, 0, 0); const reset = camera.position.clone();
    for(let i=0;i<60;i++) controls.update();
    assert.ok(camera.position.distanceTo(reset)<1e-8, 'bookmark reset clears residual input');
    camera.position.set(-672,73.8391,-442);
    const upwardBookmark=camera.position.clone();
    controls.setTarget(-696,89.8391,-472);
    for(let i=0;i<60;i++)controls.update();
    assert.ok(camera.position.distanceTo(upwardBookmark)<1e-8,'the village bookmark must retain its upward viewing angle');
    controls.dispose();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousCanvas === undefined) delete globalThis.HTMLCanvasElement;
    else globalThis.HTMLCanvasElement = previousCanvas;
  }
});
