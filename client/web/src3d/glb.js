/** A GLB reader for the assets this repository's core writes.
 *
 * This is deliberately not a glTF loader. It is a reader for exactly what
 * `shared/terrain/gltf.py` emits — verified against all 63 committed `.glb`
 * files before it was written — and it **refuses anything else rather than
 * guessing at it**. That refusal is the feature: the alternative is a second,
 * hand-maintained subset of glTF 2.0, which is a second thing to get wrong.
 *
 * ## What the core's assets actually are
 *
 * | property | the committed value |
 * |---|---|
 * | container | GLB 2.0, JSON chunk then BIN chunk, one buffer |
 * | nodes | named, a shallow tree, `translation`/`scale` sometimes set |
 * | meshes | one mesh per asset or per world-space part, several primitives per mesh |
 * | attributes | `POSITION`, `NORMAL` float32; `TEXCOORD_0` float32 or normalized uint16; tightly packed |
 * | indices | uint16 or uint32, `TRIANGLES` only |
 * | materials | `pbrMetallicRoughness`, base colour/roughness, double-sided, OPAQUE/MASK/BLEND; embedded PNGs on the blimp and generated redwood sprays |
 * | animation | node translation/rotation/scale, LINEAR or STEP; inverse-bind skeletons and four-influence skin attributes |
 * | colours | RGB/RGBA vertex colours, including normalized integer storage |
 * | not used | morph targets, sparse accessors, interleaved buffer views, extensions, TEXCOORD_1, KHR_* |
 *
 * ## Why it returns primitives rather than a scene
 *
 * A caller placing 17,208 redwoods cannot draw them as 17,208 `Group`s; it
 * needs one geometry per asset so it can build an `InstancedMesh`. So the
 * parser hands back (a) the node hierarchy for the assets that are few enough
 * to draw individually, and (b) a flat list of primitives with the cumulative
 * local matrix of the node they came from, so merging and instancing are the
 * caller's business and are visible to it.
 *
 * ## Vertices as written, with no conversion
 *
 * The assets are authored in the world's own frame (metres, x east, y north,
 * z up) and the core's writer maps that to glTF's Y-up at write time, so
 * `terrain.glb` carries its heights in `y` and the block's own coordinates in
 * `x`/`z`. A client must apply no rotation to the geometry it reads here; the
 * instance transform is the only place the two frames meet, and that meeting
 * is `instanceMatrix` in `placements.js`.
 */

import { toonMaterial } from "./style.js";

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  Vector3,
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  InterpolateDiscrete,
  InterpolateLinear,
  Bone,
  Skeleton,
  SkinnedMesh,
  RepeatWrapping,
  ClampToEdgeWrapping,
  MirroredRepeatWrapping,
} from "../vendor/three.module.min.js";

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const TRIANGLES = 4;

const COMPONENT = {
  5120: { array: Int8Array, bytes: 1 },
  5121: { array: Uint8Array, bytes: 1 },
  5122: { array: Int16Array, bytes: 2 },
  5123: { array: Uint16Array, bytes: 2 },
  5125: { array: Uint32Array, bytes: 4 },
  5126: { array: Float32Array, bytes: 4 },
};

const NUMERIC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const ATTRIBUTES = new Set(["POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0", "JOINTS_0", "WEIGHTS_0"]);

class GLBError extends Error {}

function refuse(message) {
  throw new GLBError(message);
}

/**
 * An ArrayBuffer, from whatever the caller actually has.
 *
 * `fetch` hands back an ArrayBuffer and `fs` hands back a Buffer that is a
 * *view into a shared pool*, so `buffer.buffer` is not the file — it is the
 * pool, and the file starts wherever `.byteOffset` happens to be. Copying the
 * exact bytes is the only correct handling, and it is done here once rather
 * than at every call site, where it is a trap in each.
 */
function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    return copy.buffer;
  }
  if (typeof SharedArrayBuffer !== "undefined" && input instanceof SharedArrayBuffer) return input;
  refuse(`expected an ArrayBuffer or a view of one, got ${Object.prototype.toString.call(input)}`);
}

