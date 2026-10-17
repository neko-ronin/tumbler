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
 * consequence for yaw is the whole reason this module exists. A world yaw θ
 * turns north toward east (counter-clockwise seen from above). In the scene,
 * north is −z and east is +x, so the same physical turn sends −z toward +x —
 * which is a **negative** rotation about scene +y. Hence:
 *
 *     instance.rotation.y = −yaw_deg
 *
 * Written out rather than left to be re-derived, because the opposite sign
 * mirrors every structure in the world about a vertical axis and still looks
 * like a world: nothing crashes, nothing warns, and the settlement faces the
 * wrong way. `tests/instance.test.mjs` pins this against the core's own
 * camera keyframes, which know the bearing of the valley.
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
 * The world's yaw in degrees, to the rotation about scene +y **in radians**.
 *
 * Radii are kept out of the caller's hands on purpose: three.js takes radians,
 * `placement.json` speaks degrees, and a value passed between them without one
 * named conversion is the oldest bug in 3D. This returns radians so there is
 * exactly one place the units change.
 */
export function toSceneYaw(yawDeg) {
  return (-(yawDeg ?? 0) * Math.PI) / 180;
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
 * The core authors the camera in world terms — yaw counter-clockwise from east
 * (so +yaw turns left), pitch negative to look down — and three.js's own
 * convention that a camera looks down −z is what makes the same numbers work
 * here. Both angles are converted from the core's degrees to the scene's
 * radians in one place each:
 *
 * | core writes | scene needs | why |
 * |---|---|---|
 * | yaw 62° at (−1600, −780, 150) | rotation.y = −62° | turning north toward east is a **negative** turn about +y, because north is scene −z |
 * | pitch −11° (nose down) | rotation.x = −11° | the east axis maps to itself, so the pitch keeps its sign and the world frame saw it already as nose-down |
 *
 * The yaw is the one that mirrors the world if it is got wrong: a settlement
 * would face the wrong way, nothing would crash, and only the valley's own
 * geometry would say so — which is why the test checks the pose against the
 * camera keyframes the core published rather than against this reasoning.
 */
export function cameraPose(keyframe) {
  const yaw = toSceneYaw(keyframe.yaw_deg ?? 0); // radians
  const pitch = ((keyframe.pitch_deg ?? 0) * Math.PI) / 180; // radians
  const pose = new Matrix4().makeRotationY(yaw).multiply(new Matrix4().makeRotationX(pitch));
  return pose.setPosition(toScene(keyframe.location_m));
}

/** Which way does this world yaw point, as a unit vector in the scene? */
export function yawForward(yawDeg) {
  const radians = (yawDeg * Math.PI) / 180;
  // World (sin, cos) is east/north; scene keeps east and flips north.
  return new Vector3(Math.sin(radians), 0, -Math.cos(radians));
}
