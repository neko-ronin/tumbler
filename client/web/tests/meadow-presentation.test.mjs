import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {createAirCues,createMeadowAir} from '../src3d/air-cues.js';
import {style} from '../src3d/style.js';

test('meadow wind stays at fixed world positions and preserves the signed shared field',()=>{
  const visited=[];
  const field=createMeadowAir((x,y,z)=>{visited.push([x,y,z]);return {wx:x*.1,wy:y*.2,lift:999,gust:-z,intensity:.3};},
    {height:(x,y)=>x+y},{size:2,span:40,x:-20,z:-20});
  try{
    field.update(0);
    assert.deepEqual(visited,[[-10,10,2],[10,10,22],[-10,-10,-18],[10,-10,2]]);
    assert.deepEqual(style.meadowAirGrid.value.toArray(),[-20,-20,40,2]);
    for(const texture of field.textures){
      assert.equal(texture.minFilter,T.NearestFilter);assert.equal(texture.magFilter,T.NearestFilter);
      visited.forEach(([x,y,z],i)=>{
        const a=texture.image.data.subarray(i*4,i*4+4);
        assert.ok(Math.abs(a[0]-x*.1)<1e-6);assert.ok(Math.abs(a[1]+y*.2)<1e-6);
        assert.equal(a[2],-z);assert.ok(Math.abs(a[3]-.3)<1e-6);
      });
    }
    visited.length=0;field.update(.25);
    assert.deepEqual(visited,[[-10,10,2],[10,10,22],[-10,-10,-18],[10,-10,2]],'moving the observer cannot relocate the field');
  }finally{field.dispose();}
});

test('meadow weather samples crossfade continuously, including a sign reversal',()=>{
  let speed=4;
  const field=createMeadowAir(()=>({wx:speed,wy:0,lift:0,intensity:0}),{height:()=>0},{size:2,hz:4});
  const displayed=()=>T.MathUtils.lerp(style.meadowAirFrom.value.image.data[0],style.meadowAirTo.value.image.data[0],style.meadowAirMix.value);
  try{
    field.update(0);assert.equal(displayed(),4);
    speed=-4;field.update(.25);assert.equal(displayed(),4,'new sample begins at the old visible vector');
    field.update(.125);assert.equal(displayed(),0,'a reversal interpolates signed velocity, not angle');
    field.update(.125);assert.equal(displayed(),-4,'swapping buffers preserves the last interpolated value');
    const disposed=[];for(const t of field.textures)t.addEventListener('dispose',()=>disposed.push(t));
    field.dispose();assert.equal(new Set(disposed).size,2);
  }finally{field.dispose();}
});

test('local and meadow wind initialize immediately and stagger their periodic fills',()=>{
  let local=0,meadow=0;
  const wind=()=>({wx:1,wy:2,lift:3,gust:4,intensity:5});
  const ground={height:()=>0},camera={position:new T.Vector3()};
  const cue=createAirCues(()=>{local++;return wind();},ground,{size:1});
  const field=createMeadowAir(()=>{meadow++;return wind();},ground,{size:1});
  try{
    cue.update(camera,0);field.update(0);
    assert.equal(local,1);assert.equal(meadow,1);
    let elapsed=0,coincident=0;
    const steps=[.016,.034,.05,.009,.041,.023,.027];
    for(let i=0;i<1400;i++){
      const dt=steps[i%steps.length],l=local,m=meadow;
      cue.update(camera,dt);field.update(dt);elapsed+=dt;
      if(local>l&&meadow>m)coincident++;
    }
    assert.equal(coincident,0,'normal capped frame steps do not combine the two field fills');
    assert.ok(Math.abs((local-1)-elapsed*8)<2,'local field retains its 8 Hz cadence');
    assert.ok(Math.abs((meadow-1)-elapsed*4)<2,'meadow field retains its 4 Hz cadence');
  }finally{cue.dispose();field.dispose();}
});