/** The whole container, checked before a single byte of geometry is read. */
function readContainer(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) refuse(`expected an ArrayBuffer, got ${Object.prototype.toString.call(arrayBuffer)}`);
  if (arrayBuffer.byteLength < 20) refuse(`the buffer is ${arrayBuffer.byteLength} bytes, shorter than a GLB header`);
  const header = new DataView(arrayBuffer);
  if (header.getUint32(0, true) !== MAGIC) refuse("not a GLB file: the magic is not 'glTF'");
  const version = header.getUint32(4, true);
  if (version !== 2) refuse(`this reader is written for GLB 2.0, and this file declares version ${version}`);
  if (header.getUint32(8, true) > arrayBuffer.byteLength) refuse("the header declares a file longer than the buffer it arrived in");

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= arrayBuffer.byteLength) {
    const length = header.getUint32(offset, true);
    const type = header.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > arrayBuffer.byteLength) refuse("a chunk declares more bytes than the file holds");
    if (type === CHUNK_JSON) {
      if (json) refuse("a second JSON chunk: a GLB has exactly one");
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, length)));
    } else if (type === CHUNK_BIN) {
      if (bin) refuse("a second BIN chunk: a GLB has exactly one");
      bin = arrayBuffer.slice(start, start + length);
    } else {
      refuse(`unknown chunk type 0x${type.toString(16)}`);
    }
    offset = start + length;
  }
  if (!json) refuse("this GLB has no JSON chunk");
  if (!json.asset) refuse("the JSON chunk declares no asset");
  if (String(json.asset.version ?? "") !== "2.0") refuse(`glTF asset version ${json.asset.version}, expected 2.0`);
  if (!Array.isArray(json.buffers)) refuse("the JSON chunk declares no buffers");
  if (json.buffers.length !== 1) refuse(`${json.buffers.length} buffers: this reader reads exactly one, and the core writes exactly one`);
  if (json.buffers[0].uri) refuse("an external buffer URI: this repository's assets embed their buffer, and an external one is a different thing to trust");
  if (json.extensionsUsed?.length) refuse(`extensions: ${json.extensionsUsed.join(", ")}`);
  if (json.extensions) refuse("extensions declared on the object");
  return { json, bin };
}

/**
 * One accessor's bytes as a flat typed array, plus its component count.
 *
 * Two things are checked, and they are different things:
 *
 * 1. **An accessor read twice is fine.** The city tower's two primitives both
 *    index with accessor 3 — the same 144 indices, because the two meshes have
 *    the same topology. That is legal glTF and refusing it refuses four
 *    committed assets.
 * 2. **Two accessors in one buffer view is interleaving**, and is refused. A
 *    view-sized byte range per accessor with no overlap is what keeps a reader
 *    from guessing, and the check is a range check rather than an identity
 *    check so the two cases cannot be confused again.
 */
