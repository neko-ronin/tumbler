/** Matched stills and short live sequences of the meadow and shore life (docs/reviews/meadow-life-2026-11-26), light 'day'.
 * NODE_PATH=<existing node_modules> CHROME_PATH=<chromium> timeout -k 10 600 node client/web/tools/review-meadow-life.cjs <label>
 * TUMBLER_REVIEW_URL picks the server (default 8213); writes <REVIEW_OUT or output/playwright/meadow-life>/<label>-<pose>.png
 * and <label>.json. REVIEW_POSES=a,b picks poses. REVIEW_FRAMES=n (default 0) also captures n frames 250 ms apart
 * per pose with the clock running (REVIEW_FRAME_MS changes the gap) (<label>-<pose>-f<i>.png), since wind and animals cannot be judged from a still.
 * Poses as in review-ground-seams.cjs: `at`/`look` are (east, north, metres above the rendered ground); `eye`/`target`
 * absolute scene [east, up, -north]. Exits on every path with its own deadline.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const label=process.argv[2]||'candidate',out=path.resolve(process.env.REVIEW_OUT||'output/playwright/meadow-life');fs.mkdirSync(out,{recursive:true});
const frames=Number(process.env.REVIEW_FRAMES||0),frameMs=Number(process.env.REVIEW_FRAME_MS||250);
const poses={
 meadowEye:{at:[600,-250,1.7],look:[600,-60,0]},        // player eye height across the landing meadow
 meadowFeet:{at:[600,-250,1.7],look:[600,-243,0]},      // ground and blades at the player's feet
 meadowFeetAgain:{at:[600,-250,1.7],look:[600,-243,0]}, // the same, a second time: how much a repeat still moves
 meadowLow:{at:[600,-250,8],look:[600,-20,0]},          // a little higher: drifts and gust waves read here
 meadowMid:{at:[600,-250,30],look:[600,-80,0]},         // mid band, 30 to 200 m
 meadowWide:{at:[600,-560,160],look:[600,100,0]},        // the whole meadow: one colour, or patches?
 lilies:{at:[752,183,1.8],look:[758,150,0]},           // wet meadow by river_016: corn lilies over the grass
 liliesHigh:{at:[790,180,16],look:[758,150,0]},         // the same ground from 16 m: lilies and the green riverside band
 ferns:{at:[790,800,1.3],look:[790.5,797,0]},           // forest edge: a fern close, among the floor plants
 // The nearest corn lily and the nearest fern, aimed at from close (instances move with the view, so found in the page).
 lilyClose:{find:`(async()=>{const t=tumbler;reviewAim({at:[752,183,1.8],look:[758,150,0]});await new Promise(r=>setTimeout(r,2500));
  const m=t.cornLilies.mesh,a=m.instanceMatrix.array;let best=null;for(let i=0;i<m.count;i++){const p=[a[i*16+12],a[i*16+13],a[i*16+14]];const d=Math.hypot(p[0]-752,p[2]+183);if(!best||d<best.d)best={p,d};}
  if(!best)return {error:'no lilies'};const [x,y,z]=best.p;return reviewAim({eye:[x+3.2,y+1.4,z+2.2],target:[x,y+.6,z]});})()`},
 fernClose:{find:`(async()=>{const t=tumbler;reviewAim({at:[790,800,1.3],look:[806,812,0]});await new Promise(r=>setTimeout(r,2500));
  const m=t.scene.getObjectByName('forest_floor').children[0],a=m.instanceMatrix.array;let best=null;for(let i=0;i<m.count;i++){const p=[a[i*16+12],a[i*16+13],a[i*16+14]];const d=Math.hypot(p[0]-790,p[2]+800);if(!best||d<best.d)best={p,d};}
  if(!best)return {error:'no ferns'};const [x,y,z]=best.p,dx=790-x,dz=-800-z,l=Math.hypot(dx,dz)||1;return reviewAim({eye:[x+dx/l*1.6,y+1.2,z+dz/l*1.6],target:[x,y+.25,z]});})()`},
 // The densest fern ground (most crowns within 4 m) near the forest edge, from eye height, then parted round a walker standing in it.
 fernThicket:{find:`(async()=>{const t=tumbler;reviewAim({at:[790,800,1.7],look:[800,810,0]});await new Promise(r=>setTimeout(r,2500));
  const m=t.forestFloor.group.children[0],a=m.instanceMatrix.array;let best=null;for(let dx=-30;dx<=30;dx+=1.5)for(let dy=-30;dy<=30;dy+=1.5){const x=790+dx,y=800+dy,h=t.ground.height(x,y);if(h===null)continue;let k=0;for(let i=0;i<m.count;i++)if(Math.hypot(a[i*16+12]-x,-a[i*16+14]-y)<4)k++;if(!best||k>best.k)best={x,y,h,k,c:t.forestFloor.coverAt(x,y,h)};}
  window.fernSpot=best;const {x,y,h}=best;return {...reviewAim({eye:[x+4.5,h+1.7,-y+3],target:[x,h+.5,-y]}),cover:best.c};})()`},
 fernPush:{find:`(async()=>{const {style}=await import('./src3d/style.js'),{x,y,h,c}=window.fernSpot;
  const pin=(v,a)=>{for(const [k,val] of Object.entries({x:a[0],y:a[1],z:a[2],w:a[3]}))Object.defineProperty(v,k,{configurable:true,get:()=>val,set(){}});};
  pin(style.meadowPush.value[0],[x,h,-y,1]);return {...reviewAim({eye:[x+4.5,h+1.7,-y+3],target:[x,h+.5,-y]}),cover:c};})()`},
 frogShore:{at:[657,70.5,1.1],look:[653.4,68.2,0]},     // lake_065's frog roosts at the shore
 duckRaft:{eye:[682.5,33,-124.5],target:[682.5,30,-138.5]}, // a raft of three ducks on the lake
 // A duck caught upending: wait for one whose body tips past 45 degrees, then look at it from 2.5 m.
 duckUp:{settle:150,find:`(async()=>{const d=tumbler.ecology.group.getObjectByName('waterside/duck.glb'),m=new (tumbler.camera.matrix.constructor)();
  for(let k=0;k<400;k++){for(let i=0;i<d.count;i++){d.getMatrixAt(i,m);const e=m.elements,up=e[5]/Math.hypot(e[4],e[5],e[6]);
   if(up<.7){const eye=[e[12]+2.2,e[13]+.7,e[14]+1.2],target=[e[12],e[13]+.1,e[14]];reviewAim({eye,target});tumbler.ecology.update=()=>{};return {eye,target,up};}}
   await new Promise(r=>setTimeout(r,100));}return {error:'no duck upended in 40 s'};})()`},
 // The grass parted around a standing walker (pinned at the feet view's target, since stills hold the player away).
 meadowPush:{find:`(async()=>{const {style}=await import('./src3d/style.js'),t=tumbler,x=600,n=-246.5,h=t.ground.height(x,n);
  const pin=(v,a)=>{for(const [k,val] of Object.entries({x:a[0],y:a[1],z:a[2],w:a[3]}))Object.defineProperty(v,k,{configurable:true,get:()=>val,set(){}});};
  pin(style.meadowPush.value[0],[x,h,-n,1]);pin(style.meadowPush.value[1],[x,h,-n+1.2,.6]);
  return reviewAim({at:[600,-250,1.7],look:[600,-243,0]});})()`},
 duckClose:{eye:[681.5,30.8,-133],target:[678.4,30,-136.1]},   // one of them, close: dabbling and wake
};
const chosen=process.env.REVIEW_POSES?process.env.REVIEW_POSES.split(','):Object.keys(poses);
(async()=>{
 setTimeout(()=>{console.error('review-meadow-life: no result after nine minutes; giving up');process.exit(3);},540000).unref();
 const report={label,frames,load1m:os.loadavg()[0],freeGB:os.freemem()/2**30,views:{},errors:[]},errors=report.errors;
 let browser;
 try{
  browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>{errors.push(e.message);console.error('pageerror',e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8213')+'/client/web/scene.html');
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  report.readyMs=await page.evaluate(()=>performance.now());
  await page.evaluate(async()=>{
   const t=tumbler,{style}=await import('./src3d/style.js');t.navigation.select('orbit');
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   for(const id of ['site-marker','site-dot'])document.getElementById(id)?.remove();
   t.navigation.update=()=>{};t.controls.enabled=false;t.flightRig.group.visible=false;t.character.object.visible=false;
   // The shader clock holds at 40 s for stills; reviewLive releases it for sequences.
   let held=true,live=40;
   Object.defineProperty(style.time,'value',{get:()=>held?40:live,set:v=>{live=v;}});
   window.reviewLive=on=>{held=!on;};
   const scene=([e,n,h])=>[e,(t.ground.height(e,n)??0)+h,-n];
   window.reviewAim=p=>{const eye=p.eye??scene(p.at),target=p.target??scene(p.look);
    t.setLight('day');t.camera.position.fromArray(eye);t.camera.lookAt(...target);t.camera.fov=62;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();return {eye,target};};
  });
  if(process.env.REVIEW_EVAL){report.eval=process.env.REVIEW_EVAL;report.evalResult=await page.evaluate(src=>(0,eval)(src),process.env.REVIEW_EVAL);}
  for(const name of chosen){
   const pose=poses[name];if(!pose){errors.push(`no pose ${name}`);continue;}
   const placed=await page.evaluate(async p=>{reviewLive(false);return p.find?await (0,eval)(p.find):reviewAim(p);},pose);await page.waitForTimeout(pose.settle??3000);
   await page.screenshot({path:`${out}/${label}-${name}.png`});
   if(frames){await page.evaluate(()=>reviewLive(true));for(let i=0;i<frames;i++){await page.waitForTimeout(frameMs);await page.screenshot({path:`${out}/${label}-${name}-f${i}.png`});}}
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