test('grass roots follow the supplied terrain plane without changing stamp coverage',async()=>{
  const {buildMeadowTiles,buildMeadowPatch}=await import('../src3d/groundcover.js');
  const cover={covered:new Uint8Array([1,0,0,1]),resolution:2,quad:8,offsetX:-8,offsetY:-8};
  const ground={height:(x,y)=>40+x*.25+y*.4},patch=buildMeadowPatch();
  const meadow=buildMeadowTiles(cover,ground,patch);
  const expected=new T.Vector3(-.25,1,.4).normalize(),matrix=new T.Matrix4(),up=new T.Vector3();
  try{
    let roots=0;
    for(const mesh of meadow.group.children)for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);up.set(0,1,0).transformDirection(matrix);
      assert.ok(up.dot(expected)>.999999,'patch base follows the actual slope');
      const x=matrix.elements[12],y=-matrix.elements[14];
      assert.equal(matrix.elements[13],Math.fround(ground.height(x,y)));
      assert.ok(cover.covered[Math.floor((y+8)/8)*2+Math.floor((x+8)/8)]);
      roots++;
    }
    assert.equal(roots,cover.covered.reduce((a,b)=>a+b,0));
  }finally{
    meadow.group.children.forEach(m=>m.geometry.dispose());patch.geometry.dispose();patch.material.dispose();
  }
});

test('moving the close-meadow window preserves every root in the overlapping interior',async()=>{
  const {buildCloseMeadow}=await import('../src3d/groundcover.js');
  const cover={covered:new Uint8Array(128*128).fill(1),resolution:128,quad:8,offsetX:-512,offsetY:-512};
  const close=buildCloseMeadow(cover,{height:()=>40}),camera={position:new T.Vector3(0,43,0)},matrix=new T.Matrix4();
  const roots=()=>Array.from({length:close.mesh.count},(_,i)=>{close.mesh.getMatrixAt(i,matrix);return [matrix.elements[12],matrix.elements[14]];});
  const key=p=>p.map(v=>v.toFixed(4)).join(',');
  try{
    close.update(camera);const before=new Set(roots().map(key));
    camera.position.x=13;close.update(camera);
    const interior=roots().filter(([x,z])=>Math.hypot(x,z)<30&&Math.hypot(x-12,z)<30);
    assert.ok(interior.length>0,'the two windows have an occupied overlap');
    for(const root of interior)assert.ok(before.has(key(root)),`surviving world root ${key(root)} must not swim with the window`);
  }finally{close.mesh.geometry.dispose();close.mesh.material.dispose();}
});

test('local leaves taper along curved centre lines with valid smooth normals and anchored bases',async()=>{
  const {buildMeadowPatch}=await import('../src3d/groundcover.js');
  const patch=buildMeadowPatch({close:true}),g=patch.geometry,leaves=new Map();
  try{
    const p=g.attributes.position,r=g.attributes.bladeRoot,n=g.attributes.normal,f=g.attributes.flex,plant=g.attributes.plant;
    assert.ok(r,'every vertex needs its own plant base, rather than only the patch origin');
    for(let i=0;i<p.count;i++){
      const point=new T.Vector3().fromBufferAttribute(p,i),root=new T.Vector3().fromBufferAttribute(r,i),normal=new T.Vector3().fromBufferAttribute(n,i);
      assert.ok(point.toArray().concat(root.toArray(),normal.toArray()).every(Number.isFinite));
      assert.ok(Math.abs(normal.length()-1)<1e-6,'lighting normals remain unit vectors');
      assert.equal(root.y,0,'all plants stand on the patch tangent plane');assert.ok(f.getX(i)>0);
      if(plant.getX(i)>0)continue;
      const key=root.toArray().join(','),points=leaves.get(key)??[];points.push(point);leaves.set(key,points);
    }
    const heights=[];
    for(const [key,points]of leaves){
      const root=new T.Vector3(...key.split(',').map(Number)),height=Math.max(...points.map(p=>p.y));heights.push(height);
      const base=points.filter(p=>p.y===0),tips=points.filter(p=>p.y===height);
      const low=base.reduce((a,b)=>a.add(b),new T.Vector3()).divideScalar(base.length);
      // Duplicated triangle vertices weight one ribbon edge twice; the actual
      // base endpoints still have their midpoint at the fixed plant root.
      const a=base[0],b=base.find(p=>p.distanceTo(a)>.0001);
      assert.ok(a.clone().add(b).multiplyScalar(.5).distanceTo(root)<1e-6);
      assert.ok(a.distanceTo(b)<.09,'the old broad triangular wedges are absent locally');
      assert.ok(tips.every(p=>p.distanceTo(tips[0])<1e-6),'the ribbon converges to one tip');
      assert.ok(Math.hypot(tips[0].x-root.x,tips[0].z-root.z)>.1,'each blade has a curved, leaning centre line');
      assert.ok(low.distanceTo(root)<.02);
    }
    assert.ok(Math.max(...heights)-Math.min(...heights)>.3,'the sward has varied heights');
  }finally{g.dispose();patch.material.dispose();}
});