function readAccessor(json, bin, index, state) {
  const accessor = json.accessors?.[index];
  if (!accessor) refuse(`accessor ${index} does not exist`);
  const cached = state.accessors.get(index);
  if (cached) return cached;

  const numeric = NUMERIC[accessor.type];
  if (!numeric) refuse(`accessor ${index} has type ${accessor.type}, which is not a kind of number this reader handles`);
  const componentType = COMPONENT[accessor.componentType];
  if (!componentType) refuse(`accessor ${index} has componentType ${accessor.componentType}`);
  if (accessor.sparse) refuse(`accessor ${index} is sparse: nothing here is, and honouring a sparse one would need a second path`);

  // An accessor with no bufferView is zero-filled by specification. Nothing in
  // this repository writes one, so it is honoured plainly rather than ignored.
  if (accessor.bufferView === undefined) {
    const values = new componentType.array(numeric * (accessor.count ?? 0));
    const result = { values, numeric };
    state.accessors.set(index, result);
    return result;
  }

  const viewIndex = accessor.bufferView;
  const view = json.bufferViews?.[viewIndex];
  if (!view) refuse(`accessor ${index} refers to bufferView ${viewIndex}, which does not exist`);
  if (view.buffer !== 0) refuse(`bufferView ${viewIndex} refers to buffer ${view.buffer}: this reader reads buffer 0`);
  if (view.byteStride !== undefined) refuse(`bufferView ${viewIndex} declares a byteStride of ${view.byteStride} (interleaved): the core never writes that`);
  if (!bin) refuse(`accessor ${index} refers to the BIN chunk, and this GLB has none`);

  const withinView = accessor.byteOffset ?? 0;
  const byteLength = componentType.bytes * numeric * accessor.count;
  if (withinView + byteLength > view.byteLength) {
    refuse(`accessor ${index} needs ${byteLength} bytes at ${withinView} of a ${view.byteLength}-byte bufferView: the file's own declaration and its own bytes disagree`);
  }
  // Overlap is the only failure that means interleaving: the range check also
  // accepts a view shared by two accessors that sit in disjoint halves of it,
  // which is still not interleaved, and refuses it when they overlap.
  const previous = state.ranges.get(viewIndex) ?? [];
  for (const [from, to, other] of previous) {
    if (withinView < to && from < withinView + byteLength) {
      refuse(`bufferView ${viewIndex} holds accessor ${other} and accessor ${index} in overlapping bytes (interleaved attributes): the core never writes that, and a reader that read it twice would be guessing`);
    }
  }
  previous.push([withinView, withinView + byteLength, index]);
  state.ranges.set(viewIndex, previous);

  const start = (view.byteOffset ?? 0) + withinView;
  const bytes = new Uint8Array(bin, start, byteLength);
  const values = new componentType.array(byteLength / componentType.bytes);
  new Uint8Array(values.buffer, values.byteOffset, byteLength).set(bytes);
  const result = { values, numeric };
  state.accessors.set(index, result);
  return result;
}

/**
 * The one material description a primitive needs, or a refusal.
 *
 * Written to be called by `json.materials.map(materialOf)`, so the order is
 * `(descriptor, index)` — not the other way round, which is a bug that reads
 * a number as if it were a material object and refuses a valid file.
 *
 * The factor is required only where there is no texture: `blimp_envelope` is
 * textured and omits it, which glTF allows because it defaults to white, and
 * insisting on a factor there would refuse a committed asset. Where there is
 * no texture the factor *is* the colour, so its absence is a real fault.
 */
function materialOf(descriptor, materialIndex) {
  if (!descriptor) refuse(`material ${materialIndex} does not exist`);
  const pbr = descriptor.pbrMetallicRoughness ?? {};
  const factor = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor : null;
  const textureIndex = pbr.baseColorTexture?.index ?? null;
  if (!factor && textureIndex === null) {
    refuse(`material ${materialIndex} (${descriptor.name ?? "unnamed"}) has no baseColorFactor and no baseColorTexture: the core always writes one of the two`);
  }
  if (factor && (factor.length !== 4 || factor.some((channel) => typeof channel !== "number"))) {
    refuse(`material ${materialIndex} (${descriptor.name ?? "unnamed"}) has a baseColorFactor that is not four numbers: ${JSON.stringify(factor)}`);
  }
  if (textureIndex !== null && descriptor.extensions) refuse(`material ${materialIndex} reads a texture through an extension`);
  return { textureIndex, baseColorFactor: factor ?? [1, 1, 1, 1] };
}

