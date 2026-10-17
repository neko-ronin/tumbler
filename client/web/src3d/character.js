/** Presentation of the shared Ronin puppet; movement stays in shared/activities/. */
import * as T from '../vendor/three.module.min.js';
import { buildAssetMeshes } from './glb.js';
import { installCharacterSurfaces } from './character-surface.js';

export function createCharacter(asset, config) {
  const object = new T.Group();
  object.name = 'player_cat_ronin';
  const model = buildAssetMeshes(asset);
  const textures=new Set(),skeletons=new Set(),geometries=new Set();
  model.traverse(node=>{if(node.isMesh){geometries.add(node.geometry);if(node.material.map)textures.add(node.material.map);if(node.isSkinnedMesh)skeletons.add(node.skeleton);}});
  model.scale.setScalar(config.scale);
  model.position.y = -config.sole_y_m * config.scale;
  object.add(model);
  object.visible = false;
  // The original site's buffalo-check shirt is a shader. Recreate the check
  // with a tiny local texture using the existing WebGL toon material.
  const pixels = new Uint8Array([149, 42, 39, 255, 83, 27, 28, 255, 83, 27, 28, 255, 43, 19, 22, 255]);
  const plaid = new T.DataTexture(pixels, 2, 2);
  plaid.colorSpace = T.SRGBColorSpace;
  plaid.wrapS = plaid.wrapT = T.RepeatWrapping;
  plaid.repeat.set(7, 5);
  plaid.magFilter = T.NearestFilter;
  plaid.needsUpdate = true;
  model.traverse(node => {
    if (!node.isMesh) return;
    // World sun shadows are cached across 80 m moves. A dynamic contact
    // footprint below avoids leaving a frozen Ronin silhouette behind.
    node.castShadow = false;
    node.receiveShadow = true;
    if (node.material.name === 'flannel' && !node.material.map) { node.material.color.set('#ffffff'); node.material.map = plaid; }
  });
  const surfaces=installCharacterSurfaces(model);
  const shadePixels = new Uint8Array(32 * 32 * 4);
  for (let y=0;y<32;y++) for (let x=0;x<32;x++) {
    const i=(y*32+x)*4,r=Math.hypot((x-15.5)/15.5,(y-15.5)/15.5);
    shadePixels.set([31,39,29,Math.round(Math.max(0,1-r)**2*125)],i);
  }
  const shadeTexture=new T.DataTexture(shadePixels,32,32);shadeTexture.needsUpdate=true;
  const shadow=new T.Mesh(new T.PlaneGeometry(1.6,1.2),new T.MeshBasicMaterial({map:shadeTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.025;object.add(shadow);
  const mixer = new T.AnimationMixer(model);
  const actions = Object.fromEntries(asset.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
  for (const name of Object.values(config.clips)) if (!actions[name]) throw new Error(`Ronin is missing clip ${name}`);
  let current = null, clipName = null,tailAction=null,tailName=null,tailCategory=null,tailTime=0,tailIndex=0,lastPose=null,landedTime=0,blinkTime=3.7,elapsed=0;
  for(const names of Object.values(config.tail_clips??{}))for(const name of names)if(!actions[name])throw new Error(`Ronin is missing tail clip ${name}`);
  function update(dt, pose, speed = 0, context = {}) {
    const name = config.clips[pose];
    const action = actions[name];
    if (!action) throw new Error(`Unknown Ronin pose ${pose}`);
    if (action !== current) {
      action.reset().fadeIn(.18).play();
      current?.fadeOut(.18);
      current = action; clipName = name;
    }
    action.timeScale = pose === 'walk' ? Math.max(.25, speed / config.walk.walk_mps)
      : pose === 'run' ? Math.max(.25, speed / config.walk.run_mps) : 1;
    if(lastPose==='flight'&&pose==='idle')landedTime=3;
    lastPose=pose;landedTime=Math.max(0,landedTime-dt);
    let category=pose==='flight'?(context.mode??'paraglider'):pose;
    if(pose==='flight'&&Math.abs(context.bank??0)>.18)category=context.bank<0?'turn_left':'turn_right';
    if(landedTime>0)category='landed';
    if(context.grounded||context.mode==='landed')category='landed';
    const choices=config.tail_clips?.[category];
    tailTime-=dt;
    if(choices&&(category!==tailCategory||tailTime<=0)){
      if(category!==tailCategory)tailIndex=0;else tailIndex=(tailIndex+1)%choices.length;
      const next=actions[choices[tailIndex]];
      if(next!==tailAction){next.reset().fadeIn(.4).play();tailAction?.fadeOut(.4);tailAction=next;}
      tailCategory=category;tailName=choices[tailIndex];tailTime=next.getClip().duration*(category==='idle'?1:2);
    }
    elapsed+=dt;blinkTime-=dt;
    if(blinkTime<=0&&config.blink_clip){const blink=actions[config.blink_clip];blink.reset().setLoop(T.LoopOnce,1).play();blink.clampWhenFinished=true;blinkTime=3.2+1.7*(.5+.5*Math.sin(elapsed*1.37));}
    mixer.update(dt);
    shadow.visible=pose!=='flight';
  }
  return { object, model, update, get clip() { return clipName; },get tailClip(){return tailName;}, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); surfaces.dispose();for(const s of skeletons)s.dispose();for(const t of textures)t.dispose();for(const g of geometries)g.dispose();plaid.dispose();shadeTexture.dispose();shadow.geometry.dispose();shadow.material.dispose(); } };
}
