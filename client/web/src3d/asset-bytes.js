/** Lossless delivery for models larger than the static host's per-file limit.
 * Local servers return the original GLB. Packaged builds may return a small
 * descriptor; the caller still hashes and parses the original assembled bytes. */
export const ASSET_PARTS_MAGIC='TUMBLER_ASSET_PARTS_V1\n';
export async function fetchAssetBytes(path,root,fetcher=fetch){
  const read=async rel=>{const response=await fetcher(new URL(rel,root),{cache:'no-cache'});if(!response.ok)throw new Error(`${rel}: HTTP ${response.status}`);return response.arrayBuffer();};
  const bytes=await read(path),prefix=new TextDecoder().decode(new Uint8Array(bytes,0,Math.min(bytes.byteLength,ASSET_PARTS_MAGIC.length)));
  if(!path.endsWith('.glb')||prefix!==ASSET_PARTS_MAGIC)return bytes;
  const invalid=()=>new Error(`Invalid packaged model descriptor: ${path}`);
  if(bytes.byteLength>65536)throw invalid();
  let descriptor;try{descriptor=JSON.parse(new TextDecoder().decode(bytes).slice(ASSET_PARTS_MAGIC.length));}catch{throw invalid();}
  if(!Number.isSafeInteger(descriptor?.byteLength)||descriptor.byteLength<=0||descriptor.byteLength>512*1024*1024||!Array.isArray(descriptor.parts)||descriptor.parts.length<1||descriptor.parts.length>64)throw invalid();
  let total=0;for(const [i,part]of descriptor.parts.entries()){
    if(part.path!==path.replace(/\.glb$/,`.part-${String(i).padStart(3,'0')}.glb`)||!Number.isSafeInteger(part.byteLength)||part.byteLength<=0||part.byteLength>25*1024*1024)throw invalid();
    total+=part.byteLength;
  }
  if(total!==descriptor.byteLength)throw invalid();
  const result=new Uint8Array(total);let offset=0;
  for(const part of descriptor.parts){const chunk=await read(part.path);if(chunk.byteLength!==part.byteLength)throw new Error(`Truncated packaged model part: ${part.path}`);result.set(new Uint8Array(chunk),offset);offset+=chunk.byteLength;}
  return result.buffer;
}
