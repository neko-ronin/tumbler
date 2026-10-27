/** Web presentation budget. Shared simulation keeps its own fixed-step rules. */
export const WEB_FPS=30;
export const WEB_FRAME_MS=1000/WEB_FPS;
export const WEB_FRAME_TOLERANCE_MS=1.75;
export function createFramePacer(){
 let last=null,tick=null,next=null;const gaps=[];
 return {
  due(time){
   const gap=tick===null?null:time-tick;
   const ordered=[...gaps].sort((a,b)=>a-b),refresh=ordered[Math.floor(ordered.length/2)]??WEB_FRAME_MS/2;
   const stalled=gap!==null&&gap>refresh*1.5+WEB_FRAME_TOLERANCE_MS;
   if(gap>0&&gap<500){gaps.push(gap);if(gaps.length>9)gaps.shift();}
   tick=time;
   if(next===null){last=time;next=time+WEB_FRAME_MS;return true;}
   // Preserve the target phase instead of accumulating each refresh's rounding.
   // Quantized displays may alternate refresh counts while retaining 30 FPS.
   if(time<next-WEB_FRAME_TOLERANCE_MS)return false;
   if(stalled&&time-last<WEB_FRAME_MS-WEB_FRAME_TOLERANCE_MS){next=last+WEB_FRAME_MS;return false;}
   // Drop missed slots. A delayed callback must not cause a short catch-up frame.
   next=stalled||time-next>=WEB_FRAME_MS-WEB_FRAME_TOLERANCE_MS?time+WEB_FRAME_MS:next+WEB_FRAME_MS;
   last=time;return true;
  },
  reset(){last=tick=next=null;gaps.length=0;},
 };
}