function buildGeometry(json, bin, primitive, state, where) {
  const attributes = primitive.attributes ?? {};
  if (!(attributes.POSITION !== undefined)) refuse(`${where}: a primitive with no POSITION attribute`);
  for (const name of Object.keys(attributes)) {
    if (!ATTRIBUTES.has(name)) refuse(`${where}: attribute ${name} is not one of ${[...ATTRIBUTES].join(", ")}`);
  }
  const mode = primitive.mode ?? TRIANGLES;
  if (mode !== TRIANGLES) refuse(`${where}: draw mode ${mode}; this reader handles triangles only`);

  const position = readAccessor(json, bin, attributes.POSITION, state);
  if (position.numeric !== 3) refuse(`${where}: POSITION is ${position.numeric} components`);
  const vertexCount = position.values.length / 3;
  if (vertexCount < 3) refuse(`${where}: ${vertexCount} vertices, which is not a surface`);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position.values, 3));
  if (attributes.NORMAL !== undefined) {
    const normal = readAccessor(json, bin, attributes.NORMAL, state);
    if (normal.values.length !== position.values.length) refuse(`${where}: NORMAL and POSITION disagree in length`);
    geometry.setAttribute("normal", new BufferAttribute(normal.values, 3));
  } else {
    geometry.computeVertexNormals();
  }
  if (attributes.TEXCOORD_0 !== undefined) {
    const uv = readAccessor(json, bin, attributes.TEXCOORD_0, state);
    if (uv.numeric !== 2 || uv.values.length !== vertexCount * 2) {
      refuse(`${where}: TEXCOORD_0 has ${uv.values.length / Math.max(uv.numeric, 1)} vectors for ${vertexCount} vertices`);
    }
    geometry.setAttribute("uv", new BufferAttribute(uv.values, 2, Boolean(json.accessors[attributes.TEXCOORD_0].normalized)));
  }
  for (const [source, target, sizes] of [['COLOR_0','color',[3,4]],['JOINTS_0','skinIndex',[4]],['WEIGHTS_0','skinWeight',[4]]]) {
    if (attributes[source] === undefined) continue;
    const index = attributes[source], value = readAccessor(json, bin, index, state);
    if (!sizes.includes(value.numeric) || value.values.length !== vertexCount * value.numeric) refuse(`${where}: invalid ${source} shape`);
    geometry.setAttribute(target, new BufferAttribute(value.values, value.numeric, Boolean(json.accessors[index].normalized)));
  }
  if (primitive.indices !== undefined) {
    const index = readAccessor(json, bin, primitive.indices, state);
    if (index.numeric !== 1) refuse(`${where}: indices are not scalars`);
    if (index.values.length % 3 !== 0) refuse(`${where}: ${index.values.length} indices, which is not a whole number of triangles`);
    geometry.setIndex(new BufferAttribute(index.values, 1));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, vertexCount, triangles: geometry.index ? geometry.index.count / 3 : vertexCount / 3 };
}

/**
 * Read a GLB.
 *
 * Returns the node hierarchy for drawing an asset as itself, plus a flat list
 * of primitives for merging/instancing. `images` are the raw embedded PNG
 * bytes; decoding them needs a browser, so they are returned rather than
 * loaded, and a node caller resolves them with `applyImageBytes`.
 */
