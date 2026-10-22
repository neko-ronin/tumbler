/** Web presentation budget. Shared simulation keeps its own fixed-step rules. */
export const WEB_FPS=30;
export const WEB_FRAME_MS=1000/WEB_FPS;
export const WEB_FRAME_TOLERANCE_MS=1.75;
export function createFramePacer(){
 let last=null;
 return {
  due(time){
   // rAF timestamps are rounded on some displays. Allow small display timestamp jitter,
   // never catch up by rendering two back-to-back refreshes after a stall.
   if(last!==null&&time-last<WEB_FRAME_MS-WEB_FRAME_TOLERANCE_MS)return false;
   last=time;return true;
  },
  reset(){last=null;},
 };
}
