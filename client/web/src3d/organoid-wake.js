import * as T from '../vendor/three.module.min.js';

// Start with the live doze pose. Eyes snap open and ears prick before
// Ronin pitches over his feet to stand, then overshoots and settles.
const keys = [
  // seconds, standing weight, eye opening, head pitch, spine pitch, ear pitch
  [0,    0,    0,    0,    0,    0],
  [.12,  0,    0,    .02,  0,   -.08],
  [.26,  .03,  .92, -.29, -.08,  .26],
  [.36,  .04,  1,   -.36, -.12,  .29],
  [.52,  .08,  1,   -.13,  .06,  .12],
  [.69,  .16,  1,    .11,  .31, -.09],
  [.85,  .39,  1,    .16,  .33, -.18],
  [1.04, .76,  1,    .07,  .21, -.10],
  [1.23, 1,    1,   -.09, -.04,  .08],
  [1.41, 1,    1,    .03, -.02, -.03],
  [1.57, 1,    1,    0,    0,    0],
];

export function createOrganoidWake(rig, doze, dozeTime, idle, eyes) {
  const times = keys.map(key => key[0]);
  const standing = new Map(idle.tracks.map(track => [track.name, track]));
  const pitchColumns = new Map();
  for(const [name,column] of [['head',3],['spine',4],['ear.L',5],['ear.R',5]]){
    const bone = rig.getObjectByName(name);
    if(bone)pitchColumns.set(bone.uuid+'.quaternion',column);
  }
  const axes = new T.Vector3(1,0,0);
  const from = new T.Quaternion(), to = new T.Quaternion(), result = new T.Quaternion();
  const offset = new T.Quaternion();
  const tracks = doze.tracks.map(track => {
    const a = Array.from(track.createInterpolant().evaluate(dozeTime));
    const b = Array.from(standing.get(track.name)?.createInterpolant().evaluate(0) ?? a);
    const pitch = pitchColumns.get(track.name);
    const values = keys.flatMap(key => {
      if(track instanceof T.QuaternionKeyframeTrack){
        result.slerpQuaternions(from.fromArray(a),to.fromArray(b),key[1]);
        if(pitch)result.multiply(offset.setFromAxisAngle(axes,key[pitch]));
        return result.toArray();
      }
      return a.map((value,i) => T.MathUtils.lerp(value,b[i],key[1]));
    });
    return new track.constructor(track.name,times,values);
  });
  for(const track of eyes.clip.tracks){
    const sample = track.createInterpolant();
    const values = keys.flatMap(key =>
      Array.from(sample.evaluate(T.MathUtils.lerp(eyes.time,eyes.clip.duration,key[2]))));
    tracks.push(new track.constructor(track.name,times,values));
  }
  return new T.AnimationClip('organoid_wake',times.at(-1),tracks);
}
