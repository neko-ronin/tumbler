import test from 'node:test';
import assert from 'node:assert/strict';
import {warmScene,finishGpu} from '../src3d/loading.js';

test('late allocations and LOD handoffs restart the consecutive completed-draw gate',async()=>{
  let frame=0,compiled=false,finished=0;
  const result=await warmScene({
    prepare(){assert.equal(frame===0||compiled,true);},
    async compile(){compiled=true;},
    render(){assert(compiled);frame++;},
    signature:()=>frame<3?'initial textures':'late cloud/shadow textures',
    pending:()=>frame<5,
    async finish(){finished++;},async paint(){},stableFrames:3,
  });
  assert.equal(result.frames,7,'three consecutive finished draws after the last pending handoff');
  assert.equal(finished,7);
});

test('completion stays pending until the GPU finishes the final draw',async()=>{
  let finish,draws=0,complete=false;
  const result=warmScene({prepare(){},async compile(){},render(){draws++;},signature:()=>1,pending:()=>false,
    finish:()=>new Promise(resolve=>{finish=resolve;}),async paint(){},stableFrames:1,
  }).then(()=>{complete=true;});
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(draws,1);assert.equal(complete,false);finish();
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(draws,2);assert.equal(complete,false);finish();await result;
  assert.equal(complete,true);
});

test('a failed preparation rejects instead of declaring readiness',async()=>{
  await assert.rejects(warmScene({prepare(){},async compile(){throw Error('shader failed');},render(){assert.fail('must not draw');},async paint(){}}),/shader failed/);
});

test('GPU fences yield while busy, then release the fence on success or failure',async()=>{
  const gl={SYNC_GPU_COMMANDS_COMPLETE:1,WAIT_FAILED:2,ALREADY_SIGNALED:3,CONDITION_SATISFIED:4,
    isContextLost:()=>false,fenceSync:()=>({}),flush(){},deleteSync(){deleted++;},clientWaitSync:()=>++polls===3?3:0};
  let polls=0,deleted=0,paints=0;
  await finishGpu(gl,async()=>{paints++;});assert.equal(paints,2);assert.equal(deleted,1);
  gl.clientWaitSync=()=>gl.WAIT_FAILED;
  await assert.rejects(finishGpu(gl),/Graphics interrupted/);assert.equal(deleted,2);
  gl.isContextLost=()=>true;
  await assert.rejects(finishGpu(gl),/Graphics interrupted/);
});