test('jitter, growth, blossom drifts and flower colour survive a moving-window rebuild exactly',async()=>{
  const {buildCloseMeadow}=await import('../src3d/groundcover.js');
  const cover={covered:new Uint8Array(128*128).fill(1),resolution:128,quad:8,offsetX:-512,offsetY:-512};
  const close=buildCloseMeadow(cover,{height:()=>40}),camera={position:new T.Vector3(0,43,0)},matrix=new T.Matrix4();
  const read=()=>{
    const rows=new Map(),tint=close.mesh.geometry.attributes.flowerTint,traits=close.mesh.geometry.attributes.meadowTraits;
    for(let i=0;i<close.mesh.count;i++){
      close.mesh.getMatrixAt(i,matrix);const x=matrix.elements[12],z=matrix.elements[14];
      rows.set([x,z].map(n=>n.toFixed(4)).join(','),{x,z,values:[...matrix.elements,tint.getX(i),tint.getY(i),tint.getZ(i),traits.getX(i),traits.getY(i),traits.getZ(i)]});
    }return rows;
  };
  try{
    close.update(camera);const before=read(),residuals=new Set(),bloomStates=new Set();
    const thresholds=[...new Set(close.mesh.geometry.attributes.plant.array)].filter(n=>n>0);
    for(const {x,values}of before.values()){
      residuals.add((x/1.35-Math.round(x/1.35)).toFixed(3));
      bloomStates.add(thresholds.filter(t=>t<=values.at(-3)).length);
    }
    assert.ok(residuals.size>10,'plant bases do not form straight lattice rows');
    assert.ok(bloomStates.has(0)&&bloomStates.has(thresholds.length),'blossom drifts include grass-only areas and flowering clumps');
    camera.position.x=13;close.update(camera);
    for(const [key,row]of read())if(Math.hypot(row.x,row.z)<30&&Math.hypot(row.x-12,row.z)<30){
      assert.deepEqual(row.values,before.get(key)?.values,'a surviving patch retains its transform, blossoms, colour and flutter phase');
    }
  }finally{close.mesh.geometry.dispose();close.mesh.material.dispose();}
});

test('irregular blossom drifts retain the existing palette and honor the supplied colour mix',async()=>{
  const {meadowAppearance}=await import('../src3d/groundcover.js'),colours=new Set();
  for(let y=-300;y<=300;y+=7)for(let x=-300;x<=300;x+=7){
    const appearance=meadowAppearance(x,y);colours.add(appearance.tint.getHexString());
    assert.deepEqual(appearance,meadowAppearance(x,y),'colour and plant variation depend only on world coordinates');
    assert.equal(meadowAppearance(x,y,{red:1}).tint.getHexString(),'c74e6e','the supplied mix controls colour in close and middle kits');
  }
  assert.deepEqual([...colours].sort(),['5b6fc4','c74e6e','d9792b','f0ede2'].sort(),'low-weight flower colours must survive clumping');
});

test('third-person grass coverage follows the ground at the centre of the camera view',async()=>{
  const {buildCloseMeadow}=await import('../src3d/groundcover.js');
  const cover={covered:new Uint8Array(128*128).fill(1),resolution:128,quad:8,offsetX:-512,offsetY:-512};
  const close=buildCloseMeadow(cover,{height:()=>0}),camera=new T.PerspectiveCamera(),matrix=new T.Matrix4();
  camera.position.set(0,12,0);camera.lookAt(0,0,-60);camera.updateMatrixWorld();
  const centre=()=>{const p=new T.Vector3();for(let i=0;i<close.mesh.count;i++){close.mesh.getMatrixAt(i,matrix);p.add(new T.Vector3().setFromMatrixPosition(matrix));}return p.divideScalar(close.mesh.count);};
  try{
    close.update(camera);let p=centre();assert.ok(Math.abs(p.z+60)<8,`dense grass should cover the viewed ground, not the camera's feet: centre z=${p.z}`);
    camera.lookAt(60,0,0);camera.updateMatrixWorld();close.update(camera);p=centre();
    assert.ok(Math.abs(p.x-60)<8,'turning the view without moving the pilot must move coverage into that view');
  }finally{close.mesh.geometry.dispose();close.mesh.material.dispose();}
});

