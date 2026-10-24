/** Core geometry operation, typed arrays only. Fit a portable crown into the
 * existing individual's crown bounds; the original bole/attachments never pass
 * through this function. Keep the original straight axis and crown taper. */
export function fitCrown(positions, normals, recipe, bounds, taper=.78) {
  const fitted=new Float32Array(positions.length),outNormals=new Float32Array(normals.length);
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity],radials=new Float32Array(positions.length/3);
  for(let i=0;i<positions.length;i+=3){
    const y=positions[i+1],f=Math.max(0,Math.min(.995,(y/recipe.heightM-recipe.crownBase)/(1-recipe.crownBase)));
    const radial=Math.max(.08,(1-f)**(taper-recipe.taper));radials[i/3]=radial;
    fitted[i]=(positions[i]-recipe.lean*recipe.heightM*Math.max(0,y/recipe.heightM)**1.65)*radial;
    fitted[i+1]=y;fitted[i+2]=positions[i+2]*radial;
    for(let a=0;a<3;a++){low[a]=Math.min(low[a],fitted[i+a]);high[a]=Math.max(high[a],fitted[i+a]);}
  }
  const scale=low.map((v,a)=>(bounds.max[a]-bounds.min[a])/Math.max(.001,high[a]-v));
  for(let i=0;i<fitted.length;i+=3){
    for(let a=0;a<3;a++){fitted[i+a]=bounds.min[a]+(fitted[i+a]-low[a])*scale[a];outNormals[i+a]=normals[i+a]/(scale[a]*(a===1?1:radials[i/3]));}
    const length=Math.hypot(outNormals[i],outNormals[i+1],outNormals[i+2])||1;
    for(let a=0;a<3;a++)outNormals[i+a]/=length;
  }
  return {positions:fitted,normals:outNormals};
}
