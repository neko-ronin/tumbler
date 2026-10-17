/** Browser composition only: the core remains the source of the world. */
import * as T from '../vendor/three.module.min.js';
import { createOrbitControls } from './controls.js';
import { buildBlockTerrain, buildFarFieldRing, buildWater, buildRiverReaches } from './terrain.js';
import { buildPlacements, buildForest } from './placements.js';
import { GroundSampler, HeightGrid, decodeGroundCover } from './heights.js';
import { buildMeadowTiles, buildMeadowPatch, buildCloseMeadow } from './groundcover.js';
import { parseGLB, applyImageBytes, mergePrimitives } from './glb.js';
import { makeSky, style } from './style.js';
import { createCloudPass } from './clouds.js';
import { createNavigation } from './navigation.js';
import { buildEcology } from './ecology.js';
import { buildTethers, buildTrails } from './details.js';
import { createSoundscape } from './audio.js';
import { buildWorldCollision } from './collision.js';
import { sha256, verifyFetched, checkVersion } from './provenance.js';
import { createSnowSampler, createTrailSampler, createSurfaceSampler, createRideHeight } from '../../../shared/activities/ride.js';

const root = new URL('../../../', import.meta.url);
const observed=new Map();
async function fetchData(path, json = true) {
  const response = await fetch(new URL(path, root));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();observed.set(path,sha256(bytes));
  return json ? JSON.parse(new TextDecoder().decode(bytes)) : bytes;
}

