/** Lossless delivery for files larger than the static host's per-file limit:
 * models, the world's 8 m ground, its forest. Local servers return the original
 * file. Packaged builds may return a small descriptor; the caller still hashes
 * and parses the original assembled bytes. */
const partPath=(path,i)=>path.replace(/(\.[A-Za-z0-9]+)$/,`.part-${String(i).padStart(3,'0')}$1`);
export const ASSET_PARTS_MAGIC='TUMBLER_ASSET_PARTS_V1\n';
export async function fetchAssetBytes(path,root,fetcher=fetch){
  const read=async rel=>{const response=await fetcher(new URL(rel,root),{cache:'no-cache'});if(!response.ok)throw new Error(`${rel}: HTTP ${response.status}`);return response.arrayBuffer();};
  const bytes=await read(path),prefix=new TextDecoder().decode(new Uint8Array(bytes,0,Math.min(bytes.byteLength,ASSET_PARTS_MAGIC.length)));
  if(prefix!==ASSET_PARTS_MAGIC)return bytes;
  const invalid=()=>new Error(`Invalid packaged file descriptor: ${path}`);
  if(bytes.byteLength>65536)throw invalid();
  let descriptor;try{descriptor=JSON.parse(new TextDecoder().decode(bytes).slice(ASSET_PARTS_MAGIC.length));}catch{throw invalid();}
  if(!Number.isSafeInteger(descriptor?.byteLength)||descriptor.byteLength<=0||descriptor.byteLength>512*1024*1024||!Array.isArray(descriptor.parts)||descriptor.parts.length<1||descriptor.parts.length>64)throw invalid();
  let total=0;for(const [i,part]of descriptor.parts.entries()){
    if(part.path!==partPath(path,i)||!Number.isSafeInteger(part.byteLength)||part.byteLength<=0||part.byteLength>25*1024*1024)throw invalid();
    total+=part.byteLength;
  }
  if(total!==descriptor.byteLength)throw invalid();
  const result=new Uint8Array(total);let offset=0;
  for(const part of descriptor.parts){const chunk=await read(part.path);if(chunk.byteLength!==part.byteLength)throw new Error(`Truncated packaged file part: ${part.path}`);result.set(new Uint8Array(chunk),offset);offset+=chunk.byteLength;}
  return result.buffer;
}
