import test from 'node:test';import assert from 'node:assert/strict';
import {fetchAssetBytes,ASSET_PARTS_MAGIC} from '../src3d/asset-bytes.js';
import {sha256,verifyFetched} from '../src3d/provenance.js';
const root=new URL('https://fixture.invalid/'),path='shared/tree.glb',raw=Uint8Array.from([103,108,84,70,1,2,3,4]);
const parts=[{path:'shared/tree.part-000.glb',byteLength:4},{path:'shared/tree.part-001.glb',byteLength:4}],descriptor={byteLength:8,parts};
const encoded=d=>ASSET_PARTS_MAGIC+JSON.stringify(d),requests=[];
const fetcher=files=>async url=>{requests.push(url.pathname);const data=files[url.pathname.slice(1)];return new Response(data??null,{status:data===undefined?404:200});};
const packaged=d=>({[path]:encoded(d),[parts[0].path]:raw.slice(0,4),[parts[1].path]:raw.slice(4)});
test('raw local GLBs and JSON retain byte identity without extra requests',async()=>{requests.length=0;assert.deepEqual(new Uint8Array(await fetchAssetBytes(path,root,fetcher({[path]:raw}))),raw);assert.deepEqual(requests,['/'+path]);});
test('packaged parts reconstruct the exact model and pass the existing integrity gate',async()=>{const bytes=await fetchAssetBytes(path,root,fetcher(packaged(descriptor)));assert.deepEqual(new Uint8Array(bytes),raw);assert.equal(await verifyFetched([{path,sha256:await sha256(raw)}],new Map(),()=>bytes),1);});
test('missing or truncated parts stop loading; corruption still fails the original hash',async()=>{
 const missing=packaged(descriptor);delete missing[parts[1].path];await assert.rejects(fetchAssetBytes(path,root,fetcher(missing)),/HTTP 404/);
 const truncated=packaged(descriptor);truncated[parts[1].path]=raw.slice(5);await assert.rejects(fetchAssetBytes(path,root,fetcher(truncated)),/Truncated/);
 const corrupt=packaged(descriptor);corrupt[parts[1].path]=new Uint8Array(4);const bytes=await fetchAssetBytes(path,root,fetcher(corrupt));await assert.rejects(verifyFetched([{path,sha256:await sha256(raw)}],new Map(),()=>bytes),/World data changed/);
});
test('descriptors cannot redirect fetches or allocate from inconsistent metadata',async()=>{
 for(const d of [{...descriptor,byteLength:9},{...descriptor,byteLength:Infinity},{...descriptor,parts:[]},{...descriptor,parts:[{path:'https://elsewhere.invalid/tree.glb',byteLength:8}]},{...descriptor,parts:[{path:'../tree.glb',byteLength:8}]}]){requests.length=0;await assert.rejects(fetchAssetBytes(path,root,fetcher(packaged(d))),/Invalid packaged/);assert.deepEqual(requests,['/'+path]);}
});