test('canopy tiles keep ground-tangent roots, respect the stamp and retain overlapping transforms',async()=>{
  const {buildGrassCanopy}=await import('../src3d/grass-canopy.js');
  const cover={covered:new Uint8Array(8*8).fill(1),resolution:8,quad:8,offsetX:-32,offsetY:-32};cover.covered[27]=0;
  const ground={height:(x,y)=>30+x*.1+y*.2},canopy=buildGrassCanopy(cover,ground),camera={position:new T.Vector3(0,34,0)},matrix=new T.Matrix4(),expected=new T.Vector3(-.1,1,.2).normalize();
  const read=()=>{
    const roots=new Map();
    for(const mesh of canopy.group.children)for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);const p=new T.Vector3().setFromMatrixPosition(matrix),up=new T.Vector3(0,1,0).transformDirection(matrix);
      assert.ok(canopy.contains(p.x,-p.z));assert.ok(Math.abs(p.y-ground.height(p.x,-p.z))<1e-5);assert.ok(up.dot(expected)>.999999);
      const traits=mesh.geometry.attributes.meadowTraits;
      roots.set([p.x,p.z].join(','),[...matrix.elements,traits.getX(i),traits.getY(i),traits.getZ(i)]);
    }return roots;
  };
  try{
    canopy.update(camera,new T.Vector3(0,30,0));const before=read();assert.ok(before.size>0);
    canopy.update(camera,new T.Vector3(24,30,0));let overlap=0;
    for(const [key,values]of read())if(before.has(key)){assert.deepEqual(values,before.get(key));overlap++;}assert.ok(overlap>0);
    const disposed=new Set(),released=new Set(),meshes=[...canopy.group.children],geometries=meshes.map(m=>m.geometry);
    for(const mesh of meshes)mesh.addEventListener('dispose',()=>released.add(mesh));
    for(const g of geometries)g.addEventListener('dispose',()=>disposed.add(g));
    canopy.update(camera,new T.Vector3(1000,30,1000));
    assert.ok(meshes.every(mesh=>released.has(mesh)),'eviction must release instance buffers as well as geometry');
    assert.ok(geometries.every(g=>disposed.has(g)),'tiles outside the moving view budget release their GPU buffers');
  }finally{canopy.dispose();}
});

test('nearest grass has separate narrow curved blades without a clump-wide carrier face',async()=>{
  const {grassBladeGeometry}=await import('../src3d/grass-canopy.js'),g=grassBladeGeometry(),leaves=new Map();
  try{
    const p=g.attributes.position,r=g.attributes.bladeRoot,n=g.attributes.normal;
    for(let i=0;i<p.count;i++){
      const root=new T.Vector3().fromBufferAttribute(r,i),point=new T.Vector3().fromBufferAttribute(p,i),normal=new T.Vector3().fromBufferAttribute(n,i);
      assert.ok(point.toArray().concat(normal.toArray()).every(Number.isFinite));assert.ok(Math.abs(normal.length()-1)<1e-6);
      assert.equal(root.y,0);assert.ok(point.y>=0);
      const key=root.toArray().join(','),leaf=leaves.get(key)??{root,points:[]};leaf.points.push(point);leaves.set(key,leaf);
      if(i%3)assert.deepEqual(root.toArray(),new T.Vector3().fromBufferAttribute(r,i-i%3).toArray(),'a triangle cannot bridge two plant roots');
    }
    const heights=[];
    for(const {root,points}of leaves.values()){
      const bases=points.filter(p=>p.y===0),a=bases[0],b=bases.find(p=>p.distanceTo(a)>.0001),width=b.clone().sub(a).normalize();
      assert.ok(a.clone().add(b).multiplyScalar(.5).distanceTo(root)<1e-6);
      const across=points.map(p=>p.clone().sub(root).dot(width));
      assert.ok(Math.max(...across)-Math.min(...across)<.041,'a close face must stay blade-wide rather than exposing a card');
      const height=Math.max(...points.map(p=>p.y)),tip=points.find(p=>p.y===height);heights.push(height);
      assert.ok(Math.hypot(tip.x-root.x,tip.z-root.z)>.1,'the silhouette bends along a curved centre line');
    }
    assert.ok(Math.max(...heights)-Math.min(...heights)>.3,'individual blades vary in height');
  }finally{g.dispose();}
});