export function parseGLB(input) {
  const arrayBuffer = toArrayBuffer(input);
  const { json, bin } = readContainer(arrayBuffer);
  const state = { accessors: new Map(), ranges: new Map() };
  const primitives = [];
  const nodes = new Map();
  const joints = new Set((json.skins ?? []).flatMap(skin => skin.joints ?? []));
  const stats = { vertices: 0, triangles: 0, primitives: 0, meshes: 0, nodes: 0, materials: 0, images: 0 };

  const images = (json.images ?? []).map((image) => {
    if (image.uri) refuse(`an external image URI (${image.uri}): the core embeds its images`);
    if (image.mimeType && image.mimeType !== "image/png" && image.mimeType !== "image/jpeg") {
      refuse(`image ${image.name ?? "?"} is ${image.mimeType}: a browser can decode PNG and JPEG and nothing else here`);
    }
    const mimeType = image.mimeType;
    const view = json.bufferViews[image.bufferView];
    if (!view || !bin) refuse("an image refers to a missing bufferView or there is no BIN chunk");
    const bytes = new Uint8Array(bin, view.byteOffset ?? 0, view.byteLength);
    return { name: image.name ?? "unnamed", mimeType, bytes, source: image.bufferView };
  });

  const materialInfos = (json.materials ?? []).map(materialOf);
  stats.materials = materialInfos.length;

  const meshes = (json.meshes ?? []).map((mesh, meshIndex) => {
    stats.meshes += 1;
    if (!mesh.primitives?.length) refuse(`mesh ${meshIndex} (${mesh.name ?? "unnamed"}) has no primitives`);
    return mesh.primitives.map((primitive, primitiveIndex) => {
      const where = `mesh ${meshIndex} (${mesh.name ?? "unnamed"}) primitive ${primitiveIndex}`;
      const { geometry, vertexCount, triangles } = buildGeometry(json, bin, primitive, state, where);
      stats.vertices += vertexCount;
      stats.triangles += triangles;
      stats.primitives += 1;
      if (primitive.material !== undefined && !json.materials?.[primitive.material]) {
        refuse(`${where} refers to material ${primitive.material}, which does not exist`);
      }
      const descriptor = json.materials?.[primitive.material];
      const alphaMode = descriptor?.alphaMode ?? "OPAQUE";
      if (!["OPAQUE", "MASK", "BLEND"].includes(alphaMode)) refuse(`${where}: alphaMode ${alphaMode} is unsupported`);
      // Everything a caller needs, flattened onto the primitive: merging for
      // instancing and drawing for the individual assets both want the same
      // facts, and keeping them in two parallel objects is how a caller gets
      // the wrong half.
      const info = descriptor ? materialOf(descriptor, primitive.material) : { textureIndex: null, baseColorFactor: [1, 1, 1, 1] };
      return {
        name: `${mesh.name ?? meshIndex}:${primitiveIndex}`,
        geometry,
        vertexCount,
        triangles,
        materialIndex: primitive.material ?? null,
        materialName: descriptor?.name ?? "unnamed",
        baseColorFactor: info.baseColorFactor,
        textureIndex: info.textureIndex,
        imageIndex: info.textureIndex != null ? json.textures?.[info.textureIndex]?.source ?? null : null,
        sampler: info.textureIndex != null ? json.samplers?.[json.textures?.[info.textureIndex]?.sampler] ?? {} : null,
        doubleSided: Boolean(descriptor?.doubleSided),
        alphaMode,
        alphaCutoff: descriptor?.alphaCutoff ?? .5,
        metallicFactor: descriptor?.pbrMetallicRoughness?.metallicFactor ?? 0,
        roughnessFactor: descriptor?.pbrMetallicRoughness?.roughnessFactor ?? 1,
        // The named node this primitive came from: `placement.json`'s `parts`
        // are addressed by node name ("tower", "rotor", "lake"), and an instance
        // that places two parts must not be handed the wrong one.
        part: null,
      };
    });
  });

  const root = new Group();
  root.name = json.scenes?.[json.scene ?? 0]?.name ?? "asset";

  function walk(nodeIndex, parent) {
    const node = json.nodes[nodeIndex];
    if (!node) refuse(`node ${nodeIndex} does not exist`);
    stats.nodes += 1;
    const object = joints.has(nodeIndex) ? new Bone() : new Group();
    nodes.set(nodeIndex, object);
    object.name = node.name ?? `node_${nodeIndex}`;
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    if (node.matrix) refuse(`${node.name ?? nodeIndex} is transformed by a matrix: the core writes translation/rotation/scale, so a matrix means something changed`);
    parent.add(object);
    // The cumulative matrix from the asset's root, which is what an instance
    // needs for a part that sits inside a parent: a rotor carried 90 m up its
    // tower, a rotor spun on a blimp's hull. `object.matrix` would be the local
    // one, and for anything but a flat hierarchy those differ.
    parent.updateMatrixWorld(true);
    const local = object.matrixWorld.clone();
    if (node.mesh !== undefined) {
      const prims = meshes[node.mesh];
      if (!prims) refuse(`${node.name ?? nodeIndex} refers to mesh ${node.mesh}, which does not exist`);
      for (const primitive of prims) {
        if (node.skin !== undefined && (!primitive.geometry.attributes.skinIndex || !primitive.geometry.attributes.skinWeight)) refuse(`skin ${node.skin} has no vertex joint/weight attributes`);
        primitives.push({ ...primitive, part: object.name, node: object, local, skin: node.skin });
      }
    }
    for (const child of node.children ?? []) walk(child, object);
  }

  for (const index of (json.scenes?.[json.scene ?? 0]?.nodes) ?? json.nodes.map((_, i) => i)) walk(index, root);

  root.updateMatrixWorld(true);
  const skins = (json.skins ?? []).map((skin, index) => {
    if (!skin.joints?.length || skin.inverseBindMatrices === undefined) refuse(`skin ${index} needs joints and inverse bind matrices`);
    const inverses = readAccessor(json, bin, skin.inverseBindMatrices, state);
    if (inverses.numeric !== 16 || inverses.values.length !== skin.joints.length * 16) refuse(`skin ${index} inverse bind matrix count disagrees with its joints`);
    const bones = skin.joints.map(joint => {
      const bone = nodes.get(joint);
      if (!bone?.isBone) refuse(`skin ${index} refers to missing joint ${joint}`);
      return bone;
    });
    return new Skeleton(bones, bones.map((_, i) => new Matrix4().fromArray(inverses.values, i * 16)));
  });
  for (const primitive of primitives) if (primitive.skin !== undefined && !skins[primitive.skin]) refuse(`skin ${primitive.skin} does not exist`);
  const animations = (json.animations ?? []).map(animation => {
    if (!animation.channels?.length) refuse("animation has no channels");
    const tracks = animation.channels.map(channel => {
      const node = nodes.get(channel.target?.node);
      const path = channel.target?.path;
      const property = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[path];
      const sampler = animation.samplers?.[channel.sampler];
      if (!node || !property || !sampler) refuse("animation target or sampler is unsupported");
      const interpolation = sampler.interpolation ?? 'LINEAR';
      if (!['LINEAR', 'STEP'].includes(interpolation)) refuse(`animation interpolation ${interpolation} is unsupported`);
      const input = readAccessor(json, bin, sampler.input, state);
      const output = readAccessor(json, bin, sampler.output, state);
      if (input.numeric !== 1 || output.numeric !== (path === 'rotation' ? 4 : 3) || output.values.length !== input.values.length * output.numeric) refuse('animation sampler sizes disagree');
      const Track = path === 'rotation' ? QuaternionKeyframeTrack : VectorKeyframeTrack;
      return new Track(`${node.uuid}.${property}`, input.values, output.values, interpolation === 'STEP' ? InterpolateDiscrete : InterpolateLinear);
    });
    return new AnimationClip(animation.name, -1, tracks);
  });
  stats.images = images.length;
  return {
    root,
    animations,
    skins,
    primitives,
    images,
    stats,
    extras: json.extras ?? {},
    generator: json.asset.generator ?? "unknown",
    sources: { meshes: stats.meshes, nodes: stats.nodes, materials: stats.materials, images: stats.images },
  };
}

