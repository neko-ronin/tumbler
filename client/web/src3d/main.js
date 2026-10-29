import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {buildRiverGranite} from './river-granite.js';
import {createAirCues,createMeadowAir} from './air-cues.js';
/** Browser composition only: the core remains the source of the world. */
import * as T from '../vendor/three.module.min.js';
import { createOrbitControls } from './controls.js';
import {buildTerrainLod} from './terrain-lod.js';
import {buildGeology} from './geology.js';
import {createGeologySampler,applyGeologyTerrain} from '../../../shared/geometry/granite/surface.js';
import { buildWater, buildRiverReaches, terrainRegionBlend } from './terrain.js';
import { buildPlacements, buildForest } from './placements.js';
import { buildTreeGroundShadows } from './forest.js';
import {instanceMatrix} from './world.js';
import {setTreeLighting} from './tree-surface.js';
import {bindTreeSunShadow} from './tree-shadows.js';
import {buildForestField,forestField} from './forest-field.js';
import {buildForestFloor} from './forest-floor.js';
import {buildAdoptedRedwoods,releaseCrownSources} from './redwood-rendering.js';
import { GroundSampler, HeightGrid, decodeGroundCover,mergeGroundCover,landscapeHeightGrid } from './heights.js';
import { buildCloseMeadow, meadowViewFocus } from './groundcover.js';
import {buildGrassCanopy} from './grass-canopy.js';
import { parseGLB, applyImageBytes, mergePrimitives } from './glb.js';
import { makeSky, style } from './style.js';
import { createCloudPass } from './clouds.js';
import {createActorShadows,snappedShadowAnchor} from './actor-shadow.js';
import { createResolutionGovernor } from './flight-quality.js';
import {createFramePacer,WEB_FPS,WEB_FRAME_MS} from './frame-pacing.js';
import { createFlightRig } from './flight-rig.js';
import { createNavigation } from './navigation.js';
import { createCharacter } from './character.js';
import { buildEcology } from './ecology.js';
import { buildTethers, buildTrails, TRAIL_SURFACE_LIFT } from './details.js';
import { createSoundscape } from './audio.js';
import { buildWorldCollision } from './collision.js';
import { sha256, verifyFetched, checkVersion, WORLDMAP_VERSION } from './provenance.js';
import {fetchAssetBytes} from './asset-bytes.js';
import {VERSION} from './version.js';
import { createSnowSampler, createTrailSampler, createSurfaceSampler, createRideHeight } from '../../../shared/activities/ride.js';
import { createWalkHeight } from '../../../shared/activities/walk.js';
import {createLoadingScreen,warmScene,finishGpu,nextPaint} from './loading.js';

const root = new URL('../../../', import.meta.url);
const observed=new Map();
async function fetchData(path, json = true) {
  const bytes=await fetchAssetBytes(path,root);observed.set(path,sha256(bytes));
  return json ? JSON.parse(new TextDecoder().decode(bytes)) : bytes;
}

