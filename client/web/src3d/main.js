import {createFirstPersonFlight} from './first-person-flight.js';
import {forestSpacing} from '../../../shared/activities/forest-spacing.js';
import {createParaGuide} from './para-guide.js';
import {createParakitePractice} from './parakite-practice.js';
import {createParakiteTour} from './parakite-tour.js';
import {createParaSignals} from './para-signals.js';
import {createParaPass} from './para-pass.js';
import {createParaStreaks} from './para-streaks.js';
import {treePlayFocus} from './tree-surface.js';
import {createPlayerVisibility} from './player-visibility.js';
import {stepScenicCourse} from '../../../shared/activities/scenic-course.js';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {buildRiverGranite} from './river-granite.js';
import {createAirCues,createMeadowAir} from './air-cues.js';
/** Browser composition only: the core remains the source of the world. */
import * as T from '../vendor/three.module.min.js';
import { createOrbitControls } from './controls.js';
import {buildStreamingTerrain} from './terrain-lod.js';
import {buildGeology} from './geology.js';
import {setMountainMap,mountainMapStats} from './granite-shading.js';
import {createGeologySampler,applyGeologyTerrain} from '../../../shared/geometry/granite/surface.js';
import { buildHorizonRange, buildWater, buildRiverReaches } from './terrain.js';
import { buildPlacements, buildForest } from './placements.js';
import {buildFalls} from './falls.js';
import {createMirror} from './mirror.js';
import {createReflections,createMovers,loadProbes,PROBE_FILE,MOVERS_LAYER,DEPTH_LAYER} from './reflections.js';
import {createUnderwater} from './underwater.js';
import { buildTreeGroundShadows } from './forest.js';
import {instanceMatrix,toScene} from './world.js';
import {openingShot} from './opening-shot.js';
import {setTreeLighting} from './tree-surface.js';
import {createDistantTreeShadows,updateTreeSunShadow,bindTreeSunShadow,setTreeShadowFocus,setNearTreeShadows,SCENERY_SHADOW_SPAN,SCENERY_SHADOW_RESOLUTION} from './tree-shadows.js';
import {createRidgeCull} from './ridge-cull.js';
import {buildForestField,forestField} from './forest-field.js';
import {buildForestFloor} from './forest-floor.js';
import {buildAdoptedRedwoods,releaseCrownSources} from './redwood-rendering.js';
import { GroundSampler, HeightGrid, decodeGroundCover,mergeGroundCover,coverAmount,landscapeHeightGrid } from './heights.js';
import { buildCloseMeadow, meadowViewFocus } from './groundcover.js';
import {buildGrassCanopy} from './grass-canopy.js';
import { parseGLB, applyImageBytes, mergePrimitives } from './glb.js';
import { makeSky, style } from './style.js';
import { createCloudPass } from './clouds.js';
import {createActorShadows,snappedShadowAnchor} from './actor-shadow.js';
import { createResolutionGovernor, createQualityGate } from './flight-quality.js';
import {createFramePacer,WEB_FPS,WEB_FRAME_MS} from './frame-pacing.js';
import { createFlightRig } from './flight-rig.js';
import { createNavigation } from './navigation.js';
import { createCharacter } from './character.js';
import { createFolkLayer } from './folk.js';
import { createOrganoid } from './organoid-material.js';
import { stageOrganoid } from './organoid-encounter.js';
import { stageOrganoidTutor } from './organoid-tutor.js';
import { createGondolaLayer } from './gondola.js';
import { createPlayerUI } from './player-ui.js';
import { buildGondola, deckFloor } from '../../../shared/activities/gondola.js';
import { buildEcology } from './ecology.js';
import { createVisitorWatch } from './insect-visits.js';
import { createPlayProps } from './play-props.js';
import { buildTethers, buildTrails, TRAIL_SURFACE_LIFT } from './details.js';
import { buildGenerators } from './generators.js';
import { createSoundscape, treeSpots } from './audio.js';
import {createFoleyEvents} from './character-foley.js';
import { buildWorldCollision } from './collision.js';
import { sha256, verifyFetched, checkVersion, WORLDMAP_VERSION } from './provenance.js';
import {fetchAssetBytes} from './asset-bytes.js';
import {VERSION} from './version.js';
import { createSnowSampler, createTrailSampler, createSurfaceSampler, createRideHeight } from '../../../shared/activities/ride.js';
import { createWalkHeight, walkSpawn } from '../../../shared/activities/walk.js';
import { setController, stageFlightGuide, command } from '../../../shared/npc/folk.js';
import {createLoadingScreen,warmScene,finishGpu,nextPaint} from './loading.js';

