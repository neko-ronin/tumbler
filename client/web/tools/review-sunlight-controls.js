// Focused continuation, invoked through Playwright CLI run-code while holding
// the shared heavy-operation lock. Reuses the ordinary scene on port 8012.
async page=>{
  const out='output/playwright/sunlight/continuation-2026-10-19',report={};
  await page.waitForFunction(()=>window.tumbler);
  await page.selectOption('#activity','paraglider');await page.click('#launch');
  await page.evaluate(async()=>{
    const t=window.tumbler,T=await import('./vendor/three.module.min.js'),{style}=await import('./src3d/style.js');
    t.navigation.update=()=>{};t.controls.enabled=false;
    Object.defineProperty(style.time,'value',{get:()=>30,set:()=>{}});
    document.getElementById('adaptive').checked=false;
    t.flightRig.group.visible=false;t.character.object.visible=false;
    window.sunControlReview={T,style};
    window.sunControlReview.aim=angle=>{
      const axis=new T.Vector3().crossVectors(style.sun.value,new T.Vector3(0,1,0)).normalize();
      const direction=style.sun.value.clone().applyAxisAngle(axis,angle);
      t.camera.position.set(-258.91975276860705,556.6898145764553,29.834587464478318);
      t.camera.lookAt(t.camera.position.clone().add(direction));t.camera.fov=62;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();
    };
    window.sunControlReview.stats=()=>{
      const q=t.cloudPass.rays,w=q.target.width,h=q.target.height,b=new Uint8Array(w*h*4);
      t.renderer.readRenderTargetPixels(q.target,0,0,w,h,b);
      let max=0,sum=0;for(let i=0;i<b.length;i+=4){max=Math.max(max,b[i]);sum+=b[i];}
      // Compute the current projection even when the skipped pass retains an
      // older source uniform/texture. Those retained values are not output.
      const p=style.sun.value.clone().multiplyScalar(10000).add(t.camera.position).project(t.camera);
      return {source:[p.x*.5+.5,p.y*.5+.5],strength:q.strength.value,max,sum,effects:style.sunEffects.value,draws:t.metrics.render.calls};
    };
  });
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const effects=async value=>{
    await page.getByText('Field notes',{exact:true}).click();
    await page.selectOption('#motion',value);
    await page.getByText('Field notes',{exact:true}).click();await settle();
  };
  await page.evaluate(()=>window.sunControlReview.aim(0));
  for(const [name,value] of [['full','1'],['subtle','.35'],['reduced','0']]){
    await effects(value);await page.screenshot({path:`${out}/rays-${name}.png`});
    report[name]=await page.evaluate(()=>window.sunControlReview.stats());
  }
  if(report.full.sum<=0)throw new Error('positive cloud-edge control must contain rays');
  if(Math.abs(report.subtle.strength-report.full.strength*.35)>1e-12)throw new Error('Subtle did not apply 35 percent ray gain');
  if(report.reduced.strength!==0)throw new Error('Reduced motion left rays enabled');
  await effects('1');report.edge=[];
  for(const [i,angle] of [0,.35,.45,.49,.52,.54,.56,.65,Math.PI].entries()){
    await page.evaluate(angle=>window.sunControlReview.aim(angle),angle);await settle();
    await page.screenshot({path:`${out}/edge-${String(i).padStart(2,'0')}.png`});
    report.edge.push({angle,...await page.evaluate(()=>window.sunControlReview.stats())});
  }
  if(!report.edge.some(s=>s.strength>0&&s.strength<.5&&s.source[1]>0&&s.source[1]<1))throw new Error('edge sweep missed a visible faded source');
  for(const s of report.edge)if((s.source[0]<0||s.source[0]>1||s.source[1]<0||s.source[1]>1)&&s.strength!==0)throw new Error('off-screen source retained ray strength');
  await page.evaluate(()=>{
    const t=window.tumbler;t.flightRig.group.visible=true;t.character.object.visible=true;
    t.flightRig.group.position.set(-372.3308450162895,1102.4675327059667,-1590.012967184366);
    t.flightRig.group.rotation.set(.12712811598520102,6.285888171760777,.00171941144262022,'YXZ');
    t.flightRig.update(.04,{...t.navigation.state,pressure:.996595634,bank:-.002645,rollRate:.00093,pitch:-.127128});
    t.character.object.position.copy(t.flightRig.group.position);t.character.object.quaternion.copy(t.flightRig.group.quaternion);
    t.character.update(0,'flight',0,{mode:'paraglider',bank:0,grounded:false});
    t.camera.position.set(-365.07927608333506,1102.0288560062509,-1583.7811501326084);
    t.camera.lookAt(-372.3308450162895,1107.4675327059667,-1590.012967184366);
    window.sunControlReview.fabric={};
  });
  for(const [name,value] of [['full','1'],['subtle','.35'],['reduced','0']]){
    await effects(value);
    await page.evaluate(name=>{
      const t=window.tumbler,o=t.cloudPass.opaque,b=new Uint8Array(o.width*o.height*4);
      t.renderer.readRenderTargetPixels(o,0,0,o.width,o.height,b);window.sunControlReview.fabric[name]=b;
    },name);
    await page.screenshot({path:`${out}/fabric-${name}.png`});
  }
  report.fabric=await page.evaluate(()=>{
    const {fabric,style}=window.sunControlReview,delta={};
    for(const name of ['full','subtle']){let red=0,green=0,blue=0;const a=fabric[name],b=fabric.reduced;
      for(let i=0;i<a.length;i+=4){red+=a[i]-b[i];green+=a[i+1]-b[i+1];blue+=a[i+2]-b[i+2];}
      delta[name]={red,green,blue};
    }
    return delta;
  });
  if(!(report.fabric.subtle.red>0&&report.fabric.subtle.red<report.fabric.full.red))throw new Error('Subtle fabric response was absent or unreduced');
  report.failedPrograms=await page.evaluate(()=>window.tumbler.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length);
  if(report.failedPrograms)throw new Error('shader compilation failed');
  await page.evaluate(report=>{window.sunControlReview.report=report;},report);
  return report;
}
