/** Client lighting over authoritative heights; no cloud placement lives here. */
export function cloudCellBounds(cell,atmosphere){
 const h=Math.min(cell.size_m[2],atmosphere.cloud_top_m-atmosphere.cloud_base_m);
 return {centre:[cell.centre_xy_m[0],atmosphere.cloud_base_m+h*.5,-cell.centre_xy_m[1]],extent:[cell.size_m[0],h,cell.size_m[1]]};
}
/** Conservative solar projection, including receivers throughout the height range. */
export function cloudGroundFootprint(bounds,sun,minHeight,maxHeight){
 if(sun[1]<=0)return null;
 const low=[Infinity,Infinity],high=[-Infinity,-Infinity];
 for(const sx of [-.5,.5])for(const sy of [-.5,.5])for(const sz of [-.5,.5])for(const h of [minHeight,maxHeight]){
  const p=bounds.centre.map((v,i)=>v+bounds.extent[i]*[sx,sy,sz][i]);
  for(const [j,axis]of [0,2].entries()){
   const q=p[axis]-sun[axis]*(p[1]-h)/sun[1];low[j]=Math.min(low[j],q);high[j]=Math.max(high[j],q);
  }
 }
 return {low,high};
}
export const CLOUD_GROUND_LIGHT_GLSL=`
uniform sampler2D uCloudGround;
uniform vec4 uCloudGroundGrid;
uniform float uCloudGroundReady,uCloudTop;
float cloudGroundLight(vec3 place){
 if(uCloudGroundReady<.5||place.y>=uCloudTop)return 1.;
 vec2 uv=(place.xz-uCloudGroundGrid.xy)/uCloudGroundGrid.zw;
 float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
 if(edge<=0.)return 1.;
 return mix(1.,texture2D(uCloudGround,uv).r,smoothstep(0.,.025,edge));
}
`;
