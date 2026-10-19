import assert from 'node:assert/strict';
import test from 'node:test';
import {PerspectiveCamera,Texture,Vector3} from '../vendor/three.module.min.js';
import {createSunRays} from '../src3d/sun-rays.js';
import {style} from '../src3d/style.js';

function fixture(aspect=16/9){
  const camera=new PerspectiveCamera(62,aspect,.5,24000);
  camera.position.set(591,647,-1070);
  let draws=0;
  const textures=Array.from({length:3},()=>new Texture());
  const rays=createSunRays(...textures);
  const renderer={setRenderTarget(){},render(){draws++;}};
  function aim(yaw,axis=new Vector3(0,1,0)){
    const direction=style.sun.value.clone().applyAxisAngle(axis,yaw);
    camera.lookAt(camera.position.clone().add(direction));camera.updateMatrixWorld();
    const projected=style.sun.value.clone().multiplyScalar(10000).add(camera.position).project(camera);
    return {x:projected.x*.5+.5,y:projected.y*.5+.5,facing:direction.dot(style.sun.value)};
  }
  return {camera,rays,aim,get draws(){return draws;},render(effects=1){rays.render(renderer,camera,1280,720,effects);},dispose(){rays.dispose();textures.forEach(t=>t.dispose());}};
}

test('sun outside the viewport or behind the viewer adds no ray draw or strength',()=>{
  for(const aspect of [16/9,9/16]){
    const f=fixture(aspect);
    try{
      for(const yaw of [-Math.PI,-Math.PI/2,-1.2,1.2,Math.PI/2,Math.PI]){
        const p=f.aim(yaw);
        assert.ok(p.facing<0||p.x<0||p.x>1||p.y<0||p.y>1,'negative control really excludes the source');
        const before=f.draws;f.render();
        assert.equal(f.rays.strength.value,0,'excluded source cannot illuminate a screen border');
        assert.equal(f.draws,before,'excluded source does not submit the ray pass');
      }
    }finally{f.dispose();}
  }
});

test('rays fade while the sun is still inside the screen edge',()=>{
  const f=fixture();
  try{
    f.aim(0);f.render();const centred=f.rays.strength.value;
    assert.ok(centred>.99,'positive control faces a centred sun');
    let edge;
    // Vertical FOV is narrower: isolate border fading before the separate
    // facing-angle fade begins, rather than conflating those two controls.
    const axis=new Vector3().crossVectors(style.sun.value,new Vector3(0,1,0)).normalize();
    for(let yaw=.1;yaw<.8;yaw+=.005){
      const p=f.aim(yaw,axis),border=Math.min(p.x,p.y,1-p.x,1-p.y);
      if(border>.005&&border<.025&&p.facing>.82){edge=p;break;}
    }
    assert.ok(edge,'fixture puts the sun just inside the visible border');
    f.render();
    assert.ok(f.rays.strength.value>0&&f.rays.strength.value<centred*.5,'visible edge source has already faded');
  }finally{f.dispose();}
});

test('Subtle scales ray gain and Reduced motion skips the pass',()=>{
  const f=fixture();
  try{
    f.aim(0);f.render();const full=f.rays.strength.value;
    f.render(.35);
    assert.ok(Math.abs(f.rays.strength.value-full*.35)<1e-12,'Subtle retains 35 percent of ray gain');
    const before=f.draws;f.render(0);
    assert.equal(f.rays.strength.value,0);
    assert.equal(f.draws,before,'Reduced motion submits no ray draw');
  }finally{f.dispose();}
});
