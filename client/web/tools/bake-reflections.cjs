/** Bake the lake's reflection probes (card 085, reflections.js) from the running scene.
 * NODE_PATH=<existing node_modules> CHROME_PATH=<chromium> node client/web/tools/bake-reflections.cjs
 * TUMBLER_REVIEW_URL selects the server (default 8046). For each light preset (day, golden, dusk) and each
 * probe point on the lake, five cube faces (four sides and up) are drawn with the static world the mirror
 * keeps less the falls, which the live movers pass draws (no sky, no fog, no movers) after the scene's own level of detail has settled there, resampled into an
 * equal-area panorama of the upper hemisphere, and written to client/web/data/reflections/: one colour atlas per
 * time (WebP, sRGB of colour/scale), one distance atlas (PNG, 12-bit log metres in red and green) and
 * probes.json naming the points, the sizes and the sha256 of the world data the bake saw (BAKE_INPUTS).
 * Afterwards run python3.11 client/web/tools/make_viewer_data.py so viewer.json lists the files.
 * Run under `timeout -k 10 1500`; it takes several minutes.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REPO=path.resolve(__dirname,'../../..'),OUT=path.join(REPO,'client/web/data/reflections');
// Probe points (world x east, y north): centroids of the lake's area in eight parts, so no
// water lies more than about 330 m from a probe. A hand over the 30 m surface: a reflected ray starts
// on the water, so all it can reach lies at or above the probe's horizon.
const POINTS_XY=[[-1001,127],[-673,-79],[-630,240],[-375,496],[-309,13],[-55,220],[306,274],[531,143]],ABOVE_M=.1;
const WIDTH=+(process.env.BAKE_WIDTH||1024),HEIGHT=+(process.env.BAKE_HEIGHT||256),FACE=+(process.env.BAKE_FACE||1024),TIMES=(process.env.BAKE_TIMES||'day,golden,dusk').split(',');
(async()=>{
 const started=Date.now();
 const browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
 let failed=false;
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
  page.on('pageerror',e=>{console.error('pageerror',e.message);failed=true;});
  await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html');
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  const level=await page.evaluate(async()=>{
   const t=tumbler,{style}=await import('./src3d/style.js');
   t.navigation.select('orbit');t.mirror.mode='off';
   const adaptive=document.getElementById('adaptive');if(adaptive)adaptive.checked=false;
   t.navigation.update=()=>{};t.controls.enabled=false;t.flightRig.group.visible=false;t.character.object.visible=false;
   Object.defineProperty(style.time,'value',{get:()=>40,set:()=>{}});
   window.bake={module:await import('./src3d/reflections.js'),faces:[],probes:[]};
   return t.ride.worldmap.water.bodies.find(b=>b.kind==='lake').surface_z_m;
  });
  const points=POINTS_XY.map(([x,y])=>[x,level+ABOVE_M,-y]);
  const colour={},scale={};let distance=null;
  for(const time of TIMES){
   await page.evaluate(time=>{tumbler.setLight(time);bake.probes=[];},time);
   for(const point of points){
    for(let face=0;face<5;face++){
     // Let the scene's own level of detail settle around the probe, looking the face's way.
     await page.evaluate(([point,face])=>{const t=tumbler,[d,up]=bake.module.PROBE_FACES[face];
      t.camera.position.fromArray(point);t.camera.up.fromArray(up);t.camera.lookAt(point[0]+d[0],point[1]+d[1],point[2]+d[2]);t.camera.fov=90;t.camera.updateProjectionMatrix();t.camera.updateMatrixWorld();},[point,face]);
     await page.waitForTimeout(1500);
     await page.evaluate(async([point,face,size])=>{const t=tumbler,T=await import('./vendor/three.module.min.js');
      bake.faces[face]=bake.module.renderProbeFace(t.renderer,t.scene,t.mirror.keep.filter(o=>o!==t.falls?.group),new T.Vector3(...point),face,size);},[point,face,FACE]);
    }
    await page.evaluate(([w,h])=>{bake.probes.push(bake.module.assembleProbe(bake.faces,w,h));bake.faces=[];},[WIDTH,HEIGHT]);
    process.stdout.write(`${time} probe ${bake_count(points,point)} `);
   }
   const result=await page.evaluate(async([w,h,withDistance])=>{
    const n=bake.probes.length,toBase64=async blob=>{const b=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);};
    // Colour scale: the power of two that keeps all but the brightest thousandth of texels under 1.
    const values=[];for(const p of bake.probes)for(let i=0;i<p.metres.length;i+=7)if(p.metres[i]<Infinity)values.push(Math.max(p.colour[i*3],p.colour[i*3+1],p.colour[i*3+2]));
    values.sort((a,b)=>a-b);const top=values[Math.floor(values.length*.999)]??1,scale=2**Math.max(0,Math.ceil(Math.log2(top)));
    const canvas=new OffscreenCanvas(w,h*n),ctx=canvas.getContext('2d'),image=ctx.createImageData(w,h*n);
    const srgb=x=>{x=Math.max(0,Math.min(1,x));return Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));};
    bake.probes.forEach((p,i)=>{
     // Open-sky texels take their nearest drawn neighbour's colour, so filtering at a silhouette pulls no black in.
     const c=Float32Array.from(p.colour),hit=p.metres.map(m=>m<Infinity?1:0);
     for(let pass=0;pass<4;pass++){const next=Uint8Array.from(hit);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=y*w+x;if(hit[at])continue;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=(x+dx+w)%w,ny=y+dy;if(ny<0||ny>=h)continue;const o=ny*w+nx;if(hit[o]===1){for(let k=0;k<3;k++)c[at*3+k]=c[o*3+k];next[at]=2;break;}}}
      for(let k=0;k<hit.length;k++)if(next[k]===2)hit[k]=1;}
     for(let k=0;k<w*h;k++){const at=(i*h*w+k)*4;for(let j=0;j<3;j++)image.data[at+j]=srgb(c[k*3+j]/scale);image.data[at+3]=255;}
    });
    ctx.putImageData(image,0,0);
    const out={scale,colour:await toBase64(await canvas.convertToBlob({type:'image/webp',quality:.92}))};
    if(withDistance){
     const codes=new Uint16Array(w*h*n);
     bake.probes.forEach((p,i)=>{for(let k=0;k<w*h;k++)codes[i*h*w+k]=bake.module.encodeDistance(p.metres[k]);});
     out.distance=await toBase64(new Blob([codes.buffer]));
    }
    return out;
   },[WIDTH,HEIGHT,distance===null]);
   colour[time]=Buffer.from(result.colour,'base64');scale[time]=result.scale;
   if(result.distance){const b=Buffer.from(result.distance,'base64');distance=png(new Uint16Array(Uint8Array.from(b).buffer),WIDTH,HEIGHT*points.length);}
   console.log(`\n${time}: scale ${result.scale}, colour ${colour[time].length} bytes`);
  }
  const [inputs,sinMin]=await page.evaluate(()=>[bake.module.BAKE_INPUTS,bake.module.PROBE_SIN_MIN]);
  fs.mkdirSync(OUT,{recursive:true});
  const manifest={version:1,generator:'client/web/tools/bake-reflections.cjs',points,width:WIDTH,height:HEIGHT,face:FACE,sin_min:sinMin,
   colour:{},scale,distance:'probes-distance.png',
   inputs:Object.fromEntries(inputs.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO,p))).digest('hex')])),bake_seconds:Math.round((Date.now()-started)/1000)};
  for(const [time,bytes] of Object.entries(colour)){const file=`probes-${time}.webp`;fs.writeFileSync(path.join(OUT,file),bytes);manifest.colour[time]=file;}
  fs.writeFileSync(path.join(OUT,manifest.distance),distance);
  fs.writeFileSync(path.join(OUT,'probes.json'),JSON.stringify(manifest,null,1)+'\n');
  console.log(`baked ${points.length} probes x ${TIMES.length} times in ${manifest.bake_seconds} s; distance ${distance.length} bytes`);
 }catch(e){console.error(e);failed=true;}
 await Promise.race([browser.close(),new Promise(r=>setTimeout(r,5000))]);
 process.exit(failed?1:0);
})();
/** RGB PNG of 12-bit distance codes (reflections.js packDistance), deflated at level 9 with each
 * row's filter chosen by least absolute sum: about a third the size of the browser's encoder. */
