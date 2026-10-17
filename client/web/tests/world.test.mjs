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

import { cameraPose, instanceMatrix, toScene, toSceneYaw } from "../src3d/world.js";

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

// The camera convention's own vector, in the scene: yaw counter-clockwise from
// east, pitch below the horizon, then (east, up, -north).
const declared = (keyframe) => {
  const yaw = (keyframe.yaw_deg * Math.PI) / 180, pitch = (keyframe.pitch_deg * Math.PI) / 180;
  return new Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.sin(yaw) * Math.cos(pitch));
};

test("the core's first camera keyframe looks across the valley toward the north", () => {
  const keyframe = worldmap.camera.keyframes[0];
  assert.equal(keyframe.t, 0);
  assert.match(worldmap.camera.yaw_convention, /counter-clockwise from \+X \(east\)/);
  const direction = forward(cameraPose(keyframe));
  assert.ok(direction.distanceTo(declared(keyframe)) < 1e-9, `direction ${direction.toArray()} vs ${declared(keyframe).toArray()}`);
  // Yaw 72 is past 45, so more of the view is north (scene -z) than east.
  assert.ok(-direction.z > direction.x && direction.x > 0, `${direction.toArray()} should be north-north-east`);
  assert.ok(direction.y < -0.1, `pitch ${keyframe.pitch_deg} should look down, y=${direction.y}`);
});

test("every camera keyframe keeps its own pitch and yaw", () => {
  for (const keyframe of worldmap.camera.keyframes) {
    const direction = forward(cameraPose(keyframe));
    assert.ok(direction.y < 0, `t=${keyframe.t} pitch=${keyframe.pitch_deg}, y=${direction.y}`);
    assert.ok(direction.distanceTo(declared(keyframe)) < 1e-9, `t=${keyframe.t}: ${direction.toArray()} vs ${declared(keyframe).toArray()}`);
  }
});

test("toSceneYaw keeps the sign, and returns radians", () => {
  const deg = Math.PI / 180;
  assert.equal(toSceneYaw(62), 62 * deg);
  assert.equal(toSceneYaw(-90), -90 * deg);
  assert.equal(toSceneYaw(0) + 0, 0);
  // World yaw 90 turns the asset's east (+X) to north, which is scene -z.
  const east = new Vector3(1, 0, 0).transformDirection(instanceMatrix([0, 0, 0], 90, null));
  assert.ok(east.distanceTo(new Vector3(0, 0, -1)) < 1e-12, `${east.toArray()}`);
});

test("every turbine and blimp is drawn facing the bearing the core gives it", () => {
  // The authored nose is glTF +Z for both; the core states where it must point.
  const faced = placement.instances.filter((i) => i.facing_bearing_deg !== null && i.facing_bearing_deg !== undefined);
  assert.ok(faced.some((i) => i.kind === "turbine") && faced.some((i) => i.kind === "blimp"));
  for (const instance of faced) {
    const nose = new Vector3(0, 0, 1).transformDirection(instanceMatrix(instance.position_m, instance.yaw_deg, instance.scale));
    const bearing = ((Math.atan2(nose.x, -nose.z) * 180) / Math.PI + 360) % 360;
    const off = Math.abs(((bearing - instance.facing_bearing_deg + 540) % 360) - 180);
    assert.ok(off < 1e-6, `${instance.kind} ${instance.tags[0]} drawn facing ${bearing.toFixed(2)}, core says ${instance.facing_bearing_deg}`);
  }
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