const root = new URL('../../../', import.meta.url);
const observed=new Map();
// Source GLB -> its meshopt-packed copy (viewer.json's `packed`, from tools/pack_meshopt.py).
let packed={};
async function fetchData(path, json = true) {
  path=packed[path]??path;
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
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{console.error('shader compile',gl.getShaderInfoLog(vertex)||'',gl.getShaderInfoLog(fragment)||'',gl.getProgramInfoLog(program)||'');throw new Error('The light could not be prepared on this graphics device. Please try again.');};
  const scene = new T.Scene();
  scene.background = new T.Color('#dcdcc1');
  scene.fog = new T.Fog('#dcdcc1', 2500, 11500);
  const camera = new T.PerspectiveCamera(62, 1, .15, 60000);
  camera.position.set(-1600, 200, -780);
  const controls = createOrbitControls(camera, canvas);
  const renderTargets=[[640,400],[800,500],[960,600],[1024,640],[1152,720],[1280,720],[1280,800],[1366,768],[1440,900],[1680,1050],[1920,1200],[2560,1600]];
  const renderTarget=document.getElementById('render-target'),renderTargetLabel=document.getElementById('render-target-label');
  let pixelRatio = 1,qualityScale=1;
  // Let healthy views refresh up to 60 Hz. Keep the existing visual-quality
  // threshold: missing 60 alone is not a reason to soften the whole scene.
  const resolutionGovernor=createResolutionGovernor({frameBudgetMs:Math.max(WEB_FRAME_MS,1000/30)});
  const qualityGate=createQualityGate(resolutionGovernor);
  const framePacer=createFramePacer();
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    const [targetWidth,targetHeight]=renderTargets[Number(renderTarget.value)]??renderTargets[8];
    pixelRatio=Math.min(targetWidth/Math.max(1,width),targetHeight/Math.max(1,height));
    renderTargetLabel.value=`${targetWidth} × ${targetHeight}`;
    renderTargetLabel.textContent=renderTargetLabel.value;
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
  observed.delete('client/web/data/viewer.json');  // the manifest cannot list its own hash
  packed=manifest.packed??{};
  const transition=await fetchData('shared/world/out/landscape_transition.json');checkVersion(transition,1,'landscape transition');
  // Life in the water (phase 11): its own file, built after the granite so it never moves the rocks.
  const aquatic=await fetchData('shared/ecology/aquatic.json');checkVersion(aquatic,1,'water life');
  const geologyData=worldmap.mountains.geology?await fetchData(worldmap.mountains.geology):null;
  if(geologyData)checkVersion(geologyData,1,'mountain geology');
  const speedflying=worldmap.activities.speedflying?await fetchData(worldmap.activities.speedflying):null;
  if(speedflying)checkVersion(speedflying,1,'scenic flight courses');
  placement={...placement,instances:[...placement.instances,...transition.instances]};
  checkVersion(manifest,1,'viewer manifest');checkVersion(worldmap,WORLDMAP_VERSION,'world map');
  const [meadowData,flightConfig,rideConfig]=await Promise.all([fetchData(worldmap.activities.meadow_life),fetchData(worldmap.activities.flight),fetchData(worldmap.activities.ride)]);
  const generatorsConfig=await fetchData(worldmap.activities.generators);checkVersion(generatorsConfig,1,'generator rotors');
  const characterConfig=await fetchData(worldmap.activities.character);
  const cameraPolicy=await fetchData(worldmap.activities.camera??'shared/activities/camera.json');checkVersion(cameraPolicy,1,'camera policy');
  const needsSpacing=Object.values(cameraPolicy.profiles).some(p=>p.follow_spacing_fraction>0)||cameraPolicy.areas.some(a=>a.settings.follow_spacing_fraction>0);
  const cameraSpacing=needsSpacing?forestSpacing(placement.instances):{meanNearestM:0};
  const chargeBytes=await fetchData('client/web/assets/audio/character/charge.wav',false);
  const branchData=await fetchData('shared/geometry/tree-design/branch-graphs.json');checkVersion(branchData,1,'tree branch graph');
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
  const farGrid = new HeightGrid({ values: sourceFarGrid.values, ...manifest.height_grids.far_field, kind: 'far field' });
  const geologyHeight=geologyData?createGeologySampler(geologyData):null;
  const riverData=await fetchData('shared/world/out/river_granite.json');
  const riverSurface=createRiverGranite(riverData);
  const ground = new GroundSampler(blockGrid, farGrid, riverSurface.height, geologyHeight);
  status.textContent = 'Opening the meadow…';
  loading.phase('Unpacking the meadow, homes and trees…',1);
  // Bounded parallel loading avoids a serial network waterfall and limits peak
  // parsing memory. Source bytes fall out of scope as each asset is decoded.
  const paths = [...new Set([...placement.instances.map(i => i.asset),...habitats.plantings.map(i=>i.asset),...aquatic.plantings.map(i=>i.asset),'waterside/duck.glb',...meadowData.species.map(i=>i.asset),'waterside/river_fish.glb','waterside/fish_tail.glb','waterside/frog.glb','waterside/dragonfly_wings.glb',flightConfig.wing_asset,flightConfig.motor_asset,...Object.values(flightConfig.modes).map(m=>m.wing_asset).filter(Boolean),...Object.values(rideConfig.modes).map(m=>m.asset)])];
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
  loading.phase('Checking every page of the world…',2);
  loading.phase('Sketches into sunlight. Growing the world…',3);
  await nextPaint();await nextPaint();
  const landscapeGrid=landscapeHeightGrid(blockGrid,farGrid);
  setMountainMap(landscapeGrid);
  const horizonData=await fetchData('shared/world/out/horizon_range.json');
  const horizonMap=new T.CanvasTexture(await createImageBitmap(new Blob([await fetchData(horizonData.map.file,false)],{type:'image/png'}),{imageOrientation:'none',colorSpaceConversion:'none'}));
  horizonMap.flipY=false;horizonMap.colorSpace=T.SRGBColorSpace;horizonMap.anisotropy=8;
  const horizonRange=buildHorizonRange(horizonData,horizonMap);scene.add(horizonRange);
  const terrain=buildStreamingTerrain(landscapeGrid);
  scene.add(terrain.group);
  const geology=geologyData?buildGeology(geologyData,assets):null;
  if(geology)scene.add(geology.group);
  const riverGranite=buildRiverGranite(riverSurface,assets[riverData.geometry],terrain,assets,landscapeGrid);scene.add(riverGranite.group);
  const water = buildWater(placement.instances.filter(i => i.kind === 'river' || i.kind === 'lake'), assets, blockGrid,worldmap);
  scene.add(water, buildRiverReaches(worldmap, farGrid, riverSurface));
  const fallsWidth=+new URLSearchParams(location.search).get('falls_width');
  // The two other water looks, for the final comparison (phase 14): ?water_look=clear or ?water_look=deep.
  style.waterLook.value={clear:1,deep:2}[new URLSearchParams(location.search).get('water_look')]??0;
  const falls=worldmap.water.form?buildFalls(worldmap,ground,fallsWidth>0?{width:fallsWidth}:{}):null;if(falls)scene.add(falls.group);
  const placements = buildPlacements(placement, assets, { ground,crownAssets:new Set(Object.keys(treePlan.targets)) }); scene.add(placements.group);
  // Set the initial sun before expensive atlas bakes; the first preset then
  // reuses them instead of immediately paying for a second bake.
  const lightPresets = {
      golden: { direction: [-.64,.48,-.55], color: '#ffdda2', fill: '#a8cbdc', intensity: 2.0, ambient: 1.8, exposure: 1.1, warmth: 1, fog: '#d3d8d0', windPhase: 'evening' },
      day: { direction: [-.35,.84,-.42], color: '#fff3d6', fill: '#b7ddef', intensity: 2.0, ambient: 1.75, exposure: 1.05, warmth: .15, fog: '#c8dcd6', windPhase: 'afternoon' },
      dusk: { direction: [.74,.25,-.63], color: '#ffc18d', fill: '#9baccd', intensity: 1.6, ambient: 1.55, exposure: 1.1, warmth: .85, fog: '#d9b7aa', windPhase: 'night' },
    };
  setTreeLighting({...lightPresets.golden,sun:lightPresets.golden.color,ground:'#7a8452'});
  style.sun.value.set(-.64,.48,-.55).normalize();
  const forestSoil=buildForestField(placement,assets,forestCover.habitat,{stamp:forestCover,span:farGrid.maxX*2,resolution:2048});
  const legacyForest=buildForest(placement,assets,renderer,{filter:i=>i.asset.startsWith('redwood/')&&!treePlan.targets[i.asset]});
  // On foot the ridge culling is aggressive; flying and the free camera keep the cautious test (ridge-cull.js).
  const groundModes=new Set(['walk','ski','bike']);let onFoot=()=>false;
  const adoptedForest=buildAdoptedRedwoods(placement,assets,renderer,treePlan,{detachEmpty:true,ridge:{...createRidgeCull(farGrid),aggressive:()=>onFoot()}});
  adoptedForest.stats.releasedSourceBytes=releaseCrownSources(assets,treePlan);
  const forest={group:new T.Group(),stats:{},update(camera,anchor){legacyForest.update(camera,anchor);adoptedForest.update(camera,controls.target);this.refreshStats();},
    refreshStats(){for(const key of ['trees','near','mid','far','tiles','shadowProxies','shadowRevision'])this.stats[key]=(legacyForest.stats[key]??0)+(adoptedForest.stats[key]??0);this.stats.adopted=adoptedForest.stats;},
    setRidgeCulling(on){adoptedForest.setRidgeCulling(on);},
    invalidateShadows(){legacyForest.invalidateShadows();adoptedForest.invalidateShadows();this.refreshStats();},
    rebuildImpostors(direction){legacyForest.rebuildImpostors(direction);adoptedForest.rebuildImpostors(direction);this.refreshStats();},
    dispose(){legacyForest.dispose();adoptedForest.dispose();}};
  forest.group.add(legacyForest.group,adoptedForest.group);forest.refreshStats();scene.add(forest.group);
  const treeShadows=buildTreeGroundShadows(placement,assets,ground,renderer,adoptedForest.shadowCrowns);scene.add(treeShadows.group);
  const blockCover=decodeGroundCover(stampData),cover=mergeGroundCover(blockCover,decodeGroundCover(transition.grass));
  // Snow depths are vertex samples (y = offset + row * quad), so a texel's centre sits on its vertex.
  const snowQuad=snowStamp.grid.quad_size_m;
  style.snowGrid.value.set(snowStamp.grid.offset_xy_m[0]-snowQuad/2,snowStamp.grid.offset_xy_m[1]-snowQuad/2,snowQuad,snowStamp.grid.resolution);
  const snowAt=createSnowSampler(snowStamp);
  const trail=createTrailSampler(worldmap),surfaceAt=createSurfaceSampler(rideConfig,snowAt,trail);
  const snowTexture=new T.DataTexture(Uint8Array.from(snowAt.depth,d=>Math.round(Math.min(1,d/snowStamp.model.max_depth_m)*255)),snowAt.resolution,snowAt.resolution,T.RedFormat);
  snowTexture.minFilter=snowTexture.magFilter=T.LinearFilter;snowTexture.needsUpdate=true;style.snow.value=snowTexture;
  const forestFloor=buildForestFloor(forestCover,forestSoil,ground,snowAt,(x,y)=>surfaceAt(x,y)==='trail');scene.add(forestFloor.group);
  // ONE reading of the shared grass stamp: how much sunlit sward each cell carries, 0..255.
  // The terrain's sward tint, the blades, balance and footsteps all read it, so no ground is
  // painted green without grass or grows grass the terrain does not paint (ground-seams
  // review, findings 2/3/5/11/12). Every test is a ramp matched to the shader's own ramp for
  // the same material, not a cut, so sward and blades fade out together. Read at the cell's
  // own sample point on the rendered ground. ponytail: this is this client's interpretation
  // of the stamp; publish it from the core once a second client needs the same answer.
  const ramp=(a,b,v)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
  const grassCover={resolution:cover.resolution,quad:cover.quad,offsetX:cover.offsetX,offsetY:cover.offsetY,covered:new Uint8Array(cover.covered.length),amount:new Uint8Array(cover.covered.length)};
  for(let row=0;row<cover.resolution;row++)for(let col=0;col<cover.resolution;col++){
    const i=row*cover.resolution+col,stamped=cover.amount?cover.amount[i]/255:cover.covered[i];if(!stamped)continue;
    const x=cover.offsetX+(col+.5)*cover.quad,y=cover.offsetY+(row+.5)*cover.quad,h=ground.height(x,y);
    if(h===null||surfaceAt(x,y)==='trail')continue;
    const baseHeight=blockGrid.sample(x,y)??farGrid.sample(x,y),rockHeight=geologyHeight?.(x,y);
    if(rockHeight!=null&&rockHeight>baseHeight)continue;  // a granite roof over the soil
    // Slope of the drawn terrain lattice itself (the soil's surface; rock roofs are tested above).
    const soil=(sx,sy)=>landscapeGrid.sample(sx,sy)??h,pitch=4,slope=Math.hypot(soil(x+pitch,y)-soil(x-pitch,y),soil(x,y+pitch)-soil(x,y-pitch))/(2*pitch);
    const grass=stamped*ramp(22,24,h)                       // style.js: sward smoothstep(22,24) over the shore
      *(1-ramp(.03,.14,snowAt(x,y)))                        // style.js: coreSnow smoothstep(.03,.14)
      *(1-ramp(.12,.32,riverSurface.granite(x,y)??0))       // the river's granite banks
      *(1-ramp(.55,.85,slope))                              // style.js: slopeMask smoothstep(.5,.78) plus its noise
      *(1-ramp(.4,.56,forestSoil.sample(x,y)));             // crown shade hands the ground to litter
    grassCover.amount[i]=Math.round(grass*255);grassCover.covered[i]=+(grassCover.amount[i]>0);
  }
  const coverTexture=new T.DataTexture(grassCover.amount,cover.resolution,cover.resolution,T.RedFormat);
  coverTexture.minFilter=coverTexture.magFilter=T.LinearFilter;coverTexture.needsUpdate=true;
  style.cover.value=coverTexture;style.coverGrid.value.set(cover.offsetX,cover.offsetY,cover.quad,cover.resolution);
  const grassGl=renderer.getContext();
  const meadow = buildGrassCanopy(grassCover,ground,{samples:grassGl.getParameter(grassGl.SAMPLES),batchTiles:6});
  scene.add(meadow.group);
  const closeMeadow = buildCloseMeadow(grassCover,ground,{flowerMix:stampData.density.flower_colour_mix});scene.add(closeMeadow.mesh);
  const ecology=buildEcology({...habitats,plantings:[...habitats.plantings,...aquatic.plantings],deep_schools:aquatic.deep_schools,rafts:aquatic.rafts},meadowData,assets,ground,closeMeadow,renderer,(x,y,z)=>navigation.sampleEnvironment(x,y,z));scene.add(ecology.group);
  scene.add(buildTethers(placement,assets),buildTrails(worldmap,ground));
  const flightRig=createFlightRig(assets,flightConfig),rig=flightRig.group;
  scene.add(rig);
  const rideRig=new T.Group();rideRig.name='player_ride';rideRig.rotation.order='YXZ';rideRig.visible=false;
  const rideMeshes=Object.fromEntries(Object.entries(rideConfig.modes).map(([name,m])=>{const merged=mergePrimitives(assets[m.asset].primitives,'opaque');const mesh=new T.Mesh(merged.geometry,merged.material);mesh.castShadow=true;mesh.visible=false;rideRig.add(mesh);return [name,mesh];}));
  scene.add(rideRig);
  const rideHeight=createRideHeight((x,y)=>ground.height(x,y)??0,trail);
  const stairData=await fetchData('shared/geometry/arboreal/village_stairs.json');checkVersion(stairData,1,'village stairs');
  const hitTest=buildWorldCollision(placement,assets,treePlan,branchData,stairData);
  const character=createCharacter(assets[characterConfig.asset],characterConfig);scene.add(character.object);
  const firstPerson=createFirstPersonFlight(characterConfig,{compile:root=>{const target=renderer.getRenderTarget();try{renderer.setRenderTarget(cloudPass.opaque);return renderer.compileAsync(root,camera,scene);}finally{renderer.setRenderTarget(target);}}}),leftGrip=new T.Vector3(),rightGrip=new T.Vector3();scene.add(firstPerson.group);
  // The gondola's stations are floors to walk on: their decks and the ramps up to them.
  const gondolaLine=buildGondola(await fetchData('shared/activities/gondola.json'),(x,y)=>ground.height(x,y),hitTest);
  const paraSignals=createParaSignals({height:(x,y)=>walkHeight.floorHeight(x,y),hitTest,gondola:gondolaLine,clock:()=>folk?.api.world.time??0});
  const paraPass=createParaPass(renderer,camera);
  const paraStreaks=createParaStreaks();scene.add(paraStreaks.mesh);
  const walkHeight=createWalkHeight(worldmap,(x,y)=>{const z=ground.height(x,y),deck=deckFloor(gondolaLine,x,y);return deck===null||!Number.isFinite(z)?z:Math.max(z,deck);});
  // Match the existing presentation lift of the rendered tread. Its authored
  // profile remains the shared physical floor; this offset only clears pixels.
  const characterHeight=(x,y)=>{const z=walkHeight.floorHeight(x,y),t=walkHeight.trailAt(x,y);return z===null?null:t?.beyond===0?Math.max(z,t.z+TRAIL_SURFACE_LIFT):z;};
  // Balance (shared/activities/balance.js) reads the ground he stands on as the client draws
  // it (groundSurface, below): snow, grass, litter or trail are soft; the rest is granite.
  const balanceConfig=await fetchData('shared/activities/balance.json');checkVersion(balanceConfig,1,'balance rules');
  const [tumbleHill,reactionTable,places]=await Promise.all([fetchData('shared/play/tumble-hill.json'),fetchData('shared/play/reactions.json'),fetchData('shared/play/places.json')]);
  checkVersion(places,1,'named places');
  // What is underfoot, as this client draws it: one answer for balance and for footsteps.
  // Snow keeps the riders' own .03 m (shared/activities/ride.js); grass is the field above.
  const groundSurface=(x,y)=>{
    if(snowAt(x,y)>.03)return 'snow';
    if(surfaceAt(x,y)==='trail')return 'trail';
    const base=blockGrid.sample(x,y)??farGrid.sample(x,y),rock=geologyHeight?.(x,y);
    if((riverSurface.granite(x,y)??0)>.22||rock!=null&&rock>base)return 'stone';
    if(coverAmount(grassCover,x,y)>=.5)return 'grass';
    return forestSoil.sample(x,y)>.48?'litter':'bare';
  };
  const balanceSurface=(x,y)=>({snow:'snow',trail:'grass',grass:'grass',litter:'grass'})[groundSurface(x,y)]??'granite';
  const localHost=/^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(location.hostname);
  const experimentalParakite=localHost&&new URLSearchParams(location.search).has('rotational-parakite');
  // Parakite-only sites sit after the shared launches, so a launch index means the same thing in every mode.
  const practiceLaunch=experimentalParakite?flightConfig.parakite_practice_launch:null;
  const parakiteSites=[...flightConfig.parakite_launches??[],...practiceLaunch?[practiceLaunch]:[]];
  const practiceSite=practiceLaunch?flightConfig.launches.length+parakiteSites.length-1:-1;
  const playerFlight={...flightConfig,experimentalParakite,launches:[...flightConfig.launches,...parakiteSites]};
  const navigation=createNavigation(camera,canvas,controls,ground,playerFlight,worldmap,rig,hitTest,{config:rideConfig,surfaceAt,snowAt,height:rideHeight,rig:rideRig,meshes:rideMeshes},character,characterConfig,{cameraPolicy,forestSpacingM:cameraSpacing.meanNearestM,walkHeight,floorHeight:walkHeight.floorHeight,characterHeight,balance:{config:balanceConfig,surfaceAt:balanceSurface},firstPersonEye:()=>firstPerson.eye,firstPersonCollar:()=>firstPerson.collarBounds,firstPersonBody:body=>firstPerson.update({...body,grips:[flightRig.getGripWorld(1,leftGrip),flightRig.getGripWorld(-1,rightGrip)],air:navigation.sampleEnvironment(body.state.x,body.state.y,body.state.z)}),onFlightChange:syncFlightUI,flightPresentation:(pose,view,dt,effects)=>{const sample=paraSignals.update(pose,navigation.sampleEnvironment(pose.x,pose.y,pose.z),dt,effects,view);paraStreaks.update(sample,camera,view,effects);return sample;},haptics:()=>document.getElementById('haptics').checked});
  onFoot=()=>groundModes.has(navigation.mode);
  // The world's generators turn in the same air the wing does. They are not
  // decoration on a timer: calm air slows them and the afternoon's up-valley
  // breeze slows them again, because both come from the shared field through
  // `sampleEnvironment`.
  const generators=buildGenerators({placement,assets,placements,config:generatorsConfig,air:(x,y,z)=>navigation.sampleEnvironment(x,y,z)});
  const folk=await createFolkLayer({fetchData,worldmap,placement,flightConfig,walkConfig:characterConfig.walk,height:walkHeight,ground:(x,y)=>ground.height(x,y),hitTest,gondola:gondolaLine,balance:{config:balanceConfig,surfaceAt:balanceSurface},assets,scene,camera,canvas});
  // Cabins run on the folk world's clock, so the cats ride in the cabins drawn.
  const gondola=createGondolaLayer({line:gondolaLine,scene,navigation,clock:()=>folk.api.world.time,panel:document.getElementById('gondola-panel')});
  const [organoidConfig,organoidMaterial,organoidMesh,organoidLow,organoidHigh,organoidCues,organoidVoice]=await Promise.all([
    fetchData('shared/npc/organoid.json'),
    fetchData('shared/geometry/organoid/material.json'),
    fetchData('shared/geometry/organoid/shell.glb',false),
    fetchData('shared/geometry/organoid/density-38.r8.gz',false),
    fetchData('shared/geometry/organoid/field-76.r8.gz',false),
    fetchData('client/web/assets/audio/organoid/cues.json'),
    fetchData('client/web/assets/audio/organoid/dialogue.mp3',false),
  ]);
  checkVersion(organoidConfig,1,'Organoid encounter');
  checkVersion(organoidMaterial,1,'Organoid material');
  const organoidActor=await createOrganoid(organoidMaterial,parseGLB(organoidMesh).primitives[0].geometry,organoidLow,organoidHigh);
  // The lake's baked reflection probes (reflections.js); a bake older than the world it shows is not used.
  const probeManifest=await fetchData(PROBE_FILE).catch(()=>null);
  const probeData=probeManifest?await loadProbes(probeManifest,path=>fetchData(path,false),new Map(manifest.fetched.map(e=>[e.path,e.sha256]))):null;
  if(probeData?.stale.length)console.warn(`Lake reflection probes are stale (${probeData.stale.join(', ')}); rerun client/web/tools/bake-reflections.cjs`);
  // After the last fetchData, so each loaded file is checked against the bytes used.
  status.textContent='Checking world bytes…';
  const verifiedFiles=await verifyFetched(manifest.fetched,observed);
  // Full/half Cat Ronin (button, C, or ?cat=half): presentation and camera only;
  // speeds, jumps and collision stay full size. A start for a shrink/grow mechanic.
  const catSize=document.getElementById('cat-size'),HALF_CAT=.52;
  const toggleCatSize=()=>{characterConfig.scale=characterConfig.scale===1?HALF_CAT:1;character.setScale(characterConfig.scale);const half=characterConfig.scale!==1;catSize.textContent=half?'Cat: half size':'Cat: full size';catSize.setAttribute('aria-pressed',String(half));};
  catSize.addEventListener('click',toggleCatSize);
  window.addEventListener('keydown',e=>{if(e.code==='KeyC'&&document.body.dataset.uiMode!=='player'&&!e.repeat&&!e.metaKey&&!e.ctrlKey&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))toggleCatSize();});
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
  const soundscape=createSoundscape(habitats,treeSpots(placement.instances),chargeBytes,organoidVoice,{worldmap,rafts:aquatic.rafts}),cameraShake=new T.Vector3();
  // Tumble Hill: its props answer a katana blow (on the blade's swish) and a body running,
  // tumbling or rolling into them (shared/play/reactions.json).
  const play=createPlayProps({hill:tumbleHill,table:reactionTable,height:characterHeight,scene,cue:name=>soundscape.cue(name)});
  const organoid=stageOrganoid({config:organoidConfig,clips:organoidCues,actor:organoidActor,scene,camera,canvas,
    navigation,character,characterScale:()=>characterConfig.scale,height:characterHeight,hit:hitTest,waterAt:walkHeight.waterAt,
    instances:placement.instances,hill:tumbleHill.fall_line_xy_m,playProps:play.props,sun:style.sun.value,soundscape,panel:document.getElementById('organoid-scene')});
  // The Organoid as guide: tips about the thing the player is standing near, on the ground only.
  const tutor=stageOrganoidTutor({config:organoidConfig,organoid,soundscape,clip:organoidCues[organoidConfig.tutor.call.clip],
    panel:document.getElementById('organoid-tip'),navigation,characterScale:()=>characterConfig.scale,
    anchors:{'tumble-hill':tumbleHill.fall_line_xy_m,gondola:gondolaLine.stations.map(s=>s.xy_m)}});
  const visitors=createVisitorWatch({ecology,character,navigation,camera,focusEl:document.getElementById('focus')});
  character.onCue=name=>{soundscape.cue(name);if(['swish','swish_heavy','spin','impact'].includes(name)&&navigation.mode==='walk')play.swing([navigation.state.x,navigation.state.y],navigation.state.heading??0);};
  const foleyEvents=createFoleyEvents(name=>soundscape.cue(name));
  // Interpret existing physical/stamped facts; never infer a material from color.
  // Unclassified bare ground uses a restrained earth/grit texture, not a new world tag.
  function footstepSurface(s){
    if(s.mode==='branch')return 'wood';
    return ({snow:'snow',stone:'stone',trail:'gravel',grass:'grass',litter:'grass'})[groundSurface(s.x,s.y)]??'gravel';
  }
  let foleySpeed=0;
  function updateFoley(dt){
    const s=navigation.state;if(organoid.active||!s||navigation.mode==='orbit'){foleyEvents.reset();foleySpeed=0;return;}
    const action=character.bodyAction,clip=action?.getClip();
    foleyEvents.update({mode:navigation.mode,activity:s.mode,x:s.x,y:s.y,z:s.z,speed:s.speed??0,
      grounded:!!s.grounded,swimPhase:s.swimPhase,turnRate:s.turnRate,accel:dt>0?((s.speed??0)-foleySpeed)/dt:0,
      feet:character.footContacts,bark:character.contacts.filter(c=>c.target==='bark').map(c=>c.bone),
      clip:clip?.name,cycle:clip?Math.floor(action.time/clip.duration*2):0,surface:footstepSurface(s)},dt);
    foleySpeed=s.speed??0;
  }
  const soundButton=document.getElementById('sound');
  const windWaterToggle=document.getElementById('wind-water-audio');
  soundscape.setWindWaterEnabled(windWaterToggle.checked);
  windWaterToggle.addEventListener('change',()=>soundscape.setWindWaterEnabled(windWaterToggle.checked));
  const journal=document.getElementById('loading-screen');
  const unlockSound=event=>{
    // Entry resumes audio directly, and touches on the loading journal leave it quiet.
    if(event&&(!event.isTrusted||!journal.hidden||event.target.id==='loading-begin'))return;
    soundscape.unlock().catch(error=>console.warn('Tumbler could not start audio',error));
  };
  window.addEventListener('click',unlockSound);window.addEventListener('keydown',unlockSound);
  soundButton.addEventListener('click',async e=>{const enabled=await soundscape.toggle();e.target.textContent=enabled?'Sound on':'Sound off';e.target.setAttribute('aria-pressed',String(enabled));});
  const modeSelect=document.getElementById('activity'),siteSelect=document.getElementById('launch-site');
  const rideModes=Object.keys(rideConfig.modes);
  let scenicCourse=null,scenicProgress=null;
  const paraGuide=createParaGuide(document.getElementById('para-guide'),camera);
  const courseRetry=document.getElementById('course-retry');
  const onPracticeFlight=()=>practiceSite>=0&&navigation.mode==='parakite'&&siteSelect.value===String(practiceSite);
  courseRetry.addEventListener('click',()=>{if(onPracticeFlight()||scenicCourse&&flightConfig.modes[navigation.mode])setActivity(navigation.mode);});
  function showStarts(mode){
    const list=rideModes.includes(mode)?rideConfig.starts.filter(s=>s.mode===mode).map(s=>[s.id,s.label]):flightConfig.launches.map((l,i)=>[String(i),l.label]);
    if(mode==='parakite')list.push(...parakiteSites.map((l,i)=>[String(flightConfig.launches.length+i),l.label]));
    const key=list.map(([id])=>id).join();if(siteSelect.dataset.key===key)return;
    siteSelect.replaceChildren(...list.map(([id,label])=>new Option(label,id)));siteSelect.dataset.key=key;
  }
  const helps={orbit:'Drag to orbit · Right-drag to pan · Wheel to approach',fly:'WASD: fly · Mouse: look (click to capture, Esc to release) · R: up · F: down · Hold Shift: slow',walk:'WASD: run · stick: walk, push fully to run ·Space / A: jump or wall push · Shift / LB: tuck and roll down a slope · Shift in water: dive toggle · F / Y: katana · Click / Q / B: slash · Hold R / RT: charge, release to cleave · Ctrl / R3: slide · E / X: reharness · walk into a trunk to climb it · Drag / right stick: look',
    parakite:'A/D steer · W dive / S flare · Drag to look · Launch to restart',
    ski:'A/D carve · W pole · S snowplough · Shift tuck ·Space hop · V view · Pad: stick, RT/LT, A hop, B tuck, Y view',
    bike:'A/D steer · W pedal · S brake · Shift crouch ·Space hop · V view · Pad: stick, RT/LT, A hop, B crouch, Y view'};
  function syncFlightUI(mode,site,weather){
    scenicCourse=flightConfig.modes[mode]&&site!=='here'?speedflying?.courses.find(c=>c.launch_id===flightConfig.launches[site]?.id)??null:null;
    scenicProgress=null;
    modeSelect.value=mode;document.body.dataset.flying=String(!!flightConfig.modes[mode]);
    // A wing hooked in where he stands, or launched from a tree, started at no named site: say so.
    if(flightConfig.modes[mode]){showStarts(mode);if(site==='here'){if(!siteSelect.querySelector('option[value="here"]'))siteSelect.append(new Option('Where you stand','here'));siteSelect.value='here';}else siteSelect.value=String(site);}
    document.getElementById('weather').value=weather;updateHelp(mode);
  }
  function updateHelp(mode){
    const rotating=mode==='parakite';
    document.body.dataset.rotationalFlight=String(rotating);
    const travel=mode==='parakite'?'forward: raise handles / dive · back: pull / flare':'forward: speedbar · back: brakes';
    const power=mode==='paramotor'?' · LB/RB: motor':'';
    const flightHelp=`Stick ${travel} · LT/RT: independent handles${rotating?'':' · B + steer: wingovers'}${power} · Y: view · Land then X: unhook · A: launch / air retry · D-pad: wing / ridge · Menu: weather`;
    const pad=[...(navigator.getGamepads?.()??[])].some(p=>p?.connected);
    const keyboardFlight=`A/D: ${mode==='parakite'?'weight shift + outside release':'weight shift + inside brake'} · W/S: ${mode==='parakite'?'raise handles / pull to flare':'speedbar / brakes'} · J/K: independent handles${rotating?'':' · Shift + steer: wingovers'}${mode==='paramotor'?' · R/F: motor':''} · V: view · E: unhook on safe ground · Space: ground launch · Launch: restart`;
    const parakiteHelp=pad?'Left stick to fly · Y changes view · A retries in the air':'A/D steer · W dive · S pull · V changes view';
    document.getElementById('help').textContent=rotating?parakiteHelp:flightConfig.modes[mode]?(pad?flightHelp:keyboardFlight):pad&&mode==='orbit'?'A: take flight · D-pad: wing / ridge · Menu: weather':(helps[mode]??helps.orbit);
  }
  function setActivity(mode){
    if(organoid.active)return;
    if(mode==='gondola'){gondola.goTo(gondolaLine.stations[0].id);modeSelect.value='walk';updateHelp('walk');canvas.focus();updateShadow(true);return;}
    // A fresh choice starts at a named site; "where you stand" only describes a wing already hooked in.
    if(siteSelect.value==='here'){siteSelect.querySelector('option[value="here"]').remove();siteSelect.selectedIndex=0;}
    showStarts(mode);navigation.select(mode,siteSelect.value);mode=navigation.mode;modeSelect.value=mode;document.body.dataset.flying=String(!!flightConfig.modes[mode]);
    updateHelp(mode);
    document.getElementById('launch').textContent=mode==='ski'?'Drop in ↘':mode==='bike'?'Ride ↘':'Launch ↗';
    canvas.focus();updateShadow(true);}
  window.addEventListener('gamepadconnected',()=>updateHelp(navigation.mode));
  window.addEventListener('gamepaddisconnected',()=>updateHelp(navigation.mode));
  modeSelect.addEventListener('change',e=>setActivity(e.target.value));
  siteSelect.addEventListener('change',()=>{if(siteSelect.value==='here')return;siteSelect.querySelector('option[value="here"]')?.remove();if(rideModes.includes(navigation.mode)||flightConfig.modes[navigation.mode])setActivity(navigation.mode);});
  document.getElementById('launch').addEventListener('click',()=>{if(flightConfig.modes[navigation.mode]&&navigation.state.grounded){navigation.launchHere();return;}setActivity(['orbit','fly','walk'].includes(modeSelect.value)?'paraglider':modeSelect.value);if(flightConfig.modes[navigation.mode]&&navigation.state.grounded)navigation.launchHere();});
  // The bearing is where the wind comes from; it blows toward the opposite one, and north is scene -z.
  const airCues=createAirCues((x,y,z)=>navigation.sampleEnvironment(x,y,z),ground,{renderer});
  const meadowWind=navigation.fixedEnvironmentSampler();
  const meadowAir=createMeadowAir(meadowWind.sample,ground,{
    x:cover.offsetX,z:-(cover.offsetY+cover.quad*cover.resolution),span:cover.quad*cover.resolution,
  });
  meadowAir.update(0);
  const windFrom = worldmap.wind.direction_deg * Math.PI / 180; style.wind.value.set(-Math.sin(windFrom), Math.cos(windFrom));style.cloudWind.value.copy(style.wind.value);
  const sky = makeSky(); scene.add(sky);
  const weatherSelect=document.getElementById('weather');
  weatherSelect.replaceChildren(...Object.entries(flightConfig.weather).map(([id,w])=>new Option(w.label,id)));weatherSelect.value=navigation.weather;
  weatherSelect.addEventListener('change',()=>navigation.setWeather(weatherSelect.value));
  const challengeSelect=document.getElementById('flight-challenge');
  challengeSelect.replaceChildren(new Option('Free flight',''),...Object.entries(flightConfig.challenges??{}).map(([id,c])=>new Option(c.label,id)));
  challengeSelect.addEventListener('change',()=>navigation.setChallenge(challengeSelect.value));
  const parakitePractice=createParakitePractice({navigation,canvas,challenge:challengeSelect,
    panel:document.getElementById('para-practice'),open:document.querySelector('[data-practice-open]')});
  const motionSelect=document.getElementById('motion');
  motionSelect.value=matchMedia('(prefers-reduced-motion: reduce)').matches?'0':'1';navigation.setEffects(Number(motionSelect.value));
  motionSelect.addEventListener('change',()=>navigation.setEffects(Number(motionSelect.value)));
  const pilotPostureSelect=document.getElementById('pilot-posture');
  pilotPostureSelect.addEventListener('change',()=>navigation.setPilotMotion(pilotPostureSelect.value));
  const cloudPass=createCloudPass(renderer,scene,camera,worldmap.atmosphere,ground);
  // The lake mirrors what stands around it. Field notes chooses how: off (the painted
  // reflection), Mirror (the world redrawn upside down, mirror.js) or Layered (reflections.js).
  const lakeMesh=water.getObjectByName('lake'),lakeLevel=worldmap.water.bodies.find(b=>b.kind==='lake')?.surface_z_m;
  const reflectionSelect=document.getElementById('lake-reflections');
  const mirrorKeep=[horizonRange,terrain.group,geology?.group,riverGranite.group,falls?.group,placements.group,forest.group];
  const mirror=lakeMesh&&lakeLevel!=null?createMirror(renderer,{level:lakeLevel,lake:lakeMesh,sky,clouds:cloudPass.volumes,trees:forest.group,keep:mirrorKeep}):null;
  // Movers reflect as stand-ins in a small live pass; everything else static comes from the screen and the probes.
  const folkGroup=scene.getObjectByName('cat_folk'),cabins=scene.getObjectByName('gondola_cabins');
  const insects=ecology.group.children.filter(m=>m.isInstancedMesh&&!/river_fish|fish_tail|frog/.test(m.name));
  // Glass (domes, skybridges) is drawn after the snapshot and left out of the bake: the live pass draws it.
  const glass=[];placements.group.traverse(o=>{if(o.isMesh&&o.material.transparent)glass.push(o);});
  const wingsOf=root=>{const found=[];root?.traverse(o=>{if(o.isMesh&&/_fabric$/.test(o.name))found.push(o);});return found;};
  const movers=createMovers({
    figures:()=>[character.object,...(folkGroup?.children.filter(o=>o.name!=='player_parafoil')??[])],
    wings:()=>[...wingsOf(flightRig.group),...wingsOf(folkGroup)],
    instanced:()=>insects.filter(m=>m.name==='flight/bee.glb'),
    live:[cabins,rideRig,falls?.group,...glass,...insects.filter(m=>m.name!=='flight/bee.glb'&&!(m.name===''&&!m.material.transparent))],
    roots:()=>[character.object,flightRig.group,rideRig,folkGroup,cabins,...insects],
  });
  const layered=lakeMesh&&lakeLevel!=null?createReflections(renderer,{level:lakeLevel,lake:lakeMesh,sky,clouds:cloudPass.volumes,opaque:cloudPass.opaque,movers}):null;
  if(layered){scene.add(layered.snapshot.marker);layered.setProbes(probeData&&!probeData.stale.length?probeData:null);}
  const renderMirror=()=>{
    const mode=underwater.active?'off':reflectionSelect.value;
    mirror?.update(scene,camera,mode==='mirror');layered?.update(scene,camera,mode==='layered');
  };
  document.getElementById('save-view').addEventListener('click',()=>{
    const presentation=paraSignals.sample,para=paraPass.supported&&presentation.active&&Number(motionSelect.value)>0&&(presentation.smear>.001||presentation.lens>.001);
    if(para)paraPass.prepare();
    cloudPass.render({strength:Number(motionSelect.value),submerged:underwater.active,target:para?paraPass.target:null});
    if(para)paraPass.render(cloudPass.opaque.depthTexture,presentation);
    canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`tumbler-${navigation.mode}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
  });
  renderer.info.autoReset=false;

  const sun = new T.DirectionalLight('#ffe3a3', 2.1);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -SCENERY_SHADOW_SPAN/2, right: SCENERY_SHADOW_SPAN/2, top: SCENERY_SHADOW_SPAN/2, bottom: -SCENERY_SHADOW_SPAN/2, near: 1, far: 1800 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.mapSize.set(SCENERY_SHADOW_RESOLUTION, SCENERY_SHADOW_RESOLUTION);
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .7;
  scene.add(sun, sun.target);bindTreeSunShadow(sun);sun.layers.enable(MOVERS_LAYER);sun.layers.enable(DEPTH_LAYER);
  const distantTreeShadows=createDistantTreeShadows(renderer,adoptedForest.distantShadowGroup,adoptedForest.distantShadowBounds);
  treeShadows.group.visible=false;
  const hemisphere = new T.HemisphereLight('#afd7e3', '#7a8452', 2.0); scene.add(hemisphere);hemisphere.layers.enable(MOVERS_LAYER);hemisphere.layers.enable(DEPTH_LAYER);
  const actorShadows=createActorShadows(renderer,[rig,character.object,rideRig],style);
  const actorFocus=new T.Vector3();
  const shadowCentre = new T.Vector3(Infinity, Infinity, Infinity);
  let shadowRevision=-1,lastShadowTime=0,guidedShadowLead=null;
  const shadowFocus=new T.Vector3(Infinity,Infinity,Infinity),groundShadowFocus=new T.Vector3(),shadowAim=new T.Vector3();
  // The sharp sun map round the player is for walking, and for flight or the free camera only below the average
  // tree's height (2026-11-23, the human). Above that the static world map carries every shadow and the near map
  // is not redrawn.
  let nearShadows=true;
  function nearShadowsWanted(){
    if(onFoot())return true;
    const p=camera.position,g=ground.height(p.x,-p.z);
    return g!==null&&p.y-g<adoptedForest.stats.meanTreeHeightM;
  }
  function updateShadow(force = false,forestSelected = false) {
    const near=nearShadowsWanted();
    if(near!==nearShadows){nearShadows=near;setNearTreeShadows(near);force=true;}
    if(!near&&!force){if(forestSelected){legacyForest.update(camera,shadowCentre);forest.refreshStats();}return;}
    const aim=controls.target;
    // Keep the scenery footprint on the landscape through aerial descents.
    const target=groundShadowFocus.set(aim.x,ground.height(aim.x,-aim.z)??aim.y,aim.z);
    setTreeShadowFocus(target);
    const now=performance.now();
    if(!force){
      if(guidedShadowLead){
        // The 520 m view footprint has 60 m of margin inside the 640 m map.
        // Keep 12 m in reserve for snapping and the shadow filter.
        if(shadowRevision===forest.stats.shadowRevision&&target.distanceToSquared(shadowCentre)<48*48)return;
      }else if(target.distanceToSquared(shadowCentre)<40*40&&
        ((shadowRevision===forest.stats.shadowRevision&&target.distanceToSquared(shadowFocus)<4*4)||now-lastShadowTime<350))return;
    }
    shadowAim.copy(target);
    if(guidedShadowLead){
      shadowAim.set(guidedShadowLead.x-target.x,0,-guidedShadowLead.y-target.z).clampLength(0,20).add(target);
    }
    lastShadowTime=now;shadowFocus.copy(target);
    // Static world shadows retain their light-space texel phase on recenter.
    // A forty-metre world-axis step changes that phase and makes edges jump.
    shadowCentre.copy(snappedShadowAnchor(shadowAim,style.sun.value,SCENERY_SHADOW_SPAN,SCENERY_SHADOW_RESOLUTION));
    sun.target.position.copy(shadowCentre);
    sun.position.copy(shadowCentre).addScaledVector(style.sun.value, 900);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
    updateTreeSunShadow();
    adoptedForest.updateShadowCasters?.(sun.shadow.getFrustum());
    if(forestSelected){
      // Adopted tree visibility uses the camera target and is already current.
      legacyForest.update(camera,shadowCentre);
      forest.refreshStats();
    }else forest.update(camera,shadowCentre);
    shadowRevision=forest.stats.shadowRevision;
    renderer.shadowMap.needsUpdate = true;
  }
  // Under the water's surface (underwater.js): fog by depth and light, shafts, motes, the bed's caustics.
  let lightName='golden';
  const underwater=createUnderwater({scene,camera,waterAt:walkHeight.waterAt,sky,overlayAfter:renderer.domElement});
  function setLight(name) {
    const p = lightPresets[name];lightName=name;
    // The light preset also says which phase of the day it depicts, and the
    // core's own diurnal table turns that into the valley's breeze. The client
    // names the phase; it never decides what the wind does with it.
    navigation.setTimeOfDay(p.windPhase);
    setTreeLighting({...p,sun:p.color,ground:'#7a8452'});
    style.sun.value.fromArray(p.direction).normalize(); style.warmth.value = p.warmth;
    // Each time of day carries its own clouds (worldmap atmosphere.times).
    cloudPass.setSky(name);layered?.setTime(name);
    sun.color.set(p.color); sun.intensity = p.intensity;
    hemisphere.color.set(p.fill); hemisphere.intensity = p.ambient;
    scene.fog.color.set(p.fog); scene.background.copy(scene.fog.color);
    renderer.toneMappingExposure = p.exposure;
    forest.rebuildImpostors(style.sun.value);distantTreeShadows.update(style.sun.value,true);
    updateShadow(true);
  }
  document.getElementById('light').addEventListener('change', e => setLight(e.target.value));
  renderTarget.addEventListener('input',resize);
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
  // Viewpoints are the named places (shared/play/places.json): the development UI frames each from
  // behind and above, the player map arrives at it on foot. One list, so the two cannot drift apart.
  const placeById=Object.fromEntries(places.places.map(p=>[p.id,p]));
  const bearing=deg=>[Math.sin(deg*Math.PI/180),Math.cos(deg*Math.PI/180)];
  // Walkable ground nearest (x, y), 10 m clear of the village's trunks and 5 m of every other tree: where anyone is
  // set down when a place is selected or a terrain rebuild obstructs the authored opening spawn.
  const standClear=placement.instances.filter(i=>i.kind==='arboreal_tree'||i.kind==='redwood'||i.kind==='forest_tree')
    .map(i=>[i.position_m[0],i.position_m[1],i.kind==='arboreal_tree'?10:5]);
  function clearSpot(ax,ay){
    for(let r=0;r<=120;r+=6)for(let k=0,n=Math.max(1,Math.round(r/3));k<n;k++){
      const a=k/n*2*Math.PI,x=ax+Math.cos(a)*r,y=ay+Math.sin(a)*r;
      if(standClear.every(([tx,ty,c])=>Math.hypot(x-tx,y-ty)>=c)&&walkSpawn(x,y,characterConfig.walk,walkHeight,hitTest,0))return [x,y];
    }
    return [ax,ay];
  }
  const {x:openingX,y:openingY,heading:openingHeading}=openingShot.ronin;
  const [startX,startY]=walkSpawn(openingX,openingY,characterConfig.walk,walkHeight,hitTest,0)
    ??clearSpot(...placeById['tree-village'].arrive_xy_m);
  // Start in front of Ronin so the chase frame can see his face and the village beyond him.
  const OPENING_ARRIVAL={x:startX,y:startY,heading:openingHeading,yaw:openingHeading+Math.PI/2,pitch:-.072};
  // Juno waits on open ground a few metres ahead of him on load, in the first view, so the parakite lessons are
  // easy to find ("Make sure Juno is well placed on-load"). She is a pilot who started in the air; she lands
  // here, then her own brain takes her on after a wait. The tour's first-visit offer stages her beside him again.
  {
    const juno=folk.api.world.cats.find(c=>c.id==='juno');
    if(juno){
      const world=folk.api.world;
      for(const [d,side] of [[9,.5],[9,-.5],[12,.4],[12,-.4],[7,.8],[7,-.8],[15,.3],[15,-.3]]){
        const a=OPENING_ARRIVAL.heading+Math.PI+side,x=OPENING_ARRIVAL.x+Math.cos(a)*d,y=OPENING_ARRIVAL.y+Math.sin(a)*d;
        const z=walkSpawn(x,y,characterConfig.walk,walkHeight,hitTest,0);
        if(!z)continue;
        setController(world,juno,'agent');
        stageFlightGuide(world,juno,{x,y,z:z[2],heading:Math.atan2(OPENING_ARRIVAL.y-y,OPENING_ARRIVAL.x-x)});
        setController(world,juno,'auto');command(world,juno,{verb:'wait',seconds:600});
        break;
      }
    }
  }
  const openingPath=openingShot.waypoints.map(toScene),openingTarget=toScene(openingShot.target);
  function placeView(place){
    // Framed by hand in the game on 2026-11-19 (Fly camera; target 60 m along its look).
    if(place.id==='tree-village')return {position:[-723.2534,99.2090,-543.9767],target:[-704.3150,93.8070,-487.3008]};
    if(place.id==='homestead')return {position:homeCamera,target:[hx,hz+3,-hy]};
    // The first framing, from behind and above, that sees the place: nothing within 14 m of the eye, no crown across
    // the first 120 m of the line of sight, and the line clear of the ground (2026-11-22: the views had drifted into
    // trees and slopes as the world moved: "the different look-around views were disturbed into non-aesthetic views").
    const [x,y]=place.arrive_xy_m,base=place.facing_deg;
    const near=viewTrees.filter(([tx,ty])=>Math.hypot(tx-x,ty-y)<320);
    let room=14;  // how far the nearest trunk must stand from the eye; relaxed when no framing allows it
    const line=(ex,ey,ez,tx,ty,tz,reach)=>{
      const lx=tx-ex,ly=ty-ey,lz=tz-ez,l=Math.hypot(lx,ly)||1;
      for(let s=.05;s<=Math.min(1,reach/l);s+=.05){const px=ex+lx*s,py=ey+ly*s;if(ez+lz*s<ground.height(px,py)+2)return false;}
      for(const [tx_,ty_,top] of near){
        const s=Math.max(0,Math.min(Math.min(1,120/l),((tx_-ex)*lx+(ty_-ey)*ly)/(l*l))),d=Math.hypot(ex+lx*s-tx_,ey+ly*s-ty_);
        if(Math.hypot(tx_-ex,ty_-ey)<room||(d<6&&ez+lz*s<top))return false;
      }
      return true;
    };
    // The frame, not only its centre: three lines across it, each clear of trees and masts for 120 m, and the
    // centre clear of rising ground for 200 m toward where the view looks.
    const sees=(ex,ey,ez,tx,ty,tz)=>{
      const a=Math.atan2(ty-ey,tx-ex),l=Math.hypot(tx-ex,ty-ey);
      return [0,.35,-.35].every(o=>line(ex,ey,ez,ex+Math.cos(a+o)*l,ey+Math.sin(a+o)*l,tz,120));
    };
    // The place's own facing matters more than a perfect frame: small turns first, strict then relaxed, and only
    // then a wide turn (one pass turned the falls view 90 degrees off the falls for a stricter frame).
    for(const [turns,space] of [[[0,15,-15,30,-30],14],[[0,15,-15,30,-30],8],[[50,-50,70,-70,90,-90],8]]){
      room=space;
      for(const turn of turns)for(const back of [40,60,85,30])for(const lift of [14,24,36]){
        const [dx,dy]=bearing(base+turn),ex=x-dx*back,ey=y-dy*back,tx=x+dx*260,ty=y+dy*260;
        const eye=Math.max(ground.height(ex,ey),ground.height(x,y))+lift,aim=Math.max(ground.height(tx,ty)+10,eye-60);
        if(sees(ex,ey,eye,x,y,ground.height(x,y)+2)&&line(ex,ey,eye,tx,ty,aim,200))return {position:[ex,eye,-ey],target:[tx,aim,-ty]};
      }
    }
    const [dx,dy]=bearing(base),ex=x-dx*40,ey=y-dy*40,tx=x+dx*260,ty=y+dy*260;
    const eye=Math.max(ground.height(ex,ey),ground.height(x,y))+14;
    return {position:[ex,eye,-ey],target:[tx,Math.max(ground.height(tx,ty)+10,eye-60),-ty]};
  }
  // Trees a Look around view must see past: [east, north, crown top].
  var viewTrees=placement.instances.filter(i=>['arboreal_tree','redwood','forest_tree','mooring_mast','turbine'].includes(i.kind))
    .map(i=>{const sc=Array.isArray(i.scale)?i.scale[1]:i.scale??1;return [i.position_m[0],i.position_m[1],i.position_m[2]+({forest_tree:28,mooring_mast:60,turbine:40}[i.kind]??45)*sc];});
  const views=Object.fromEntries(places.places.map(p=>[p.id,placeView(p)]));
  // Not a place anyone travels to: the close framing the tree reviews open with (?view=redwood-canopy).
  views['redwood-canopy']={position:heroCentre.clone().add(new T.Vector3(heroRadius*2.1,8,heroRadius*2.3)).toArray(),target:heroCentre.toArray()};
  const placeNav=document.querySelector('nav[aria-label="Places to pause"]');
  placeNav.replaceChildren(...places.places.map(p=>{const b=document.createElement('button');b.dataset.view=p.id;b.setAttribute('aria-pressed','false');b.textContent=p.label;return b;}));
  function setView(name) {
    if(organoid.active)return;
    if(navigation.mode!=='orbit'){setActivity('orbit');}
    const v = views[name];
    document.body.dataset.view = name;
    camera.position.fromArray(v.position); controls.setTarget(...v.target); controls.update();
    document.querySelectorAll('button[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
    updateShadow(true);
  }
  document.querySelectorAll('button[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  // Time moves on with every journey: golden hour, then evening, then a clear morning.
  const dayOrder=['golden','dusk','day'];let timeOfDay='golden';
  function passTime(){timeOfDay=dayOrder[(dayOrder.indexOf(timeOfDay)+1)%dayOrder.length];setLight(timeOfDay);document.getElementById('light').value=timeOfDay;return timeOfDay;}
  // On foot at a place, facing as it says. The walk-in shot starts at the place, not wherever the
  // camera was: across a mountain the glide cuts through rock.
  function arriveAt(place,{passesTime=true}={}){
    if(organoid.active)return;
    if(navigation.mode!=='orbit')setActivity('orbit');
    const [x,y]=clearSpot(...place.arrive_xy_m),[dx,dy]=bearing(place.facing_deg),bx=x-dx*24,by=y-dy*24;
    camera.position.set(bx,ground.height(bx,by)+12,-by);camera.lookAt(x,ground.height(x,y)+1,-y);camera.updateMatrixWorld();setActivity('walk');
    navigation.placeOnFoot(x,y,place.facing_deg*Math.PI/180);
    document.querySelectorAll('button[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));canvas.focus();updateShadow(true);
    if(passesTime)passTime();
  }
  const toTumbleHill=()=>arriveAt(placeById['tumble-hill'],{passesTime:false});
  window.addEventListener('keydown', e => {
    if (organoid.active||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||document.body.dataset.uiMode==='player') return;
    if ((e.code==='KeyH'||e.key==='Escape')&&!e.repeat&&!e.metaKey&&!e.ctrlKey) document.body.dataset.ui = document.body.dataset.ui==='hidden' ? '' : 'hidden';
    if (['1','2','3'].includes(e.key)) setView(places.places[Number(e.key)-1].id);
    if (e.key==='4') toTumbleHill();
    if (e.code==='KeyT'&&navigation.mode!=='gondola'&&!e.repeat&&!e.metaKey&&!e.ctrlKey) setTumbleMode(character.spike.mode==='s0'?'s1':'s0');
  });
  // S0 spike (docs/design/S0-TUMBLE-SPIKE.md): T switches how a body looks while it is down, S0's
  // spring body (the default) or S1's scrubbed clips, for him and the cats alike. Development only.
  const tumbleLabel=document.createElement('div');tumbleLabel.className='tumble-label';
  Object.assign(tumbleLabel.style,{position:'fixed',left:'50%',top:'8px',transform:'translateX(-50%)',font:'12px/1.4 system-ui,sans-serif',color:'#fff',background:'#0008',padding:'2px 8px',borderRadius:'4px',zIndex:20,pointerEvents:'none'});
  document.body.append(tumbleLabel);
  function setTumbleMode(mode){character.spike.mode=mode;folk.api.tumbleMode=mode;tumbleLabel.textContent=`Tumble: ${mode==='s0'?'S0 spring body':'S1 scrubbed clips'} · T switches`;}
  setTumbleMode(character.spike.mode);
  // Taking to the air as a player: the parakite leaves North Wall, the route's launch, unless asked for
  // a parakite-only site such as Tumble Hill; the paramotor unfolds wherever he stands, if the ground there will take it.
  const parakiteSite=String(flightConfig.launches.findIndex(l=>l.id===speedflying.courses[0].launch_id));
  function startParakite(id){
    const site=id?String(playerFlight.launches.findIndex(l=>l.id===id)):parakiteSite;if(site==='-1')throw new Error(`Unknown parakite launch ${id}`);
    if(navigation.mode!=='orbit')setActivity('orbit');showStarts('parakite');siteSelect.value=site;setActivity('parakite');if(navigation.mode==='parakite')passTime();}
  // Why the paramotor cannot unfold right now, in a player's words, or null when it can.
  function paramotorRefusal(){const s=navigation.state;
    if(navigation.mode!=='walk')return navigation.mode==='gondola'?'Get off the gondola first':'Land and unhook first';
    if(s?.mode==='swim')return 'Get out of the water first';if(['climb','branch'].includes(s?.mode))return 'Climb down first';
    if(!s?.grounded)return 'Land on your feet first';if(/tumble|roll|slide|trip|stumble/.test(s?.balance?.phase??''))return 'Find your feet first';return null;}
  const canStartParamotor=()=>paramotorRefusal()===null;
  // The wing still needs room to spread; if the ground refuses it, say what the game said.
  function startParamotor(){if(!canStartParamotor())return paramotorRefusal();setActivity('paramotor');return navigation.mode==='paramotor'?null:(navigation.message||'No room to spread the wing here');}
  const parakiteTour=createParakiteTour({panel:document.getElementById('parakite-tour'),camera,canvas,navigation,practice:parakitePractice,
    world:folk.api.world,soundscape,isAvailable:()=>document.body.dataset.uiMode==='player'&&!organoid.active,
    onFootMode:pose=>{
      const spawn=walkSpawn(pose.x,pose.y,characterConfig.walk,walkHeight,hitTest);
      if(navigation.mode!=='walk')navigation.select('orbit');
      if(spawn)navigation.placeOnFoot(spawn[0],spawn[1],pose.heading);else navigation.select('walk');
      navigation.cancelShot();syncFlightUI('walk','here',navigation.weather);
    }});
  const playerUI=createPlayerUI({places:places.places,arriveAt,startParakite,navigation,ground,snowAt,
    learnParakite:()=>parakiteTour.offer({force:true}),
    flightStatsDock:()=>parakitePractice.statsDock??parakiteTour.statsDock,
    trees:placement.instances.filter(i=>i.asset.startsWith('redwood/')).map(i=>i.position_m),worldmap,course:speedflying.courses[0],
    launch:flightConfig.launches[Number(parakiteSite)],timeOfDay:()=>timeOfDay,nextTimeOfDay:()=>dayOrder[(dayOrder.indexOf(timeOfDay)+1)%dayOrder.length],showLight:setLight,canvas,camera,fog:scene.fog});
  // Two interfaces: the development panels, served locally, and the player's. Players always get theirs;
  // on a local server a switch (or the ` key) chooses, and remembers the choice.
  const storedMode=(()=>{try{return localStorage.getItem('tumbler.ui-mode');}catch{return null;}})();
  function setUiMode(mode,remember=true){
    document.body.dataset.uiMode=mode;navigation.setPlayerMode(mode==='player');if(mode!=='player')playerUI.close();
    if(uiSwitch)uiSwitch.textContent=mode==='player'?'Player UI · switch to dev (`)':'Dev UI · switch to player (`)';
    if(remember)try{localStorage.setItem('tumbler.ui-mode',mode);}catch{}
  }
  const uiSwitch=localHost?Object.assign(document.createElement('button'),{className:'ui-switch',type:'button'}):null;
  if(uiSwitch){document.body.append(uiSwitch);uiSwitch.addEventListener('click',()=>setUiMode(document.body.dataset.uiMode==='player'?'dev':'player'));
    window.addEventListener('keydown',e=>{if(e.code==='Backquote'&&!e.repeat&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))setUiMode(document.body.dataset.uiMode==='player'?'dev':'player');});}
  const previewPlayer=new URLSearchParams(location.search).get('ui')==='player';
  setUiMode(!localHost||previewPlayer||storedMode==='player'?'player':'dev',!previewPlayer);
  // Cat links: Cat Ronin drops you into walk mode; the folk get an orbit look-in.
  const catNav=document.getElementById('cats');
  for(const cat of folk.api.list()){const b=document.createElement('button');b.dataset.cat=cat.id;b.textContent=cat.name;catNav.append(b);}
  catNav.addEventListener('click',e=>{
    const id=e.target.closest('button')?.dataset.cat;if(!id)return;
    if(id==='ronin'){if(navigation.mode!=='walk')setActivity('walk');canvas.focus();return;}
    setActivity('orbit');const p=folk.api.focus(id);controls.setTarget(p[0],p[1]+.8,p[2]);controls.update();updateShadow(true);
  });
  const viewParam=new URLSearchParams(location.search).get('view');
  setView(viewParam in views ? viewParam : 'tree-village');
  const requestedOrganoid=localHost&&new URLSearchParams(location.search).get('encounter')==='organoid';
  const requestedCourse=speedflying?.courses.find(c=>c.id===new URLSearchParams(location.search).get('course'));
  const requestedPractice=!!practiceLaunch&&!requestedCourse&&!requestedOrganoid;
  if(requestedPractice){
    setUiMode('dev',false);showStarts('parakite');siteSelect.value=String(practiceSite);navigation.setWeather('calm');setActivity('parakite');document.body.dataset.ui='';
    const lesson=new URLSearchParams(location.search).get('lesson');
    if(lesson)parakitePractice.prepare(lesson);
  }else if(requestedCourse){
    const requestedMode=new URLSearchParams(location.search).get('mode');
    const mode=flightConfig.modes[requestedMode]?requestedMode:'parakite';
    const site=flightConfig.launches.findIndex(l=>l.id===requestedCourse.launch_id);
    if(site>=0){showStarts(mode);siteSelect.value=String(site);navigation.setWeather('calm');setActivity(mode);document.body.dataset.ui='';}
  }
  setLight('golden');

  const player=()=>navigation.mode==='orbit'?null:navigation.mode==='fly'?{x:camera.position.x,y:-camera.position.z,z:camera.position.y}:navigation.state;
  const meadowFocus=meadowViewFocus(camera,ground,undefined,player());meadow.update(camera,meadowFocus);closeMeadow.update(camera,meadowFocus);

  let frame = 0, contextLost = false, stopped = false, lastFrame = 0, lastStamp = 0;
  let presenting=false,presentedOnce=false,openingFrame=null,audioPrepared=false;
  let elapsed = 0,lastReadout=0;
  const samples = [];
  const metrics = { frame: 0, framesMs: samples, cpuMs: 0, render: {}, get view() { return document.body.dataset.view; } };
  const startup={ready:false,frames:0};
  // Read-only inspection hook used for repeatable visual/performance checks.
  const visibilityToggle=document.getElementById('visibility-spotlight'),adaptiveToggle=document.getElementById('adaptive');
  const playerVisibility=createPlayerVisibility(camera,renderer,[placements.group,forest.group,geology?.group,riverGranite.group,gondola.group].filter(Boolean),[placements.group,gondola.group]);
  window.tumbler = { underwater, mirror:{get enabled(){return reflectionSelect.value!=='off';},set enabled(on){reflectionSelect.value=on?'layered':'off';},
    get mode(){return reflectionSelect.value;},set mode(v){if(['off','mirror','layered'].includes(v))reflectionSelect.value=v;},layered,movers,probes:probeData,keep:mirrorKeep,get stats(){return reflectionSelect.value==='layered'?layered?.stats:mirror?.stats;},get target(){return mirror?.target;},get scale(){return mirror?.scale;},set scale(v){if(mirror)mirror.scale=v;},get reach(){return mirror?.reach;},set reach(v){if(mirror)mirror.reach=v;}},falls,organoid,tutor,parakiteTour,playerUI,setUiMode,arriveAt,places,startParakite,startParamotor,passTime,mountainMapStats,play,toTumbleHill,setTumbleMode, folk:folk.api,gondola,airCues,riverGranite,walkHeight,meadowAir,meadowWind,generators,startup,begin:beginGame,flightRig, distantTreeShadows, scene, camera, renderer, controls, navigation, character, firstPerson, paraSignals, paraPass, paraStreaks, soundscape, ride: { config: rideConfig, snowAt, surfaceAt, height: rideHeight, hitTest, worldmap, setActivity }, forest, treeShadows, cloudPass, actorShadows, ground, terrain, geology, speedflying, transition, forestFloor, forestSoil, ecology, closeMeadow, meadow, metrics, views, setView, setLight, provenance: {files:verifiedFiles}, stats: { terrain:terrain.stats,forest: forest.stats, meadow: meadow.stats, placements: placements.stats } };
  async function prepareFirstView(){
    presenting=false;startup.ready=false;startup.rendered=false;startup.playing=false;
    loading.show();status.textContent='Letting the light settle…';
    paraPass.warm();
    loading.meter(.63,'Waking the light…');
    await firstPerson.prewarm();
    loading.meter(.66,'Finding Cat Ronin…');
    // Everything the first walk frame needs is warmed behind the journal: the
    // village view, then the walk view the player will actually open on. The
    // journal is opaque and the arrival is warmed through the real select('walk')
    // state, so the entry is a cut to a frame that already exists rather than a
    // camera move interpolating between two scenes.
    const warmOptions={
      prepare(){
        terrain.update(camera,canvas.height);riverGranite.update(camera,canvas.height);forest.update(camera,shadowCentre);forestFloor.update(camera);updateShadow();
        meadowViewFocus(camera,ground,meadowFocus,player());meadow.update(camera,meadowFocus);closeMeadow.update(camera,meadowFocus);
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
        renderMirror();
        cloudPass.render({strength:Number(motionSelect.value),submerged:underwater.active,target:paraPass.supported?paraPass.target:null});
        if(paraPass.supported)paraPass.render(cloudPass.opaque.depthTexture,{smear:0,lens:0,velocity:[0,0,0]});
      },
      signature:()=>JSON.stringify([renderer.info.memory,renderer.info.programs.length,forest.stats.adopted.lodCounts,meadow.stats.tiles,forestFloor.stats.plants]),
      pending:()=>forest.stats.adopted.transitioning>0,
      finish:()=>finishGpu(renderer.getContext()),
    };
    // Progress is the work: completed draws plus the consecutive stable ones
    // that the completion rule actually requires. It is not a time estimate.
    const share=p=>Math.min(1,.45*Math.min(1,p.frames/16)+.55*(p.stable/p.stableFrames));
    const warmView=onProgress=>warmScene({...warmOptions,onProgress});
    // The first load warms the opening framing the glide starts from, not the Look around viewpoint.
    if(!viewParam&&!requestedCourse&&!requestedPractice&&!requestedOrganoid&&!presentedOnce){
      camera.position.copy(openingPath[0]);controls.setTarget(...openingTarget);controls.update();
      camera.fov=openingShot.fov;camera.updateProjectionMatrix();
    }
    const result=await warmView(p=>loading.meter(.66+.16*share(p),'Rendering the village…'));
    // A ?view=, ?course= or ?encounter= link is a developer shortcut that starts
    // where it is told, so it keeps the cheaper single-view startup.
    const intro=!viewParam&&!requestedCourse&&!requestedPractice&&!requestedOrganoid;
    // The gate is the first entry only. A context recovery must return the
    // player to the activity they were in, not dump them on foot.
    const gate=intro&&!presentedOnce;
    let arrival=null;
    if(gate){
      loading.meter(.82,'Finding the meadow…');
      arrival=await navigation.warmArrival(()=>warmView(p=>loading.meter(.82+.12*share(p),'Rendering the meadow…')),{restore:false,arrival:OPENING_ARRIVAL});
      // The journal covers the world, and the warm leaves the camera, walk
      // state, orbit target and scenery-shadow focus exactly where the entry
      // needs them. Keeping them is what makes the entry cut cheap: the first
      // live frame reuses the warmed shadow map instead of rebuilding it.
      navigation.suspend(true);
      modeSelect.value='walk';document.body.dataset.flying='false';updateHelp('walk');
      document.body.dataset.ui='hidden';
      loading.meter(.96,'Preparing sound…');
      await nextPaint();
      if(contextLost||stopped)return;
      try {
        await soundscape.prepare();
        audioPrepared=true;
      } catch(error) {
        audioPrepared=false;
        console.warn('Tumbler could not prepare audio',error);
      }
    }
    firstPerson.finishWarm();
    if(contextLost||stopped)return;
    if(gate){
      loading.meter(.98,'Drawing the meadow…');
      // He is already standing at OPENING_ARRIVAL in walk mode; the camera opens on the tour's first
      // point and, once the player enters, flies it round to him. Input is held until it lands.
      navigation.introShot(openingPath,openingTarget,openingShot.seconds,openingShot.fov);
      const time=await nextPaint();
      if(contextLost||stopped)return;
      drawFrame(time,0);
      if(contextLost||stopped)return;
      retainOpeningFrame();
      await finishGpu(renderer.getContext());
      if(contextLost||stopped)return;
    }
    Object.assign(startup,result,{warm:{orbit:result.frames,arrival:arrival?.frames??0}});
    // Warm-up costs must not enter play's clock or adaptive-quality samples.
    samples.length=0;lastFrame=0;qualityGate.reset(performance.now());
    status.textContent='Ready for the mountains.';updateStamp();
    if(gate){
      // The world is drawn and fenced; the journal now waits for the player's
      // gesture. That gesture is also what lets the browser start audio, so the
      // game never claims sound is on while the context is still suspended.
      startup.rendered=true;
      loading.ready('The valley is ready.',beginGame);
      // Automated runs have no gesture to give; they enter through the same
      // door rather than hanging on a button, and say so in `startup`.
      if(navigator.webdriver)beginGame({auto:true});
      return;
    }
    Object.assign(startup,{ready:true,rendered:true,playing:true});
    presentedOnce=true;presenting=true;loading.reveal();resume();
  }
  function retainOpeningFrame(){
    // WebGL may clear its drawing buffer after compositing. Keep just the
    // opening frame until play can replace it, without changing WebGL buffering.
    const copy=document.createElement('canvas');
    copy.className='opening-frame';
    copy.setAttribute('aria-hidden','true');
    copy.width=canvas.width;copy.height=canvas.height;
    copy.getContext('2d',{alpha:false}).drawImage(canvas,0,0);
    canvas.after(copy);
    openingFrame=copy;
  }
  function clearOpeningFrame(){
    openingFrame?.remove();
    openingFrame=null;
  }
  function beginGame({auto=false}={}){
    if(!startup.rendered||presenting||startup.playing||stopped||contextLost)return;
    loading.reveal();
    navigation.suspend(false);
    canvas.focus({preventScroll:true});
    parakiteTour.offer();
    status.textContent='Walk the meadow.';
    presenting=true;presentedOnce=true;
    startup.ready=true;startup.playing=true;if(auto)startup.autoStarted=true;
    if(!auto&&audioPrepared)unlockSound();
    // Let the prepared view reach the screen before the next render begins.
    requestAnimationFrame(()=>requestAnimationFrame(resume));
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
      `${generators.stats.turbines} turbines · ${generators.stats.blimps} blimps · ${generators.stats.rpm.toFixed(1)} rpm mean · wind ${(generators.stats.windMps*3.6).toFixed(0)} km/h at the hubs · ${generators.stats.spinning} turning`,
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
    drawFrame(time,delta);
    if(stopped||contextLost)return;
    clearOpeningFrame();
    frame=requestAnimationFrame(animate);
  }
  function drawFrame(time,delta){
    elapsed += Math.min(delta, 50) / 1000;
    style.time.value = elapsed;
    // A landed katana blow shakes the view; the offset is taken back off before
    // navigation places the camera again, so it never drifts the follow.
    camera.position.sub(cameraShake);
    gondola.update();
    const tourFoot=navigation.mode==='walk'&&navigation.state?.mode!=='climb'&&navigation.state?.mode!=='swim'?navigation.state:null;
    parakiteTour.update(Math.min(delta,50)/1000,tourFoot);
    if(!organoid.active&&!parakiteTour.cinematic)navigation.update(Math.min(delta,50)/1000);
    playerUI.hold();
    const onFoot=navigation.mode==='walk'&&navigation.state?.mode!=='climb'&&navigation.state?.mode!=='swim'?navigation.state:null;
    const spotlight=visibilityToggle.checked;
    if(!flightConfig.modes[navigation.mode]){paraSignals.update(null,{},0,0);firstPerson.update({active:false});paraStreaks.update(null);}
    const treePlay=navigation.mode==='walk'&&['climb','branch','tree-jump'].includes(navigation.state?.mode);
    const treePlayer=navigation.state;treePlayFocus.value.set(treePlayer?.x??0,(treePlayer?.z??0)+.9,-(treePlayer?.y??0),treePlay&&spotlight?1.8:0);
    const guide=parakiteTour.sceneryLead;
    const pilot=navigation.state;
    guidedShadowLead=navigation.view==='chase'&&guide&&pilot&&!pilot.grounded&&
      Math.hypot(guide.x-pilot.x,guide.y-pilot.y)<85?guide:null;
    folk.update(Math.min(delta,50)/1000,onFoot,!!guide);
    const quake=navigation.mode==='walk'?character.shake??0:0;
    cameraShake.set((Math.random()-.5)*quake,(Math.random()-.5)*quake,(Math.random()-.5)*quake);camera.position.add(cameraShake);
    if(!organoid.active&&!parakiteTour.cinematic&&navigation.mode!=='orbit'&&navigation.view==='chase')navigation.constrainCamera();
    tutor.update(Math.min(delta,150)/1000,onFoot);
    organoid.update(Math.min(delta,150)/1000,onFoot);
    playerVisibility.update(character.object.position.clone().add(new T.Vector3(0,1.1*characterConfig.scale,0)),spotlight&&!organoid.active&&navigation.mode!=='orbit'&&navigation.mode!=='fly'&&navigation.view==='chase',characterConfig.scale,treePlay);
    underwater.update(Math.min(delta,50)/1000,{...lightPresets[lightName],name:lightName},canvas.height);soundscape.setUnderwater(underwater.depth);airCues.update(camera,Math.min(delta,50)/1000);meadowAir.update(Math.min(delta,50)/1000);
    generators.update(Math.min(delta,50)/1000);
    terrain.update(camera,canvas.height);riverGranite.update(camera,canvas.height);forest.update(camera,shadowCentre);forestFloor.update(camera);updateShadow(false,true);meadowViewFocus(camera,ground,meadowFocus,player());meadow.update(camera,meadowFocus);closeMeadow.update(camera,meadowFocus);visitors.update(Math.min(delta,50)/1000);play.update(Math.min(delta,50)/1000,camera,[...(onFoot?[onFoot]:[]),...folk.api.world.cats.filter(c=>c.body.mode==='walk').map(c=>({...c.body.state,radius:.25}))]);ecology.update(camera,elapsed);soundscape.update(camera,navigation,(kind,maxM,limit)=>ecology.nearby(kind,camera,maxM,limit),paraSignals.sample);updateFoley(Math.min(delta,50)/1000);

    // The canopy owns its view-focused tile budget and conservative wind bounds.
    const flight=navigation.state;
    const rider=rideModes.includes(navigation.mode)?flight:null,riderSpeed=rider?Math.hypot(rider.vx,rider.vy,rider.vz):0;
    const airborne=!!flightConfig.modes[navigation.mode];
    parakitePractice.render();
    const air=airborne?navigation.air:null;
    if(time-lastReadout>125){
      lastReadout=time;
      const readout=document.getElementById('flight-readout');
      const rotationalReadout=flight?.mode==='parakite';
      const lessonActive=!!navigation.flightLesson;
      const touchdown=flight?.landingQuality?
        `${flight.landingQuality[0].toUpperCase()+flight.landingQuality.slice(1)} touchdown · ${(flight.landingSpeed??0).toFixed(1)} m/s down · ${((flight.landingGroundSpeed??0)*3.6).toFixed(0)} km/h along ground`+
        ((flight.landingRunM??0)>.5?` · ${Math.round(flight.landingRunM)} m run`:''):'Landed';
      readout.textContent=rider?(rider.crashed?`Contact: ${rider.crashed} · Launch to go again`:
        `${rideConfig.modes[rider.mode].label} · ${(riderSpeed*3.6).toFixed(0)} km/h · ${Math.round(rider.startZ-rider.z)} m down · ${(rider.distance/1000).toFixed(2)} km · ${rider.grounded?rider.surface:'airborne'}`):
        !airborne?(navigation.mode==='walk'?(navigation.message||(flight.mode==='climb'?(flight.launchReady?'Crown perch · E / X: launch para':'Climbing · E / X: step onto a nearby branch · Space / A: jump off'):flight.mode==='stair'?(flight.stairPhase==='rail'?'Sliding the handrail · let go of Shift / LB to stop · Space / A: jump off':'Stair · tap Space / A toward the rail: vault · Space / A: jump · Shift / LB: slide the handrail'):flight.mode==='branch'?'On branch · move along limb · Space / A: leap toward another tree · E / X near trunk: climb':flight.mode==='tree-jump'?'Leaping to branch':null)||`On foot · V: ${navigation.view==='first'?'chase view':'first person'} · Space / A: ${flight.jumpPhase==='airborne'?flight.jumpStyle.replace('_',' '):'jump'}${flight.harnessMode?' · E / X: reharness':''}`):''):
        flight.launching?`${flight.launchStage==='running'?'Running for takeoff':'Inflating the wing'} · ${Math.round((flight.launchProgress??0)*100)}%\n${(flight.speed*3.6).toFixed(0)} km/h · E / X: cancel and unhook`:
        flight.grounded?`${flight.launchAborted?flight.figure:touchdown}${flight.impact?` · Contact with ${flight.impact}`:''}\n${lessonActive?'Space / A: retry from the bench':navigation.message||'E / X: unhook · Space / A: launch here'}`:
        `${flightConfig.modes[flight.mode].label}  /  ${flightConfig.weather[navigation.weather].label}\n`+
        (rotationalReadout?`Air ${Math.round(flight.speed*3.6)} km/h · ${Math.round(air.agl)} m above ground\n`:
          `${(flight.speed*3.6).toFixed(0)} km/h AIR   ${(flight.groundSpeed*3.6).toFixed(0)} GROUND   ${Math.round(air.agl)} m AGL\n`)+
        `${flight.vario>=0?'+':''}${flight.vario.toFixed(1)} m/s   ${flight.load.toFixed(1)} g   Wind from ${Math.round((Math.atan2(-air.wx,-air.wy)*180/Math.PI+360)%360)}° ${(air.windSpeed*3.6).toFixed(0)} km/h`+
        (flight.mode==='paramotor'?`   Motor ${Math.round(flight.engine*100)}% / set ${Math.round(flight.throttle*100)}% · ${Math.round(flight.thrustN??0)} N thrust`:'')+
        (flight.mode==='parakite'?`\nHandle pull L ${Math.round(flight.handleLeft*100)}% / R ${Math.round(flight.handleRight*100)}% · 45% best glide`:
          `\nBrakes L ${Math.round(flight.brakeLeft*100)}% / R ${Math.round(flight.brakeRight*100)}% · Speedbar ${Math.round(flight.accelerator*100)}%`)+
        (flight.rotation?`\nWing pressure L ${Math.round(flight.rotation.pressure[1]*100)}% / R ${Math.round(flight.rotation.pressure[0]*100)}%`:'')+
        (lessonActive?'':`\n${flight.figure}`)+
        (flight.stall>.15&&!flight.rotation?'\nLOW ENERGY · Ease the handles':air.lee>.15?'\nLEE SIDE · Descending, turbulent air':Math.abs(air.turbulence)>.85?'\nTURBULENT AIR':'');
      readout.dataset.warning=String(airborne&&!flight.launching&&(flight.grounded?flight.landingQuality==='hard':
        flight.stall>.15||flight.rotation?.pressure.some(value=>value<.65)||air.agl<12));
      if(airborne&&flight.challenge){
        const goal=flightConfig.challenges[flight.challenge.id],progress=flight.challenge;
        readout.textContent+=`\n${goal.label}: ${progress.status==='complete'?'Complete':progress.status==='retry'?'Try again on your next flight':goal.goal==='linked_turns'?`${progress.lastSide?Math.min(progress.turns+1,goal.reversals+1):0} / ${goal.reversals+1} turns`:`Touch down gently below ${Math.round(goal.max_ground_mps*3.6)} km/h`}`;
      }
      if(airborne&&scenicCourse){
        const launch=flightConfig.launches[siteSelect.value];
        scenicProgress=stepScenicCourse(scenicCourse,scenicProgress,flight,launch.xy_m);
        const next=scenicCourse.landmarks[scenicProgress.index];
        const distance=next?Math.round(Math.hypot(flight.x-next.position_m[0],flight.y-next.position_m[1])):0;
        const bearing=next?Math.atan2(next.position_m[1]-flight.y,next.position_m[0]-flight.x)-flight.heading:0;
        const delta=Math.atan2(Math.sin(bearing),Math.cos(bearing));
        const arrow=Math.abs(delta)<.2?'↑':delta>0?'↖':'↗';
        const arrivalLabel={exit:'Valley exit · continue to the meadow',approach:scenicCourse.arrival?.label,landed:'Landed · fly again',retry:'Run ended · fly again'}[scenicProgress.phase];
        readout.textContent+=`\n${scenicCourse.label} · ${arrivalLabel??(next?`${arrow} ${next.label} · ${distance} m`:'Valley reached · keep exploring')}`;
      }
      paraGuide.update(airborne?scenicCourse:null,scenicProgress,flight,document.getElementById('course-guide').checked);
      document.body.dataset.flying=String(airborne);document.body.dataset.pilotView=navigation.view;
    }
    const practiceLanded=onPracticeFlight()&&flight?.grounded&&!flight.launching;
    courseRetry.hidden=!!navigation.flightLesson||!(airborne&&(practiceLanded||scenicCourse&&['landed','retry'].includes(scenicProgress?.phase)&&document.getElementById('course-guide').checked));
    if(!courseRetry.hidden){
      courseRetry.dataset.practice=String(!!practiceLanded);
      courseRetry.textContent=`Fly ${practiceLanded?practiceLaunch.label:scenicCourse.label} again ↗`;
    }
    const localWind=air??navigation.sampleEnvironment(camera.position.x,-camera.position.z,camera.position.y);
    style.wind.value.set(localWind.wx/Math.max(1,flightConfig.wind.speed_mps),-localWind.wy/Math.max(1,flightConfig.wind.speed_mps));
    // Slow, bounded render-scale adaptation. Preserve the user's chosen ceiling.
    // The opening shot is held out: its frames are not steady play, and a resize
    // mid-move is a visible hitch, so the gate also restarts the sample window.
    const next=qualityGate.decide(time,samples,adaptiveToggle.checked,navigation.shotActive||organoid.active);
    if(next!==null&&Math.abs(next-qualityScale)>.001){qualityScale=next;adoptedForest.setQuality(qualityScale);samples.length=0;renderer.setPixelRatio(pixelRatio*qualityScale);renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);}
    sky.position.copy(camera.position);
    const start = performance.now();
    try {
      renderer.info.reset();
      const pilot=navigation.state;
      actorFocus.set(pilot?.x??camera.position.x,pilot?.z??camera.position.y,-(pilot?.y??-camera.position.z));
      actorShadows.update(actorFocus,style.sun.value);
      const presentation=paraSignals.sample,para=paraPass.supported&&airborne&&presentation.active&&Number(motionSelect.value)>0&&(presentation.smear>.001||presentation.lens>.001);
      if(para)paraPass.prepare();
      renderMirror();
      cloudPass.render({strength:Number(motionSelect.value),submerged:underwater.active,target:para?paraPass.target:null});
      if(para)paraPass.render(cloudPass.opaque.depthTexture,presentation);
    }
    catch (error) { stopped = true;presenting=false;loading.fail(error);status.textContent = `Render error: ${error.message}`; console.error(error); return; }
    metrics.cpuMs = performance.now() - start; metrics.frame++;
    Object.assign(metrics.render, renderer.info.render);
    if (time - lastStamp > 700) { updateStamp(); lastStamp = time; }
  }
  function resume() { lastFrame = 0;framePacer.reset(); if (presenting && !frame && !contextLost && !stopped && !document.hidden) frame = requestAnimationFrame(animate); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else resume(); });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); contextLost = true; cancelAnimationFrame(frame); frame = 0;
    // The shot's clock is frozen while the context is gone; restart it cleanly
    // instead of resuming an interpolation whose frames nobody saw.
    navigation.cancelShot();organoid.skip();
    clearOpeningFrame();
    presenting=false;startup.ready=false;startup.rendered=false;loading.show('The light slipped away. Preparing it again…');
    status.textContent = 'Graphics paused — recovering…';
  });
  canvas.addEventListener('webglcontextrestored', async () => {
    try { contextLost=false;cloudPass.lighting.update(true);cloudPass.shadows.update(true);forest.rebuildImpostors();distantTreeShadows.update(style.sun.value,true);ecology.rebuildImpostors();updateShadow(true);await prepareFirstView(); }
    catch(error){stopped=true;loading.fail(error);console.error(error);}
  });
  window.addEventListener('pagehide', e => { if (!e.persisted) { stopped = true; cancelAnimationFrame(frame); riverGranite.dispose();geology?.dispose();terrain.dispose();distantTreeShadows.dispose();forest.dispose();treeShadows.dispose();ecology.dispose();airCues.dispose();forestLitterTexture.dispose();litterBitmap.close();forestFloor.dispose();forestSoil.dispose();meadowAir.dispose();meadowWind.dispose();meadow.dispose();tutor.dispose();parakiteTour.dispose();organoid.dispose();soundscape.dispose();navigation.dispose();firstPerson.dispose();flightRig.dispose();character.dispose();folk.dispose();gondola.dispose();actorShadows.dispose();cloudPass.dispose();mirror?.dispose();layered?.dispose();paraPass.dispose();controls.dispose(); renderer.dispose(); } });
  await prepareFirstView();
  if(requestedOrganoid){
    toTumbleHill();
    navigation.cancelShot();
    const player=navigation.state;
    const [x,y]=organoid.approach;
    navigation.placeOnFoot(player.x,player.y,Math.atan2(y-player.y,x-player.x));
  }
  // The default opening is the journal's ready state: the world is drawn behind
  // it, and the Begin gesture is what starts play and audio. Developer links
  // (?view=, ?course=, ?encounter=) start where they are told, as before.
}
