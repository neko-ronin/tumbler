/** Matched stills of the ground's seams (docs/reviews/ground-seams-2026-11-23), clock held, light 'day'.
 * NODE_PATH=<existing node_modules> CHROME_PATH=<chromium> timeout -k 10 480 node client/web/tools/review-ground-seams.cjs <label>
 * TUMBLER_REVIEW_URL picks the server (default 8046); writes <REVIEW_OUT or output/playwright/ground-seams>/<label>-<pose>.png
 * and <label>.json. REVIEW_POSES=a,b picks poses.
 * Poses are world (east, north, metres above the rendered ground) — `at` the eye, `look` the target — so an audit
 * coordinate drops in unchanged; `eye`/`target` are absolute scene coordinates [east, up, -north] as in review-water.cjs.
 * Exits on every path, with its own deadline, like review-water.cjs.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const label=process.argv[2]||'candidate',out=path.resolve(process.env.REVIEW_OUT||'output/playwright/ground-seams');fs.mkdirSync(out,{recursive:true});
const poses={
 overview:{at:[0,-3200,1100],look:[0,200,0]},                 // the block from the south: sward tint against blades at range
 village:{at:[316,-1560,160],look:[316,-1252,0]},             // finding 1: the retired village disc
 villageFoot:{at:[316,-1360,1.7],look:[316,-1200,0]},         // finding 1 at player height
 forestEdge:{at:[790,800,1.7],look:[900,900,0]},              // finding 2: grass stamp and forest litter overlap
 snowline:{at:[-316,1000,150],look:[-316,1332,0]},            // finding 3: the bald band below the snow
 meadowEye:{at:[600,-250,1.7],look:[600,-60,0]},              // finding 4: blade layer ends, landing meadow
 meadowLow:{at:[600,-250,8],look:[600,-20,0]},                // finding 4, a little higher
 seamEast:{eye:[1930,40,330],target:[2120,20,420]},           // finding 5: river / granite / grass at the east edge
 topSeamEast:{eye:[2048,160,400],target:[2048,20,420.1]},     // finding 6: straight down on x = 2048
 falls:{at:[-484,610,30],look:[-484,790,30]},                 // finding 7: grass cap and granite at the falls
 gondola:{at:[-590,490,22],look:[-650,545,0]},                // finding 8: the village gondola station
 track:{at:[-928,-700,14],look:[-928,-600,0]},                // finding 9: the T1 track's carved line
 summit:{at:[-1284,1640,160],look:[-1284,2028,0]},            // finding 11: high ground in the block
 highFar:{at:[4500,-6500,260],look:[4500,-5996,0]},           // finding 11: high ground in the transition
 riverBank:{at:[1150,-300,3],look:[1110,-350,0]},             // finding 12: bank below the outlet, sward halo past the blades
 southRidge:{at:[-1760,-1760,90],look:[-2028,-2028,0]},       // finding 13: the 37 degree forest-slope cut
 edgeSouth:{at:[-1300,-1990,6],look:[-1300,-2140,0]},         // finding 6 on land: grass across the south block edge (y = -2048)
 topSeamSouth:{at:[-1300,-2048,120],look:[-1300,-2048.1,0]},  // finding 6: straight down on that edge
 mooring:{at:[-560,430,25],look:[-620,490,0]},                // finding 8 (corrected): the blimp mooring hardstanding
 dome05:{at:[1840,-640,30],look:[1910.3,-575.3,4]},            // DOME05 re-sited 2026-11-23 out of the river (was 2039.2, -413.8)
 fallsBay:{eye:[-380,34,-250],target:[-390,80,-860]},          // lake walls must keep their granite (review-water.cjs pose)
};
const chosen=process.env.REVIEW_POSES?process.env.REVIEW_POSES.split(','):Object.keys(poses);
(async()=>{
 setTimeout(()=>{console.error('review-ground-seams: no result after seven minutes; giving up');process.exit(3);},420000).unref();
 const report={label,load1m:os.loadavg()[0],freeGB:os.freemem()/2**30,views:{},errors:[]},errors=report.errors;
 let browser;
 try{
  browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>{errors.push(e.message);console.error('pageerror',e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html');
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  report.readyMs=await page.evaluate(()=>performance.now());  // navigation start to ready: load cost, coarse
  await page.evaluate(async()=>{
   const t=tumbler,{style}=await import('./src3d/style.js');t.navigation.select('orbit');
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   for(const id of ['site-marker','site-dot'])document.getElementById(id)?.remove();
   t.navigation.update=()=>{};t.controls.enabled=false;t.flightRig.group.visible=false;t.character.object.visible=false;
   Object.defineProperty(style.time,'value',{get:()=>40,set:()=>{}});
   const scene=([e,n,h])=>[e,(t.ground.height(e,n)??0)+h,-n];
   window.seamAim=p=>{const eye=p.eye??scene(p.at),target=p.target??scene(p.look);
    t.setLight('day');t.camera.position.fromArray(eye);t.camera.lookAt(...target);t.camera.fov=62;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();return {eye,target};};
  });
  // REVIEW_EVAL: a diagnostic switch run in the page before any still, e.g. one shader input
  // turned off to prove it is what draws a seam. Its source is recorded in the report.
  if(process.env.REVIEW_EVAL){report.eval=process.env.REVIEW_EVAL;report.evalResult=await page.evaluate(src=>(0,eval)(src),process.env.REVIEW_EVAL);}
  for(const name of chosen){
   const pose=poses[name];if(!pose){errors.push(`no pose ${name}`);continue;}
   const placed=await page.evaluate(p=>seamAim(p),pose);await page.waitForTimeout(3000);
   await page.screenshot({path:`${out}/${label}-${name}.png`});
   report.views[name]={...pose,...placed};
  }
 }catch(e){errors.push(e.message);console.error(e);}
 report.load1mEnd=os.loadavg()[0];
 if(!Object.keys(report.views).length&&!errors.length)errors.push('no views were captured');
 fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,1));
 console.log(JSON.stringify({views:Object.keys(report.views).length,errors,load:report.load1m}));
 if(browser)await Promise.race([browser.close(),new Promise(r=>setTimeout(r,5000))]);
 process.exit(errors.length||!Object.keys(report.views).length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
