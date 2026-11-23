/** Frame times at fixed poses, for paired runs against another build (2026-11-23 tree budget work).
 * NODE_PATH=<existing node_modules> CHROME_PATH=<chromium> timeout -k 10 600 node client/web/tools/review-frame-rate.cjs <label>
 * TUMBLER_REVIEW_URL picks the server (default 8046), so the same script times main's checkout on another port.
 * Writes <REVIEW_OUT or output/playwright/frame-rate>/<label>.json: per pose the median and 95th-percentile interval
 * between presented frames over REVIEW_SECONDS (default 6), draw calls, triangles and the forest's own counts.
 *  - spawn: the first load as a player gets it, 12 s after ready, nothing touched;
 *  - the rest: the free camera held at a pose (ground height + metres), golden light, adaptive resolution off.
 * Run each build back to back in the same quiet period; one run on a busy machine says nothing.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const label=process.argv[2]||'candidate',out=path.resolve(process.env.REVIEW_OUT||'output/playwright/frame-rate');fs.mkdirSync(out,{recursive:true});
const seconds=+(process.env.REVIEW_SECONDS||6);
// [east, north, metres above ground] for the eye and the point looked at.
const poses={
 meadowLow:{eye:[0,800,2],look:[0,1800,60]},
 edgeEast:{eye:[1800,0,2],look:[4000,0,40]},
 landing40:{eye:[600,-250,40],look:[0,1500,100]},
 valley500:{eye:[0,-1500,500],look:[0,2000,0]},
};
(async()=>{
 setTimeout(()=>{console.error('review-frame-rate: no result after nine minutes');process.exit(3);},540000).unref();
 const report={label,url:process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046',load1m:os.loadavg()[0],seconds,poses:{},errors:[]};let browser;
 try{
  browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
  await page.goto(report.url+'/client/web/scene.html');
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  await page.evaluate(()=>{
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   window.pace=async ms=>{
    const t=tumbler,gaps=[];let last=performance.now();const end=last+ms;
    await new Promise(done=>{const tick=now=>{gaps.push(now-last);last=now;now<end?requestAnimationFrame(tick):done();};requestAnimationFrame(tick);});
    gaps.sort((a,b)=>a-b);const info=t.renderer.info.render,f=t.forest?.stats??{};
    return {frames:gaps.length,median:+gaps[gaps.length>>1].toFixed(2),p95:+gaps[Math.floor(gaps.length*.95)].toFixed(2),calls:info.calls,triangles:info.triangles,
      trees:f.trees,near:f.near,mid:f.mid,far:f.far,ridgeHidden:f.adopted?.ridgeHidden??null,shadowProxies:f.shadowProxies};
   };
  });
  await page.waitForTimeout(12000);
  report.poses.spawn=await page.evaluate(ms=>pace(ms),seconds*1000);
  await page.evaluate(()=>{const t=tumbler;t.navigation.select('orbit');t.navigation.update=()=>{};t.controls.enabled=false;t.setLight?.('golden');});
  for(const [name,p]of Object.entries(poses)){
   await page.evaluate(p=>{
    const t=tumbler,g=(e,n)=>t.ground.height(e,n)??0;
    t.camera.position.set(p.eye[0],g(p.eye[0],p.eye[1])+p.eye[2],-p.eye[1]);
    t.controls.target.set(p.look[0],g(p.look[0],p.look[1])+p.look[2],-p.look[1]);
    t.camera.lookAt(t.controls.target);t.camera.updateMatrixWorld();
   },p);
   await page.waitForTimeout(3000);
   report.poses[name]=await page.evaluate(ms=>pace(ms),seconds*1000);
   await page.screenshot({path:`${out}/${label}-${name}.png`});
  }
 }catch(e){report.errors.push(e.message);console.error(e);}
 fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,1));
 console.log(JSON.stringify(report));
 if(browser)await Promise.race([browser.close(),new Promise(r=>setTimeout(r,5000))]);
 process.exit(report.errors.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
