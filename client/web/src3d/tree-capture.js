/** Renderer viewport/scissor setters take logical canvas coordinates even when
 * a render target is bound. Tree capture rectangles are physical texels. */
export function treeCaptureRect(renderer,x,y,width,height){
 const ratio=renderer.getPixelRatio?.()??1;
 renderer.setViewport(x/ratio,y/ratio,width/ratio,height/ratio);
 renderer.setScissor(x/ratio,y/ratio,width/ratio,height/ratio);
}