/**
 * Attach decoded image bytes to their primitives.
 *
 * `decode` is the seam: the browser passes a loader that makes an `ImageBitmap`
 * from these exact bytes (a blob URL and the browser's own PNG decoder — no
 * decoder is written here and none is shipped), and nothing else is needed for
 * the 62 assets that carry no texture at all. The decoded texture is attached
 * to the primitive, so `buildAssetMeshes` can make its material.
 */
export async function applyImageBytes(asset, decode) {
  if (!asset.images.length) return asset;
  if (typeof decode !== "function") {
    refuse(`this asset needs an image decoder and none was given: ${asset.images.map((i) => i.name).join(", ")}`);
  }
  for (const [imageIndex, image] of asset.images.entries()) {
    const texture = await decode(image.bytes, image.mimeType);
    if (!texture) refuse(`the image decode returned nothing for ${image.name}`);
    const textures=new Map();
    const wraps={10497:RepeatWrapping,33071:ClampToEdgeWrapping,33648:MirroredRepeatWrapping};
    for (const primitive of asset.primitives) {
      if (primitive.imageIndex !== imageIndex) continue;
      if(!textures.has(primitive.textureIndex)){
        const mapped=textures.size?texture.clone():texture;
        mapped.wrapS=wraps[primitive.sampler?.wrapS??10497];mapped.wrapT=wraps[primitive.sampler?.wrapT??10497];
        if(mapped.wrapS===undefined||mapped.wrapT===undefined)refuse('unsupported glTF texture wrap mode');
        mapped.needsUpdate=true;textures.set(primitive.textureIndex,mapped);
      }
      primitive.texture = textures.get(primitive.textureIndex);
    }
  }
  return asset;
}

