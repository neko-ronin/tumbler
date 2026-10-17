/** Byte identity, independent of JSON spelling or a Git label. */
export async function sha256(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
export function checkVersion(value,known,label){if(!Number.isInteger(value?.version)||value.version>known||value.version<1)throw new Error(`${label}: unsupported version ${value?.version}`);}
export async function verifyFetched(entries,observed,fetchBytes){
  for(const entry of entries){let actual=observed.get(entry.path);if(!actual)actual=sha256(await fetchBytes(entry.path));actual=await actual;if(actual!==entry.sha256)throw new Error(`World data changed: ${entry.path}. Regenerate viewer data and reload.`);}
  return entries.length;
}
