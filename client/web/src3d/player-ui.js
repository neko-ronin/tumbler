/** The player's interface: a trail map of the valley for fast travel and taking to the air, and a
 * key card for whatever he is doing. Every control it names works for a player in that state, on
 * the keyboard and on a controller; development controls never appear here.
 *
 * The map is drawn from the world itself, once, on first opening: the ground's relief and 100 m
 * contours, the forest from the published trees, rock where it is too steep to hold them, the snow
 * the core lays, the river and the lake, the parakite route and the named places.
 */
import * as T from '../vendor/three.module.min.js';
const TIME_LABELS={golden:'Golden hour',dusk:'Evening',day:'Morning'};

// Each control: what it does, its keyboard keys, its controller buttons. Keys and buttons render
// as map-legend symbols; an empty list means that input has no binding for it.
const CONTROLS={
  walk:{title:'On foot',rows:[
    ['Walk, runs by default',['WASD'],['L stick, push fully to run']],['Look',['Drag','Arrows'],['R stick']],
    ['Jump',['Space'],['A']],['Tuck and roll, held',['Shift'],['LB']],['Dive in water, press to toggle',['Shift'],[]],['Slide',['Ctrl'],['R3']],
    ['Draw the katana',['F'],['Y']],['Slash',['Q','Click'],['B']],['Charge, held',['R'],['RT']],
    ['Grab a tree',['E'],['X']],['Launch from a giant redwood crown',['1','2','3'],['D-pad','X']],['First person',['V'],['L3']],['Board the gondola, on a station deck',['G'],['RB']],['Map',['Esc','M'],['Menu']]]},
  stair:{title:'On a tree village stair',rows:[
    ['Climb or go down the stair',['WASD'],['L stick']],['Step off at a gallery, at a gap in the rail',['WASD'],['L stick']],
    ['Jump',['Space'],['A']],['Vault the handrail: a quick tap toward it',['Space'],['A']],['Slide down the handrail, held',['Shift'],['LB']],
    ['Look',['Drag','Arrows'],['R stick']],['Map',['Esc','M'],['Menu']]]},
  harness:{title:'Paramotor, on the ground',rows:[
    ['Start the take-off run',['Space'],['A']],['Steer',['A','D'],['L stick']],['Motor up, down',['R','F'],['RB','LB']],
    ['Unhook and walk',['E'],['X']],['Look',['Drag','Arrows'],['R stick']],['Map',['Esc','M'],['Menu']]]},
  paraglider:{title:'Paraglider',rows:[
    ['Steer',['A','D'],['L stick']],['Speed bar, brakes',['W','S'],['L stick']],['Brake handles, left and right',['J','K'],['LT','RT']],
    ['Wingovers',['Shift','A','D'],['B','L stick']],['View',['V'],['Y']],
    ['Look',['Drag','Arrows'],['R stick']],['After landing, unhook',['E'],['X']],['Map',['Esc','M'],['Menu']]]},
  paramotor:{title:'Paramotor',rows:[
    ['Steer',['A','D'],['L stick']],['Speed bar, brakes',['W','S'],['L stick']],['Brake handles, left and right',['J','K'],['LT','RT']],
    ['Motor up, down',['R','F'],['RB','LB']],['Wingovers',['Shift','A','D'],['B','L stick']],['View',['V'],['Y']],
    ['Look',['Drag','Arrows'],['R stick']],['After landing, unhook',['E'],['X']],['Map',['Esc','M'],['Menu']]]},
  parakite:{title:'Parakite',rows:[
    ['Steer',['A','D'],['L stick']],['Dive, flare',['W','S'],['L stick']],['Handles, left and right',['J','K'],['LT','RT']],
    ['Wingovers',['Shift','A','D'],['B','L stick']],['View',['V'],['Y']],['Look',['Drag','Arrows'],['R stick']],
    ['After landing, unhook',['E'],['X']],['Map',['Esc','M'],['Menu']]]},
  gondola:{title:'Gondola',rows:[['Fast travel to the far station',['T'],['RB']],['View',['V'],['Y']],['Look',['Drag','Arrows'],['R stick']],['Map',['Esc','M'],['Menu']]]},
};
const MENU_CONTROLS={
  map:[['Choose a place',['Arrows','WASD','Click'],['D-pad','L stick']],['Travel there',['Enter'],['A']],
    ['Fly the parakite from North Wall',['L'],['Y']],['Fly the parakite from Tumble Hill',['H'],['X']],['The map or the valley itself',['V'],['LB']],['All controls',['Tab'],['RB']],['Back to the valley',['Esc'],['B','Menu']]],
  controls:[['Back to the map',['Tab'],['LB']],['Back to the valley',['Esc'],['B','Menu']]],
};

