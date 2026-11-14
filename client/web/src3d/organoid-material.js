import * as T from '../vendor/three.module.min.js';

export const levels = ['Close', 'Medium', 'Far', 'Distant', 'Hidden'];
export const transitionPixels = [[136, 176], [40, 56], [12, 20], [2, 4]];

export function detailAt(diameter) {
  for (let i = 0; i < transitionPixels.length; i++) {
    const [lo, hi] = transitionPixels[i];
    if (diameter >= hi) return i;
    if (diameter > lo) {
      const t = (hi - diameter) / (hi - lo);
      return i + t * t * (3 - 2 * t);
    }
  }
  return 4;
}

export function closeSampleBudget(diameter) {
  return Math.min(32, Math.max(8, 32 * (288 / Math.max(diameter, 1)) ** 2));
}

export function projectedDiameter(camera, worldCentre, worldRadius, drawingBufferHeight) {
  const depth = -worldCentre.clone().applyMatrix4(camera.matrixWorldInverse).z;
  return depth > 0 ? worldRadius * camera.projectionMatrix.elements[5] * drawingBufferHeight / depth : 0;
}

async function densityTexture(bytes, size, signedField = false) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const unpacked = new Uint8Array(await new Response(stream).arrayBuffer());
  if (unpacked.length !== size ** 3) throw new Error('Unexpected Organoid volume size');
  if (signedField) for (let i = 0; i < unpacked.length; i++) unpacked[i] = Math.round(unpacked[i] * 255 / 63);
  const texture = new T.Data3DTexture(unpacked, size, size, size);
  texture.format = T.RedFormat;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = `
precision highp float;
in vec3 position, normal;
uniform mat4 modelViewMatrix, projectionMatrix;
out vec3 surface, facet;
void main() {
  surface = position;
  facet = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = `
precision highp float;
precision highp sampler3D;
uniform sampler3D detailedVolume, coarseVolume;
uniform vec3 eye, viewAxis, palette[3], sun, attentionAxis;
uniform mat3 tissueFrame;
uniform vec4 expression;  // contraction, focus, pulse-front, pulse strength
uniform float sunStrength;
uniform vec4 planes[12];
uniform float detail, closeSamples, innerRadius, emission, fieldColor, materialScale, materialFold;
uniform float fieldRange, fieldWidth;
uniform float ior, wall, opacity, reflection, time;
// The source project's Rose gold (Orbius palette 4): the light the brain gives its smoke and sparks of thought.
const vec3 ROSE_DEEP = vec3(.71,.106,.486), ROSE = vec3(.96,.565,.675), ROSE_WHITE = vec3(1.,.918,.816);
in vec3 surface, facet;
out vec4 outColor;

