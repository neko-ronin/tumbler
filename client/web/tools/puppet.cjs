/* Dev puppet: drive the real player character along a route in the running game and report whether it got there.
 *
 *   NODE_PATH=<playwright> TUMBLER_REVIEW_URL=http://127.0.0.1:8170 node client/web/tools/puppet.cjs <route.json> [out-dir]
 *
 * The route is {name, waypoints: [[x, y], ...] (world metres, x east, y north), reach_m?, run?, timeout_s?,
 * shots?: [waypoint indices], expect?: {max_phase?: 'steady'|'stumble', above?: [{centre_xy_m, dir_xy, half_m, across_m,
 * z_m, slack_m}]}}: a footprint (a deck) the walker must not drop below.
 * The cat is placed on foot at the first waypoint and steered toward each next one through navigation.puppet, so
 * it walks with exactly a player's walking, balance (footing), collision, decks and stairs; nothing is teleported
 * after the start. Every frame is logged (position, height, mode, balance phase and budget, surface). The game's
 * own chase camera is captured at the listed waypoints, so the render is checked on the same run.
 *
 * PUPPET_EVAL=<page expression> is run when the route ends and its result recorded in the report.
 * Writes <out>/<name>.json (verdict, phase counts, the worst moments, a 5 Hz trace) and <out>/<name>-<k>.png.
 * Exit 0 when the route passes: every waypoint reached in time, no balance phase past `max_phase` (default
 * 'stumble': no trip, tumble, slide or roll), and every `above` footprint kept at or over its height.
 */
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const route=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out=path.resolve(process.argv[3]||'output/puppet');fs.mkdirSync(out,{recursive:true});
const url=(process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html';
const ORDER=['steady','stumble','trip','tumble','slide','recover','roll'];

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:['--use-angle=metal','--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  await page.evaluate(r=>{
    const t=tumbler,[x,y]=r.waypoints[0],[nx,ny]=r.waypoints[1];
    t.arriveAt({arrive_xy_m:[x,y],facing_deg:Math.atan2(nx-x,ny-y)*180/Math.PI},{passesTime:false});
    const reach=r.reach_m??1.2,log=[],start=performance.now();let i=1;
    window.puppetRun={log,done:false,reached:0,i:()=>i};
    t.navigation.puppet=s=>{
      if(window.puppetRun.done)return null;
      let [wx,wy]=r.waypoints[i];
      while(Math.hypot(wx-s.x,wy-s.y)<reach){window.puppetRun.reached=i;if(++i>=r.waypoints.length){window.puppetRun.done=true;return null;}[wx,wy]=r.waypoints[i];}
      const d=Math.hypot(wx-s.x,wy-s.y);return {x:(wx-s.x)/d,y:(wy-s.y)/d,run:!!r.run};
    };
    const tick=()=>{
      const s=t.navigation.state;
      if(s)log.push([+((performance.now()-start)/1000).toFixed(3),+s.x.toFixed(2),+s.y.toFixed(2),+s.z.toFixed(2),s.mode??'walk',s.balance?.phase??'steady',+(s.balance?.budget??1).toFixed(3),t.ride.surfaceAt(s.x,s.y),i]);
      if(!window.puppetRun.done)requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },route);
  // PUPPET_START: a page expression run as the walk begins (e.g. keep swinging the katana while running).
  if(process.env.PUPPET_START)await page.evaluate(src=>(0,eval)(src),process.env.PUPPET_START);
  const shots=new Set(route.shots??[]),taken=new Set(),limit=(route.timeout_s??90)*1000,t0=Date.now();
  let last=null,since=Date.now(),stuck=null;
  for(;;){
    await page.waitForTimeout(200);
    const p=await page.evaluate(()=>({done:puppetRun.done,i:puppetRun.i(),at:puppetRun.log.at(-1)}));
    for(const k of shots)if(!taken.has(k)&&p.i>k){taken.add(k);await page.screenshot({path:path.join(out,`${route.name}-${k}.png`)});}
    if(p.done)break;
    if(process.env.PUPPET_VERBOSE)console.error('waypoint',p.i,p.at?.slice(1,6).join(' '));
    const here=p.at&&[p.at[1],p.at[2]];
    if(!last||Math.hypot(here[0]-last[0],here[1]-last[1])>.3){last=here;since=Date.now();}
    if(Date.now()-since>5000){stuck=`no progress for 5 s at ${here} toward waypoint ${p.i}`;break;}
    if(Date.now()-t0>limit){stuck=`timed out at waypoint ${p.i}/${route.waypoints.length-1}`;break;}
  }
  // PUPPET_ACT: a page expression run as the route ends, before the settle and the last shot (e.g. swing the katana).
  if(process.env.PUPPET_ACT)await page.evaluate(src=>(0,eval)(src),process.env.PUPPET_ACT);
  // PUPPET_SETTLE_MS: wait after the route ends before the last shot (e.g. for something to fade in).
  if(process.env.PUPPET_SETTLE_MS)await page.waitForTimeout(Number(process.env.PUPPET_SETTLE_MS));
  await page.screenshot({path:path.join(out,`${route.name}-end.png`)});
  // PUPPET_EVAL: a page expression run once the route ends (e.g. what the world did in reply); its result goes in the report.
  const evalResult=process.env.PUPPET_EVAL?await page.evaluate(src=>(0,eval)(src),process.env.PUPPET_EVAL):undefined;
  const log=await page.evaluate(()=>{tumbler.navigation.puppet=null;puppetRun.done=true;return JSON.stringify(puppetRun.log);}).then(JSON.parse);
  // A busy GPU process can hold close() open; the verdict does not wait on it.
  await Promise.race([browser.close(),new Promise(done=>setTimeout(done,5000))]);

  const counts={};for(const f of log)counts[f[5]]=(counts[f[5]]??0)+1;
  const allowed=ORDER.indexOf(route.expect?.max_phase??'stumble');
  const fall=log.find(f=>ORDER.indexOf(f[5])>allowed);
  const lowBudget=log.reduce((a,f)=>f[6]<a[6]?f:a,log[0]);
  const reached=!stuck&&log.length>0;
  const under=[];
  // A footprint ({centre_xy_m, dir_xy, half_m, across_m}: a deck's) inside which the walker must stay at z_m or above.
  for(const a of route.expect?.above??[]){
    const [cx,cy]=a.centre_xy_m,[ux,uy]=a.dir_xy;
    for(const f of log){const dx=f[1]-cx,dy=f[2]-cy;if(Math.abs(dx*ux+dy*uy)<a.half_m&&Math.abs(dx*uy-dy*ux)<a.across_m&&f[3]<a.z_m-(a.slack_m??.3)){under.push({footprint:a,frame:f});break;}}
  }
  const verdict={route:route.name,pass:reached&&!fall&&!under.length&&!errors.length,reached,stuck,
    first_loss_of_footing:fall??null,lowest_budget:lowBudget,below:under,phase_frames:counts,frames:log.length,
    seconds:log.at(-1)?.[0],page_errors:errors,...(evalResult!==undefined?{eval:process.env.PUPPET_EVAL,evalResult}:{}),columns:['t_s','x','y','z','mode','phase','budget','surface','waypoint'],
    trace:log.filter((_,k)=>k%12===0)};
  fs.writeFileSync(path.join(out,`${route.name}.json`),JSON.stringify(verdict,null,1));
  console.log(JSON.stringify({route:route.name,pass:verdict.pass,reached,stuck,first_loss_of_footing:fall,lowest_budget:lowBudget,phase_frames:counts,below:under.length,seconds:verdict.seconds,errors:errors.length}));
  process.exit(verdict.pass?0:1);  // also ends a browser that would not close
})().catch(e=>{console.error(e);process.exit(2);});
