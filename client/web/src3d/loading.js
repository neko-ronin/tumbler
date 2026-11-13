/** Startup is presentation work: keep the journal opaque until the actual
 * first view, its lazy resources and every GPU pass have finished.
 *
 * The meter is real preparation, not a timer: the load phases fill the first
 * 60%, then `warmScene` reports each completed, stable draw and the final
 * `ready()` is only called after its GPU fence. The journal is also the entry
 * layer — browsers only allow sound after a gesture, so the world waits at
 * "ready" until the player steps in, and that click starts the audio. */
export function createLoadingScreen() {
  const screen=document.getElementById('loading-screen'),world=document.getElementById('world');
  const message=document.getElementById('loading-message'),progress=document.getElementById('loading-progress');
  const percent=document.getElementById('loading-percent'),footnote=document.getElementById('loading-footnote');
  const begin=document.getElementById('loading-begin');
  const RESET_FOOTNOTE='Take a breath. We’re getting the whole place ready.';
  let handler=null;
  begin.addEventListener('click',()=>{
    if(!handler||begin.disabled)return;
    begin.disabled=true;begin.textContent='Stepping in…';
    handler();
  });
  const blockInput=e=>{if(!screen.hidden&&!e.metaKey&&!e.ctrlKey&&e.key!=='Tab'&&!screen.contains(e.target))e.stopImmediatePropagation();};
  window.addEventListener('keydown',blockInput,true);
  function showBar(value){
    const v=Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
    progress.max=1;progress.value=v;percent.textContent=`${Math.round(v*100)}%`;
  }
  function reset(){
    handler=null;begin.hidden=true;begin.disabled=false;begin.textContent='Step into the meadow';
    footnote.textContent=RESET_FOOTNOTE;
  }
  reset();
  return {
    // The line sketch stays up while the world's asset files arrive (step 1→2);
    // the coloured journal fades over it once the last one lands.
    phase(text,step){if(message.textContent!==text)message.textContent=text;showBar(Math.min(4,step)/5);if(step>=2)screen.dataset.art='journal';},
    /** Warm-up progress in [0,1]. The bar only ever moves forward: a step that
     * resets and re-settles must not look like the world un-preparing itself. */
    meter(value,text){
      const v=Math.max(progress.value,Math.min(1,value));
      if(text&&message.textContent!==text)message.textContent=text;
      showBar(v);
    },
    /** Everything is drawn and fenced; wait for the player's gesture. `run` is
     * called once, by that gesture (the returned promise is ignored). */
    ready(text='The valley is ready.',run){
      showBar(1);message.textContent=text;
      document.body.dataset.loading='ready';
      footnote.textContent='Sound begins when you step in.';
      handler=run;begin.hidden=false;begin.disabled=false;begin.textContent='Step into the meadow';
      begin.focus({preventScroll:true});
    },
    show(text='Letting the light settle…'){
      document.body.classList.remove('ready');document.body.dataset.loading='loading';
      screen.hidden=false;world.inert=true;world.setAttribute('aria-busy','true');
      document.getElementById('loading-title').textContent='Tumbler';document.getElementById('loading-retry').hidden=true;
      message.textContent=text;showBar(0);reset();
    },
    reveal(){
      showBar(1);world.inert=false;world.setAttribute('aria-busy','false');
      document.body.dataset.loading='ready';document.body.classList.add('ready');screen.hidden=true;
      reset();
    },
    fail(error){
      this.show();document.body.dataset.loading='error';
      document.getElementById('loading-title').textContent='A pause in the journey';
      message.textContent='The light was interrupted. Please try again.';
      document.getElementById('loading-retry').hidden=false;reset();
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
 * The caller freezes simulation/input so preparation cannot move the player.
 * `onProgress` receives the live counter each frame, so the journal's meter is
 * the work itself rather than an estimate. */
export async function warmScene({prepare,compile,render,signature,pending,finish,paint=nextPaint,stableFrames=4,onProgress=null}) {
  await paint();prepare();await compile();
  let previous,stable=0,frames=0;
  while(stable<stableFrames){
    await paint();prepare();render();await finish();frames++;
    const current=signature();
    stable=!pending()&&current===previous?stable+1:0;previous=current;
    onProgress?.({frames,stable,stableFrames});
  }
  return {frames,signature:previous};
}
