/** The meeting of the world frame and the scene frame.
 *
 *     node --test client/web/tests/world.test.mjs
 *
 * These are not fixtures. The keyframes are the repository's real
 * `worldmap.json: camera.keyframes`, so a sign error here is caught against the
 * core's own authored camera rather than against this file's opinion of it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Matrix4, Vector3 } from "../vendor/three.module.min.js";

import { cameraPose, instanceMatrix, toScene, toSceneYaw, yawForward } from "../src3d/world.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const worldmap = JSON.parse(readFileSync(join(REPO, "shared", "world", "worldmap.json"), "utf8"));
const placement = JSON.parse(readFileSync(join(REPO, "shared", "world", "out", "placement.json"), "utf8"));

// A direction, not a point: the translation must not ride along. This is a
// real distinction here and not a nicety -- applyMatrix4 on a direction
// returns the camera's own position, which is a vector 1,700 m long pointing
// nowhere near the valley. transformDirection drops the translation column.
const forward = (matrix) => new Vector3(0, 0, -1).transformDirection(matrix);

test("world axes are read, not assumed", () => {
  assert.equal(worldmap.axes.x, "east");
  assert.equal(worldmap.axes.y, "north");
  assert.equal(worldmap.axes.z, "up");
});

test("north is scene -z and east is scene +x east", () => {
  const north = toScene([0, 1, 0]);
  assert.deepEqual([north.x, north.y, north.z], [0, 0, -1]);
  const east = toScene([1, 0, 0]);
  assert.deepEqual([east.x, east.y, east.z], [1, 0, 0]);
  const up = toScene([0, 0, 1]);
  assert.deepEqual([up.x, up.y, up.z], [0, 1, 0]);
});

test("the mapping is a rotation, not a mirror", () => {
  // A mirror would flip every structure in the world and still look like a
  // world, so the property is checked directly: for a rotation R,
  // R(a) x R(b) = R(a x b). In the world frame east x up = -north, so in the
  // scene east x up must be -toScene(north) = +z. A mirror would give -z,
  // which is exactly the failure this rules out.
  const [ex, ny, up] = [toScene([1, 0, 0]), toScene([0, 1, 0]), toScene([0, 0, 1])];
  const cross = new Vector3().crossVectors(ex, up);
  const expected = new Vector3(-ny.x, -ny.y, -ny.z);
  assert.ok(cross.distanceTo(expected) < 1e-9, `east x up must be -north, got ${[cross.x, cross.y, cross.z]}`);
  assert.equal(cross.z, 1, "a mirror would put this at -1 and south-up everything");
});

test("the core's first camera keyframe looks down the valley", () => {
  const keyframe = worldmap.camera.keyframes[0];
  assert.equal(keyframe.t, 0);
  const matrix = cameraPose(keyframe);
  const direction = forward(matrix);
  // Closed form of R_y(toSceneYaw) · R_x(pitch) acting on a camera's own −z:
  //   (−sin φ · cos θ, sin θ · cos φ, −cos θ · cos φ),  φ = −yaw, θ = pitch
  // Both scene angles appear in all three components, so a flipped sign on
  // either, or degrees passed where radians are due, fails here.
  const phi = toSceneYaw(keyframe.yaw_deg);
  const theta = (keyframe.pitch_deg * Math.PI) / 180;
  const expected = new Vector3(-Math.sin(phi) * Math.cos(theta), Math.sin(theta), -Math.cos(phi) * Math.cos(theta));
  assert.ok(direction.distanceTo(expected) < 1e-9, `direction ${direction.toArray()} vs ${expected.toArray()}`);
  // The core's yaw is a turn from east: at 62 degrees most of the nose is
  // eastward, and with pitch -11 some of it is down.
  assert.ok(direction.x > 0.8, `x ${direction.x} should be mostly east`);
  assert.ok(direction.y < -0.1, `pitch ${keyframe.pitch_deg} should look down, y=${direction.y}`);
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-9, "a direction of length 1");
});

test("every camera keyframe keeps its own pitch, and it is always nose down", () => {
  for (const keyframe of worldmap.camera.keyframes) {
    const matrix = cameraPose(keyframe);
    const direction = forward(matrix);
    assert.ok(direction.y < 0, `t=${keyframe.t} pitch=${keyframe.pitch_deg}, y=${direction.y}`);
    // And against the closed form, so a degrees/radians slip at any keyframe
    // fails rather than silently aiming the camera somewhere plausible.
    const phi = toSceneYaw(keyframe.yaw_deg);
    const theta = (keyframe.pitch_deg * Math.PI) / 180;
    const expected = new Vector3(-Math.sin(phi) * Math.cos(theta), Math.sin(theta), -Math.cos(phi) * Math.cos(theta));
    assert.ok(direction.distanceTo(expected) < 1e-9, `t=${keyframe.t}: ${direction.toArray()} vs ${expected.toArray()}`);
  }
});

test("yaw zero faces north, which is scene -z", () => {
  const direction = yawForward(0);
  assert.ok(direction.distanceTo(new Vector3(0, 0, -1)) < 1e-9);
  // Yaw turns counter-clockwise from east in the world: at 90 degrees the
  // nose is due north... which in the scene is -z still rotated, so instead
  // check a turn toward east, the case that fails if the sign is flipped.
  const eastward = yawForward(90);
  assert.ok(eastward.x > 0.99 && Math.abs(eastward.z) < 1e-9, `${[eastward.x, eastward.z]}`);
});

test("toSceneYaw negates, and returns radians", () => {
  const deg = Math.PI / 180;
  assert.equal(toSceneYaw(62), -62 * deg);
  assert.equal(toSceneYaw(-90), 90 * deg);
  assert.equal(toSceneYaw(0) + 0, 0);
  // Degrees on the way in, radians on the way out: three.js takes radians and
  // placement.json speaks degrees, and this is the one place they meet.
  assert.ok(Math.abs(toSceneYaw(90) + Math.PI / 2) < 1e-12, "90 degrees world yaw is a quarter turn the other way");
});

test("an instance's position lands in scene metres, up on y", () => {
  const homestead = placement.instances.find((i) => i.kind === "homestead");
  assert.ok(homestead.ground_z_m, "the core publishes the ground height");
  const matrix = instanceMatrix(homestead.position_m, homestead.yaw_deg, homestead.scale);
  const position = new Vector3().setFromMatrixPosition(matrix);
  const [ex, ny, up] = homestead.position_m;
  assert.ok(Math.abs(position.x - ex) < 1e-9);
  assert.ok(Math.abs(position.y - up) < 1e-9, `scene y must be height, got ${position.y} for ${up}`);
  assert.ok(Math.abs(position.z + ny) < 1e-9, `scene z must be -north, got ${position.z} for ${ny}`);
  assert.ok(Math.abs(position.y - homestead.ground_z_m) < 1e-6, "the instance stands on the published ground");
});

test("a non-uniform scale is applied on the world's own axes", () => {
  const tower = placement.instances.find((i) => i.kind === "city_tower" && i.scale[2] !== i.scale[0]);
  assert.ok(tower, "the core places at least one tower stretched vertically");
  const matrix = instanceMatrix(tower.position_m, tower.yaw_deg, tower.scale);
  const origin = new Vector3().setFromMatrixPosition(matrix);
  const vertical = new Vector3(0, 1, 0).applyMatrix4(matrix).sub(origin);
  // The world stretches `z`, which is up; the scene's up is `y`. So the tower's
  // vertical in the scene is scaled by the world's z scale, and that is true
  // whatever the yaw: up is the yaw's own axis. This was wrong once and it
  // stretched a tower sideways instead of up.
  assert.ok(Math.abs(vertical.y - tower.scale[2]) < 1e-6, `vertical must keep the world's z scale, got ${vertical.y} for ${tower.scale[2]}`);
  assert.ok(vertical.length() - tower.scale[2] < 1e-6, "up must not be bent by the yaw");

  // Horizontally, the instance's own east axis is turned by the yaw, so the
  // east scale is checked against the yaw-rotated axis rather than against the
  // scene's +x. World x is east, scene x is east, and north flips sign, so a
  // positive world yaw turns the asset's east toward north = scene −z.
  const east = new Vector3(1, 0, 0).applyMatrix4(matrix).sub(origin);
  const expected = new Vector3(Math.cos(toSceneYaw(tower.yaw_deg)), 0, -Math.sin(toSceneYaw(tower.yaw_deg))).multiplyScalar(
    tower.scale[0]
  );
  assert.ok(east.distanceTo(expected) < 1e-6, `east axis: ${east.toArray()} vs ${expected.toArray()}`);
});

test("a world_space instance is placed at its authored coordinates, not twice", () => {
  const river = placement.instances.find((i) => i.tags?.includes("world_space"));
  assert.ok(river, "the core tags at least one instance world_space");
  const matrix = instanceMatrix(river.position_m, river.yaw_deg, river.scale, null, true);
  const position = new Vector3().setFromMatrixPosition(matrix);
  // The mesh already stands at y=20 in the world; translating it by its own
  // position_m would float the river at 40.
  for (const axis of ["x", "y", "z"]) assert.equal(Math.abs(position[axis]), 0);
});

test("a named part carries its own local matrix", () => {
  const local = new Matrix4().makeTranslation(0, 90, 5);
  const turbine = placement.instances.find((i) => i.kind === "turbine");
  const matrix = instanceMatrix(turbine.position_m, turbine.yaw_deg, turbine.scale, local);
  const position = new Vector3().setFromMatrixPosition(matrix);
  // The rotor sits 90 m up and 5 m along the authored forward; the instance
  // then yaws it into the world.
  assert.ok(position.y - turbine.position_m[2] > 80, `rotor should clear the tower head, got ${position.y}`);
});
