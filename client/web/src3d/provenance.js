/** Byte identity, independent of JSON spelling or a Git label. */
export const WORLDMAP_VERSION=3;
export async function sha256(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
export function checkVersion(value,known,label){if(!Number.isInteger(value?.version)||value.version>known||value.version<1)throw new Error(`${label}: unsupported version ${value?.version}`);}
// Checks the bytes the page actually loaded through fetchData, and only those: never
// downloads a file just to hash it. Modules and the loading art the browser fetches
// itself are checked at publish (package_web.verified_files), not here.
export async function verifyFetched(entries,observed){
  const expected=new Map(entries.map(e=>[e.path,e.sha256]));
  for(const [path,digest] of observed){
    if(!expected.has(path))throw new Error(`World data changed: ${path} is not in viewer data. Regenerate viewer data and reload.`);
    if(await digest!==expected.get(path))throw new Error(`World data changed: ${path}. Regenerate viewer data and reload.`);
  }
  return observed.size;
}