const el=(tag,props={},...children)=>{const n=Object.assign(document.createElement(tag),props);n.append(...children.filter(c=>c!=null));return n;};
const glyph=(label,kind)=>el('span',{className:`glyph glyph-${kind} glyph-${label.length>2?'word':'key'}`,textContent:label});
const paraModes=new Set(['paraglider','parakite','paramotor']);
// What a giant redwood's crown perch offers, in the order of its number keys.
const PERCH_MODES=[['parakite','Parakite'],['paraglider','Paraglider'],['paramotor','Paramotor']];
function controlRow([action,keys,pad]){
  const keyCell=keys.length?keys.map(k=>glyph(k,'key')):[el('span',{className:'glyph-none',textContent:'not on the keyboard'})];
  return el('div',{className:'control-row'},el('span',{className:'control-action',textContent:action}),el('span',{className:'control-keys'},...keyCell),el('span',{className:'control-pad'},...pad.map(b=>glyph(b,'pad'))));
}
function legend(rows,{caption}={}){
  return el('div',{className:'legend'},caption?el('p',{className:'legend-caption',textContent:caption}):null,
    el('div',{className:'control-head'},el('span',{textContent:''}),el('span',{textContent:'Keyboard'}),el('span',{textContent:'Controller'})),...rows.map(controlRow));
}

