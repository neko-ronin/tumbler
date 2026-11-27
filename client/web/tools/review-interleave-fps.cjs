// Frame rate of two builds in one page, alternating: main (8214, e.g. serve.py --overlay of the old client) and the branch (8213),
// 3 rounds, order flipped each round, 4 x 2 s windows per pose. Paired in time, so background load hits both builds alike.
// NODE_PATH=<playwright> CHROME_PATH=<chromium> [BRANCH_EVAL=<page expression>] node client/web/tools/review-interleave-fps.cjs <out.json>
const {chromium}=require('playwright'),fs=require('fs'),os=require('os');
// MAIN_URL overrides the main build (e.g. the branch itself, with BRANCH_EVAL switching one layer off on the other side).
const builds=[['main',process.env.MAIN_URL||'http://127.0.0.1:8214'],['branch','http://127.0.0.1:8213']];
const poses={meadowLow:{eye:[0,800,2],look:[0,1800,60]},edgeEast:{eye:[1800,0,2],look:[4000,0,40]},valley500:{eye:[0,-1500,500],look:[0,2000,0]},fernThicket:{eye:[764,820,1.7],look:[772,828.5,0]}};
(async()=>{
 setTimeout(()=>{console.error('deadline');process.exit(3);},1500000).unref();
 const out=[];let browser;
 try{
  browser=await chromium.launch({headless:false,executablePath:process.env.CHROME_PATH,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  for(let round=0;round<3;round++)for(const [build,url] of (round%2?[...builds].reverse():builds)){
   await page.goto(url+'/client/web/scene.html');
   await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:300000});
   // BRANCH_EVAL: a page expression run on the branch build only (e.g. hide one layer to price it).
   if(build==='branch'&&process.env.BRANCH_EVAL)await page.evaluate(src=>(0,eval)(src),process.env.BRANCH_EVAL);
   await page.evaluate(()=>{const t=tumbler;document.getElementById('adaptive')&&(document.getElementById('adaptive').checked=false);t.navigation.select('orbit');t.navigation.update=()=>{};t.controls.enabled=false;t.setLight?.('golden');
    window.pace=ms=>new Promise(done=>{const gaps=[];let last=performance.now();const end=last+ms;const tick=now=>{gaps.push(now-last);last=now;now<end?requestAnimationFrame(tick):done(gaps);};requestAnimationFrame(tick);});});
   for(const [name,p] of Object.entries(poses)){
    await page.evaluate(p=>{const t=tumbler,g=(e,n)=>t.ground.height(e,n)??0;t.camera.position.set(p.eye[0],g(p.eye[0],p.eye[1])+p.eye[2],-p.eye[1]);t.camera.lookAt(p.look[0],g(p.look[0],p.look[1])+p.look[2],-p.look[1]);t.camera.updateMatrixWorld();},p);
    await page.waitForTimeout(4000);
    for(let w=0;w<4;w++){const gaps=await page.evaluate(()=>pace(2000));out.push({round,build,pose:name,window:w,frames:gaps.length,load:os.loadavg()[0]});}
   }
   console.error('done',round,build);
  }
 }catch(e){console.error(e);}
 fs.writeFileSync(process.argv[2],JSON.stringify(out));
 if(browser)await Promise.race([browser.close(),new Promise(r=>setTimeout(r,5000))]);
 process.exit(out.length?0:1);
})();
