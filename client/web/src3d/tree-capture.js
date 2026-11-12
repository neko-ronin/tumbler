/** Three r187 takes physical pixels while a render target is bound. */
export function treeCaptureRect(renderer,x,y,width,height){
 renderer.setViewport(x,y,width,height);
 renderer.setScissor(x,y,width,height);
}