/** The three.js material one primitive's own description implies. */
export function makeMaterialFor(primitive) {
  const material = toonMaterial({
    name: primitive.materialName,
    // glTF multiplies the base colour factor by the embedded texture.
    color: new Color(...primitive.baseColorFactor.slice(0, 3)),
    map: primitive.texture ?? null,
    vertexColors: Boolean(primitive.geometry.getAttribute('color')),
    side: primitive.doubleSided ? DoubleSide : FrontSide,
    opacity: primitive.baseColorFactor[3],
    transparent: primitive.alphaMode === "BLEND",
    alphaTest: primitive.alphaMode === "MASK" ? primitive.alphaCutoff : 0,
    alphaToCoverage: primitive.alphaMode === "MASK",
    depthWrite: primitive.alphaMode !== "BLEND",
  });
  material.userData.baseColorFactor = [...primitive.baseColorFactor];
  material.userData.imageName = primitive.texture ? primitive.materialName : null;
  return material;
}

/**
 * The asset as a group of meshes, each at its own place in the asset's tree.
 *
 * For the assets drawn individually — the two blimps, the river and the lake —
 * where there is one instance and a texture to preserve. The assets that are
 * drawn 17,208 times use `mergePrimitives` instead, and never go through here.
 */
export function buildAssetMeshes(asset) {
  for (const primitive of asset.primitives) {
    if (!primitive.node) continue;
    const mesh = primitive.skin === undefined ? new Mesh(primitive.geometry, makeMaterialFor(primitive)) : new SkinnedMesh(primitive.geometry, makeMaterialFor(primitive));
    mesh.name = primitive.name;
    // The parent already owns the node transform. Applying the cumulative
    // matrix here a second time breaks bone-parented animated assets.
    primitive.node.add(mesh);
    if (mesh.isSkinnedMesh) {
      mesh.normalizeSkinWeights();
      // glTF inverse bind matrices are already in the asset's bind frame,
      // as in Three's GLTFLoader; no node transform is applied twice.
      mesh.bind(asset.skins[primitive.skin], new Matrix4());
      mesh.frustumCulled = false;
    }
  }
  return asset.root;
}

/**
 * Merge opaque primitives into one geometry, and the BLEND ones into another.
 *
 * The material's `baseColorFactor` is baked into a vertex colour, which is what
 * lets 17,208 individually-scaled redwoods be eleven primitives across four
 * materials and still draw as **one** `InstancedMesh`. That is not a hack: it
 * is the same information, moved to where a single material can reach it, and
 * the factor is kept verbatim on the geometry for the stamp to report.
 */
