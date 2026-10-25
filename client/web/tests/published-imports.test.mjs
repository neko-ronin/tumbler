import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// The published game fetches only what viewer.json lists. Every module the
// page imports, transitively from main.js, must be listed, or it 404s live.
test('every module the game imports is in the published manifest',()=>{
 const repo=fileURLToPath(new URL('../../../',import.meta.url));
 const fetched=new Set(JSON.parse(readFileSync(path.join(repo,'client/web/data/viewer.json'))).fetched.map(e=>e.path));
 const seen=new Set(),queue=['client/web/src3d/main.js'];
 while(queue.length){
  const file=queue.pop();if(seen.has(file))continue;seen.add(file);
  for(const [,spec] of readFileSync(path.join(repo,file),'utf8').matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+\.js)['"]/g)){
   const target=path.relative(repo,path.resolve(path.dirname(path.join(repo,file)),spec)).split(path.sep).join('/');
   if(existsSync(path.join(repo,target)))queue.push(target);
  }
 }
 const missing=[...seen].filter(file=>!fetched.has(file)).sort();
 assert.deepEqual(missing,[],'imported by the game but not published');
});
