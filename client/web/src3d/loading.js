/** Startup is presentation work: keep the journal opaque until the actual
 * first view, its lazy resources and every GPU pass have finished. */
export function createLoadingScreen() {
  const screen=document.getElementById('loading-screen'),world=document.getElementById('world');
  const message=document.getElementById('loading-message'),progress=document.getElementById('loading-progress');
  const blockInput=e=>{if(document.body.dataset.loading==='loading'&&!e.metaKey&&!e.ctrlKey&&e.key!=='Tab')e.stopImmediatePropagation();};
  window.addEventListener('keydown',blockInput,true);
  return {
    // The line sketch stays up while the world's asset files arrive (step 1→2);
    // the coloured journal fades over it once the last one lands.
    phase(text,step){message.textContent=text;progress.value=step;if(step>=2)screen.dataset.art='journal';},
    show(text='Letting the light settle…'){
      document.body.classList.remove('ready');document.body.dataset.loading='loading';
      screen.hidden=false;world.inert=true;world.setAttribute('aria-busy','true');
      document.getElementById('loading-title').textContent='Tumbler';document.getElementById('loading-retry').hidden=true;
      message.textContent=text;progress.value=4;
    },
    reveal(){
      progress.value=5;world.inert=false;world.setAttribute('aria-busy','false');
      document.body.dataset.loading='ready';document.body.classList.add('ready');screen.hidden=true;
    },
    fail(error){
      this.show();document.body.dataset.loading='error';
      document.getElementById('loading-title').textContent='A pause in the journey';
      message.textContent='The light was interrupted. Please try again.';
      document.getElementById('loading-retry').hidden=false;
    },
  };
}

export const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(resolve));

/** A fence waits for submitted GPU work without freezing the paper UI. */
export async function finishGpu(gl,paint=nextPaint) {
  if(gl.isContextLost())throw new Error('Graphics interrupted. Reload to open the world again.');
  const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if(!fence)throw new Error('Could not finish preparing the graphics. Please try again.');
  gl.flush();
  try {
    for(;;){
      const result=gl.clientWaitSync(fence,0,0);
      if(gl.isContextLost()||result===gl.WAIT_FAILED)throw new Error('Graphics interrupted while preparing the world. Please try again.');
      if(result===gl.ALREADY_SIGNALED||result===gl.CONDITION_SATISFIED)return;
      await paint();
    }
  } finally { gl.deleteSync(fence); }
}

/** No timer can declare a scene complete. Require consecutive complete draws
 * with unchanged resources and no pending LOD handoffs, then drain the GPU.
 * The caller freezes simulation/input so preparation cannot move the player. */
export async function warmScene({prepare,compile,render,signature,pending,finish,paint=nextPaint,stableFrames=4}) {
  await paint();prepare();await compile();
  let previous,stable=0,frames=0;
  while(stable<stableFrames){
    await paint();prepare();render();await finish();frames++;
    const current=signature();
    stable=!pending()&&current===previous?stable+1:0;previous=current;
  }
  return {frames,signature:previous};
}