test('aerial grass reaches visible distant ground and culls by the actual camera projection',async()=>{
  const {buildGrassCanopy}=await import('../src3d/grass-canopy.js');
  const cover={covered:new Uint8Array(192*192).fill(1),resolution:192,quad:8,offsetX:-768,offsetY:-768};
  const canopy=buildGrassCanopy(cover,{height:()=>30}),camera=new T.PerspectiveCamera(52,16/9,.2,3000),frustum=new T.Frustum();
  camera.position.set(0,66,0);
  const check=target=>{
    camera.lookAt(target);camera.updateMatrixWorld();canopy.update(camera);
    frustum.setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const visible=canopy.group.children.filter(m=>m.visible);
    for(const mesh of visible)assert.ok(frustum.intersectsSphere(mesh.boundingSphere),'no offscreen tile should be submitted');
    return visible;
  };
  try{
    let visible=check(new T.Vector3(0,30,-180));
    for(const point of [new T.Vector3(0,30,-400),new T.Vector3(96,30,-500),new T.Vector3(-96,30,-500)]){
      assert.ok(frustum.containsPoint(point),'test point is actually in the view');
      assert.ok(visible.some(m=>m.name===`grass_distant_${Math.floor(point.x/48)}_${Math.floor(-point.z/48)}`),'visible ground beyond the old 210 m fade must have grass');
    }
    const retained=canopy.group.children.find(m=>m.name==='grass_distant_0_8'),matrices=[...retained.instanceMatrix.array];
    visible=check(new T.Vector3(0,30,180));
    assert.ok(visible.some(m=>m.name==='grass_distant_0_-9'),'a turn in place updates the allocation into the new view');
    assert.ok(!retained.visible,'previous view is cached without being drawn');
    check(new T.Vector3(0,30,-180));assert.deepEqual([...retained.instanceMatrix.array],matrices,'turning does not move grass roots');
    camera.aspect=9/16;camera.updateProjectionMatrix();check(new T.Vector3(0,30,-180));
    camera.aspect=3;camera.updateProjectionMatrix();visible=check(new T.Vector3(180,30,0));assert.ok(visible.length>0,'ultrawide views retain grass');
    visible=check(new T.Vector3(0,1000,0));assert.equal(visible.length,0,'a sky-only view has no grass draws');
    visible=check(new T.Vector3(0,30,0));assert.ok(visible.length>0,'a downward view retains the ground under the camera');
    const orthographic=new T.OrthographicCamera(-100,100,80,-80,.2,3000);orthographic.position.set(0,200,0);orthographic.lookAt(0,30,-400);orthographic.updateMatrixWorld();canopy.update(orthographic);
    frustum.setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(orthographic.projectionMatrix,orthographic.matrixWorldInverse));
    assert.ok(canopy.group.children.some(m=>m.visible&&m.name==='grass_distant_0_8'),'orthographic inspection uses its own projection');
    for(const mesh of canopy.group.children.filter(m=>m.visible))assert.ok(frustum.intersectsSphere(mesh.boundingSphere));
  }finally{canopy.dispose();}
});

test('grass culling retains a visible ridge between lower tile corners',async()=>{
  const {buildGrassCanopy}=await import('../src3d/grass-canopy.js'),{HeightGrid,GroundSampler}=await import('../src3d/heights.js');
  const values=new Float32Array(192*192).fill(30);values[146*192+98]=300;
  const block=new HeightGrid({values,resolution:192,quad_size_m:8,offset_xy_m:[-768,-768]});
  const ground=new GroundSampler(block,block),cover={covered:new Uint8Array(192*192).fill(1),resolution:192,quad:8,offsetX:-768,offsetY:-768};
  const canopy=buildGrassCanopy(cover,ground),camera=new T.PerspectiveCamera(52,16/9,.2,3000),peak=new T.Vector3(16,300,-400);
  camera.position.set(0,180,0);camera.lookAt(0,230,-400);camera.updateMatrixWorld();
  const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  try{
    assert.ok(frustum.containsPoint(peak));assert.ok(!frustum.containsPoint(new T.Vector3(16,30,-400)),'flat ground would be outside this camera');
    canopy.update(camera);const mesh=canopy.group.children.find(m=>m.name==='grass_distant_0_8');
    assert.ok(mesh?.visible,'the published height samples inside the tile must keep the ridge grass visible');
  }finally{canopy.dispose();}
});

test('a stamped sliver with no sampled grass roots stays safe in the tile cache',async()=>{
  const {buildGrassCanopy}=await import('../src3d/grass-canopy.js');
  const canopy=buildGrassCanopy({covered:new Uint8Array([1]),resolution:1,quad:.01,offsetX:0,offsetY:0},{height:()=>30});
  const camera=new T.PerspectiveCamera(52,16/9,.2,3000);camera.position.set(0,40,0);camera.lookAt(0,30,-20);camera.updateMatrixWorld();
  try{canopy.update(camera);assert.doesNotThrow(()=>canopy.update(camera));assert.equal(canopy.group.children.length,0);}finally{canopy.dispose();}
});
