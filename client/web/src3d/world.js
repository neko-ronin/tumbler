/** The world frame, the glTF frame, and the one transform between them.
 *
 * The core's placement.json speaks the world's own frame: **x east, y north,
 * z up, metres, yaw degrees counter-clockwise** (from `worldmap.json:axes` and
 * `placement.json:frame`). Three.js, like every glTF engine, is right-handed
 * with **y up**, so a camera looks down −z. The two frames meet exactly once,
 * here, and every other module in this client speaks one of them.
 *
 * ## The mapping, and the sign that follows from it
 *
 *     world (x east, y north, z up)  →  scene (x east, y up, z south)
 *     scene_x = world_x
 *     scene_y = world_z
 *     scene_z = −world_y
 *
 * Its determinant is +1, so it is a rotation and not a mirror: the north axis
 * becomes scene −z, which is *toward* a default three.js camera. The
 * consequence for yaw is the whole reason this module exists. A world yaw θ is
 * counter-clockwise seen from above: it turns east toward north. In the scene
 * east is +x and north is −z, and a **positive** rotation about scene +y sends
 * +x toward −z, the same physical turn. A rotation keeps the sense of every
 * turn, so:
 *
 *     instance.rotation.y = +yaw_deg
 *
 * Written out rather than left to be re-derived, because the opposite sign
 * mirrors every facing about the north-south line and still looks like a
 * world: nothing crashes, nothing warns. This file once negated it, and every
 * turbine and blimp the core points into a 245° wind faced 115°.
 * `tests/world.test.mjs` pins it against the core's own `facing_bearing_deg`.
 *
 * What is *not* here: the world→Unreal conversion (`AGENTS.md` /
 * `placement.json:frame` records that Unreal mirrors y and negates yaw,
 * because Unreal is left-handed). This client is right-handed, so it keeps the
 * sign and never mirrors.
 */

import { Matrix4, Quaternion, Vector3 } from "../vendor/three.module.min.js";

/**
 * World metres to scene metres: (x, y, z) → (x, z, −y).
 *
 * A signed zero is normalised away, because `-0` prints as −0 in a log and
 * compares unequal to `0` in a test while meaning precisely the same position.
 */
export function toScene([x, y, z]) {
  const north = y ?? 0;
  return new Vector3(x ?? 0, z ?? 0, north === 0 ? 0 : -north);
}

/**
 * The world's yaw in degrees, to the rotation about scene +y **in radians**, sign kept.
 *
 * Radii are kept out of the caller's hands on purpose: three.js takes radians,
 * `placement.json` speaks degrees, and a value passed between them without one
 * named conversion is the oldest bug in 3D. This returns radians so there is
 * exactly one place the units change.
 */
export function toSceneYaw(yawDeg) {
  return ((yawDeg ?? 0) * Math.PI) / 180;
}

/**
 * The matrix that places one instance.
 *
 * `positionM` and `scale` are read straight from `placement.json` and are
 * **non-uniform for some kinds** — the city tower and the hardstanding both
 * carry one — so the scale is applied as a matrix and never assumed equal on
 * all three axes. The scale is also in the *world's* axes, where up is `z`, so
 * world (x, y, z) becomes scene (x, z, y) before it is applied; getting that
 * wrong would stretch a tower sideways by 1.44 and nothing would look wrong
 * until someone measured. `local` is the asset-internal matrix of the named
 * part being placed — the rotor a turbine carries at [0, 90, 5] — so a caller
 * can instance a part without walking the asset's node tree per instance.
 *
 * `worldSpace` places an asset at its authored coordinates with no transform
 * at all: the river and the lake arrive as meshes already standing in the
 * world, tagged `world_space` by the core for exactly that reason, and
 * translating them by their own `position_m` would float them twice as high.
 */
export function instanceMatrix(positionM, yawDeg, scale, local = null, worldSpace = false) {
  if (worldSpace) {
    const identity = new Matrix4();
    return local ? identity.multiply(local) : identity;
  }
  const position = toScene(positionM);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), toSceneYaw(yawDeg));
  const matrix = new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
  if (scale) {
    // World axes to scene axes: up is z in the world and y in the scene, so the
    // world's vertical scale is the scene's vertical scale and the two
    // horizontal ones keep their east/north order (north in, south out).
    const [sx, sy, sz] = [scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1];
    if (sx !== 1 || sy !== 1 || sz !== 1) matrix.scale(new Vector3(sx, sz, sy));
  }
  if (local) matrix.multiply(local);
  return matrix;
}

/**
 * The core's camera pose, as a scene matrix.
 *
 * The core authors the camera in world terms (`camera.yaw_convention`): yaw
 * counter-clockwise from east, so 90 looks north, and pitch negative to look
 * down. A three.js camera at rest looks down −z, which is world north, yaw 90:
 *
 * | core writes | scene needs | why |
 * |---|---|---|
 * | yaw 72° | rotation.y = 72° − 90° | the yaw keeps its sign (see `toSceneYaw`), less the rest camera's own 90° |
 * | pitch −12° (nose down) | rotation.x = −12° | applied before the yaw, about the camera's own x, so it keeps its sign |
 *
 * The test checks the pose against the convention's own vector, not against
 * this reasoning.
 */
export function cameraPose(keyframe) {
  const yaw = toSceneYaw(keyframe.yaw_deg ?? 0); // radians
  const pitch = ((keyframe.pitch_deg ?? 0) * Math.PI) / 180; // radians
  const pose = new Matrix4().makeRotationY(yaw - Math.PI / 2).multiply(new Matrix4().makeRotationX(pitch));
  return pose.setPosition(toScene(keyframe.location_m));
}
