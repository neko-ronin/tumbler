/** Matched stills, GPU cost and frame pacing of the cumulus field, clouds on, clock held for stills.
 * NODE_PATH=<existing node_modules> CHROME_PATH=<chromium> node client/web/tools/review-cumulus.cjs <label>
 * TUMBLER_REVIEW_URL selects the server (default 8046); output/playwright/cumulus/<label>-<pose>.png and <label>.json
 * REVIEW_CLIP=1 also records <label>-approach.mp4, a ten-second climb past the central tower with the clock running.
 * The label `play` opens the ordinary game instead and leaves it open until the window is closed.
 * REVIEW_REV=<commit> renders that commit's client code (the baseline).
 * REVIEW_ATMOSPHERE=<json> replaces worldmap.json's atmosphere block for this run only.
 * Check of the failure path: with TUMBLER_REVIEW_URL=http://127.0.0.1:9 and REVIEW_OUT=<scratch dir> it must exit 1
 * within seconds, with the error in <label>.json.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const label=process.argv[2]||'candidate',out=path.resolve(process.env.REVIEW_OUT||'output/playwright/cumulus');fs.mkdirSync(out,{recursive:true});
// Scene metres: x east, y up, z = -north. Cloud base is 980 m.
const poses={
 valley:{eye:[600,120,900],target:[250,1700,-500],light:'day'},            // cloud watcher on the meadow
 glide:{eye:[-500,1150,900],target:[900,1500,-900],light:'day'},           // paraglider just above base
 flank:{eye:[50,2350,-230],target:[526,2257,-638],light:'day'},            // 330 m off the central tower's top turret, light grazing
 sunlit:{eye:[-2100,2500,-1100],target:[200,1900,-600],light:'day'},       // sun over the shoulder: the lit west faces
 inside:{eye:[200,1150,-520],target:[0,1500,-900],light:'day'},            // in cloud above the central thermals, facing the sun
 panorama:{eye:[0,1500,4200],target:[0,1700,0],light:'day'},               // whole field from the south
 skydive:{eye:[-1400,4300,2600],target:[600,1200,-600],light:'day'},       // jump altitude, tops below
 golden:{eye:[600,120,900],target:[250,1700,-500],light:'golden'},         // valley again, low warm sun
 goldenAir:{eye:[-900,2100,1700],target:[1350,1700,-1050],light:'golden'}, // among the towers at golden hour
 dusk:{eye:[0,1500,4200],target:[0,1700,0],light:'dusk'},
 // Arrangement views: the whole sky from the ground, the mountains and the jump.
 meadowNorth:{eye:[300,40,200],target:[200,1500,-4000],light:'golden'},
 meadowSouth:{eye:[300,40,200],target:[0,1500,4000],light:'golden'},
 northWall:{eye:[-1440,1920,-3020],target:[200,900,3000],light:'golden'},
 southRidge:{eye:[0,1220,3000],target:[-200,1700,-3000],light:'golden'},  // south wall top, looking at the north massif
 jumpDown:{eye:[-2600,4300,1200],target:[-1300,1500,3900],light:'golden'},
 glideBase:{eye:[-2600,1350,600],target:[2500,1700,500],light:'golden'},
 // Close looks at golden towers: the south-wall hero from 2 km, and its crown from beside it.
 towerNear:{eye:[-1300,2000,1700],target:[-1300,2700,3900],light:'golden'},
 crownSide:{eye:[-3400,3600,2600],target:[-1300,3500,3900],light:'golden'},
};
// REVIEW_POSES=a,b picks views; REVIEW_LIGHT=day|golden|dusk lights every view the same.
const chosen=process.env.REVIEW_POSES?process.env.REVIEW_POSES.split(','):Object.keys(poses).slice(0,10);
for(const k of Object.keys(poses))if(!chosen.includes(k))delete poses[k];else if(process.env.REVIEW_LIGHT)poses[k].light=process.env.REVIEW_LIGHT;
(async()=>{
 // Nothing below may wait forever: a page evaluation has no timeout of its own.
 if(label!=='play')setTimeout(()=>{console.error('review-cumulus: no result after seven minutes; giving up');process.exit(3);},420000).unref();
 const browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}),errors=[],report={label,load1m:os.loadavg()[0],views:{},errors};
 page.on('pageerror',e=>{errors.push(e.message);console.error('pageerror',e.message);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 // Captures must not read a connected pad; `play` is for flying it, so the pad stays live there.
 if(label!=='play')await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
 // REVIEW_ATMOSPHERE=<json> swaps the world map's atmosphere block in flight, so a sky can be judged
 // before the core map (and every digest that hashes it) is regenerated.
 // REVIEW_REV=<commit> serves that commit's client files through this server, for a matched baseline.
 if(process.env.REVIEW_REV){
  const git=args=>require('node:child_process').execSync(`git ${args}`,{maxBuffer:1<<28});
  report.revFiles=git(`diff --name-only --diff-filter=a ${process.env.REVIEW_REV} -- client/web`).toString().split('\n').filter(f=>f&&!/^client\/web\/(tests|tools|data)\//.test(f));
  for(const file of report.revFiles){const body=git(`show ${process.env.REVIEW_REV}:${file}`);await page.route(`**/${file}*`,route=>route.fulfill({body,contentType:'text/javascript'}));}
 }
 if(process.env.REVIEW_ATMOSPHERE){
  const atmosphere=JSON.parse(fs.readFileSync(process.env.REVIEW_ATMOSPHERE,'utf8')),map='shared/world/worldmap.json';report.atmosphere=process.env.REVIEW_ATMOSPHERE;
  const body=JSON.stringify({...JSON.parse(fs.readFileSync(map,'utf8')),atmosphere}),sha256=require('node:crypto').createHash('sha256').update(body).digest('hex');
  await page.route(`**/${map}*`,route=>route.fulfill({body,contentType:'application/json'}));
  // The page verifies fetched bytes against the manifest, so the manifest must name the swapped map.
  await page.route('**/client/web/data/viewer.json*',async route=>{const response=await route.fetch(),manifest=await response.json();manifest.fetched.find(e=>e.path===map).sha256=sha256;route.fulfill({response,json:manifest});});
 }
 try{
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html');
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  if(label==='play'){console.log('ready: close the browser window to end');await new Promise(closed=>browser.on('disconnected',closed));process.exit(0);}
  await page.evaluate(async()=>{
   const t=tumbler,{style}=await import('./src3d/style.js');t.navigation.select('orbit');
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   t.navigation.update=()=>{};t.controls.enabled=false;t.flightRig.group.visible=false;t.character.object.visible=false;
   // Stills hold the clock at 40 s; pacing and the clip let the page's own clock run.
   let real=40;window.cumulusClock={held:40};
   Object.defineProperty(style.time,'value',{get:()=>cumulusClock.held??real,set:v=>{real=v;}});
   window.cumulusAim=p=>{t.setLight(p.light);t.camera.position.fromArray(p.eye);t.camera.lookAt(...p.target);t.camera.fov=62;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();t.cloudPass.lighting.update(true);t.cloudPass.shadows.update(true);};
   // GPU time from a timer query where the browser offers one: a whole frame, and the cloud march alone.
   // Compare these between runs only: they read higher than the presented frame gap allows.
   // (Timing forced renders with gl.finish() was tried first and read 2-10 ms for 20 fps views.)
   const three=await import('./vendor/three.module.min.js'),saved=new three.Color();
   window.cumulusGpu=async()=>{
    const gl=t.renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return null;
    const time=async draw=>{
     const query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);draw();gl.endQuery(ext.TIME_ELAPSED_EXT);
     for(let i=0;i<240;i++){
      await new Promise(next=>requestAnimationFrame(next));
      if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){const ns=gl.getQueryParameter(query,gl.QUERY_RESULT);gl.deleteQuery(query);return gl.getParameter(ext.GPU_DISJOINT_EXT)?null:ns/1e6;}
     }
     gl.deleteQuery(query);return null;
    };
    const march=()=>{const r=t.renderer,target=r.getRenderTarget(),alpha=r.getClearAlpha();r.getClearColor(saved);r.setClearColor(0,0);r.setRenderTarget(t.cloudPass.cloudy);r.clear();r.render(t.cloudPass.volumes,t.camera);r.setClearColor(saved,alpha);r.setRenderTarget(target);};
    const frame=[],clouds=[];
    for(let i=0;i<7;i++){frame.push(await time(()=>t.cloudPass.render()));clouds.push(await time(march));}
    const median=list=>{const ok=list.filter(v=>v!==null).sort((a,b)=>a-b);return ok.length?ok[ok.length>>1]:null;};
    return {frame:median(frame),clouds:median(clouds),samples:frame.filter(v=>v!==null).length};
   };
   // The page's own loop, clock running: intervals between the frames it actually presents.
   window.cumulusPace=async ms=>{
    cumulusClock.held=null;const gaps=[];let last=performance.now();const end=last+ms;
    await new Promise(done=>{const tick=now=>{gaps.push(now-last);last=now;now<end?requestAnimationFrame(tick):done();};requestAnimationFrame(tick);});
    cumulusClock.held=40;gaps.sort((a,b)=>a-b);
    return {frames:gaps.length,median:gaps[gaps.length>>1],p95:gaps[Math.floor(gaps.length*.95)],over20ms:gaps.filter(g=>g>20).length,over34ms:gaps.filter(g=>g>34).length};
   };
  });
  for(const [name,pose]of Object.entries(poses)){
   await page.evaluate(p=>cumulusAim(p),pose);await page.waitForTimeout(1500);
   await page.screenshot({path:`${out}/${label}-${name}.png`});
   report.views[name]={...pose,gpuMs:await page.evaluate(()=>cumulusGpu()),pace:await page.evaluate(()=>cumulusPace(4000))};
  }
  if(process.env.REVIEW_CLIP){
   const data=await page.evaluate(async()=>{
    const t=tumbler,stream=document.querySelector('canvas').captureStream(30),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:8000000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};cumulusAim({eye:[-1700,1250,1700],target:[300,1900,-520],light:'day'});cumulusClock.held=null;recorder.start();
    const start=performance.now();
    await new Promise(done=>{const move=now=>{const u=Math.min(1,(now-start)/10000);t.camera.position.set(-1700+1450*u,1250+850*u,1700-1900*u);t.camera.lookAt(300,1900,-520);t.camera.updateMatrixWorld();u<1?requestAnimationFrame(move):done();};requestAnimationFrame(move);});
    await new Promise(done=>{recorder.onstop=done;recorder.stop();});stream.getTracks().forEach(track=>track.stop());cumulusClock.held=40;
    return await new Promise(done=>{const reader=new FileReader();reader.onload=()=>done(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:recorder.mimeType}));});
   });
   fs.writeFileSync(`${out}/${label}-approach.webm`,Buffer.from(data,'base64'));
   require('node:child_process').execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',`${out}/${label}-approach.webm`,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',`${out}/${label}-approach.mp4`]);
   fs.rmSync(`${out}/${label}-approach.webm`);report.clip='ten-second inspection-camera climb past the central tower; clock running; not flight physics';
  }
  // REVIEW_SWAPTIME=1: how long the first change to each time of day takes (its sky is built then),
  // and a second change once all are built. Each includes the next presented frame.
  if(process.env.REVIEW_SWAPTIME)report.swapMs=await page.evaluate(async()=>{
   const t=tumbler,out={},frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   for(const [key,light]of [['first-day','day'],['first-dusk','dusk'],['back-golden','golden'],['again-day','day']]){const t0=performance.now();t.setLight(light);await frame();out[key]=Math.round(performance.now()-t0);}
   return out;});
  report.failedPrograms=await page.evaluate(()=>tumbler.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length);
 }catch(e){errors.push(e.message);throw e;} // a report with no views must say why
 finally{report.load1mEnd=os.loadavg()[0];fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,1));}
 console.log(JSON.stringify(Object.fromEntries(Object.entries(report.views).map(([k,v])=>[k,[v.gpuMs?.clouds??null,v.gpuMs?.frame??null,v.pace.frames]])),null,0),'load',report.load1m);
 if(errors.length||report.failedPrograms)console.error(errors);
 // close() waits for the browser's stderr to end, and its crash-handler helpers can outlive it holding that open.
 // The report is already on disk.
 await Promise.race([browser.close(),new Promise(r=>setTimeout(r,5000))]);process.exit(errors.length||report.failedPrograms?1:0);
// Exit; never only set an exit code. This process does not end on its own for the reason above, and Playwright
// turns SIGTERM into "close the browser", so a plain `timeout` cannot end it either (use `timeout -k`).
})().catch(e=>{console.error(e);process.exit(1)});
