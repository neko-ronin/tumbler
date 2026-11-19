/** Matched stills of the tree village's skybridges, clouds removed, clock pinned.
 * NODE_PATH=<existing node_modules> node client/web/tools/review-tree-village.cjs <label>
 * TUMBLER_REVIEW_URL selects the server (default 8046); output/playwright/tree-village/<label>-<pose>.png
 * Copied from review-mountain-scale.cjs. Three.js frame: x east, y up, z = -north.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const label=process.argv[2]||'candidate',out=path.resolve('output/playwright/tree-village');fs.mkdirSync(out,{recursive:true});
// The village is B_canyon: six trunks from north 420 to 510 m around east -705, bridges 52-103 m up.
const poses={
 street:{eye:[-706,58,-398],target:[-706,88,-480]},
 east:{eye:[-610,95,-470],target:[-708,80,-462]},
 west:{eye:[-800,90,-455],target:[-706,78,-465]},
 aerial:{eye:[-610,190,-370],target:[-706,72,-465]},
 lower:{eye:[-690,62,-405],target:[-706,57,-432]},
 upper:{eye:[-680,105,-470],target:[-707,92,-490]},
};
const deadline=setTimeout(()=>{console.error('capture deadline passed');process.exit(2);},420000);
(async()=>{
 const browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}),errors=[],report={label,views:{},errors};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
 try{
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html');
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  await page.evaluate(async()=>{
   const t=tumbler,{style}=await import('./src3d/style.js');t.navigation.select('orbit');
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   t.navigation.update=()=>{};t.controls.enabled=false;t.flightRig.group.visible=false;t.character.object.visible=false;
   Object.defineProperty(style.time,'value',{get:()=>40,set:()=>{}});
   t.cloudPass.render=()=>{t.renderer.setRenderTarget(null);t.renderer.render(t.scene,t.camera);};
   window.villageAim=(eye,target)=>{t.camera.position.fromArray(eye);t.camera.lookAt(...target);t.camera.fov=55;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();};
  });
  for(const [name,pose]of Object.entries(poses)){
   await page.evaluate(p=>villageAim(p.eye,p.target),pose);await page.waitForTimeout(2500);
   await page.screenshot({path:`${out}/${label}-${name}.png`});report.views[name]=pose;
  }
 }catch(e){errors.push(String(e));}
 if(!Object.keys(report.views).length)report.empty='no view was captured';
 fs.writeFileSync(`${out}/${label}-report.json`,JSON.stringify(report,null,1));
 console.log(JSON.stringify({label,views:Object.keys(report.views).length,errors:errors.slice(0,5)}));
 clearTimeout(deadline);
 await Promise.race([browser.close(),new Promise(r=>setTimeout(r,8000))]);
 process.exit(Object.keys(report.views).length?0:1);
})();