// Entry and exit distances along the same ray for each LOD. The field is
// stored in normalized core space, while the mesh lives in vessel space.
vec2 sphere(vec3 origin, vec3 ray) {
  float b = dot(origin, ray);
  float h = b * b - dot(origin, origin) + 1.0;
  if (h <= 0.0) return vec2(0.0);
  float span = sqrt(h);
  return vec2(max(0.0, -b - span), -b + span);
}
float hullChord(vec3 point, vec3 ray, vec3 face, out vec3 edgeNormal, out float edge) {
  float exitAt = 3.0;
  float nearest = 1.0;
  vec3 adjacent = face;
  for (int i = 0; i < 12; i++) {
    vec3 n = planes[i].xyz;
    float room = planes[i].w - dot(n, point);
    float slope = dot(n, ray);
    if (slope > .0001) exitAt = min(exitAt, room / slope);
    if (dot(n, face) < .98 && room < nearest) {
      nearest = room;
      adjacent = n;
    }
  }
  edge = 1.0 - smoothstep(0.0, .032, nearest);
  edgeNormal = normalize(mix(face, adjacent, edge * .47));
  return max(.02, exitAt);
}
vec3 volume(vec3 origin, vec3 ray, int tier) {
  vec2 interval = sphere(origin, ray);
  float len = interval.y - interval.x;
  if (len <= 0.0) return vec3(0.0);
  if (tier == 3) {
    float limb = clamp(len * .5, 0.0, 1.0);
    return vec3(.25, .205, .28) * pow(limb, 1.2);
  }
  float count = tier == 0 ? closeSamples : (tier == 1 ? 16.0 : 8.0);
  float ds = len / count;
  vec3 entry = origin + ray * interval.x;
  // The folds shift slowly through the tissue. Vary the deformation along
  // the ray so the body does more than rotate as a solid.
  vec3 bend = .066 * sin(entry.zxy * 3.0 + vec3(.57,.46,.61) * time);
  vec3 bendRate = .085 * cos(entry.zxy * 2.7 + vec3(.34,.46,.26) * time) * ray.zxy;
  vec3 sampleAt = (entry + bend) * .5 + .5;
  vec3 stepAt = (ray + bendRate) * (.5 * ds);
  float transmittance = 1.0;
  float weight = 0.0;
  float moment = 0.0;
  float bright = 0.0;
  float spark = 0.0;
  for (int i = 0; i < 32; i++) {
    float fraction = clamp(count - float(i), 0.0, 1.0);
    if (fraction <= 0.0) break;
    vec3 uvw = sampleAt + stepAt * (.5 * fraction);
    vec3 q = entry + ray * ((float(i) + .5 * fraction) * ds);
    float d;
    if (tier == 0) {
      float f = (texture(detailedVolume, uvw).r - .5) * (2.0 * fieldRange);
      d = exp2(-abs(f) * (1.442695 / fieldWidth));
    } else {
      d = texture(coarseVolume, uvw).r;
    }
    // Soft exterior with a folded, slightly bilobed silhouette.
    vec3 lobe = q;
    lobe.x = abs(lobe.x) - .14;
    float tissue = dot(lobe * vec3(1.04,1.08,1.0), lobe);
    d *= 1.0 - smoothstep(.58, .99, tissue);
    float depth = d * ds * 3.2 * fraction;
    float a = depth / (1.0 + .5 * depth);
    float visible = a * transmittance;
    weight += visible;
    moment += visible * ((float(i) + .5 * fraction) * ds);
    bright += visible * d*d;
    // Sparkling thought: sparse cells along the filaments flash and fade, each on its own beat.
    if (tier < 2) {
      vec3 cell = floor(q * 7.0);
      float h = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      float beat = fract(time * (.35 + .5 * h) + h * 17.0);
      spark += visible * d * step(.8, h) * exp2(-beat * 28.0);
    }
    transmittance *= 1.0 - a;
    sampleAt += stepAt;
    if (transmittance < .01) break;
  }
  vec3 q = entry + ray * (moment / max(weight, 1e-5));
  vec3 w = q * materialScale;
  w += sin(w.yzx * 1.3) * materialFold;
  vec3 tint = mix(palette[0], palette[1], .5 + .5 * sin(w.y * fieldColor + w.z * .3));
  float idle = .5 + .5 * sin(dot(q, vec3(3.5, 5.1, 2.7)) - time * .83);
  float facing = dot(q, attentionAxis);
  float focus = expression.y * smoothstep(-.22, .74, facing);
  float waveDist = (q.y + .22 * q.x - expression.z) * 4.7;
  float pulse = expression.w * exp2(-waveDist * waveDist);
  vec3 body = (tint * (weight - bright*.67) + palette[2] * (bright*.67)) * (emission * 1.06);
  body *= (.78 + .22 * idle + 1.65 * focus - .55 * expression.x);
  body += vec3(.93,.56,.70) * focus * (weight * .46 + bright * 1.27);
  body += vec3(.69,.66,.76) * pulse * weight * 1.23;
  body += ROSE_WHITE * spark * (5.5 + 6.0 * expression.y);
  return body;
}
vec3 room(vec3 ray) {
  float rim = pow(max(0.0, dot(ray, normalize(vec3(-.75, .25, -.55)))), 12.0);
  float key = pow(max(0.0, dot(ray, normalize(vec3(-.35, .75, .56)))), 5.0);
  return vec3(.12, .16, .23) + vec3(.37, .51, .76) * rim + vec3(.32, .41, .58) * key;
}
vec3 glint(vec3 reflected, float edge, float fresnel) {
  vec3 tangent = normalize(cross(sun, vec3(0,1,0)));
  vec3 offset = reflected - sun;
  float across = dot(offset, tangent);
  float spread = dot(offset, offset);
  float highlight = exp2(-260.0 * spread);
  float streak = exp2(-3400.0 * spread + 3140.0 * across * across);
  vec3 split = vec3(1.0, 0.0, -1.0) * .044;
  vec3 bands = exp2(-680.0 * (vec3(max(0.0, spread - across * across)) + (across-split)*(across-split)));
  // Spectral sheen rides the sunlight highlight. It adds no extra rays.
  vec3 white = vec3(1., .95, .86) * (.83 * highlight + .48 * streak);
  return white * (.53 + fresnel + .23 * edge) + .46 * bands * (.68 + .32 * edge);
}
vec3 lensRay(vec3 ray, vec3 n, float eta, float strength) {
  return normalize(ray + (refract(ray, n, eta) - ray) * strength);
}
void main() {
  int tier = int(floor(detail));
  float weight = fract(detail);
  float coverage = tier == 3 ? 1.0 - weight : 1.0;
  vec3 ray = normalize(surface - eye);
  vec3 face = normalize(facet);
  vec3 edgeNormal = face;
  float edge = 0.0;
  float facing = max(.001, dot(face, -ray));
  float chord = max(.02, 1.6 * facing);
  if (tier < 2) chord = mix(hullChord(surface, ray, face, edgeNormal, edge), chord, clamp(detail - 1.0, 0.0, 1.0));
  float fine = 1.0 - clamp(detail - 1.0, 0.0, 1.0);
  edge *= fine;
  vec3 normal = normalize(mix(face, edgeNormal, fine * .42));
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - facing, 5.0);
  float thickness = chord * wall;
  float depth = max(.2, dot(surface - eye, viewAxis));
  float lensStrength = 2.0 * thickness / depth;
  float radius = innerRadius * (1.0 - expression.x * .075);
  vec3 origin = tissueFrame * (eye / radius);
  vec3 bentRay = tissueFrame * lensRay(ray, normal, 1.0 / ior, lensStrength);
  vec3 core = volume(origin, bentRay, tier);
  if (weight > 0.0 && tier < 3) core = mix(core, volume(origin, bentRay, tier+1), weight);
  vec3 reflectedRay = reflect(ray, normalize(mix(normal, edgeNormal, fine * .35)));
  vec3 reflected = room(reflectedRay) * (fresnel * reflection + edge * .22);
  reflected += vec3(.025,.046,.069) * (.68 + .5 * edge);
  if (sunStrength > 0.0 && fine > 0.0) reflected += glint(reflectedRay, edge, fresnel) * fine * sunStrength;
  // Smoke fills the vessel: Beer-Lambert over the chord through the hull, broken into slow wisps
  // by one coarse-volume tap. The brain lights it, so its colour spills out to the walls.
  vec3 drift = surface * .38 + vec3(.11, -.07, .05) * time;
  float wisp = texture(coarseVolume, fract(drift * .5 + .5)).r;
  float smoke = 1.0 - exp(-chord * (1.15 + 1.6 * wisp));
  // Light scattered by the smoke falls off with the ray's closest approach to the brain.
  float along = dot(eye, ray);
  float near = max(0.0, dot(eye, eye) - along * along);
  float glow = exp(-near * 3.2) * (.55 + .45 * wisp) * emission * (.5 + .45 * expression.y);
  vec3 smokeColor = vec3(.05, .028, .05) + mix(ROSE_DEEP, ROSE, .3 + .45 * wisp) * glow;
  float glassAlpha = .36 + .5 * fresnel + .14 * edge;
  vec3 absorb = exp(-vec3(.84, 1.0, .96) * opacity * thickness * 3.6);
  vec3 radiance = core * absorb * (1.0 - fresnel) * (1.0 - .2 * smoke) + smokeColor * smoke + reflected;
  vec3 color = pow(1.0 - exp(-radiance * 1.65), vec3(.90));
  float lit = max(color.r, max(color.g, color.b));
  float alpha = mix(glassAlpha, 1.0, smoke * .55) + clamp(lit * 1.42, 0.0, 1.0) * (1.0 - glassAlpha);
  alpha = min(alpha, 1.0);
  // The valley composites opaque and transparent objects in linear light,
  // then applies the same filmic/output transform as the surrounding forest.
  vec3 linear = mix(color / 12.92, pow((color + .055) / 1.055, vec3(2.4)), step(.04045, color));
  outColor = vec4(linear / max(alpha, .01), alpha * coverage);
}
`;

// Harsh points of light round the Organoid, as if its presence frays space a little: hard bright
// points with a red/cyan split and a short horizontal tear, each twinkling slowly on its own beat (a
// quick bright rise, a long fade, a faint shimmer while lit) and somewhere new each time. Most cling
// to the glass, just inside and just outside its faces; a few stray through the ball. Subtle by
// rarity and size, not by softness, and fading with distance. Closed-form in (seed, time): nothing is simulated or
// uploaded per frame. Units are the vessel's (radius 1).
const SPARKLES = 140, SPARKLE_RADIUS = 1.5;
const sparkleVertex = `
precision highp float;
in vec4 position;  // per sparkle: beat phase, seed, rate, size
uniform mat4 modelViewMatrix, projectionMatrix;
uniform float time, pixelScale, excite;
out float flash, split;
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  vec4 seed = position;
  float beat = time * (.2 + .3 * seed.z) * (1.0 + .5 * excite) + seed.x;
  float cycle = floor(beat), t = fract(beat);
  // A twinkle: a quick bright rise, a long fade, a faint shimmer while lit, then dark.
  flash = smoothstep(0.0, .05, t) * (1.0 - smoothstep(.05, .38, t)) * (.8 + .2 * sin(time * 9.0 + seed.y));
  float n = seed.y + cycle * 17.31;
  float u = hash(n + 1.0) * 2.0 - 1.0, around = hash(n + 2.0) * 6.283185;
  vec3 dir = vec3(sqrt(1.0 - u * u) * cos(around), u, sqrt(1.0 - u * u) * sin(around));
  float r = hash(n + 5.0) < .75 ? .82 + .4 * hash(n + 3.0) : ${SPARKLE_RADIUS.toFixed(2)} * pow(hash(n + 3.0), 1.0 / 3.0);
  vec4 view = modelViewMatrix * vec4(r * dir, 1.0);
  gl_Position = projectionMatrix * view;
  float scale = length(modelViewMatrix[0].xyz);
  float size = (.05 + .04 * seed.w) * scale * pixelScale / -view.z;
  gl_PointSize = clamp(size, 2.0, 48.0);
  flash *= (.95 + .35 * excite) * smoothstep(1.5, 5.0, size);
  split = hash(n + 9.0) - .5;
}`;
const sparkleFragment = `
precision highp float;
in float flash, split;
out vec4 outColor;
void main() {
  if (flash <= 0.0) discard;
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  // A hard hot point whose colours pull apart a little, like a signal tearing.
  vec2 shift = vec2(split * .25, 0.0);
  float red = 1.0 - smoothstep(.16, .24, length(c - shift));
  float green = 1.0 - smoothstep(.16, .24, length(c));
  float blue = 1.0 - smoothstep(.16, .24, length(c + shift));
  // A short horizontal tear through it.
  float tear = (1.0 - smoothstep(0.0, .06, abs(c.y))) * (1.0 - smoothstep(.2, .95, abs(c.x))) * .45;
  vec3 color = vec3(red, green, blue) * vec3(1.0, .93, .88) + vec3(1.0, .8, .75) * tear;
  outColor = vec4(color * flash, 1.0);
}`;

function createSparkles() {
  const seeds = new Float32Array(SPARKLES * 4);
  for (let i = 0; i < SPARKLES; i++) seeds.set([Math.random(), i * 1.618, Math.random(), Math.random()], i * 4);
  const geometry = new T.BufferGeometry();
  // Named `position` because three takes the draw count from it.
  geometry.setAttribute('position', new T.BufferAttribute(seeds, 4));
  geometry.boundingSphere = new T.Sphere(new T.Vector3(), SPARKLE_RADIUS + .1);
  const uniforms = {time: {value: 0}, pixelScale: {value: 500}, excite: {value: 0}};
  const material = new T.RawShaderMaterial({glslVersion: T.GLSL3, vertexShader: sparkleVertex, fragmentShader: sparkleFragment, uniforms,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending});
  const points = new T.Points(geometry, material);
  points.name = 'Organoid sparkles';
  // After the glass, so the static inside it shows through the smoke.
  points.renderOrder = 1;
  const size = new T.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    uniforms.pixelScale.value = renderer.getDrawingBufferSize(size).y * camera.projectionMatrix.elements[5] / 2;
  };
  return {points, uniforms, dispose() { geometry.dispose(); material.dispose(); }};
}

/** The caller owns the source GLB. Both volume levels decode only when requested. */
export async function createOrganoid(asset, geometry, coarseBytes, closeBytes) {
  geometry.computeBoundingSphere();
  const coarse = await densityTexture(coarseBytes, asset.textureSizes[1]);
  const uniforms = {
    // The review can request each level immediately. The high-volume CPU data is
    // decoded lazily, and Three uploads the high texture at its first use.
    detailedVolume: { value: coarse }, coarseVolume: { value: coarse },
    eye: { value: new T.Vector3() }, viewAxis: { value: new T.Vector3() },
    sun: { value: new T.Vector3() }, attentionAxis: { value: new T.Vector3() },
    tissueFrame: { value: new T.Matrix3() }, expression: { value: new T.Vector4() },
    sunStrength: { value: 1 }, fieldRange: { value: asset.fieldRange }, fieldWidth: { value: asset.fieldWidth },
    planes: { value: asset.planes.map(p => new T.Vector4(...p)) },
    detail: { value: 2 }, closeSamples: { value: 32 }, time: { value: 0 }, innerRadius: { value: asset.radiusInner },
    materialScale: { value: asset.materialScale }, materialFold: { value: asset.materialFold },
    fieldColor: { value: asset.fieldColor }, emission: { value: asset.emission },
    palette: { value: asset.palette.map(s => new T.Vector3(...s.slice(1).match(/../g).map(v => parseInt(v,16) / 255))) },
    ior: { value: asset.shell.ior }, wall: { value: asset.shell.thickness },
    opacity: { value: asset.shell.opacity }, reflection: { value: asset.shell.light },
  };
  const material = new T.RawShaderMaterial({
    glslVersion: T.GLSL3, vertexShader, fragmentShader, uniforms,
    transparent: true, depthWrite: false,
  });
  const mesh = new T.Mesh(geometry, material);
  const sparkles = createSparkles();
  mesh.add(sparkles.points);
  const localCamera = new T.Vector3();
  const localSun = new T.Vector3();
  const target = new T.Vector3(), worldTarget = new T.Vector3();
  const matrix = new T.Matrix4();
  const tilt = new T.Euler();
  const rotation = new T.Quaternion();
  let detailed, loading, disposed = false;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    mesh.worldToLocal(uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld));
    const toward = camera.getWorldDirection(uniforms.viewAxis.value);
    toward.add(localCamera.setFromMatrixPosition(camera.matrixWorld));
    mesh.worldToLocal(toward).sub(uniforms.eye.value).normalize();
    localSun.copy(uniforms.sun.value).transformDirection(matrix.copy(mesh.matrixWorld).invert());
    uniforms.sun.value.copy(localSun);
    uniforms.attentionAxis.value.copy(mesh.worldToLocal(target.copy(worldTarget))).normalize().applyMatrix3(uniforms.tissueFrame.value);
  };
  return {
    mesh,
    async prepareClose() {
      loading ??= densityTexture(closeBytes, asset.textureSizes[0], true).then(texture => {
        if (disposed) texture.dispose();
        else {
          detailed = texture;
          uniforms.detailedVolume.value = texture;
        }
      });
      return loading;
    },
    update(detail, time, closeSamples, look) {
      mesh.visible = detail < 4;
      uniforms.detail.value = detail;
      uniforms.closeSamples.value = closeSamples;
      uniforms.time.value = time;
      uniforms.sunStrength.value = look.sunStrength;
      uniforms.sun.value.copy(look.sun);
      worldTarget.copy(look.target);
      uniforms.expression.value.set(look.withdraw, look.notice, look.front, look.pulse);
      sparkles.uniforms.time.value = time;
      sparkles.uniforms.excite.value = look.notice;
      tilt.set(.10 * Math.sin(time * .20), .26 * Math.sin(time * .15), -.12 * Math.sin(time * .13));
      rotation.setFromEuler(tilt);
      uniforms.tissueFrame.value.setFromMatrix4(matrix.makeRotationFromQuaternion(rotation));
    },
    dispose() {
      disposed = true;
      detailed?.dispose();
      coarse.dispose();
      sparkles.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
