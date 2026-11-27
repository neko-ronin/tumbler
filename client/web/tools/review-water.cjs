/** Matched stills and frame pacing of the river and lake from fixed views, clock held for stills.
 * NODE_PATH=<existing node_modules> CHROME_PATH=<chromium> node client/web/tools/review-water.cjs <label>
 * TUMBLER_REVIEW_URL selects the server (default 8046); writes <REVIEW_OUT or output/playwright/water>/<label>-<pose>.png and <label>.json.
 * Views look with FOV 62 unless they say otherwise. REVIEW_POSES=a,b picks views; REVIEW_MIRROR=0 turns the lake reflection off; REVIEW_REFLECTIONS=off|mirror|layered picks the lake reflection (card 085), REVIEW_LAYERS=1,0,1 its layers; REVIEW_FRAMES=n adds n stills a quarter second apart; REVIEW_LIGHT=day|golden|dusk lights every view the same; REVIEW_PACE=0 skips pacing (stills only).
 * Run under `timeout -k 10 480`: Playwright turns SIGTERM into "close the browser" and this process would not end on TERM alone.
 * Check of the failure path: TUMBLER_REVIEW_URL=http://127.0.0.1:9 must exit 1 within seconds with the error in <label>.json.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const label=process.argv[2]||'candidate',out=path.resolve(process.env.REVIEW_OUT||'output/playwright/water');fs.mkdirSync(out,{recursive:true});
// Scene metres: x east, y up, z = -north. Today's water surface is 20 m; the lake is an oval at world (-1450, -850).
const poses={
 lakeShore:{eye:[-1010,37,820],target:[-1450,20,850],light:'day'},        // standing on the east shore, sun behind
 lakeEdge:{eye:[-1098,21.6,836],target:[-1160,19.5,880],light:'day'},     // crouched at the waterline: the shore's own detail
 lakeGolden:{eye:[-1790,38,700],target:[-1300,20,900],light:'golden'},    // west shore toward the evening light
 riverBend:{eye:[-640,40,60],target:[-900,20,-60],light:'day'},           // the river-bend place, looking upstream
 riverBank:{eye:[-610,22.5,18],target:[-560,20,60],light:'day'},          // at the river's edge, looking downstream
 homestead:{eye:[-1730,44,590],target:[-1668,31,540],light:'day'},        // the first homestead with the lake behind it
 underLake:{eye:[-1450,16,850],target:[-1380,14,800],light:'day'},        // four metres under the lake's surface
 underRiver:{eye:[-640,17,40],target:[-600,16,10],light:'day'},           // under the river at the bend
 airWest:{eye:[-2900,620,1900],target:[-1100,20,500],light:'day'},        // paraglider over the west valley: lake and river together
 airLake:{eye:[-1450,330,1500],target:[-1450,20,820],light:'golden'},     // low over the lake from the south
 // Views of the long-lake candidate (surface 30 m, falls lip at world (-390, 860), narrows near x = 185).
 airLong:{eye:[-2600,600,1500],target:[-150,30,-200],light:'day'},        // the whole formation from the south-west
 airFalls:{eye:[-900,380,300],target:[-390,90,-860],light:'day'},         // over the west basin toward the falls and the hanging valley
 fallsBay:{eye:[-380,34,-250],target:[-390,80,-860],light:'day'},         // on the water in the north bay, looking up at the falls
 narrows:{eye:[-700,40,80],target:[400,30,-150],light:'day'},             // west basin's south shore, east through the narrows
 outlet:{eye:[1250,45,200],target:[300,30,-150],light:'golden'},          // below the moraine, back up the lake toward evening light
 logJam:{eye:[700,33.2,-180],target:[692,30.3,-222],light:'day'},        // the drift-log jam at the outlet (card 092)
 underLong:{eye:[-500,24,-120],target:[-300,20,-200],light:'day'},        // six metres under the west basin
 valleyEast:{eye:[-1900,120,900],target:[1500,60,300],light:'day'},       // low over the south-west floor, east along the valley: its cross-section
 // Close views of the adopted formation, eyes 1.7 m over ground sampled with tumbler.ground.height (2026-11-19).
 shoreSouth:{eye:[-349,34.7,217],target:[-380,29.5,50],light:'day'},      // standing on the west basin's south shore, north over the lake
 shoreEdge:{eye:[-353,32.2,202],target:[-372,29.6,140],light:'day'},       // at the waterline there: the shore's own detail
 riverBelow:{eye:[1157.5,27.7,307],target:[1114.6,23.5,355.6],light:'day'},// on the bank below the outlet, across the river
 riverMid:{eye:[1330,70,150],target:[1110,24,330],light:'day'},           // low over the bank below the outlet, 300 m down onto the river (card 087)
 fallsBrow:{eye:[-430,230,-640],target:[-372,160,-960],light:'day'},      // over the north bay at the lip's height, up the cascade above the falls (card 087)
 homeRaised:{eye:[1020,50,-362],target:[996,46.5,-380],light:'day'},      // HS010, the most-raised home (1.85 m foundation)
 // Under the long lake and the river (phase 10). Surface 30 m; the basin's deepest bed is 6.4 m at world (-378, 167).
 underShelf:{eye:[-372,27,80],target:[-375,14,-60],light:'day'},          // 3 m down over the south shelf, north down the slope into the basin
 underDeep:{eye:[-378,14,-150],target:[-480,12,-160],light:'day'},        // 16 m down in the basin, 8 m over the bed, looking west
 underUp:{eye:[-372,22,0],target:[-372,40,12],light:'day'},               // 8 m down, looking up through the surface (Snell's window)
 underBay:{eye:[-390,28.3,-650],target:[-390,32,-860],light:'day'},       // under the north bay toward the falls' plunge
 underRiverLow:{eye:[1105,22.6,310],target:[1180,22,380],light:'day'},    // in the river below the outlet (surface 24 m, bed 21.2), downstream
 // Where the block's river meets the outer reaches (pre-merge seams review, 2026-11-22).
 seamEast:{eye:[1930,40,330],target:[2120,20,420],light:'day'},           // the east block edge, downstream across it
 seamWest:{eye:[-1930,50,40],target:[-2150,31,110],light:'day'},          // the west block edge, upstream across it
 airSeamEast:{eye:[1700,260,0],target:[2100,20,400],light:'day'},         // over the east edge
 topSeamEast:{eye:[2048,160,400],target:[2048,20,420.1],light:'day'},    // straight down on the east junction (x 2048)
 topSeamWest:{eye:[-2048,170,80],target:[-2048,31,100.1],light:'day'},    // straight down on the west junction
 // Life in the water (phase 11), from shared/ecology/aquatic.json: the densest beds and a duck raft.
 lilyBay:{eye:[-440,36,-520],target:[-461,30,-543],light:'day'},          // low over the lily beds of the north-west bay
 underWeed:{eye:[-400,27,150],target:[-418,25.8,140],light:'day'},        // 3 m down beside a pondweed meadow (bed 24.8 m)
 duckRaft:{eye:[-330,31.6,140],target:[-344.6,30,154.3],light:'day'},     // just over the water by the south-shore raft
 underTrout:{eye:[-372,22,10],target:[-350,19,2],light:'day'},            // 8 m down in the basin where a trout school swims
 // Movers in the lake's reflection (card 085): `setup` places them (y null: on the ground).
 shorePlayer:{eye:[-361,30.7,157],target:[-354.5,30.4,185],fov:30,light:'day',setup:{character:[-354.5,null,185],yaw:2.8}}, // low over the water, the player at the waterline (FOV 30)
 paraCliff:{eye:[-380,34,-250],target:[-430.25,34,-335.6],fov:25,light:'day',setup:{wing:[-550.1,72.6,-542.7],wingYaw:.53}},  // fallsBay's view, a paraglider half behind the west bay's rim (on its eye ray, 30 m past it)
};
// REVIEW_POSES_FILE=<json> adds (or overrides) views for one review without editing this list.
if(process.env.REVIEW_POSES_FILE)Object.assign(poses,JSON.parse(fs.readFileSync(process.env.REVIEW_POSES_FILE,'utf8')));
const chosen=process.env.REVIEW_POSES?process.env.REVIEW_POSES.split(','):Object.keys(poses);
for(const k of Object.keys(poses))if(!chosen.includes(k))delete poses[k];else if(process.env.REVIEW_LIGHT)poses[k].light=process.env.REVIEW_LIGHT;
(async()=>{
 // Nothing below may wait forever: a page evaluation has no timeout of its own.
 setTimeout(()=>{console.error('review-water: no result after seven minutes; giving up');process.exit(3);},420000).unref();
 const report={label,load1m:os.loadavg()[0],views:{},errors:[]},errors=report.errors;
 const write=()=>fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,1));
 let browser;
 try{
  browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>{errors.push(e.message);console.error('pageerror',e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
  // REVIEW_HEIGHTS=<file.f32>: a candidate block heightmap served in place of the published one, its manifest hash with it.
  if(process.env.REVIEW_HEIGHTS){
   const body=fs.readFileSync(process.env.REVIEW_HEIGHTS),sha256=require('node:crypto').createHash('sha256').update(body).digest('hex'),file='client/web/data/heightmap.f32';
   await page.route(`**/${file}*`,route=>route.fulfill({body,contentType:'application/octet-stream'}));
   await page.route('**/client/web/data/viewer.json*',async route=>{const response=await route.fetch(),manifest=await response.json();manifest.fetched.find(e=>e.path===file).sha256=sha256;route.fulfill({response,json:manifest});});
   report.heights={file:process.env.REVIEW_HEIGHTS,sha256};
  }
  // REVIEW_QUERY=water_look=clear (for example) is appended to the page's address.
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html'+(process.env.REVIEW_QUERY?'?'+process.env.REVIEW_QUERY:''));
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  await page.evaluate(async mirrorOff=>{
   const t=tumbler,{style}=await import('./src3d/style.js');t.navigation.select('orbit');
   if(t.mirror&&mirrorOff)t.mirror.enabled=false;  // REVIEW_MIRROR=0: the lake's planar reflection off
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   for(const id of ['site-marker','site-dot'])document.getElementById(id)?.remove();  // the preview's marking tool is not part of the picture
   t.navigation.update=()=>{};t.controls.enabled=false;t.flightRig.group.visible=false;t.character.object.visible=false;
   // Stills hold the clock at 40 s; pacing lets the page's own clock run.
   let real=40;window.waterClock={held:40};
   Object.defineProperty(style.time,'value',{get:()=>waterClock.held??real,set:v=>{real=v;}});
   window.waterAim=p=>{t.setLight(p.light);t.camera.position.fromArray(p.eye);t.camera.lookAt(...p.target);t.camera.fov=p.fov??62;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();};
   // The page's own loop, clock running: intervals between the frames it actually presents.
   window.waterPace=async ms=>{
    waterClock.held=null;const gaps=[];let last=performance.now();const end=last+ms;
    await new Promise(done=>{const tick=now=>{gaps.push(now-last);last=now;now<end?requestAnimationFrame(tick):done();};requestAnimationFrame(tick);});
    waterClock.held=40;gaps.sort((a,b)=>a-b);
    return {frames:gaps.length,median:gaps[gaps.length>>1],p95:gaps[Math.floor(gaps.length*.95)],over20ms:gaps.filter(g=>g>20).length,over34ms:gaps.filter(g=>g>34).length};
   };
   // Poses that show movers place them first (`setup`); the others hide them.
   window.waterMovers=s=>{
    t.flightRig.group.visible=false;t.character.object.visible=false;
    if(s?.character){t.character.object.visible=true;t.character.object.position.fromArray(s.character);if(s.character[1]==null)t.character.object.position.y=t.ground.height(s.character[0],-s.character[2]);t.character.object.rotation.set(0,s.yaw??0,0);t.character.object.updateMatrixWorld(true);}
    if(s?.wing){const g=t.flightRig.group;g.visible=true;g.position.fromArray(s.wing);g.rotation.set(0,s.wingYaw??0,0);g.updateMatrixWorld(true);}
   };
  },process.env.REVIEW_MIRROR==="0");
  if(process.env.REVIEW_REFLECTIONS)await page.evaluate(m=>{tumbler.mirror.mode=m;},process.env.REVIEW_REFLECTIONS);
  // REVIEW_UNDER=0: hide the underwater shafts and motes and the bed's caustics (cost isolation).
  if(process.env.REVIEW_UNDER==='0')await page.evaluate(async()=>{const {style}=await import('./src3d/style.js');const u=tumbler.underwater,update=u.update.bind(u);u.update=(...a)=>{const r=update(...a);u.group.visible=false;style.underwater.value=0;return r;};});
  // REVIEW_HIDE=a,b hides scene objects by name (cost isolation), e.g. living_habitats.
  if(process.env.REVIEW_HIDE)await page.evaluate(names=>{for(const n of names.split(','))tumbler.scene.traverse(o=>{if(o.name===n)o.visible=false;});},process.env.REVIEW_HIDE);
  // REVIEW_LAYERS=screen,probes,movers (1 or 0 each): show the layered reflection's layers alone.
  if(process.env.REVIEW_LAYERS)await page.evaluate(l=>{tumbler.mirror.layered.layers.set(...l.split(',').map(Number));},process.env.REVIEW_LAYERS);
  for(const [name,pose]of Object.entries(poses)){
   await page.evaluate(p=>{waterMovers(p.setup);waterAim(p);},pose);await page.waitForTimeout(2500);
   await page.screenshot({path:`${out}/${label}-${name}.png`});
   // REVIEW_FRAMES=n: n stills a quarter second apart on the held clock, for judging motion.
   for(let f=1;f<=+(process.env.REVIEW_FRAMES||0);f++){await page.evaluate(f=>{waterClock.held=40+f*.25;},f);await page.waitForTimeout(400);await page.screenshot({path:`${out}/${label}-${name}-f${f}.png`});}
   await page.evaluate(()=>{waterClock.held=40;});
   // What the reflection drew for the still (held clock): its size, draw calls and triangles.
   const reflection=await page.evaluate(()=>({mode:tumbler.mirror.mode,...JSON.parse(JSON.stringify(tumbler.mirror.stats??{}))}));
   report.views[name]={...pose,reflection,pace:process.env.REVIEW_PACE==='0'?null:await page.evaluate(()=>waterPace(4000))};
  }
  report.failedPrograms=await page.evaluate(()=>tumbler.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length);
 }catch(e){errors.push(e.message);console.error(e);} // a report with no views must say why
 report.load1mEnd=os.loadavg()[0];write();
 console.log(JSON.stringify(Object.fromEntries(Object.entries(report.views).map(([k,v])=>[k,v.pace?[v.pace.frames,+v.pace.median.toFixed(1)]:null]))),'load',report.load1m);
 // close() can wait on the browser's crash-handler helpers; the report is already on disk.
 if(browser)await Promise.race([browser.close(),new Promise(r=>setTimeout(r,5000))]);
 process.exit(errors.length||report.failedPrograms||!Object.keys(report.views).length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