export function mergePrimitives(primitives, kind = "opaque") {
  const chosen = primitives.filter((p) => (kind === "glass" ? p.alphaMode === "BLEND" : p.alphaMode === "OPAQUE"));
  if(chosen.some(p=>p.skin!==undefined))refuse('cannot merge skinned meshes: preserve their skeleton and node hierarchy');
  if (chosen.length === 1 && chosen[0].texture) {
    const p = chosen[0];
    return { geometry: p.geometry, material: makeMaterialFor(p), triangles: p.triangles };
  }
  if (!chosen.length) return null;
  const first = chosen[0];
  const attributeNames = attributeSignature(first.geometry);
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const factors = [];
  const indexed = chosen.every((p) => Boolean(p.geometry.index));
  if (!indexed && chosen.some((p) => Boolean(p.geometry.index))) {
    refuse("cannot merge: some primitives are indexed and some are not");
  }

  for (const primitive of chosen) {
    const crown = /foliage/.test(primitive.materialName ?? "");
    // Compared through one normalising function, because the test compares
    // 'uv' against 'TEXCOORD_0' and two spellings of the same fact are how a
    // merge refuses a file that is perfectly mergeable.
    const names = attributeSignature(primitive.geometry);
    if (names !== attributeNames) {
      refuse(`cannot merge "${primitive.name}" into ${kind}: its attributes (${names}) differ from the others (${attributeNames})`);
    }
    const position = primitive.geometry.getAttribute("position");
    const normal = primitive.geometry.getAttribute("normal") ?? null;
    const uv = primitive.geometry.getAttribute("uv") ?? null;
    const tint = primitive.geometry.getAttribute('color') ?? null;
    const [r, g, b] = primitive.baseColorFactor;
    factors.push([...primitive.baseColorFactor]);
    if (indexed) {
      const index = primitive.geometry.index;
      for (let i = 0; i < index.count; i += 1) {
        const v = index.getX(i);
        positions.push(position.getX(v), position.getY(v), position.getZ(v));
        if (normal) normals.push(...(crown ? crownNormal(position, normal, v) : [normal.getX(v), normal.getY(v), normal.getZ(v)]));
        if (uv) uvs.push(uv.getX(v), uv.getY(v));
        if(tint)colors.push(r*tint.getX(v),g*tint.getY(v),b*tint.getZ(v),primitive.baseColorFactor[3]*(tint.itemSize===4?tint.getW(v):1));
        else colors.push(r, g, b, primitive.baseColorFactor[3]);
      }
    } else {
      for (let v = 0; v < position.count; v += 1) {
        positions.push(position.getX(v), position.getY(v), position.getZ(v));
        if (normal) normals.push(...(crown ? crownNormal(position, normal, v) : [normal.getX(v), normal.getY(v), normal.getZ(v)]));
        if (uv) uvs.push(uv.getX(v), uv.getY(v));
        if(tint)colors.push(r*tint.getX(v),g*tint.getY(v),b*tint.getZ(v),primitive.baseColorFactor[3]*(tint.itemSize===4?tint.getW(v):1));
        else colors.push(r, g, b, primitive.baseColorFactor[3]);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (normals.length) geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  if (uvs.length) geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = toonMaterial({
    name: `${kind}:${first.materialName ?? first.name}`,
    vertexColors: true,
    side: chosen.some(p => p.doubleSided) ? DoubleSide : FrontSide,
    transparent: kind === "glass",
    depthWrite: kind !== "glass",
  }, { foliage: chosen.some(p => /foliage/.test(p.materialName ?? "")) });
  material.userData.mergedFrom = chosen.map((p) => p.materialName ?? p.name);
  material.userData.baseColorFactors = factors;
  const triangles = positions.length / 9;
  geometry.userData.mergedFrom = chosen.map((p) => p.name);
  return { geometry, material, triangles };
}

/**
 * A crown's lighting normal: mostly the outward, slightly raised direction
 * from the bole, partly the face's own. The core writes one flat normal per
 * face, which lights every clump as a cut gem; a crown lit as one rounded mass
 * reads as foliage. Presentation only: no vertex moves.
 */
function crownNormal(position, normal, v) {
  const x = position.getX(v), z = position.getZ(v), reach = Math.hypot(x, z);
  const nx = normal.getX(v), ny = normal.getY(v), nz = normal.getZ(v);
  if (reach < 0.3) return [nx, ny, nz];
  const ox = x / reach, oy = 0.35, oz = z / reach;
  const facing = Math.sign(nx * ox + ny * oy + nz * oz) || 1;
  const bx = ox * 0.8 + nx * facing * 0.3, by = oy * 0.8 + ny * facing * 0.3, bz = oz * 0.8 + nz * facing * 0.3;
  const length = Math.hypot(bx, by, bz);
  return [bx / length, by / length, bz / length];
}

/** A geometry's attribute names, spelled one way, for comparing two. */
function attributeSignature(geometry) {
  return Object.keys(geometry.attributes)
    .map((name) => (name === "uv" ? "TEXCOORD_0" : name.toUpperCase()))
    .sort()
    .join(",");
}
