// Playwright CLI run-code expression. Serve port 8012, open the ordinary scene,
// then pass this file to `playwright-cli -s=sunlight run-code "$(cat FILE)"`.
// Acquire the shared heavy-operation lock before opening the browser.
async page => {
  const out='output/playwright/sunlight',report={};
  await page.reload();
  await page.waitForFunction(()=>window.tumbler);
  await page.evaluate(()=>{document.getElementById('adaptive').checked=false;});
  report.device=await page.evaluate(()=>{const r=window.tumbler.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {browser:navigator.userAgent,viewport:[innerWidth,innerHeight],devicePixelRatio,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),verifiedFiles:window.tumbler.provenance.files};});
  // Ordinary game paths: launch each wing, keyboard steering and V view toggle.
  for(const mode of ['paraglider','parakite','paramotor']){
    await page.selectOption('#activity',mode);
    await page.click('#launch');
    await page.keyboard.down('d');await page.waitForTimeout(250);await page.keyboard.up('d');
    await page.screenshot({path:`${out}/${mode}-chase.png`});
    await page.keyboard.press('v');
    await page.screenshot({path:`${out}/${mode}-first.png`});
    await page.mouse.move(620,440);await page.mouse.down();
    await page.mouse.move(550,60,{steps:15});await page.mouse.up();
    await page.screenshot({path:`${out}/${mode}-first-look-up.png`});
    report[mode]=await page.evaluate(()=>({mode:window.tumbler.navigation.mode,view:window.tumbler.navigation.view,state:window.tumbler.navigation.state}));
    await page.keyboard.press('v');
  }
  // Frozen inspection fixture: all positions below are browser presentation,
  // never world facts. Keep clock, cloth and geometry fixed for lighting A/B.
  await page.evaluate(async()=>{
    const t=window.tumbler,T=await import('./vendor/three.module.min.js'),{style}=await import('./src3d/style.js');
    t.ride.setActivity('paraglider');t.navigation.update=()=>{};t.controls.enabled=false;
    Object.defineProperty(style.time,'value',{get:()=>30,set:()=>{}});
    window.sunReview={T,style,report:{}};
    window.sunReview.effects=value=>{const e=document.getElementById('motion');e.value=String(value);e.dispatchEvent(new Event('change'));};
    window.sunReview.aim=(position,direction)=>{t.camera.position.fromArray(position);t.camera.lookAt(t.camera.position.clone().add(direction));t.camera.fov=62;t.camera.updateProjectionMatrix();};
    window.sunReview.rayStats=()=>{
      const r=t.cloudPass.rays,w=r.target.width,h=r.target.height,b=new Uint8Array(w*h*4);
      t.renderer.readRenderTargetPixels(r.target,0,0,w,h,b);
      let max=0,sum=0;for(let i=0;i<b.length;i+=4){max=Math.max(max,b[i]);sum+=b[i];}
      return {max,sum,strength:r.strength.value,source:r.source.value.toArray(),size:[w,h]};
    };
    window.sunReview.canopy=()=>{
      t.flightRig.group.position.set(-372.3308450162895,1102.4675327059667,-1590.012967184366);
      t.flightRig.group.rotation.set(.12712811598520102,6.285888171760777,.00171941144262022,'YXZ');
      t.flightRig.update(.04,{...t.navigation.state,pressure:.996595634,bank:-.002645,rollRate:.00093,pitch:-.127128});
      t.character.object.position.copy(t.flightRig.group.position);t.character.object.quaternion.copy(t.flightRig.group.quaternion);
      t.character.update(0,'flight',0,{mode:'paraglider',bank:0,grounded:false});
      t.camera.position.set(-365.07927608333506,1102.0288560062509,-1583.7811501326084);
      t.camera.lookAt(-372.3308450162895,1107.4675327059667,-1590.012967184366);
      t.camera.fov=62;t.camera.updateProjectionMatrix();
    };
  });
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const capture=async name=>{await settle();await page.screenshot({path:`${out}/${name}.png`});};
  await page.evaluate(()=>window.sunReview.canopy());
  await capture('after-canopy-aligned');
  await page.evaluate(()=>window.sunReview.effects(0));await capture('canopy-effects-off');
  await page.evaluate(()=>window.sunReview.effects(1));
  // Compare the opaque target in one synchronous operation: only the added
  // fabric transmission changes. No frame/clock/physics drift can explain it.
  report.fabric=await page.evaluate(()=>{
    const t=window.tumbler,r=t.renderer,o=t.cloudPass.opaque,w=o.width,h=o.height;
    const compare=()=>{
      const a=new Uint8Array(w*h*4),b=new Uint8Array(w*h*4);
      t.cloudPass.render({strength:1});r.readRenderTargetPixels(o,0,0,w,h,a);
      t.cloudPass.render({strength:0});r.readRenderTargetPixels(o,0,0,w,h,b);
      let pixels=0,red=0,green=0,blue=0,max=0;
      for(let i=0;i<a.length;i+=4){const d=[a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]];if(d.some(v=>v!==0)){pixels++;red+=d[0];green+=d[1];blue+=d[2];max=Math.max(max,...d);}}
      return {pixels,red,green,blue,max};
    };
    const aligned=compare();
    t.camera.position.set(-380,1104,-1579);t.camera.lookAt(-372.3308450162895,1107.4675327059667,-1590.012967184366);
    const offAxis=compare();return {aligned,offAxis};
  });
  await capture('canopy-off-axis');
  for(const preset of ['golden','day','dusk']){
    await page.selectOption('#light',preset);
    await page.evaluate(()=>{const t=window.tumbler,{T,style}=window.sunReview,centre=new T.Vector3(-372.3308450162895,1107.4675327059667,-1590.012967184366);
      t.camera.position.copy(centre).addScaledVector(style.sun.value,-11);t.camera.lookAt(centre);
    });
    await capture(`canopy-${preset}`);
  }
  await page.selectOption('#light','golden');
  for(let i=0;i<10;i++){
    await page.evaluate(i=>{const t=window.tumbler,{T}=window.sunReview,centre=new T.Vector3(-372.3308450162895,1107.4675327059667,-1590.012967184366);
      const offset=new T.Vector3(7.25156893295444,-5.4386766997158,6.2318170517576).applyAxisAngle(new T.Vector3(0,1,0),i*.16);
      t.camera.position.copy(centre).add(offset);t.camera.lookAt(centre);
    },i);
    await capture(`fabric-motion-${String(i).padStart(2,'0')}`);
  }
  // Clear sun, then a natural cloud edge near the northern ridge.
  await page.evaluate(()=>{const t=window.tumbler;t.flightRig.group.visible=false;t.character.object.visible=false;window.sunReview.aim([0,500,800],window.sunReview.style.sun.value);});
  await capture('sun-golden');report.clear=await page.evaluate(()=>window.sunReview.rayStats());
  for(const preset of ['day','dusk']){
    await page.selectOption('#light',preset);
    await page.evaluate(()=>window.sunReview.aim([0,500,800],window.sunReview.style.sun.value));
    await capture(`sun-${preset}`);
  }
  await page.selectOption('#light','golden');
  await page.evaluate(()=>window.sunReview.aim([591.080247231393,646.6898145764553,-1070.1654125355217],window.sunReview.style.sun.value));
  await capture('rays-cloud-edge');report.edge=await page.evaluate(()=>window.sunReview.rayStats());
  const performanceSample=()=>page.evaluate(async()=>{
    const t=window.tumbler,frames=[];let last=performance.now();
    for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-last);last=now;}
    const a=frames.slice(1).sort((a,b)=>a-b);return {viewport:[innerWidth,innerHeight],pixelRatio:t.renderer.getPixelRatio(),p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],render:{...t.metrics.render},frames};
  });
  report.performance=await performanceSample();
  await page.evaluate(()=>window.sunReview.effects(0));await capture('rays-effects-off');report.off=await page.evaluate(()=>window.sunReview.rayStats());
  report.performanceOff=await performanceSample();
  await page.evaluate(()=>window.sunReview.effects(1));
  // Moving viewpoint: sky source and cloud/ridge masks must move together.
  report.motion=[];
  for(let i=0;i<12;i++){
    await page.evaluate(i=>{const {aim,style,T}=window.sunReview;aim([591.080247231393+i*7,646.6898145764553,-1070.1654125355217],style.sun.value.clone().applyAxisAngle(new T.Vector3(0,1,0),i*.035));},i);
    await capture(`motion-${String(i).padStart(2,'0')}`);
    report.motion.push(await page.evaluate(()=>window.sunReview.rayStats()));
  }
  await page.evaluate(()=>window.sunReview.aim([-258.91975276860705,556.6898145764553,29.834587464478318],window.sunReview.style.sun.value));
  await capture('rays-west-cloud');report.west=await page.evaluate(()=>window.sunReview.rayStats());
  // Find an above-ground camera whose line toward the sun intersects core
  // terrain. This selects an inspection viewpoint; it changes no geography.
  report.mountain=await page.evaluate(async()=>{
    const t=window.tumbler,{style,aim}=window.sunReview;
    for(let y=900;y<1900;y+=100)for(let x=-900;x<=1000;x+=100){
      const ground=t.ground.height(x,y)??0;if(ground<500)continue;
      const z=ground+100;
      for(let d=40;d<2000;d+=40){const px=x+style.sun.value.x*d,py=y-style.sun.value.z*d,pz=z+style.sun.value.y*d;
        if((t.ground.height(px,py)??-10000)>pz+20){aim([x,z,-y],style.sun.value);return {position:[x,z,-y],blocker:[px,pz,-py]};}
      }
    }
    return null;
  });
  await capture('mountain-occlusion-high');report.mountain.rays=await page.evaluate(()=>window.sunReview.rayStats());
  report.programErrors=await page.evaluate(()=>window.tumbler.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length);
  report.status=await page.locator('#status').textContent();
  await page.evaluate(report=>{window.sunReview.report=report;},report);
  return report;
}
