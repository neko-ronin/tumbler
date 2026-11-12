/** Matched stills of the mountains at every viewing distance, clouds removed.
 * NODE_PATH=<existing node_modules> node client/web/tools/review-mountain-scale.cjs <label>
 * TUMBLER_REVIEW_URL selects the server (default 8046); REVIEW_WIRE=1 adds terrain wireframes; REVIEW_REV=<commit> renders that commit's client; output/playwright/mountain-scale/<label>-<pose>.png
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const label=process.argv[2]||'candidate',out=path.resolve('output/playwright/mountain-scale');fs.mkdirSync(out,{recursive:true});
// Valley floor up to the far overview, nearest last; `rock` is arm's length on a face.
const poses={
 overview:{eye:[1900,3800,2800],target:[0,40,0]},
 aerial:{eye:[-400,2200,-300],target:[100,920,-1800]},
 meadow:{eye:[600,120,900],target:[300,900,-1700]},
 valley:{eye:[1500,300,-200],target:[800,1100,-1700]},
 west:{eye:[-3400,1720,-1600],target:[-2600,1280,-2900]},
 middle:{eye:[1700,1370,-1070],target:[1080,1120,-1630]},
 cirque:{eye:[190,870,-1440],target:[-360,1073,-1760]},
 close:{eye:[1190,1300,-1480],target:[1072,1200,-1618]},
 slab:{eye:[1235,1305,-1500],target:[1095,1150,-1618]},
 river:{eye:[3180,540,1190],target:[3100,12,580]},
 bank:{eye:[2940,37,654],target:[3035,14,599]},
};
(async()=>{
 const browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}),errors=[],report={label,views:{},errors};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
 // REVIEW_REV=<commit> serves that commit's client through this server, for a matched baseline without a second checkout.
 if(process.env.REVIEW_REV){
  const git=args=>require('node:child_process').execSync(`git ${args}`,{maxBuffer:1<<28});
  // Every client file changed since that commit, so no part of the old look is silently missed.
  const changed=git(`diff --name-only --diff-filter=a ${process.env.REVIEW_REV} -- client/web`).toString().split('\n').filter(f=>f&&!/^client\/web\/(tests|tools)\//.test(f));
  report.revFiles=changed;
  for(const file of changed){
   const body=git(`show ${process.env.REVIEW_REV}:${file}`),type={js:'text/javascript',json:'application/json',html:'text/html'}[file.split('.').pop()];
   await page.route(`**/${file}*`,route=>route.fulfill({body,...(type?{contentType:type}:{})}));
  }
 }
 try{
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html');
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  await page.evaluate(async()=>{
   const t=tumbler,{style}=await import('./src3d/style.js');t.navigation.select('orbit');
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   t.navigation.update=()=>{};t.controls.enabled=false;t.flightRig.group.visible=false;t.character.object.visible=false;
   Object.defineProperty(style.time,'value',{get:()=>40,set:()=>{}});
   t.cloudPass.render=()=>{t.renderer.setRenderTarget(null);t.renderer.render(t.scene,t.camera);};
   window.mountainAim=(eye,target)=>{t.camera.position.fromArray(eye);t.camera.lookAt(...target);t.camera.fov=62;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();};
  });
  for(const [name,pose]of Object.entries(poses)){
   await page.evaluate(p=>mountainAim(p.eye,p.target),pose);await page.waitForTimeout(1500);
   await page.screenshot({path:`${out}/${label}-${name}.png`});report.views[name]=pose;
  }
  // One face from arm's length to the far overview: every footprint band and terrain LOD on a single target.
  const dolly=[40,120,300,700,1500,3500,6500],aim=[1072,1200,-1618],dir=[.567,.48,.663];report.dolly={};
  for(const d of dolly){
   const pose={eye:aim.map((v,i)=>v+dir[i]*d),target:aim};
   await page.evaluate(p=>mountainAim(p.eye,p.target),pose);await page.waitForTimeout(1500);
   await page.screenshot({path:`${out}/${label}-dolly${d}.png`});
   report.dolly[d]=await page.evaluate(()=>({triangles:tumbler.renderer.info.render.triangles,calls:tumbler.renderer.info.render.calls}));
   if(process.env.REVIEW_WIRE){
    await page.evaluate(()=>tumbler.terrain.group.traverse(o=>{if(o.material)o.material.wireframe=true;}));await page.waitForTimeout(700);
    await page.screenshot({path:`${out}/${label}-wire${d}.png`});
    await page.evaluate(()=>tumbler.terrain.group.traverse(o=>{if(o.material)o.material.wireframe=false;}));
   }
  }
  // The other light presets share this rock; one matched view of each.
  const presets=await page.evaluate(()=>[...document.getElementById('light').options].map(o=>o.value));
  for(const preset of presets.filter(p=>p!=='golden')){
   await page.evaluate(([v,p])=>{const light=document.getElementById('light');light.value=v;light.dispatchEvent(new Event('change'));mountainAim(p.eye,p.target);},[preset,poses.aerial]);await page.waitForTimeout(1500);
   await page.screenshot({path:`${out}/${label}-light-${preset}.png`});
  }
  await page.evaluate(()=>{const light=document.getElementById('light');light.value='golden';light.dispatchEvent(new Event('change'));});
  // A 30 fps cap hides cost, so time a synchronous render of the rockiest views.
  report.syncRenderMs={};
  for(const name of ['valley','close','slab']){
   await page.evaluate(p=>mountainAim(p.eye,p.target),poses[name]);await page.waitForTimeout(900);
   report.syncRenderMs[name]=await page.evaluate(()=>{const t=tumbler,gl=t.renderer.getContext(),px=new Uint8Array(4),times=[];
    for(let i=0;i<14;i++){const s=performance.now();t.renderer.setRenderTarget(null);t.renderer.render(t.scene,t.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);times.push(performance.now()-s);}
    return times.sort((a,b)=>a-b)[7];});
  }
  await page.evaluate(p=>mountainAim(p.eye,p.target),poses.valley);await page.waitForTimeout(1000);
  const start=await page.evaluate(()=>{tumbler.metrics.framesMs.length=0;return tumbler.metrics.frame;});
  await page.waitForFunction(f=>tumbler.metrics.frame>=f+120,start,{timeout:60000});
  report.frameMs=await page.evaluate(()=>{const a=[...tumbler.metrics.framesMs].sort((x,y)=>x-y);return {frames:a.length,p50:a[a.length>>1],p95:a[Math.floor(a.length*.95)]};});
  report.mountainMap=await page.evaluate(()=>tumbler.mountainMapStats);
  report.programFailures=await page.evaluate(()=>tumbler.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length);
 }finally{fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,2));await browser.close();}
 console.log(JSON.stringify({map:report.mountainMap,syncRenderMs:report.syncRenderMs,frameMs:report.frameMs,programFailures:report.programFailures,errors}));
 if(errors.length||report.programFailures)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
