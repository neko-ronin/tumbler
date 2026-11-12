/** Matched stills of the valley's outline and horizon, clouds removed.
 * NODE_PATH=<existing node_modules> node client/web/tools/review-valley-shape.cjs <label>
 * TUMBLER_REVIEW_URL selects the server (default 8046). Writes output/playwright/valley-shape/<label>-<pose>.png and <label>.json.
 * Poses are [east, up, south], the scene's frame: world y is scene -z.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const label=process.argv[2]||'candidate',out=path.resolve(process.env.REVIEW_OUT||'output/playwright/valley-shape');fs.mkdirSync(out,{recursive:true});
const poses={
 north:{eye:[0,110,300],target:[0,420,-1500]},        // the mountain front from the meadow
 northwest:{eye:[-700,110,500],target:[-2000,380,-1000]},
 northeast:{eye:[900,110,300],target:[2200,360,-1100]},
 south:{eye:[0,110,300],target:[0,330,2600]},         // the south edge
 southeast:{eye:[700,130,600],target:[2800,380,2400]},
 southwest:{eye:[-800,130,700],target:[-2900,380,2500]},
 west:{eye:[-1100,120,-40],target:[-4200,420,-180]},  // where the river arrives
 east:{eye:[1200,120,300],target:[4600,220,700]},     // where the river leaves
 high_south:{eye:[0,3600,5200],target:[0,0,-500]},    // the whole valley, looking north
 high_north:{eye:[0,3600,-5200],target:[0,0,500]},
 high_west:{eye:[-5200,3000,0],target:[800,0,0]},
 ceiling:{eye:[0,2150,3400],target:[0,100,-600]},    // as high and as far south as flight allows
 crest:{eye:[-380,1500,-1900],target:[300,300,2500]}, // off the highest peak, the player's best view
 river:{eye:[3180,540,1190],target:[3100,12,580]},    // the accepted downstream river granite
 bank:{eye:[2940,37,654],target:[3035,14,599]},
 village:{eye:[-672,74,-442],target:[-696,90,-472]},
 trail:{eye:[300,780,-900],target:[900,1000,-1400]},
 trunk_west:{eye:[-7000,1400,300],target:[0,200,300]},   // down the valley from upstream
 trunk_east:{eye:[8000,900,1500],target:[0,300,300]},    // up the valley from downstream
 upland:{eye:[-2500,3200,-7000],target:[0,400,1000]},    // from the high country north
 world:{eye:[0,9000,14000],target:[0,0,0]},              // the whole world
};
(async()=>{
 const browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}),errors=[],report={label,views:{},errors};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
 try{
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html');
  await Promise.race([page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000}),new Promise((_,fail)=>page.on('pageerror',e=>fail(e))),page.waitForFunction(()=>/couldn.t finish opening/.test(document.body.innerText)&&[...document.querySelectorAll('*')].some(e=>!e.children.length&&e.offsetParent&&/couldn.t finish/.test(e.textContent)),null,{timeout:240000}).then(()=>{throw new Error('load failed: '+errors.join(' | '));})]);
  await page.evaluate(async()=>{
   const t=tumbler,{style}=await import('./src3d/style.js');t.navigation.select('orbit');
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   t.navigation.update=()=>{};t.controls.enabled=false;t.flightRig.group.visible=false;t.character.object.visible=false;
   Object.defineProperty(style.time,'value',{get:()=>40,set:()=>{}});
   t.cloudPass.render=()=>{t.renderer.setRenderTarget(null);t.renderer.render(t.scene,t.camera);};
   window.aim=(eye,target)=>{t.camera.position.fromArray(eye);t.camera.lookAt(...target);t.camera.fov=62;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();t.terrain.update(t.camera,t.renderer.domElement.height,{flush:true});t.controls.target?.fromArray?.(target);};
  });
  for(const [name,pose]of Object.entries(poses)){
   await page.evaluate(p=>aim(p.eye,p.target),pose);await page.waitForTimeout(1500);
   await page.screenshot({path:`${out}/${label}-${name}.png`});
   report.views[name]={...pose,...await page.evaluate(()=>({triangles:tumbler.renderer.info.render.triangles,calls:tumbler.renderer.info.render.calls}))};
  }
  // A 30 fps cap hides cost, so time a synchronous render of matched views.
  report.syncRenderMs={};
  for(const name of ['north','south','southeast','east','crest','ceiling','high_west']){
   await page.evaluate(p=>aim(p.eye,p.target),poses[name]);await page.waitForTimeout(900);
   report.syncRenderMs[name]=await page.evaluate(()=>{const t=tumbler,gl=t.renderer.getContext(),px=new Uint8Array(4),times=[];
    for(let i=0;i<14;i++){const s=performance.now();t.renderer.setRenderTarget(null);t.renderer.render(t.scene,t.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);times.push(performance.now()-s);}
    return times.sort((a,b)=>a-b)[7];});
  }
  report.memory=await page.evaluate(()=>({geometries:tumbler.renderer.info.memory.geometries,textures:tumbler.renderer.info.memory.textures,jsHeapMB:performance.memory?performance.memory.usedJSHeapSize/1048576:null}));
  report.programFailures=await page.evaluate(()=>tumbler.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length);
 }finally{fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,1));await browser.close();}
 console.log(JSON.stringify({label,errors,views:Object.keys(report.views).length,sync:report.syncRenderMs,memory:report.memory,programFailures:report.programFailures}));
})();