export function createPlayerUI({places,arriveAt,startParakite,navigation,ground,snowAt,trees,worldmap,course,launch,timeOfDay,nextTimeOfDay,showLight,canvas,camera,fog,learnParakite,flightStatsDock}){
  const root=el('div',{className:'player-ui'});
  const card=el('aside',{className:'key-card',ariaLabel:'Controls'});
  const toast=el('div',{className:'arrival',ariaLive:'polite'});
  const menu=el('section',{className:'trail-map',hidden:true,ariaLabel:'Trail map'});
  const statRows=new Map(['Airspeed','Groundspeed','Above ground','Vertical speed','Load','Wing pressure'].map(label=>{
    const value=el('dd');
    const className=['Airspeed','Above ground','Wing pressure'].includes(label)?'compact-reading':'';
    return [label,{value,row:el('div',{className},el('dt',{textContent:label}),value)}];
  }));
  const flightStats=el('aside',{className:'player-flight-stats',hidden:true,ariaLabel:'Para-flight stats'},
    el('h3',{textContent:'Para-flight'}),el('dl',{},...[...statRows.values()].map(({row})=>row)));
  const perchRows=PERCH_MODES.map(([mode,label],i)=>el('li',{},el('button',{type:'button',className:'perch-option',onclick:()=>navigation.launchFromTree(mode)},glyph(String(i+1),'key'),el('span',{textContent:label}))));
  const perch=el('aside',{className:'perch-launch',hidden:true,ariaLabel:'Launch from the crown'},el('h3',{textContent:'Crown perch · take to the air'}),el('ol',{},...perchRows),
    el('p',{className:'perch-pad'},glyph('D-pad','pad'),' choose ',glyph('X','pad'),' launch ',glyph('B','pad'),' close'));
  root.append(card,flightStats,perch,toast,menu);document.body.append(root);

  // ---- the map, drawn once from the world
  const pts=[...places.map(p=>p.arrive_xy_m),...course.control_xy_m];
  const pad=1400,x0=Math.min(...pts.map(p=>p[0]))-pad,x1=Math.max(...pts.map(p=>p[0]))+pad,y0=Math.min(...pts.map(p=>p[1]))-pad,y1=Math.max(...pts.map(p=>p[1]))+pad;
  const W=1200,H=Math.round(W*(y1-y0)/(x1-x0)),scale=(x1-x0)/W;
  const toPx=([x,y])=>[(x-x0)/scale,(y1-y)/scale],toWorld=(px,py)=>[x0+px*scale,y1-py*scale];
  let drawn=null;
  function draw(){
    const c=el('canvas',{width:W,height:H,className:'map-canvas'}),g=c.getContext('2d'),img=g.createImageData(W,H),d=img.data;
    const h=new Float32Array(W*H);for(let j=0;j<H;j++)for(let i=0;i<W;i++){const [x,y]=toWorld(i+.5,j+.5);h[j*W+i]=ground.height(x,y)??0;}
    const wood=new Float32Array(W*H);for(const [x,y] of trees){const [i,j]=toPx([x,y]).map(Math.floor);if(i>=0&&j>=0&&i<W&&j<H)wood[j*W+i]+=1;}
    const soft=new Float32Array(W*H);for(let j=1;j<H-1;j++)for(let i=1;i<W-1;i++){let s=0;for(let b=-1;b<=1;b++)for(let a=-1;a<=1;a++)s+=wood[(j+b)*W+i+a];soft[j*W+i]=s;}
    const paper=[233,236,221],woodland=[191,211,160],rock=[214,208,192],snow=[248,249,246],contour=[154,107,60];
    for(let j=1;j<H-1;j++)for(let i=1;i<W-1;i++){
      const k=j*W+i,dx=(h[k+1]-h[k-1])/(2*scale),dy=(h[k-W]-h[k+W])/(2*scale),slope=Math.hypot(dx,dy);
      let c3=paper;if(soft[k]>0)c3=woodland;if(slope>.75&&soft[k]===0)c3=rock;
      const [x,y]=toWorld(i+.5,j+.5);if(snowAt(x,y)>.03)c3=snow;
      // Relief from the north-west, kept faint: the map's job is reading, not drama.
      const light=Math.max(.72,Math.min(1.08,1+(-dx*.55+dy*.55)/Math.hypot(1,slope)*.32));
      let col=c3.map(v=>v*light);
      const band=Math.floor(h[k]/100),index=Math.floor(h[k]/500);
      if(band!==Math.floor(h[k+1]/100)||band!==Math.floor(h[k+W]/100)){const strong=index!==Math.floor(h[k+1]/500)||index!==Math.floor(h[k+W]/500);col=col.map((v,n)=>v+(contour[n]-v)*(strong?.75:.4));}
      d[k*4]=col[0];d[k*4+1]=col[1];d[k*4+2]=col[2];d[k*4+3]=255;
    }
    g.putImageData(img,0,0);
    const line=(path,w,colour,dash=[])=>{g.beginPath();path.forEach((p,n)=>{const [px,py]=toPx(p);n?g.lineTo(px,py):g.moveTo(px,py);});g.lineWidth=w;g.strokeStyle=colour;g.setLineDash(dash);g.lineJoin=g.lineCap='round';g.stroke();g.setLineDash([]);};
    // Water: the block's river, its reaches past the block, the lake.
    const river=worldmap.water.bodies.find(b=>b.id==='river'),lake=worldmap.water.bodies.find(b=>b.id==='lake');
    for(const r of worldmap.mountains?.enclosure?.river_reaches??[])line(r.polyline_xyz_m,4,'#3e7fa8');
    if(river)line(river.polyline,4,'#3e7fa8');
    if(lake){const [lx,ly]=toPx(lake.centre_xy_m);g.beginPath();g.ellipse(lx,ly,lake.size_m[0]/2/scale,lake.size_m[1]/2/scale,0,0,Math.PI*2);g.fillStyle='#9cc4dd';g.fill();g.strokeStyle='#3e7fa8';g.lineWidth=1.5;g.stroke();}
    // The parakite route, as a trail is printed: red dashes.
    line(course.control_xy_m,3,'#c2302a',[9,6]);
    drawn=c;return c;
  }

  // ---- markers and the layout of the sheet
  const sheet=el('div',{className:'sheet'}),frame=el('div',{className:'map-frame'}),markers=el('div',{className:'markers'});
  const cartouche=el('div',{className:'cartouche'},el('h2',{textContent:'Tumbler valley'}),el('p',{className:'cartouche-time'}));
  const scaleBar=el('div',{className:'scale-bar'},el('span',{className:'scale-rule'}),el('span',{textContent:'2 km'}));
  const north=el('div',{className:'north',ariaHidden:'true'},el('span',{textContent:'N'}));
  const side=el('div',{className:'map-side'});
  const viewButtons=['Map','Scene'].map(label=>el('button',{type:'button',textContent:label,onclick:()=>setScene(label==='Scene')}));
  const viewToggle=el('div',{className:'view-toggle',role:'group',ariaLabel:'Map or the valley itself'},...viewButtons);
  frame.append(markers,cartouche,scaleBar,north,viewToggle);sheet.append(frame,side);
  const controlsSheet=el('div',{className:'controls-sheet',hidden:true});
  menu.append(sheet,controlsSheet);
  const here=el('div',{className:'you-are-here',ariaHidden:'true'},el('span',{className:'here-ring'}),el('span',{className:'here-label',textContent:'You are here'}));
  const placeMarkers=places.map(p=>{
    const b=el('button',{className:`place place-${p.kind}`,type:'button'},el('span',{className:'place-dot'}),el('span',{className:'place-name',textContent:p.label}));
    b.addEventListener('click',()=>{if(selected===p)travel();else select(p);});
    return [p,b];
  });
  markers.append(...placeMarkers.map(([,b])=>b),here);
  const launchMark=el('span',{className:'launch-mark',title:launch.label,ariaHidden:'true'});markers.append(launchMark);
  // On the paper a mark sits at its map pixel; over the scene it sits where the camera sees that ground.
  const v=new T.Vector3();
  function layout(){
    const r=frame.getBoundingClientRect(),k=r.width/W,c=canvas.getBoundingClientRect();
    const put=(node,xy,z)=>{
      if(!sceneShown()){const [px,py]=toPx(xy);node.style.left=`${px*k}px`;node.style.top=`${py*k}px`;return;}
      v.set(xy[0],z??ground.height(xy[0],xy[1])??0,-xy[1]).project(camera);
      node.style.left=`${c.left+(v.x+1)/2*c.width-r.left}px`;node.style.top=`${c.top+(1-v.y)/2*c.height-r.top}px`;
    };
    for(const [p,b] of placeMarkers)put(b,p.arrive_xy_m);
    put(launchMark,launch.xy_m);
    const s=navigation.state;if(s&&navigation.mode!=='orbit'){here.hidden=false;put(here,[s.x,s.y],s.z);}else here.hidden=true;
    scaleBar.querySelector('.scale-rule').style.width=`${2000/scale*k}px`;
  }

  // ---- state
  let open=false,sheetName='map',scene=false,panning=false,baseFog=null,selected=places.find(p=>p.id==='tree-village')??places[0];
  const sceneShown=()=>open&&scene&&sheetName==='map';
  // The scene view shows the valley at the time a journey arrives at; anywhere else, the time it is.
  let shownLight=null;
  function syncLight(){const want=sceneShown()?nextTimeOfDay():timeOfDay();if(want!==shownLight){shownLight=want;showLight(want);}}

  // ---- the scene view: the game camera straight overhead, north up, framing the same ground the
  // paper shows. Height comes from the frame's metres-per-pixel at the places' mean ground height.
  const groundRef=places.reduce((a,p)=>a+(ground.height(...p.arrive_xy_m)??0),0)/places.length;
  const DOWN=new T.Quaternion().setFromEuler(new T.Euler(-Math.PI/2,0,0));  // looking down, screen top is north
  function setScene(on){scene=on;viewButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String((i===1)===on)));
    menu.classList.toggle('scene',sceneShown());if(open){syncLight();hold();layout();}}
  /** Called every frame after navigation moves the camera: holds the overhead view while it is shown,
   * and lifts the fog with the camera's height until the pan down has landed. */
  function hold(){
    if(sceneShown()){
      const r=frame.getBoundingClientRect(),c=canvas.getBoundingClientRect(),s=r.width/(x1-x0);
      camera.fov=62;camera.updateProjectionMatrix();
      const f=c.height/2/Math.tan(camera.fov*Math.PI/360),ox=r.left+r.width/2-(c.left+c.width/2),oy=r.top+r.height/2-(c.top+c.height/2);
      camera.position.set((x0+x1)/2-ox/s,groundRef+f/s,-((y0+y1)/2+oy/s));camera.quaternion.copy(DOWN);camera.updateMatrixWorld();
      layout();
    }
    if(panning&&!navigation.shotActive)panning=false;
    if(sceneShown()||panning){
      baseFog??={near:fog.near,far:fog.far};
      const k=Math.max(1,(camera.position.y-(ground.height(camera.position.x,-camera.position.z)??0))/500);
      fog.near=baseFog.near*k;fog.far=baseFog.far*k;
    }else if(baseFog){fog.near=baseFog.near;fog.far=baseFog.far;baseFog=null;}
  }
  // From the overhead view down to him: one straight, eased glide into the live chase view.
  function panDown(from){
    if(navigation.mode!=='walk')return;
    navigation.glideFrom(from,DOWN,4);panning=navigation.shotActive;
  }
  function leave(){const from=sceneShown()?camera.position.clone():null;close();if(from)panDown(from);}
  function select(p){selected=p;for(const [q,b] of placeMarkers)b.setAttribute('aria-current',String(q===p));renderSide();}
  function nearestTo(){const s=navigation.state;if(!s)return selected;return places.reduce((a,p)=>Math.hypot(p.arrive_xy_m[0]-s.x,p.arrive_xy_m[1]-s.y)<Math.hypot(a.arrive_xy_m[0]-s.x,a.arrive_xy_m[1]-s.y)?p:a);}
  function renderSide(){
    const actions=[el('button',{type:'button',className:'action action-primary',onclick:travel},'Travel to ',selected.label),
      el('button',{type:'button',className:'action',onclick:()=>{close();startParakite();}},'Fly the parakite from North Wall'),
      el('button',{type:'button',className:'action',onclick:()=>{close();startParakite('tumble-hill');}},'Fly the parakite from Tumble Hill')];
    if(learnParakite&&navigation.mode==='walk')actions.push(el('button',{type:'button',className:'action',onclick:()=>{
      close();if(!learnParakite())notice('Look for Juno on open ground.');
    }},'Learn parakiting with Juno'));
    side.replaceChildren(el('h3',{className:`side-name side-${selected.kind}`,textContent:selected.label}),el('p',{className:'side-about',textContent:selected.about}),
      el('div',{className:'actions'},...actions),legend(MENU_CONTROLS.map,{caption:'This map'}));
  }
  function notice(text){toast.replaceChildren(el('span',{className:'notice',textContent:text}));toast.classList.remove('shown');void toast.offsetWidth;toast.classList.add('shown');
  }
  function renderControls(){
    controlsSheet.replaceChildren(el('h2',{className:'controls-title',textContent:'Controls'}),
      el('div',{className:'controls-grid'},...['walk','stair','parakite'].map(m=>el('div',{className:'controls-group'},el('h3',{textContent:CONTROLS[m].title}),legend(CONTROLS[m].rows)))),
      legend(MENU_CONTROLS.controls,{caption:'This page'}));
  }
  function show(name){sheetName=name;sheet.hidden=name!=='map';controlsSheet.hidden=name!=='controls';menu.classList.toggle('scene',sceneShown());syncLight();if(name==='controls')renderControls();else{renderSide();hold();layout();}}
  function openMenu(){
    if(open||navigation.suspended)return;open=true;navigation.suspend(true);shownLight=timeOfDay();
    if(!drawn)frame.prepend(draw());
    menu.hidden=false;document.body.dataset.menu='open';cartouche.querySelector('.cartouche-time').textContent=TIME_LABELS[nextTimeOfDay()]??'';
    setScene(scene);select(nearestTo());show('map');requestAnimationFrame(()=>{hold();layout();});
  }
  function close(restoreLight=true){if(!open)return;open=false;menu.hidden=true;menu.classList.remove('scene');delete document.body.dataset.menu;navigation.suspend(false);canvas.focus();if(restoreLight)syncLight();}
  function travel(){const p=selected,from=sceneShown()?camera.position.clone():null;close(false);arriveAt(p);shownLight=timeOfDay();arrived(p);if(from)panDown(from);}
  function arrived(p){toast.replaceChildren(el('strong',{textContent:p.label}),el('span',{textContent:TIME_LABELS[timeOfDay()]??''}));toast.classList.remove('shown');void toast.offsetWidth;toast.classList.add('shown');}
  function move(dx,dy){
    // The nearest place in the direction pressed, weighting distance by how far off the line it lies.
    const [sx,sy]=selected.arrive_xy_m;let best=null,score=Infinity;
    for(const p of places){if(p===selected)continue;const vx=p.arrive_xy_m[0]-sx,vy=p.arrive_xy_m[1]-sy,dist=Math.hypot(vx,vy),cos=(vx*dx+vy*dy)/dist;
      if(cos<.35)continue;const s=dist*(2-cos);if(s<score){score=s;best=p;}}
    if(best)select(best);
  }
  window.addEventListener('resize',()=>{if(open){hold();layout();}});

  // ---- the key card while playing
  // The card shows in full when an activity starts, then folds to where the map and all controls are,
  // so it is there when needed and out of the view the rest of the time.
  let cardKey='',foldTimer=0;
  const folded=()=>el('div',{className:'card-folded'},el('span',{textContent:'Map and all controls'}),el('span',{className:'control-keys'},glyph('Esc','key'),glyph('M','key')),el('span',{className:'control-pad'},glyph('Menu','pad')));
  function cardState(){if(navigation.mode==='gondola')return 'gondola';if(navigation.mode==='walk'&&navigation.state?.mode==='stair')return 'stair';if(navigation.mode==='paramotor'&&navigation.state?.grounded&&!navigation.state?.launching)return 'harness';return CONTROLS[navigation.mode]?navigation.mode:null;}
  function renderCard(){const k=cardState();if(k===cardKey)return;cardKey=k;card.hidden=!k;clearTimeout(foldTimer);if(!k)return;
    card.classList.remove('folded');card.replaceChildren(el('h3',{textContent:CONTROLS[k].title}),legend(CONTROLS[k].rows));
    foldTimer=setTimeout(()=>{if(cardKey===k){card.classList.add('folded');card.replaceChildren(el('h3',{textContent:CONTROLS[k].title}),folded());}},12000);}

  // ---- the crown perch prompt
  // Shown on arriving at a launch perch, faded after a few seconds. The number keys launch at any
  // time on the perch; on a controller the D-pad picks a mode (the one X launches, through the
  // navigation's own tree launch) and wakes the prompt, and B puts it away.
  let perched=false,perchFade=0;
  const perchedNow=()=>navigation.mode==='walk'&&navigation.state?.mode==='climb'&&!!navigation.state.launchReady;
  function wakePerch(){perch.hidden=false;perch.classList.remove('faded');clearTimeout(perchFade);perchFade=setTimeout(()=>perch.classList.add('faded'),5000);}
  function sleepPerch(){perch.hidden=true;clearTimeout(perchFade);}
  function renderPerch(pad,edge){
    const now=active()&&!open&&perchedNow();
    if(now!==perched){perched=now;now?wakePerch():sleepPerch();}
    if(!now)return;
    const chosen=Math.max(0,PERCH_MODES.findIndex(([m])=>m===navigation.preferredFlightMode));
    perch.classList.toggle('pad',!!pad);
    perchRows.forEach((row,i)=>row.classList.toggle('chosen',!!pad&&i===chosen));
    if(!pad)return;
    const step=edge(12)?-1:edge(13)?1:0;
    if(step){navigation.preferredFlightMode=PERCH_MODES[(chosen+step+PERCH_MODES.length)%PERCH_MODES.length][0];wakePerch();}
    if(edge(1))sleepPerch();
  }

  let nextStats=0;
  function renderFlightStats(now){
    const host=flightStatsDock?.()??root;
    if(flightStats.parentElement!==host){host.append(flightStats);nextStats=0;}
    const flight=navigation.state;
    const show=active()&&!open&&navigation.view==='chase'&&paraModes.has(navigation.mode)&&flight&&!flight.grounded;
    if(!show){flightStats.hidden=true;nextStats=0;return;}
    if(now<nextStats)return;
    nextStats=now+125;
    const agl=flight.z-navigation.sampleFloor(flight.x,flight.y);
    const vario=flight.vario??0;
    const pressure=flight.rotation?.pressure;
    const readings=[`${Math.round(flight.speed*3.6)} km/h`,`${Math.round(flight.groundSpeed*3.6)} km/h`,
      `${Math.max(0,Math.round(agl))} m`,`${vario>0?'+':''}${vario.toFixed(1)} m/s`,`${flight.load.toFixed(1)} g`,
      pressure?`${Math.round(pressure[1]*100)}% L · ${Math.round(pressure[0]*100)}% R`:null];
    [...statRows.values()].forEach(({row,value},i)=>{
      row.hidden=readings[i]===null;
      if(!row.hidden&&value.textContent!==readings[i])value.textContent=readings[i];
    });
    flightStats.hidden=false;
  }

  // ---- input
  const active=()=>document.body.dataset.uiMode==='player';
  window.addEventListener('keydown',e=>{
    if(!active()||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.metaKey||e.ctrlKey)return;
    if(!open&&/^Digit[123]$/.test(e.code)&&!e.repeat&&perchedNow()){e.preventDefault();navigation.launchFromTree(PERCH_MODES[e.code.at(-1)-1][0]);return;}
    if(!open){if((e.key==='Escape'||e.code==='KeyM')&&!e.repeat){e.preventDefault();openMenu();}return;}
    e.preventDefault();e.stopImmediatePropagation();
    if(e.key==='Escape'){leave();return;}
    if(e.code==='Tab'){show(sheetName==='map'?'controls':'map');return;}
    if(sheetName!=='map')return;
    const dir={ArrowUp:[0,1],KeyW:[0,1],ArrowDown:[0,-1],KeyS:[0,-1],ArrowLeft:[-1,0],KeyA:[-1,0],ArrowRight:[1,0],KeyD:[1,0]}[e.code];
    if(dir)move(...dir);else if(e.key==='Enter')travel();else if(e.code==='KeyV')setScene(!scene);else if(e.code==='KeyL'){close();startParakite();}else if(e.code==='KeyH'){close();startParakite('tumble-hill');}
  },true);
  const held=new Set();let stickReady=true;
  function poll(now){
    renderCard();
    renderFlightStats(now);
    if(active()){
      const pad=[...(navigator.getGamepads?.()??[])].find(p=>p?.connected);
      const edge=i=>{const now=!!pad?.buttons[i]?.pressed,was=held.has(i);now?held.add(i):held.delete(i);return now&&!was;};
      const menuButton=edge(9);
      if(!open){if(menuButton)openMenu();else renderPerch(pad,edge);}
      else{
        if(menuButton||edge(1))leave();
        else if(sheetName==='map'){
          const ax=pad?.axes[0]??0,ay=pad?.axes[1]??0,stick=Math.hypot(ax,ay)>.6;
          if(stick&&stickReady){move(ax,-ay);stickReady=false;}else if(!stick)stickReady=true;
          if(edge(12))move(0,1);if(edge(13))move(0,-1);if(edge(14))move(-1,0);if(edge(15))move(1,0);
          if(edge(0))travel();else if(edge(3)){close();startParakite();}else if(edge(2)){close();startParakite('tumble-hill');}else if(edge(5))show('controls');else if(edge(4))setScene(!scene);
        }else if(edge(4))show('map');
      }
    }
    if(!active()||open)renderPerch(null,()=>false);
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);
  return {open:openMenu,close,arrived,hold,get isOpen(){return open;},select:id=>select(places.find(p=>p.id===id))};
}