export async function main() {
  const loading=createLoadingScreen();
  // Let the journal paint before any synchronous geometry/renderer work.
  await nextPaint();await nextPaint();
  await document.getElementById('journal-art-image').decode();
  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const stamp = document.getElementById('stamp');
  const version = document.getElementById('version');
  if (version) version.textContent = `v${VERSION}`;
  let creationError = '';
  canvas.addEventListener('webglcontextcreationerror', e => { creationError = e.statusMessage; });
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    throw new Error(`WebGL unavailable: ${creationError || error.message}. Restart the browser and reopen this scene.`);
  }
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.debug.onShaderError=()=>{throw new Error('The light could not be prepared on this graphics device. Please try again.');};
  const scene = new T.Scene();
  scene.background = new T.Color('#dcdcc1');
  scene.fog = new T.Fog('#dcdcc1', 2500, 11500);
  const camera = new T.PerspectiveCamera(62, 1, .15, 30000);
  camera.position.set(-1600, 200, -780);
  const controls = createOrbitControls(camera, canvas);
  let pixelRatio = 1,qualityScale=1;
  const resolutionGovernor=createResolutionGovernor({frameBudgetMs:WEB_FRAME_MS});
  const framePacer=createFramePacer();
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio*qualityScale);
    renderer.setSize(width, height, false);
  }
  window.addEventListener('resize', resize); resize();

  status.textContent = 'Finding our place…';
  loading.phase('Finding our place in the mountains…',0);
  let [manifest, placement, stampData, blockBytes, farBytes, worldmap, habitats] = await Promise.all([
    fetchData('client/web/data/viewer.json'), fetchData('shared/world/out/placement.json'),
    fetchData('shared/world/out/ground_cover.json'), fetchData('client/web/data/heightmap.f32', false),
    fetchData('client/web/data/farfield.f32', false), fetchData('shared/world/worldmap.json'),
    fetchData('shared/ecology/habitats.json'),
  ]);
  const transition=await fetchData('shared/world/out/landscape_transition.json');checkVersion(transition,1,'landscape transition');
  const geologyData=worldmap.mountains.geology?await fetchData(worldmap.mountains.geology):null;
  if(geologyData)checkVersion(geologyData,1,'mountain geology');
  placement={...placement,instances:[...placement.instances,...transition.instances]};
  checkVersion(manifest,1,'viewer manifest');checkVersion(worldmap,WORLDMAP_VERSION,'world map');
  const [meadowData,flightConfig,rideConfig]=await Promise.all([fetchData(worldmap.activities.meadow_life),fetchData(worldmap.activities.flight),fetchData(worldmap.activities.ride)]);
  const characterConfig=await fetchData(worldmap.activities.character);
  const treePlan=await fetchData('shared/geometry/tree-design/adopted-redwoods.json');checkVersion(treePlan,2,'forest rendering plan');
  checkVersion(characterConfig,1,'playable character');
  const forestCover=await fetchData('shared/world/out/forest_floor.json');checkVersion(forestCover,1,'forest ground cover');
  const litterBytes=await fetchData('client/web/textures/forest-litter-v1.png',false);
  const litterBitmap=await createImageBitmap(new Blob([litterBytes],{type:'image/png'}));
  const forestLitterTexture=new T.Texture(litterBitmap);forestLitterTexture.colorSpace=T.SRGBColorSpace;
  forestLitterTexture.wrapS=forestLitterTexture.wrapT=T.RepeatWrapping;forestLitterTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());forestLitterTexture.needsUpdate=true;forestField.litter.value=forestLitterTexture;
  const snowStamp=await fetchData(rideConfig.snow_cover);
  for(const [value,known,label] of [[worldmap,WORLDMAP_VERSION,'world map'],[placement,3,'placements'],[stampData,1,'grass stamp'],[habitats,1,'water habitats'],[meadowData,1,'meadow life'],[flightConfig,3,'flight'],[rideConfig,1,'ski and bike rules'],[snowStamp,1,'snow cover']])checkVersion(value,known,label);
  const sourceBlockGrid = new HeightGrid({ values: new Float32Array(blockBytes), ...manifest.height_grids.block, kind: 'block source' });
  const sourceFarGrid = new HeightGrid({ values: new Float32Array(farBytes), ...manifest.height_grids.far_field, kind: 'far field source' });
  const blockGrid = new HeightGrid({ values: applyGeologyTerrain(sourceBlockGrid.values,manifest.height_grids.block,geologyData?.terrain?.block), ...manifest.height_grids.block, kind: 'block' });
  const farGrid = new HeightGrid({ values: applyGeologyTerrain(sourceFarGrid.values,manifest.height_grids.far_field,geologyData?.terrain?.far_field), ...manifest.height_grids.far_field, kind: 'far field' });
  const sourceGround=new GroundSampler(sourceBlockGrid,sourceFarGrid);
  const geologyHeight=geologyData?createGeologySampler(geologyData):null;
  const riverData=await fetchData('shared/world/out/river_granite.json');
  const riverSurface=createRiverGranite(riverData);
  const ground = new GroundSampler(blockGrid, farGrid, riverSurface.height, geologyHeight);
  status.textContent = 'Opening the meadow…';
  loading.phase('Unpacking the meadow, homes and trees…',1);
  // Bounded parallel loading avoids a serial network waterfall and limits peak
  // parsing memory. Source bytes fall out of scope as each asset is decoded.
  const paths = [...new Set([...placement.instances.map(i => i.asset),...habitats.plantings.map(i=>i.asset),...meadowData.species.map(i=>i.asset),'waterside/river_fish.glb','waterside/fish_tail.glb','waterside/frog.glb','waterside/dragonfly_wings.glb',flightConfig.wing_asset,flightConfig.motor_asset,...Object.values(flightConfig.modes).map(m=>m.wing_asset).filter(Boolean),...Object.values(rideConfig.modes).map(m=>m.asset)])];
  for(const path of [characterConfig.asset,...treePlan.stages.map(stage=>stage.asset),...Object.values(treePlan.profiles??{}).flatMap(p=>p.stages.map(s=>s.asset))])if(!paths.includes(path))paths.push(path);
  paths.push(riverData.geometry);
  const assets = {};
  for(const path of geologyData?.meshes??[])if(!paths.includes(path))paths.push(path);
  const decodedImages=new Map();
  let next = 0,loaded=0;
  async function loadAsset() {
    while (next < paths.length) {
      const path = paths[next++];
      const asset = parseGLB(await fetchData(`shared/geometry/${path}`, false));
      await applyImageBytes(asset, async (bytes, mimeType) => {
        const imageKey=await sha256(bytes);
        if(decodedImages.has(imageKey))return decodedImages.get(imageKey);
        const pending=(async()=>{
          const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }), { imageOrientation: 'none' });
          const texture = new T.Texture(bitmap);
          texture.colorSpace = T.SRGBColorSpace; texture.flipY = false; texture.needsUpdate = true;
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          return texture;
        })();decodedImages.set(imageKey,pending);return pending;
      });
      assets[path] = asset;
      loading.phase(`Unpacking the meadow, homes and trees… ${++loaded} / ${paths.length}`,1+loaded/paths.length);
    }
  }
  await Promise.all([loadAsset(), loadAsset(), loadAsset()]);
  status.textContent='Checking world bytes…';
  loading.phase('Checking every page of the world…',2);
  const verifiedFiles=await verifyFetched(manifest.fetched,observed,p=>fetchData(p,false));
  loading.phase('Sketches into sunlight. Growing the world…',3);
  await nextPaint();await nextPaint();
  const landscapeGrid=landscapeHeightGrid(blockGrid,farGrid);
  const basin=worldmap.mountains.enclosure.north_basin;
  const normalRegion=basin.landform?{centre:basin.centre_xy_m,radii:basin.landform.radii_m,edgeBlend:basin.landform.edge_blend,radiusM:farGrid.quad,southM:blockGrid.maxY+112}:null;
  const terrain=buildTerrainLod(landscapeGrid,{horizonM:farGrid.maxX,batchTiles:4,normalRegion});
  scene.add(terrain.group);
  const geology=geologyData?buildGeology(geologyData,assets):null;
  if(geology)scene.add(geology.group);
  const riverGranite=buildRiverGranite(riverSurface,assets[riverData.geometry],terrain,assets,landscapeGrid);scene.add(riverGranite.group);
  const water = buildWater(placement.instances.filter(i => i.kind === 'river' || i.kind === 'lake'), assets, blockGrid,worldmap);
  scene.add(water, buildRiverReaches(worldmap, farGrid, riverSurface));
  const placements = buildPlacements(placement, assets, { ground,crownAssets:new Set(Object.keys(treePlan.targets)) }); scene.add(placements.group);
  // Set the initial sun before expensive atlas bakes; the first preset then
  // reuses them instead of immediately paying for a second bake.
  const lightPresets = {
      golden: { direction: [-.64,.48,-.55], color: '#ffdda2', fill: '#a8cbdc', intensity: 2.0, ambient: 1.8, exposure: 1.1, warmth: 1, fog: '#dcd7b8' },
      day: { direction: [-.35,.84,-.42], color: '#fff3d6', fill: '#b7ddef', intensity: 2.0, ambient: 1.75, exposure: 1.05, warmth: .15, fog: '#c8dcd6' },
      dusk: { direction: [.74,.25,-.63], color: '#ffc18d', fill: '#9baccd', intensity: 1.6, ambient: 1.55, exposure: 1.1, warmth: .85, fog: '#d9b7aa' },
    };
  setTreeLighting({...lightPresets.golden,sun:lightPresets.golden.color,ground:'#7a8452'});
  style.sun.value.set(-.64,.48,-.55).normalize();
  const forestSoil=buildForestField(placement,assets,forestCover.habitat,{stamp:forestCover,span:farGrid.maxX*2,resolution:2048});
  const legacyForest=buildForest(placement,assets,renderer,{filter:i=>i.asset.startsWith('redwood/')&&!treePlan.targets[i.asset]});
  const adoptedForest=buildAdoptedRedwoods(placement,assets,renderer,treePlan);
  adoptedForest.stats.releasedSourceBytes=releaseCrownSources(assets,treePlan);
  const forest={group:new T.Group(),stats:{},update(camera,anchor){legacyForest.update(camera,anchor);adoptedForest.update(camera,anchor);this.refreshStats();},
    refreshStats(){for(const key of ['trees','near','mid','far','tiles','shadowProxies','shadowRevision'])this.stats[key]=(legacyForest.stats[key]??0)+(adoptedForest.stats[key]??0);this.stats.adopted=adoptedForest.stats;},
    invalidateShadows(){legacyForest.invalidateShadows();adoptedForest.invalidateShadows();this.refreshStats();},
    rebuildImpostors(direction){legacyForest.rebuildImpostors(direction);adoptedForest.rebuildImpostors(direction);this.refreshStats();}};
  forest.group.add(legacyForest.group,adoptedForest.group);forest.refreshStats();scene.add(forest.group);
  const treeShadows=buildTreeGroundShadows(placement,assets,ground);scene.add(treeShadows.group);
  const blockCover=decodeGroundCover(stampData),cover=mergeGroundCover(blockCover,decodeGroundCover(transition.grass));
  const coverTexture=new T.DataTexture(Uint8Array.from(cover.covered,v=>v*255),cover.resolution,cover.resolution,T.RedFormat);
  coverTexture.minFilter=coverTexture.magFilter=T.LinearFilter;coverTexture.needsUpdate=true;
  style.cover.value=coverTexture;style.coverGrid.value.set(cover.offsetX,cover.offsetY,cover.quad,cover.resolution);
  // Snow retains the original block transform while grass also covers the outer landscape.
  const snowGrid=snowStamp.grid;
  if(snowGrid.resolution!==blockCover.resolution||snowGrid.quad_size_m!==blockCover.quad||snowGrid.offset_xy_m[0]!==blockCover.offsetX||snowGrid.offset_xy_m[1]!==blockCover.offsetY)throw new Error('snow_cover.json and ground_cover.json must share a grid');
  style.snowGrid.value.set(blockCover.offsetX,blockCover.offsetY,blockCover.quad,blockCover.resolution);
  const snowAt=createSnowSampler(snowStamp);
  const trail=createTrailSampler(worldmap),surfaceAt=createSurfaceSampler(rideConfig,snowAt,trail);
  const snowTexture=new T.DataTexture(Uint8Array.from(snowAt.depth,d=>Math.round(Math.min(1,d/snowStamp.model.max_depth_m)*255)),snowAt.resolution,snowAt.resolution,T.RedFormat);
  snowTexture.minFilter=snowTexture.magFilter=T.LinearFilter;snowTexture.needsUpdate=true;style.snow.value=snowTexture;
  const forestFloor=buildForestFloor(forestCover,forestSoil,ground,snowAt,(x,y)=>surfaceAt(x,y)==='trail');scene.add(forestFloor.group);
  // Interpret the shared grass habitat as sunlit sward; keep shaded forest
  // litter, snow, exposed rock and the authored trail tread clear of blades.
  const grassCover={resolution:cover.resolution,quad:cover.quad,offsetX:cover.offsetX,offsetY:cover.offsetY,covered:cover.covered.slice()};
  for(let row=0;row<cover.resolution;row++)for(let col=0;col<cover.resolution;col++){
    const i=row*cover.resolution+col;if(!grassCover.covered[i])continue;
    const x=cover.offsetX+col*cover.quad,y=cover.offsetY+row*cover.quad,h=ground.height(x,y);
    const regionalSoil=terrainRegionBlend(normalRegion,x,y)>0;
    const soilGround=regionalSoil?ground:sourceGround;
    const sourceHeight=soilGround.height(x,y);
    const slopePitch=regionalSoil?normalRegion.radiusM:4;
    const slope=Math.hypot((soilGround.height(x+slopePitch,y)??h)-(soilGround.height(x-slopePitch,y)??h),(soilGround.height(x,y+slopePitch)??h)-(soilGround.height(x,y-slopePitch)??h))/(2*slopePitch);
    const baseHeight=blockGrid.sample(x,y)??farGrid.sample(x,y),rockHeight=geologyHeight?.(x,y);
    if((riverSurface.granite(x,y)??0)>.22||h===null||h<23||sourceHeight>1100||slope>.72||(rockHeight!=null&&rockHeight>baseHeight)||snowAt(x,y)>.03||surfaceAt(x,y)==='trail'||forestSoil.sample(x,y)>.48)grassCover.covered[i]=0;
  }
  const grassGl=renderer.getContext();
  const meadow = buildGrassCanopy(grassCover,ground,{samples:grassGl.getParameter(grassGl.SAMPLES)});
  scene.add(meadow.group);
  const closeMeadow = buildCloseMeadow(grassCover,ground,{flowerMix:stampData.density.flower_colour_mix});scene.add(closeMeadow.mesh);
  const ecology=buildEcology(habitats,meadowData,assets,ground,closeMeadow,renderer,(x,y,z)=>navigation.sampleEnvironment(x,y,z));scene.add(ecology.group);
  scene.add(buildTethers(placement,assets),buildTrails(worldmap,ground));
  const flightRig=createFlightRig(assets,flightConfig),rig=flightRig.group;
  scene.add(rig);
  const rideRig=new T.Group();rideRig.name='player_ride';rideRig.rotation.order='YXZ';rideRig.visible=false;
  const rideMeshes=Object.fromEntries(Object.entries(rideConfig.modes).map(([name,m])=>{const merged=mergePrimitives(assets[m.asset].primitives,'opaque');const mesh=new T.Mesh(merged.geometry,merged.material);mesh.castShadow=true;mesh.visible=false;rideRig.add(mesh);return [name,mesh];}));
  scene.add(rideRig);
  const rideHeight=createRideHeight((x,y)=>ground.height(x,y)??0,trail);
  const hitTest=buildWorldCollision(placement,assets);
  const character=createCharacter(assets[characterConfig.asset],characterConfig);scene.add(character.object);
  const walkHeight=createWalkHeight(worldmap,(x,y)=>ground.height(x,y));
  // Match the existing presentation lift of the rendered tread. Its authored
  // profile remains the shared physical floor; this offset only clears pixels.
  const characterHeight=(x,y)=>{const z=walkHeight.floorHeight(x,y),t=walkHeight.trailAt(x,y);return z===null?null:t?.beyond===0?Math.max(z,t.z+TRAIL_SURFACE_LIFT):z;};
  const navigation=createNavigation(camera,canvas,controls,ground,flightConfig,worldmap,rig,hitTest,{config:rideConfig,surfaceAt,snowAt,height:rideHeight,rig:rideRig,meshes:rideMeshes},character,characterConfig,{walkHeight,floorHeight:walkHeight.floorHeight,characterHeight,onFlightChange:syncFlightUI,haptics:()=>document.getElementById('haptics').checked});
  // Full/half Cat Ronin (button, C, or ?cat=half): presentation and camera only;
  // speeds, jumps and collision stay full size. A start for a shrink/grow mechanic.
  const catSize=document.getElementById('cat-size'),HALF_CAT=.52;
  const toggleCatSize=()=>{characterConfig.scale=characterConfig.scale===1?HALF_CAT:1;const half=characterConfig.scale!==1;catSize.textContent=half?'Cat: half size':'Cat: full size';catSize.setAttribute('aria-pressed',String(half));};
  catSize.addEventListener('click',toggleCatSize);
  window.addEventListener('keydown',e=>{if(e.code==='KeyC'&&!e.repeat&&!e.metaKey&&!e.ctrlKey&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))toggleCatSize();});
  if(new URLSearchParams(location.search).get('cat')==='half')toggleCatSize();
  const clothAir=new T.Vector3(),clothFloor=new T.Vector3(),clothUp=new T.Vector3(),clothInverse=new T.Quaternion();
  rig.userData.flightUpdate=(dt,state,presentation={})=>{
    if(!(presentation.grounded??state.grounded)){flightRig.update(dt,state,presentation);return;}
    rig.updateMatrixWorld(true);clothInverse.copy(rig.quaternion).invert();
    const air=navigation.sampleEnvironment(state.x,state.y,state.z+2);
    clothAir.set(air.wx,air.lift,-air.wy).applyQuaternion(clothInverse);
    clothUp.set(0,1,0).applyQuaternion(rig.quaternion);
    flightRig.update(dt,state,{...presentation,localAir:presentation.localAir??clothAir,groundAt:presentation.groundAt??((x,z)=>{
      let y=0;
      for(let i=0;i<3;i++){
        clothFloor.set(x,y,z).applyMatrix4(rig.matrixWorld);
        y+=((characterHeight(clothFloor.x,-clothFloor.z)??0)-clothFloor.y)/Math.max(.2,clothUp.y);
      }
      return y;
    })});
  };
  const soundscape=createSoundscape(habitats);
  character.onCue=name=>soundscape.cue(name);
  document.getElementById('sound').addEventListener('click',async e=>{const enabled=await soundscape.toggle();e.target.textContent=enabled?'Sound on':'Sound off';e.target.setAttribute('aria-pressed',String(enabled));});
  const modeSelect=document.getElementById('activity'),siteSelect=document.getElementById('launch-site');
  const rideModes=Object.keys(rideConfig.modes);
  function showStarts(mode){
    const list=rideModes.includes(mode)?rideConfig.starts.filter(s=>s.mode===mode).map(s=>[s.id,s.label]):flightConfig.launches.map((l,i)=>[String(i),l.label]);
    const key=list.map(([id])=>id).join();if(siteSelect.dataset.key===key)return;
    siteSelect.replaceChildren(...list.map(([id,label])=>new Option(label,id)));siteSelect.dataset.key=key;
  }
  const helps={orbit:'Drag to orbit · Right-drag to pan · Wheel to approach',walk:'WASD / stick: walk · Shift / L3: run · Space / A: jump or moving skip · E / X: reharness · Drag / right stick: look',
    parakite:'A/D steer · W dive / S flare · Drag to look · Launch to restart',
    ski:'A/D carve · W pole · S snowplough · Shift tuck · Space hop · V view · Pad: stick, RT/LT, A hop, B tuck, Y view',
    bike:'A/D steer · W pedal · S brake · Shift crouch · Space hop · V view · Pad: stick, RT/LT, A hop, B crouch, Y view'};
  function syncFlightUI(mode,site,weather){
    modeSelect.value=mode;document.body.dataset.flying=String(!!flightConfig.modes[mode]);
    if(flightConfig.modes[mode]){showStarts(mode);siteSelect.value=String(site);}
    document.getElementById('weather').value=weather;updateHelp(mode);
  }
  function updateHelp(mode){
    const travel=mode==='parakite'?'forward: raise handles / dive · back: pull / flare':'forward: speedbar · back: brakes';
    const power=mode==='paramotor'?' · LB/RB: motor':'';
    const flightHelp=`Stick ${travel} · LT/RT: independent handles · B + steer: wingovers${power} · Y: view · Land then X: unhook · A: launch / air retry · D-pad: wing / ridge · Menu: weather`;
    const pad=[...(navigator.getGamepads?.()??[])].some(p=>p?.connected);
    const keyboardFlight=`A/D: ${mode==='parakite'?'weight shift + outside release':'weight shift + inside brake'} · W/S: ${mode==='parakite'?'raise handles / pull to flare':'speedbar / brakes'} · Shift + steer: wingovers${mode==='paramotor'?' · R/F: motor':''} · V: view · E: unhook on safe ground · Space: ground launch · Launch: restart`;
    document.getElementById('help').textContent=flightConfig.modes[mode]?(pad?flightHelp:keyboardFlight):pad&&mode==='orbit'?'A: take flight · D-pad: wing / ridge · Menu: weather':(helps[mode]??helps.orbit);
  }
  function setActivity(mode){showStarts(mode);navigation.select(mode,siteSelect.value);mode=navigation.mode;modeSelect.value=mode;document.body.dataset.flying=String(!!flightConfig.modes[mode]);
    updateHelp(mode);
    document.getElementById('launch').textContent=mode==='ski'?'Drop in ↘':mode==='bike'?'Ride ↘':'Launch ↗';
    canvas.focus();updateShadow(true);}
  window.addEventListener('gamepadconnected',()=>updateHelp(navigation.mode));
  window.addEventListener('gamepaddisconnected',()=>updateHelp(navigation.mode));
  modeSelect.addEventListener('change',e=>setActivity(e.target.value));
  siteSelect.addEventListener('change',()=>{if(rideModes.includes(navigation.mode)||flightConfig.modes[navigation.mode])setActivity(navigation.mode);});
  document.getElementById('launch').addEventListener('click',()=>{if(flightConfig.modes[navigation.mode]&&navigation.state.grounded){navigation.launchHere();return;}setActivity(['orbit','walk'].includes(modeSelect.value)?'paraglider':modeSelect.value);if(flightConfig.modes[navigation.mode]&&navigation.state.grounded)navigation.launchHere();});
  // The bearing is where the wind comes from; it blows toward the opposite one, and north is scene -z.
  const airCues=createAirCues((x,y,z)=>navigation.sampleEnvironment(x,y,z),ground,{renderer});
  const meadowWind=navigation.fixedEnvironmentSampler();
  const meadowAir=createMeadowAir(meadowWind.sample,ground,{
    x:cover.offsetX,z:-(cover.offsetY+cover.quad*cover.resolution),span:cover.quad*cover.resolution,
  });
  meadowAir.update(0);
  const windFrom = worldmap.wind.direction_deg * Math.PI / 180; style.wind.value.set(-Math.sin(windFrom), Math.cos(windFrom));style.cloudWind.value.copy(style.wind.value);
  const sky = makeSky(worldmap.mountains?.enclosure?.river_reaches); scene.add(sky);
  const weatherSelect=document.getElementById('weather');
  weatherSelect.replaceChildren(...Object.entries(flightConfig.weather).map(([id,w])=>new Option(w.label,id)));weatherSelect.value=navigation.weather;
  weatherSelect.addEventListener('change',()=>navigation.setWeather(weatherSelect.value));
  const challengeSelect=document.getElementById('flight-challenge');
  challengeSelect.replaceChildren(new Option('Free flight',''),...Object.entries(flightConfig.challenges??{}).map(([id,c])=>new Option(c.label,id)));
  challengeSelect.addEventListener('change',()=>navigation.setChallenge(challengeSelect.value));
  const motionSelect=document.getElementById('motion');
  motionSelect.value=matchMedia('(prefers-reduced-motion: reduce)').matches?'0':'1';navigation.setEffects(Number(motionSelect.value));
  motionSelect.addEventListener('change',()=>navigation.setEffects(Number(motionSelect.value)));
  const pilotPostureSelect=document.getElementById('pilot-posture');
  pilotPostureSelect.addEventListener('change',()=>navigation.setPilotMotion(pilotPostureSelect.value));
  const cloudPass=createCloudPass(renderer,scene,camera,worldmap.atmosphere,ground);
  document.getElementById('save-view').addEventListener('click',()=>{
    const speed=flightConfig.modes[navigation.mode]&&!navigation.state.grounded?Math.min(1,Math.max(0,(navigation.state.speed-12)/22)):0;
    cloudPass.render({speed,strength:Number(motionSelect.value)});
    canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`tumbler-${navigation.mode}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
  });
  renderer.info.autoReset=false;

  const sun = new T.DirectionalLight('#ffe3a3', 2.1);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 1800 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .7;
  scene.add(sun, sun.target);bindTreeSunShadow(sun);
  const hemisphere = new T.HemisphereLight('#afd7e3', '#7a8452', 2.0); scene.add(hemisphere);
  const actorShadows=createActorShadows(renderer,scene,[rig,character.object,rideRig],style);
  const actorFocus=new T.Vector3();
  const shadowCentre = new T.Vector3(Infinity, Infinity, Infinity);
  let shadowRevision=-1,lastShadowTime=0;
  const shadowFocus=new T.Vector3(Infinity,Infinity,Infinity);
  function updateShadow(force = false) {
    const target = controls.target;
    const now=performance.now();
    if (!force && target.distanceToSquared(shadowCentre)<80*80 &&
      ((shadowRevision===forest.stats.shadowRevision&&target.distanceToSquared(shadowFocus)<4*4)||now-lastShadowTime<350))return;
    lastShadowTime=now;shadowFocus.copy(target);
    // Static world shadows retain their light-space texel phase on recenter.
    // A forty-metre world-axis step changes that phase and makes edges jump.
    shadowCentre.copy(snappedShadowAnchor(target,style.sun.value,520,2048));
    forest.update(camera,shadowCentre);shadowRevision=forest.stats.shadowRevision;
    sun.target.position.copy(shadowCentre);
    sun.position.copy(shadowCentre).addScaledVector(style.sun.value, 900);
    sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }
  // Under the water's surface: a short teal fog and a tint over the view.
  // Surfacing restores the fog the light preset set. Presentation only.
  const underwaterTint=document.createElement('div');
  Object.assign(underwaterTint.style,{position:'fixed',inset:'0',background:'rgba(30,92,100,.3)',pointerEvents:'none',display:'none'});
  renderer.domElement.insertAdjacentElement('afterend',underwaterTint);
  let underwaterView=false,airFog=null;
  function applyUnderwater(under){
    if(under===underwaterView)return;underwaterView=under;underwaterTint.style.display=under?'block':'none';
    if(under){airFog={color:scene.fog.color.clone(),near:scene.fog.near,far:scene.fog.far};scene.fog.color.set('#2c6f73');scene.fog.near=1;scene.fog.far=28;scene.background.copy(scene.fog.color);}
    else if(airFog){scene.fog.color.copy(airFog.color);scene.fog.near=airFog.near;scene.fog.far=airFog.far;scene.background.copy(airFog.color);}
  }
  function setLight(name) {
    const p = lightPresets[name];
    setTreeLighting({...p,sun:p.color,ground:'#7a8452'});
    style.sun.value.fromArray(p.direction).normalize(); style.warmth.value = p.warmth;
    sun.color.set(p.color); sun.intensity = p.intensity;
    hemisphere.color.set(p.fill); hemisphere.intensity = p.ambient;
    scene.fog.color.set(p.fog); scene.background.copy(scene.fog.color);
    renderer.toneMappingExposure = p.exposure;
    treeShadows.setSun(style.sun.value);forest.rebuildImpostors(style.sun.value);
    updateShadow(true);
  }
  document.getElementById('light').addEventListener('change', e => setLight(e.target.value));
  document.getElementById('resolution').addEventListener('change', e => { pixelRatio = Number(e.target.value); resize(); });
  const home = placement.instances.find(i => i.kind === 'homestead');
  const [hx,hy,hz] = home.position_m;
  // These are camera bookmarks, never placement decisions.
  const homePoses=Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return [hx+Math.cos(a)*38,hz+10,-hy+Math.sin(a)*38];});
  const nearby=placement.instances.filter(i=>i.asset.startsWith('redwood/')&&Math.hypot(i.position_m[0]-hx,i.position_m[1]-hy)<100);
  const masts=placement.instances.filter(i=>i.kind==='mooring_mast'&&Math.hypot(i.position_m[0]-hx,i.position_m[1]-hy)<80);
  const homeCamera=homePoses.sort((a,b)=>{
    const clearance=p=>Math.min(...[...nearby,...masts].map(t=>{const x=t.position_m[0],z=-t.position_m[1],dx=p[0]-hx,dz=p[2]+hy;const along=Math.max(.05,Math.min(1,((x-hx)*dx+(z+hy)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-hx-dx*along,z+hy-dz*along)-(t.kind==='mooring_mast'?3:4);}));
    return clearance(b)-clearance(a);
  })[0];
  // A camera bookmark derived from an existing individual, never a new tree
  // or a launch-site/world edit. Inspect actual LOD 0 among the live stand.
  const heroTree=placement.instances.filter(t=>t.asset==='redwood/giant_redwood.glb').sort((a,b)=>Math.hypot(a.position_m[0]+710,a.position_m[1]-450)-Math.hypot(b.position_m[0]+710,b.position_m[1]-450))[0];
  const heroCrown=new T.Box3();for(const p of assets[heroTree.asset].primitives)if(/foliage/.test(p.materialName))heroCrown.union(p.geometry.boundingBox.clone().applyMatrix4(instanceMatrix(heroTree.position_m,heroTree.yaw_deg,heroTree.scale,p.local)));
  const heroCentre=heroCrown.getCenter(new T.Vector3()),heroRadius=heroCrown.getSize(new T.Vector3()).x*.5;
  // Look-around camera bookmarks use the existing terrain and launch location.
  const launch=ground.height(-380,1620);
  const views = {
    ...(basin.landform?{
      northBasin:{position:[basin.centre_xy_m[0]+900,ground.height(...basin.centre_xy_m)+1225,-basin.centre_xy_m[1]+1000],target:[basin.centre_xy_m[0],ground.height(...basin.centre_xy_m)+75,-basin.centre_xy_m[1]]},
      northMeadow:{position:[basin.centre_xy_m[0]-295,ground.height(basin.centre_xy_m[0]-295,basin.centre_xy_m[1]+105)+2.2,-basin.centre_xy_m[1]-105],target:[basin.centre_xy_m[0]-150,ground.height(basin.centre_xy_m[0]-150,basin.centre_xy_m[1]+140)+20,-basin.centre_xy_m[1]-140]}
    }:{}),
    graniteRiver:{position:[3180,540,1190],target:[3100,12,580]},
    graniteBank:{position:[2940,37,654],target:[3035,14,599]},
    canopy:{position:heroCentre.clone().add(new T.Vector3(heroRadius*2.1,8,heroRadius*2.3)).toArray(),target:heroCentre.toArray()},
    home: { position: homeCamera, target: [hx, hz + 3, -hy] },
    valley: { position: [-700,ground.height(-700,-700)+140,700], target: [-380,150,-1900] },
    summit: { position: [-150,launch+14,-1350], target: [-380,launch+10,-1620] },
    // Matched to the approved game-village.png capture (62 degree field of view).
    village: { position: [-672,73.8391,-442], target: [-696,89.8391,-472] },
    river: { position: [-640,ground.height(-640,-40)+5,40], target: [-700,20,-500] },
  };
  function setView(name) {
    if(navigation.mode!=='orbit'){setActivity('orbit');}
    const v = views[name];
    document.body.dataset.view = name;
    camera.position.fromArray(v.position); controls.setTarget(...v.target); controls.update();
    document.querySelectorAll('button[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
    updateShadow(true);
  }
  document.querySelectorAll('button[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  window.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.code==='KeyH'||e.key==='Escape')&&!e.repeat&&!e.metaKey&&!e.ctrlKey) document.body.dataset.ui = document.body.dataset.ui==='hidden' ? '' : 'hidden';
    if (['1','2','3'].includes(e.key)) setView(['home','river','valley'][Number(e.key)-1]);
  });
  setView(new URLSearchParams(location.search).get('view') in views ? new URLSearchParams(location.search).get('view') : 'home');
  setLight('golden');

  const meadowFocus=meadowViewFocus(camera,ground);meadow.update(camera,meadowFocus);closeMeadow.update(camera,meadowFocus);

  let frame = 0, contextLost = false, stopped = false, lastFrame = 0, lastStamp = 0;
  let presenting=false;
  let elapsed = 0,lastReadout=0,lastQuality=0;
  const samples = [];
  const metrics = { frame: 0, framesMs: samples, cpuMs: 0, render: {}, get view() { return document.body.dataset.view; } };
  const startup={ready:false,frames:0};
  // Read-only inspection hook used for repeatable visual/performance checks.
  window.tumbler = { airCues,riverGranite,walkHeight,meadowAir,meadowWind,startup,flightRig, scene, camera, renderer, controls, navigation, character, ride: { config: rideConfig, snowAt, surfaceAt, height: rideHeight, hitTest, worldmap, setActivity }, forest, treeShadows, cloudPass, actorShadows, ground, terrain, geology, transition, forestFloor, forestSoil, ecology, closeMeadow, meadow, metrics, views, setView, setLight, provenance: {files:verifiedFiles}, stats: { terrain:terrain.stats,forest: forest.stats, meadow: meadow.stats, placements: placements.stats } };
  async function prepareFirstView(){
    presenting=false;startup.ready=false;
    loading.show();status.textContent='Letting the light settle…';
    const result=await warmScene({
      prepare(){
        terrain.update(camera,canvas.height);riverGranite.update(camera,canvas.height);forest.update(camera,shadowCentre);forestFloor.update(camera);updateShadow();
        meadowViewFocus(camera,ground,meadowFocus);meadow.update(camera,meadowFocus);closeMeadow.update(camera,meadowFocus);
        airCues.update(camera,0);ecology.update(camera,elapsed);sky.position.copy(camera.position);
        const wind=navigation.sampleEnvironment(camera.position.x,-camera.position.z,camera.position.y);
        style.wind.value.set(wind.wx/Math.max(1,flightConfig.wind.speed_mps),-wind.wy/Math.max(1,flightConfig.wind.speed_mps));
      },
      compile:()=>renderer.compileAsync(scene,camera),
      render(){
        renderer.info.reset();
        const pilot=navigation.state;
        actorFocus.set(pilot?.x??camera.position.x,pilot?.z??camera.position.y,-(pilot?.y??-camera.position.z));
        actorShadows.update(actorFocus,style.sun.value);
        cloudPass.render({strength:Number(motionSelect.value)});
      },
      signature:()=>JSON.stringify([renderer.info.memory,renderer.info.programs.length,forest.stats.adopted.lodCounts,meadow.stats.tiles,forestFloor.stats.plants]),
      pending:()=>forest.stats.adopted.transitioning>0,
      finish:()=>finishGpu(renderer.getContext()),
    });
    if(contextLost||stopped)return;
    Object.assign(startup,result,{ready:true});
    // Warm-up costs must not enter play's clock or adaptive-quality samples.
    samples.length=0;lastFrame=0;lastQuality=performance.now();
    status.textContent='Ready for the mountains.';updateStamp();
    presenting=true;loading.reveal();resume();
  }
  function updateStamp() {
    const ordered = [...samples].sort((a,b) => a-b);
    const percentile = p => ordered[Math.floor((ordered.length - 1) * p)] ?? 0;
    stamp.textContent = [
      `Render cap ${WEB_FPS} FPS · scale ${(pixelRatio*qualityScale).toFixed(2)}× · canopy budget 30 Hz`,
      `${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles`,
      `Frame interval p50 ${percentile(.5).toFixed(1)} ms · p95 ${percentile(.95).toFixed(1)} ms`,
      `CPU submit ${metrics.cpuMs.toFixed(1)} ms · ${canvas.width} × ${canvas.height}`,
      `${forest.stats.trees.toLocaleString()} trees · ${forest.stats.near} nearby meshes · ${forest.stats.tiles} batches`,
      `Redwoods LOD 0 / 1 / 2 / 3: ${forest.stats.adopted.lodCounts.join(" / ")} · ${forest.stats.adopted.culled} culled · select ${forest.stats.adopted.selectionMs.toFixed(1)} ms`,
      `${meadow.stats.patches.toLocaleString()} meadow cells · ${meadow.stats.tiles} batches`,
      `Version ${VERSION} · verified ${verifiedFiles} fetched files · generation ${manifest.commit.slice(0,8)} · local working tree`,
    ].join('\n');
  }
  function animate(time) {
    frame = 0;
    if (!presenting || contextLost || stopped || document.hidden) return;
    if(!framePacer.due(time)){navigation.poll();frame=requestAnimationFrame(animate);return;}
    const delta = lastFrame ? time - lastFrame : 0;
    lastFrame = time;
    if (delta > 0 && delta < 500) { samples.push(delta); if (samples.length > 240) samples.shift(); }
    elapsed += Math.min(delta, 50) / 1000;
    style.time.value = elapsed;
    navigation.update(Math.min(delta,50)/1000);applyUnderwater(navigation.underwater);airCues.update(camera,Math.min(delta,50)/1000);meadowAir.update(Math.min(delta,50)/1000);
    terrain.update(camera,canvas.height);riverGranite.update(camera,canvas.height);forest.update(camera,shadowCentre);forestFloor.update(camera);updateShadow();meadowViewFocus(camera,ground,meadowFocus);meadow.update(camera,meadowFocus);closeMeadow.update(camera,meadowFocus);ecology.update(camera,elapsed);soundscape.update(camera,navigation);

    // The canopy owns its view-focused tile budget and conservative wind bounds.
    const flight=navigation.state;
    const rider=rideModes.includes(navigation.mode)?flight:null,riderSpeed=rider?Math.hypot(rider.vx,rider.vy,rider.vz):0;
    const airborne=!!flightConfig.modes[navigation.mode];
    const air=airborne?navigation.air:null;
    if(time-lastReadout>125){
      lastReadout=time;
      const readout=document.getElementById('flight-readout');
      const touchdown=flight?.landingQuality?
        `${flight.landingQuality[0].toUpperCase()+flight.landingQuality.slice(1)} touchdown · ${(flight.landingSpeed??0).toFixed(1)} m/s down · ${((flight.landingGroundSpeed??0)*3.6).toFixed(0)} km/h along ground`+
        ((flight.landingRunM??0)>.5?` · ${Math.round(flight.landingRunM)} m run`:''):'Landed';
      readout.textContent=rider?(rider.crashed?`Contact: ${rider.crashed} · Launch to go again`:
        `${rideConfig.modes[rider.mode].label} · ${(riderSpeed*3.6).toFixed(0)} km/h · ${Math.round(rider.startZ-rider.z)} m down · ${(rider.distance/1000).toFixed(2)} km · ${rider.grounded?rider.surface:'airborne'}`):
        !airborne?(navigation.mode==='walk'?(navigation.message||`On foot · V / R3: ${navigation.view==='first'?'chase view':'first person'} · Space / A: ${flight.jumpPhase==='airborne'?flight.jumpStyle.replace('_',' '):'jump'}${flight.harnessMode?' · E / X: reharness':''}`):''):
        flight.launching?`${flight.launchStage==='running'?'Running for takeoff':'Inflating the wing'} · ${Math.round((flight.launchProgress??0)*100)}%\n${(flight.speed*3.6).toFixed(0)} km/h · E / X: cancel and unhook`:
        flight.grounded?`${flight.launchAborted?flight.figure:touchdown}${flight.impact?` · Contact with ${flight.impact}`:''}\n${navigation.message||'E / X: unhook · Space / A: launch here'}`:
        `${flightConfig.modes[flight.mode].label}  /  ${flightConfig.weather[navigation.weather].label}\n`+
        `${(flight.speed*3.6).toFixed(0)} km/h AIR   ${(flight.groundSpeed*3.6).toFixed(0)} GROUND   ${Math.round(air.agl)} m AGL\n`+
        `${flight.vario>=0?'+':''}${flight.vario.toFixed(1)} m/s   ${flight.load.toFixed(1)} g   Wind from ${Math.round((Math.atan2(-air.wx,-air.wy)*180/Math.PI+360)%360)}° ${(air.windSpeed*3.6).toFixed(0)} km/h`+
        (flight.mode==='paramotor'?`   Motor ${Math.round(flight.engine*100)}% / set ${Math.round(flight.throttle*100)}% · ${Math.round(flight.thrustN??0)} N thrust`:'')+
        (flight.mode==='parakite'?`\nHandle pull L ${Math.round(flight.handleLeft*100)}% / R ${Math.round(flight.handleRight*100)}% · 45% best glide`:
          `\nBrakes L ${Math.round(flight.brakeLeft*100)}% / R ${Math.round(flight.brakeRight*100)}% · Speedbar ${Math.round(flight.accelerator*100)}%`)+
        `\n${flight.figure}`+
        (flight.stall>.15?'\nLOW ENERGY · Ease the handles':air.lee>.15?'\nLEE SIDE · Descending, turbulent air':Math.abs(air.turbulence)>.85?'\nTURBULENT AIR':'');
      readout.dataset.warning=String(airborne&&!flight.launching&&(flight.grounded?flight.landingQuality==='hard':flight.stall>.15||air.agl<12));
      if(airborne&&flight.challenge){
        const goal=flightConfig.challenges[flight.challenge.id],progress=flight.challenge;
        readout.textContent+=`\n${goal.label}: ${progress.status==='complete'?'Complete':progress.status==='retry'?'Try again on your next flight':goal.goal==='linked_turns'?`${progress.lastSide?Math.min(progress.turns+1,goal.reversals+1):0} / ${goal.reversals+1} turns`:`Touch down gently below ${Math.round(goal.max_ground_mps*3.6)} km/h`}`;
      }
      document.body.dataset.flying=String(airborne);document.body.dataset.pilotView=navigation.view;
    }
    const localWind=air??navigation.sampleEnvironment(camera.position.x,-camera.position.z,camera.position.y);
    style.wind.value.set(localWind.wx/Math.max(1,flightConfig.wind.speed_mps),-localWind.wy/Math.max(1,flightConfig.wind.speed_mps));
    // Slow, bounded render-scale adaptation. Preserve the user's chosen ceiling.
    if(time-lastQuality>3000&&samples.length>=120){
      lastQuality=time;const ordered=[...samples].sort((a,b)=>a-b),p95=ordered[Math.floor(ordered.length*.95)];
      const next=resolutionGovernor.sample(p95,time,document.getElementById('adaptive').checked);
      if(Math.abs(next-qualityScale)>.001){qualityScale=next;adoptedForest.setQuality(qualityScale);samples.length=0;renderer.setPixelRatio(pixelRatio*qualityScale);renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);}
    }
    sky.position.copy(camera.position);
    const start = performance.now();
    try {
      renderer.info.reset();
      const pilot=navigation.state;
      actorFocus.set(pilot?.x??camera.position.x,pilot?.z??camera.position.y,-(pilot?.y??-camera.position.z));
      actorShadows.update(actorFocus,style.sun.value);
      cloudPass.render({speed:airborne&&!flight.grounded?Math.min(1,Math.max(0,(flight.speed-12)/22)):0,strength:Number(motionSelect.value)});
    }
    catch (error) { stopped = true;presenting=false;loading.fail(error);status.textContent = `Render error: ${error.message}`; console.error(error); return; }
    metrics.cpuMs = performance.now() - start; metrics.frame++;
    Object.assign(metrics.render, renderer.info.render);
    if (time - lastStamp > 700) { updateStamp(); lastStamp = time; }
    frame = requestAnimationFrame(animate);
  }
  function resume() { lastFrame = 0;framePacer.reset(); if (presenting && !frame && !contextLost && !stopped && !document.hidden) frame = requestAnimationFrame(animate); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else resume(); });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); contextLost = true; cancelAnimationFrame(frame); frame = 0;
    presenting=false;startup.ready=false;loading.show('The light slipped away. Preparing it again…');
    status.textContent = 'Graphics paused — recovering…';
  });
  canvas.addEventListener('webglcontextrestored', async () => {
    try { contextLost=false;treeShadows.setSun(style.sun.value);cloudPass.lighting.update(true);cloudPass.shadows.update(true);forest.rebuildImpostors();ecology.rebuildImpostors();updateShadow(true);await prepareFirstView(); }
    catch(error){stopped=true;loading.fail(error);console.error(error);}
  });
  window.addEventListener('pagehide', e => { if (!e.persisted) { stopped = true; cancelAnimationFrame(frame); riverGranite.dispose();geology?.dispose();terrain.dispose();ecology.dispose();airCues.dispose();forestLitterTexture.dispose();litterBitmap.close();forestFloor.dispose();forestSoil.dispose();meadowAir.dispose();meadowWind.dispose();meadow.dispose();soundscape.dispose();navigation.dispose();flightRig.dispose();character.dispose();actorShadows.dispose();cloudPass.dispose();controls.dispose(); renderer.dispose(); } });
  await prepareFirstView();
}
