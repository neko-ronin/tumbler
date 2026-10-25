/** One linear-light wood response for full meshes and retained card wood.
 * Surface detail is measured in object metres, so assets without UVs work too.
 * Derivative filtering removes subpixel bark stripes before they can shimmer.
 */
export const TREE_WOOD_GLSL=`
uniform float uTreeRedBark;
float barkNoise(vec2 p){
 vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 vec3 q=fract(vec3(cell.xyx)*.1031);q+=dot(q,q.yzx+33.33);
 float a=fract((q.x+q.y)*q.z);
 q=fract(vec3((cell+vec2(1.,0.)).xyx)*.1031);q+=dot(q,q.yzx+33.33);float b=fract((q.x+q.y)*q.z);
 q=fract(vec3((cell+vec2(0.,1.)).xyx)*.1031);q+=dot(q,q.yzx+33.33);float c=fract((q.x+q.y)*q.z);
 q=fract(vec3((cell+1.).xyx)*.1031);q+=dot(q,q.yzx+33.33);float d=fract((q.x+q.y)*q.z);
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
vec3 treeWoodAlbedo(vec3 albedo,vec3 p,out float relief){
 float radius=max(.15,length(p.xz));
 vec2 uv=vec2(atan(p.z,p.x)*radius,p.y);
 float footprint=max(length(dFdx(p)),length(dFdy(p)));
 float wander=barkNoise(vec2(uv.x*.7,uv.y*.35));
 float furrow=barkNoise(vec2(uv.x*9.+wander*1.3,uv.y*.65));
 float fibre=barkNoise(vec2(uv.x*45.+wander*3.,uv.y*2.));
 float resolved=1.-smoothstep(.03,.18,footprint);
 float groove=mix(.55,smoothstep(.16,.8,furrow),1.-smoothstep(.2,.65,footprint));
 float luminance=dot(albedo,vec3(.2126,.7152,.0722));
 // Redwood keeps its iron-red source hue, as the occupied village did.
 // Conifers retain the subtler weathered treatment.
 vec3 wood=mix(albedo,luminance*vec3(1.16,1.04,.93),mix(.48,.06,uTreeRedBark))*mix(.9,1.08,uTreeRedBark);
 wood*=mix(.46,1.13,groove)*mix(.88,1.06,mix(.5,fibre,resolved));
 float lichen=smoothstep(.67,.83,barkNoise(uv*vec2(2.7,1.3)))*.25;
 wood=mix(wood,luminance*vec3(.9,1.02,.77),lichen);
 relief=(groove*.045+fibre*.009*resolved);
 return wood;
}
vec3 treeReliefNormal(vec3 N,vec3 world,float relief){
 vec3 dx=dFdx(world),dy=dFdy(world),r1=cross(dy,N),r2=cross(N,dx);
 float det=dot(dx,r1);
 return normalize(abs(det)*N-sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2));
}
vec3 treeWoodLight(vec3 albedo,vec3 p,vec3 world,vec3 N,vec3 L,vec3 sunTint,vec3 skyTint,vec3 groundTint,float visibility,float ao){
 float relief;vec3 wood=treeWoodAlbedo(albedo,p,relief);N=treeReliefNormal(N,world,relief);
 vec3 fill=mix(groundTint,skyTint,N.y*.5+.5);
 // Separate occluded direct sun from diffuse fill. No wrap-light on wood.
 return wood*(fill*vec3(.34,.40,.42)*ao+sunTint*max(0.,dot(N,L))*.9*visibility);
}
`;