function png(codes,width,height){
 const zlib=require('node:zlib'),raw=Buffer.alloc((width*3+1)*height),row=Buffer.alloc(width*3),prev=Buffer.alloc(width*3),best=Buffer.alloc(width*3),trial=Buffer.alloc(width*3);
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++){const c=codes[y*width+x];row[x*3]=c>>4;row[x*3+1]=(c&15)<<4;row[x*3+2]=0;}
  let bestType=0,bestSum=Infinity;
  for(let type=0;type<3;type++){let sum=0;for(let i=0;i<row.length;i++){const left=i>=3?row[i-3]:0,v=type===0?row[i]:type===1?row[i]-left:row[i]-prev[i];trial[i]=v&255;sum+=Math.min(trial[i],256-trial[i]);}
   if(sum<bestSum){bestSum=sum;bestType=type;trial.copy(best);}}
  raw[y*(width*3+1)]=bestType;best.copy(raw,y*(width*3+1)+1);row.copy(prev);
 }
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]),crc=Buffer.alloc(4);crc.writeUInt32BE(zlib.crc32(td));return Buffer.concat([len,td,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9,memLevel:9})),chunk('IEND',Buffer.alloc(0))]);
}
function bake_count(points,point){return `${points.indexOf(point)+1}/${points.length}`;}
