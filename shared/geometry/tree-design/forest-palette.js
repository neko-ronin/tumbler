/** Foliage palette chosen by the human in live review (2026-10-31), per tree
 * type. The client applies it over the original GLB material colours at every
 * LOD (fitted meshes, spray palette and baked cards); the GLBs stay untouched.
 * Only tones that were changed are listed; bark is unchanged for every type.
 * `REPLACED` keeps what each override took the place of, as the original
 * assets' sRGB hex, so the change can be reversed by deleting the entry. */
export const FOREST_PALETTE={
  village:{dark:'#3c4d23'},
  pine:{dark:'#2e4c10'},
  redwood:{dark:'#324628',mid:'#3f6a1e'},
  fir:{dark:'#355421',mid:'#46693f'},
  giant:{dark:'#334527',mid:'#3f6a29',new:'#648628'}
};
export const REPLACED={
  village:{dark:'#2f5a34'},
  pine:{dark:'#294b37'},
  redwood:{dark:'#294b37',mid:'#3f6a47'},
  fir:{dark:'#294b37',mid:'#3f6a47'},
  giant:{dark:'#294b37',mid:'#3f6a47',new:'#648658'}
};
const linear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
export const hexToLinear=hex=>[1,3,5].map(i=>linear(parseInt(hex.slice(i,i+2),16)/255));
/** Linear-RGB override per tone for a tree type, or undefined when it has none. */
export const paletteOverride=type=>FOREST_PALETTE[type]?Object.fromEntries(Object.entries(FOREST_PALETTE[type]).map(([tone,hex])=>[tone,hexToLinear(hex)])):undefined;
