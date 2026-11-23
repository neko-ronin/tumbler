/** Stills of what the player sees first and of every Look around viewpoint, for the pre-merge placement review.
 * NODE_PATH=<existing node_modules> CHROME_PATH=<chromium> timeout -k 10 480 node client/web/tools/review-placement.cjs <label>
 * TUMBLER_REVIEW_URL picks the server (default 8046); writes <REVIEW_OUT or output/playwright/placement>/<label>-<view>.png
 * and <label>.json (the spawn pose and any page errors). REVIEW_VIEWS=a,b limits the viewpoints.
 *  - spawn: the first load as a player gets it: the opening tour lands on the chase view (navigator.webdriver enters
 *    without a gesture), 12 s after the page is ready;
 *  - every button in "Places to pause" (shared/play/places.json), framed by the development UI, light held at golden.
 * Exits on every path, with its own deadline, like review-water.cjs.
 */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const label=process.argv[2]||'candidate',out=path.resolve(process.env.REVIEW_OUT||'output/playwright/placement');fs.mkdirSync(out,{recursive:true});
(async()=>{
 setTimeout(()=>{console.error('review-placement: no result after seven minutes');process.exit(3);},420000).unref();
 const report={label,views:[],errors:[]},errors=report.errors;let browser;
 try{
  browser=await chromium.launch({headless:false,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
  await page.goto((process.env.TUMBLER_REVIEW_URL||'http://127.0.0.1:8046')+'/client/web/scene.html');
  await page.waitForFunction(()=>window.tumbler&&document.body.classList.contains('ready'),null,{timeout:240000});
  await page.waitForTimeout(12000);
  await page.screenshot({path:`${out}/${label}-spawn.png`});
  report.spawn=await page.evaluate(()=>{const s=tumbler.navigation.state;return s&&{x:s.x,y:s.y,z:s.z,heading:s.heading};});
  const ids=await page.evaluate(()=>[...document.querySelectorAll('button[data-view]')].map(b=>b.dataset.view));
  const chosen=process.env.REVIEW_VIEWS?process.env.REVIEW_VIEWS.split(','):ids;
  for(const id of ids.filter(i=>chosen.includes(i))){
   await page.evaluate(id=>{tumbler.setLight?.('golden');document.querySelector(`button[data-view="${id}"]`).click();},id);
   await page.waitForTimeout(3500);
   await page.screenshot({path:`${out}/${label}-${id}.png`});
   report.views.push(id);
  }
 }catch(e){errors.push(e.message);console.error(e);}
 fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,1));
 console.log(JSON.stringify({views:report.views.length,spawn:report.spawn,errors:errors.length}));
 if(browser)await Promise.race([browser.close(),new Promise(r=>setTimeout(r,5000))]);
 process.exit(errors.length||!report.views.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
