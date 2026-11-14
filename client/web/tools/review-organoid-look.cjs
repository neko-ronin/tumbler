/** Matched stills, a motion sequence and frame timings of the Organoid at its Tumble Hill perch.
 * NODE_PATH=<existing node_modules> CHROME_PATH=<chromium> node client/web/tools/review-organoid-look.cjs <label>
 * TUMBLER_REVIEW_URL selects the server (default 8046). Output: output/playwright/organoid-look/<label>-<pose>.png
 * and <label>.json. The Organoid's clock is held still for the stills (its update gets dt 0 and no player, so
 * it sits at its perch); the motion frames run the clock. Ronin is hidden. A tutor-visit still is taken only
 * where the client has the tutor's `guest` pose.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const label=process.argv[2]||'candidate',out=path.resolve('output/playwright/organoid-look');fs.mkdirSync(out,{recursive:true});
const deadline=setTimeout(()=>{console.error('deadline');process.exit(2);},12*60e3);
(async()=>{
 const report={label,views:{},errors:[],url:process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046'};
 let browser;
 try{
  browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
  await page.goto(report.url+'/client/web/scene.html?encounter=organoid');
  await page.waitForFunction(()=>window.tumbler?.startup?.ready,null,{timeout:240000});
  report.poses=await page.evaluate(async()=>{
   const t=tumbler;
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   document.body.dataset.ui='hidden';
   for(const id of ['organoid-tip','gondola-panel'])document.getElementById(id)?.setAttribute('hidden','');
   for(const el of document.querySelectorAll('.ui-switch,.tumble-label'))el.style.display='none';
   t.navigation.update=()=>{};t.controls.enabled=false;t.character.object.visible=false;
   const update=t.organoid.update.bind(t.organoid);
   window.organoidFrozen=true;
   t.organoid.update=(dt,onFoot)=>update(window.organoidFrozen?0:dt,null);
   if(t.tutor)t.tutor.update=()=>{};
   await new Promise(r=>setTimeout(r,500));
   const orb=t.scene.getObjectByName('Organoid').position.clone();
   const {style}=await import('./src3d/style.js');
   const sun=style.sun.value.clone();sun.y=0;sun.normalize();
   // Eight azimuths; keep those whose sightline is clear of the redwood and ground.
   const hit=t.ride.hitTest,solid=v=>[v.x,-v.z,v.y];
   const clear=(az,d,h)=>{const eye=orb.clone().add({x:Math.cos(az)*d,y:h,z:Math.sin(az)*d});
    const ground=t.ride.height(eye.x,-eye.z);if(Number.isFinite(ground)&&eye.y<ground+.4)return null;
    return hit(solid(eye),solid(orb),.05)?null:eye.toArray();};
   const sunAz=Math.atan2(sun.z,sun.x),pick=(want,d,h)=>{
    let best=null;for(let k=0;k<16;k++){const az=want+(k%2?1:-1)*Math.ceil(k/2)*Math.PI/8,eye=clear(az,d,h);if(eye){best=eye;break;}}
    return best&&{eye:best,target:orb.toArray()};};
   return {'close-front':pick(sunAz,1.8,.15),'close-back':pick(sunAz+Math.PI,1.8,.15),
    chase:pick(sunAz+Math.PI/2,4.5,1.2),mid:pick(sunAz+Math.PI/2,12,2),far:pick(sunAz+Math.PI/2,35,5),orb:orb.toArray()};
  });
  const aim=pose=>page.evaluate(p=>{const c=tumbler.camera;c.position.fromArray(p.eye);c.lookAt(...p.target);c.fov=50;c.updateProjectionMatrix();c.updateMatrixWorld();},pose);
  for(const name of ['close-front','close-back','chase','mid','far']){
   const pose=report.poses[name];if(!pose){report.views[name]='no clear sightline';continue;}
   await aim(pose);await page.waitForTimeout(name.startsWith('close')?2500:1500);
   await page.screenshot({path:`${out}/${label}-${name}.png`});report.views[name]=pose;
  }
  // The tutor's visit: a small orb over open ground at Ronin's shoulder height, framed like the chase camera.
  report.tutor=await page.evaluate(()=>{const o=tumbler.organoid;if(!Object.getOwnPropertyDescriptor(Object.getPrototypeOf(o),'guest')&&!('guest' in o))return false;
   const [x,y]=[-920,972],z=tumbler.ride.height(x,y);  // open ledge, clear of the bell frame
   o.guest={position:[x,y,z+1.35],scale:.45,notice:.7,pulse:.2,front:0,glow:0};return [x,y,z];});
  if(report.tutor){
   const [x,y,z]=report.tutor;
   await aim({eye:[x-2.6,z+2.1,-(y-2.6)],target:[x,z+1.35,-y]});await page.waitForTimeout(2000);
   await page.screenshot({path:`${out}/${label}-tutor.png`});
   await page.evaluate(()=>{tumbler.organoid.guest=null;});
  }
  // Motion: the clock running at the close front view, four frames 0.4 s apart.
  await aim(report.poses['close-front']);await page.evaluate(()=>{window.organoidFrozen=false;});
  for(let i=0;i<4;i++){await page.waitForTimeout(400);await page.screenshot({path:`${out}/${label}-motion${i}.png`});}
  // Presented frame times with the orb filling the close view, clock running.
  const frames=async()=>{const start=await page.evaluate(()=>{tumbler.metrics.framesMs.length=0;return tumbler.metrics.frame;});
   await page.waitForFunction(f=>tumbler.metrics.frame>=f+180,start,{timeout:60000});
   return page.evaluate(()=>{const a=[...tumbler.metrics.framesMs].sort((x,y)=>x-y);return {frames:a.length,p50:+a[a.length>>1].toFixed(2),p95:+a[Math.floor(a.length*.95)].toFixed(2)};});};
  report.frameMs={close:[await frames(),await frames()]};
  await aim(report.poses.chase);report.frameMs.chase=[await frames(),await frames()];
  report.programFailures=await page.evaluate(()=>tumbler.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length);
 }catch(e){report.errors.push(String(e?.stack||e));}
 finally{
  if(!Object.keys(report.views).length)report.empty='no views captured';
  fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({views:Object.keys(report.views),frameMs:report.frameMs,errors:report.errors,empty:report.empty}));
  clearTimeout(deadline);
  await Promise.race([browser?.close(),new Promise(r=>setTimeout(r,8000))]);
  process.exit(report.errors.length||report.empty?1:0);
 }
})();