async function main() {
  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const stamp = document.getElementById('stamp');
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
  const scene = new T.Scene();
  scene.background = new T.Color('#dcdcc1');
  scene.fog = new T.Fog('#dcdcc1', 2500, 11500);
  const camera = new T.PerspectiveCamera(62, 1, .15, 30000);
  camera.position.set(-1600, 200, -780);
  const controls = createOrbitControls(camera, canvas);
  let pixelRatio = 1;
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
  }
  window.addEventListener('resize', resize); resize();

  status.textContent = 'Finding our place…';
  const [manifest, placement, stampData, blockBytes, farBytes, worldmap, habitats] = await Promise.all([
    fetchData('client/web/data/viewer.json'), fetchData('shared/world/out/placement.json'),
    fetchData('shared/world/out/ground_cover.json'), fetchData('client/web/data/heightmap.f32', false),
    fetchData('client/web/data/farfield.f32', false), fetchData('shared/world/worldmap.json'),
    fetchData('shared/ecology/habitats.json'),
  ]);
  checkVersion(manifest,1,'viewer manifest');checkVersion(worldmap,2,'world map');
  const [meadowData,flightConfig,rideConfig]=await Promise.all([fetchData(worldmap.activities.meadow_life),fetchData(worldmap.activities.flight),fetchData(worldmap.activities.ride)]);
  const snowStamp=await fetchData(rideConfig.snow_cover);
  for(const [value,known,label] of [[worldmap,2,'world map'],[placement,3,'placements'],[stampData,1,'grass stamp'],[habitats,1,'water habitats'],[meadowData,1,'meadow life'],[flightConfig,1,'flight'],[rideConfig,1,'ski and bike rules'],[snowStamp,1,'snow cover']])checkVersion(value,known,label);
  const blockGrid = new HeightGrid({ values: new Float32Array(blockBytes), ...manifest.height_grids.block, kind: 'block' });
  const farGrid = new HeightGrid({ values: new Float32Array(farBytes), ...manifest.height_grids.far_field, kind: 'far field' });
  const ground = new GroundSampler(blockGrid, farGrid);
  status.textContent = 'Opening the meadow…';
  // Bounded parallel loading avoids a serial network waterfall and limits peak
  // parsing memory. Source bytes fall out of scope as each asset is decoded.
  const paths = [...new Set([...placement.instances.map(i => i.asset),...habitats.plantings.map(i=>i.asset),...meadowData.species.map(i=>i.asset),'waterside/river_fish.glb','waterside/fish_tail.glb','waterside/frog.glb','waterside/dragonfly_wings.glb',flightConfig.wing_asset,flightConfig.motor_asset,...Object.values(flightConfig.modes).map(m=>m.wing_asset).filter(Boolean),...Object.values(rideConfig.modes).map(m=>m.asset)])];
  const assets = {};
  let next = 0;
  async function loadAsset() {
    while (next < paths.length) {
      const path = paths[next++];
      const asset = parseGLB(await fetchData(`shared/geometry/${path}`, false));
      await applyImageBytes(asset, async (bytes, mimeType) => {
        const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }), { imageOrientation: 'none' });
        const texture = new T.Texture(bitmap);
        texture.colorSpace = T.SRGBColorSpace; texture.flipY = false; texture.needsUpdate = true;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        return texture;
      });
      assets[path] = asset;
    }
  }
  await Promise.all([loadAsset(), loadAsset(), loadAsset()]);
  status.textContent='Checking world bytes…';
  const verifiedFiles=await verifyFetched(manifest.fetched,observed,p=>fetchData(p,false));
  scene.add(buildBlockTerrain(blockGrid), buildFarFieldRing(farGrid, blockGrid.maxX));
  const water = buildWater(placement.instances.filter(i => i.kind === 'river' || i.kind === 'lake'), assets, blockGrid,worldmap);
  scene.add(water, buildRiverReaches(worldmap, farGrid));
  const placements = buildPlacements(placement, assets, { ground }); scene.add(placements.group);
  const forest = buildForest(placement, assets,renderer); scene.add(forest.group);
  const cover = decodeGroundCover(stampData);
  const coverTexture=new T.DataTexture(Uint8Array.from(cover.covered,v=>v*255),cover.resolution,cover.resolution,T.RedFormat);
  coverTexture.minFilter=coverTexture.magFilter=T.LinearFilter;coverTexture.needsUpdate=true;
  style.cover.value=coverTexture;style.coverGrid.value.set(cover.offsetX,cover.offsetY,cover.quad,cover.resolution);
  // The snow stamp shares the grass stamp's grid, so the terrain samples both with one transform.
  const snowGrid=snowStamp.grid;
  if(snowGrid.resolution!==cover.resolution||snowGrid.quad_size_m!==cover.quad||snowGrid.offset_xy_m[0]!==cover.offsetX||snowGrid.offset_xy_m[1]!==cover.offsetY)throw new Error('snow_cover.json and ground_cover.json must share a grid');
  const snowAt=createSnowSampler(snowStamp);
  const snowTexture=new T.DataTexture(Uint8Array.from(snowAt.depth,d=>Math.round(Math.min(1,d/snowStamp.model.max_depth_m)*255)),snowAt.resolution,snowAt.resolution,T.RedFormat);
  snowTexture.minFilter=snowTexture.magFilter=T.LinearFilter;snowTexture.needsUpdate=true;style.snow.value=snowTexture;
  const meadow = buildMeadowTiles(cover, ground, buildMeadowPatch(), {
    tileM: 128, flowerMix: stampData.density.flower_colour_mix,
  });
  scene.add(meadow.group);
  const closeMeadow = buildCloseMeadow(cover,ground);scene.add(closeMeadow.mesh);
  const ecology=buildEcology(habitats,meadowData,assets,ground,closeMeadow,renderer);scene.add(ecology.group);
  scene.add(buildTethers(placement,assets),buildTrails(worldmap,ground));
  const rig=new T.Group();rig.name='player_parafoil';
  const wing=mergePrimitives(assets[flightConfig.wing_asset].primitives,'opaque');rig.add(new T.Mesh(wing.geometry,wing.material));
  const motor=mergePrimitives(assets[flightConfig.motor_asset].primitives,'opaque');const motorMesh=new T.Mesh(motor.geometry,motor.material);motorMesh.position.set(0,.5,-.45);rig.add(motorMesh);
  const parafoilMesh=rig.children[0];
  const kiteAsset=mergePrimitives(assets[flightConfig.modes.parakite.wing_asset].primitives,'opaque');const parakiteMesh=new T.Mesh(kiteAsset.geometry,kiteAsset.material);parakiteMesh.visible=false;rig.add(parakiteMesh);
  rig.visible=false;scene.add(rig);
  const rideRig=new T.Group();rideRig.name='player_ride';rideRig.rotation.order='YXZ';rideRig.visible=false;
  const rideMeshes=Object.fromEntries(Object.entries(rideConfig.modes).map(([name,m])=>{const merged=mergePrimitives(assets[m.asset].primitives,'opaque');const mesh=new T.Mesh(merged.geometry,merged.material);mesh.castShadow=true;mesh.visible=false;rideRig.add(mesh);return [name,mesh];}));
  scene.add(rideRig);
  const trail=createTrailSampler(worldmap),surfaceAt=createSurfaceSampler(rideConfig,snowAt,trail);
  const rideHeight=createRideHeight((x,y)=>ground.height(x,y)??0,trail);
  const hitTest=buildWorldCollision(placement,assets);
  const navigation=createNavigation(camera,canvas,controls,ground,flightConfig,worldmap,rig,hitTest,{config:rideConfig,surfaceAt,snowAt,height:rideHeight,rig:rideRig,meshes:rideMeshes});
  const soundscape=createSoundscape(habitats);
  document.getElementById('sound').addEventListener('click',async e=>{const enabled=await soundscape.toggle();e.target.textContent=enabled?'Sound on':'Sound off';e.target.setAttribute('aria-pressed',String(enabled));});
  const modeSelect=document.getElementById('activity'),siteSelect=document.getElementById('launch-site');
  const rideModes=Object.keys(rideConfig.modes);
  function showStarts(mode){
    const list=rideModes.includes(mode)?rideConfig.starts.filter(s=>s.mode===mode).map(s=>[s.id,s.label]):flightConfig.launches.map((l,i)=>[String(i),l.label]);
    const key=list.map(([id])=>id).join();if(siteSelect.dataset.key===key)return;
    siteSelect.replaceChildren(...list.map(([id,label])=>new Option(label,id)));siteSelect.dataset.key=key;
  }
  const helps={orbit:'Drag to orbit · Right-drag to pan · Wheel to approach',walk:'WASD / left stick to walk · Drag / right stick to look · Shift to run',
    parakite:'A/D steer · W dive / S flare · Drag to look · Launch to restart',
    ski:'A/D carve · W pole · S snowplough · Shift tuck · Space hop · V view · Pad: stick, RT/LT, A hop, B tuck, Y view',
    bike:'A/D steer · W pedal · S brake · Shift crouch · Space hop · V view · Pad: stick, RT/LT, A hop, B crouch, Y view'};
  function setActivity(mode){showStarts(mode);navigation.select(mode,siteSelect.value);motorMesh.visible=mode==='paramotor';parafoilMesh.visible=mode!=='parakite';parakiteMesh.visible=mode==='parakite';modeSelect.value=mode;
    document.getElementById('help').textContent=helps[mode]??'A/D steer · W/S speed & brake · Drag to look · R/F motor throttle · Launch to restart';
    document.getElementById('launch').textContent=mode==='ski'?'Drop in ↘':mode==='bike'?'Ride ↘':'Launch ↗';
    canvas.focus();updateShadow(true);}
  modeSelect.addEventListener('change',e=>setActivity(e.target.value));
  siteSelect.addEventListener('change',()=>{if(rideModes.includes(navigation.mode))setActivity(navigation.mode);});
  document.getElementById('launch').addEventListener('click',()=>setActivity(['orbit','walk'].includes(modeSelect.value)?'paraglider':modeSelect.value));
  // The bearing is where the wind comes from; it blows toward the opposite one, and north is scene -z.
  const windFrom = worldmap.wind.direction_deg * Math.PI / 180; style.wind.value.set(-Math.sin(windFrom), Math.cos(windFrom));
  const sky = makeSky(worldmap.mountains?.enclosure?.river_reaches); scene.add(sky);
  const cloudPass=createCloudPass(renderer,scene,camera,worldmap.atmosphere);
  renderer.info.autoReset=false;

  const sun = new T.DirectionalLight('#ffe3a3', 2.1);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 1800 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .7;
  scene.add(sun, sun.target);
  const hemisphere = new T.HemisphereLight('#afd7e3', '#7a8452', 2.0); scene.add(hemisphere);
  const shadowCentre = new T.Vector3(Infinity, Infinity, Infinity);
  function updateShadow(force = false) {
    const target = controls.target;
    if (!force && target.distanceToSquared(shadowCentre) < 80 * 80) return;
    // Quantized anchor prevents shadow swimming while orbiting a fixed place.
    shadowCentre.set(Math.round(target.x / 40) * 40, target.y, Math.round(target.z / 40) * 40);
    sun.target.position.copy(shadowCentre);
    sun.position.copy(shadowCentre).addScaledVector(style.sun.value, 900);
    sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }
  function setLight(name) {
    const presets = {
      golden: { direction: [-.64,.48,-.55], color: '#ffdda2', fill: '#a8cbdc', intensity: 2.0, ambient: 1.8, exposure: 1.1, warmth: 1, fog: '#dcd7b8' },
      day: { direction: [-.35,.84,-.42], color: '#fff3d6', fill: '#b7ddef', intensity: 2.0, ambient: 1.75, exposure: 1.05, warmth: .15, fog: '#c8dcd6' },
      dusk: { direction: [.74,.25,-.63], color: '#ffc18d', fill: '#9baccd', intensity: 1.6, ambient: 1.55, exposure: 1.1, warmth: .85, fog: '#d9b7aa' },
    };
    const p = presets[name];
    style.sun.value.fromArray(p.direction).normalize(); style.warmth.value = p.warmth;
    sun.color.set(p.color); sun.intensity = p.intensity;
    hemisphere.color.set(p.fill); hemisphere.intensity = p.ambient;
    scene.fog.color.set(p.fog); scene.background.copy(scene.fog.color);
    renderer.toneMappingExposure = p.exposure;
    updateShadow(true);
  }
  document.getElementById('light').addEventListener('change', e => setLight(e.target.value));
  document.getElementById('resolution').addEventListener('change', e => { pixelRatio = Number(e.target.value); resize(); });
  const home = placement.instances.find(i => i.kind === 'homestead');
  const [hx,hy,hz] = home.position_m;
  // These are camera bookmarks, never placement decisions.
  const river = worldmap.water.bodies.find(b => b.kind === 'river');
  let riverIndex = 0, nearest = Infinity;
  river.polyline.forEach(([x,y],i) => { const d=(x-hx)**2+(y-hy)**2; if(d<nearest){nearest=d;riverIndex=i;} });
  const centre = river.polyline[riverIndex];
  const before = river.polyline[Math.max(0,riverIndex-1)], after=river.polyline[Math.min(river.polyline.length-1,riverIndex+1)];
  const tangent = new T.Vector2(after[0]-before[0],after[1]-before[1]).normalize();
  const bank = new T.Vector2(hx-centre[0],hy-centre[1]).normalize();
  const width = river.width_start_m + (river.width_end_m-river.width_start_m)*riverIndex/(river.polyline.length-1);
  const bankX=centre[0]+bank.x*(width*.1)-tangent.x*25;
  const bankY=centre[1]+bank.y*(width*.1)-tangent.y*25;

  const homePoses=Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return [hx+Math.cos(a)*38,hz+10,-hy+Math.sin(a)*38];});
  const nearby=placement.instances.filter(i=>i.asset.startsWith('redwood/')&&Math.hypot(i.position_m[0]-hx,i.position_m[1]-hy)<100);
  const masts=placement.instances.filter(i=>i.kind==='mooring_mast'&&Math.hypot(i.position_m[0]-hx,i.position_m[1]-hy)<80);
  const homeCamera=homePoses.sort((a,b)=>{
    const clearance=p=>Math.min(...[...nearby,...masts].map(t=>{const x=t.position_m[0],z=-t.position_m[1],dx=p[0]-hx,dz=p[2]+hy;const along=Math.max(.05,Math.min(1,((x-hx)*dx+(z+hy)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-hx-dx*along,z+hy-dz*along)-(t.kind==='mooring_mast'?3:4);}));
    return clearance(b)-clearance(a);
  })[0];
  const shoreHabitat=habitats.habitats.filter(h=>h.body==='river').sort((a,b)=>Math.hypot(a.shore_m[0]-hx,a.shore_m[1]-hy)-Math.hypot(b.shore_m[0]-hx,b.shore_m[1]-hy))[0];
  const shore=shoreHabitat.shore_m,school=shoreHabitat.centre_m;
  const views = {
    home: { position: homeCamera, target: [hx, hz + 3, -hy] },
    valley: { position: [-1850,1150,1450], target: [0,450,-1100] },
    summit: { position: [-650,ground.height(-380,1620)+110,-1360], target: [200,500,-700] },
    village: { position: [-780,ground.height(-710,450)+55,-340], target: [-710,ground.height(-710,450)+42,-450] },
    river: { position: [shore[0],shore[2]+2,-shore[1]], target: [school[0],school[2]-.7,-school[1]] },
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
    if (['1','2','3'].includes(e.key)) setView(['home','river','valley'][Number(e.key)-1]);
  });
  setView(new URLSearchParams(location.search).get('view') in views ? new URLSearchParams(location.search).get('view') : 'home');
  setLight('golden');

  status.textContent = 'Warming the light…';
  await renderer.compileAsync(scene, camera);

  let frame = 0, contextLost = false, stopped = false, lastFrame = 0, lastStamp = 0;
  let elapsed = 0;
  const samples = [];
  const metrics = { frame: 0, framesMs: samples, cpuMs: 0, render: {}, get view() { return document.body.dataset.view; } };
  // Read-only inspection hook used for repeatable visual/performance checks.
  window.tumbler = { scene, camera, renderer, controls, navigation, ride: { config: rideConfig, snowAt, surfaceAt, height: rideHeight, hitTest, worldmap, setActivity }, forest, cloudPass, ground, ecology, closeMeadow, metrics, views, setView, setLight, provenance: {files:verifiedFiles}, stats: { forest: forest.stats, meadow: meadow.stats, placements: placements.stats } };
  function updateStamp() {
    const ordered = [...samples].sort((a,b) => a-b);
    const percentile = p => ordered[Math.floor((ordered.length - 1) * p)] ?? 0;
    stamp.textContent = [
      `${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles`,
      `Frame interval p50 ${percentile(.5).toFixed(1)} ms · p95 ${percentile(.95).toFixed(1)} ms`,
      `CPU submit ${metrics.cpuMs.toFixed(1)} ms · ${canvas.width} × ${canvas.height}`,
      `${forest.stats.trees.toLocaleString()} trees · ${forest.stats.near} nearby meshes · ${forest.stats.tiles} batches`,
      `${meadow.stats.patches.toLocaleString()} meadow cells · ${meadow.stats.tiles} batches`,
      `Verified ${verifiedFiles} fetched files · generation ${manifest.commit.slice(0,8)} · local working tree`,
    ].join('\n');
  }
  function animate(time) {
    frame = 0;
    if (contextLost || stopped || document.hidden) return;
    const delta = lastFrame ? time - lastFrame : 0;
    lastFrame = time;
    if (delta > 0 && delta < 500) { samples.push(delta); if (samples.length > 240) samples.shift(); }
    elapsed += Math.min(delta, 50) / 1000;
    style.time.value = elapsed;
    navigation.update(Math.min(delta,50)/1000); updateShadow();
    forest.update(camera);closeMeadow.update(camera);ecology.update(camera,elapsed);soundscape.update(camera,navigation);

    // Far grass is represented by terrain shading; visible mesh cells occupy
    // the middle distance and dense blades take over around the observer.
    for(const tile of meadow.group.children){const sphere=tile.boundingSphere;tile.visible=!sphere||sphere.center.distanceTo(camera.position)<sphere.radius+230;}
    const flight=navigation.state;
    const rider=rideModes.includes(navigation.mode)?flight:null,riderSpeed=rider?Math.hypot(rider.vx,rider.vy,rider.vz):0;
    document.getElementById('flight-readout').textContent=rider?(rider.crashed?`${rider.crashed==='landing'?'Hard landing':`Hit a ${rider.crashed}`} · ${document.getElementById('launch').textContent} to go again`
      :`${rideConfig.modes[rider.mode].label} · ${(riderSpeed*3.6).toFixed(0)} km/h · ${Math.round(rider.startZ-rider.z)} m down · ${(rider.distance/1000).toFixed(2)} km · ${rider.grounded?rider.surface:'airborne'}${rider.mode==='ski'&&rider.grounded&&rider.surface!=='snow'&&riderSpeed<.3?' · Out of snow':''}`):navigation.mode==='orbit'?'':navigation.mode==='walk'?'On foot':flight.grounded?(flight.impact?`Contact with ${flight.impact} · Launch to fly again`:'Landed · Launch to fly again'):`${flightConfig.modes[flight.mode].label} · ${Math.round(navigation.air.agl)} m above ground · ${(flight.speed*3.6).toFixed(0)} km/h · ${flight.vario>=0?'+':''}${flight.vario.toFixed(1)} m/s${flight.mode==='paramotor'?` · Motor ${Math.round(flight.throttle*100)}%`:''}`;
    sky.position.copy(camera.position);
    const start = performance.now();
    try { renderer.info.reset(); cloudPass.render(); }
    catch (error) { stopped = true; status.textContent = `Render error: ${error.message}`; console.error(error); return; }
    metrics.cpuMs = performance.now() - start; metrics.frame++;
    Object.assign(metrics.render, renderer.info.render);
    if (time - lastStamp > 700) { updateStamp(); lastStamp = time; }
    frame = requestAnimationFrame(animate);
  }
  function resume() { lastFrame = 0; if (!frame && !contextLost && !stopped && !document.hidden) frame = requestAnimationFrame(animate); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else resume(); });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); contextLost = true; cancelAnimationFrame(frame); frame = 0;
    status.textContent = 'Graphics paused — recovering…';
  });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; forest.rebuildImpostors();ecology.rebuildImpostors();updateShadow(true); status.textContent = 'Ready for the mountains.'; resume(); });
  window.addEventListener('pagehide', e => { if (!e.persisted) { stopped = true; cancelAnimationFrame(frame); soundscape.dispose();navigation.dispose();cloudPass.dispose();controls.dispose(); renderer.dispose(); } });
  status.textContent = 'Ready for the mountains.';
  document.body.classList.add('ready');
  resume();
}
main().catch(error => { console.error(error); document.getElementById('status').textContent = error.message; });
