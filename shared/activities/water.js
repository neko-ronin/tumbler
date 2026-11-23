/** One water query for every body shape in the world map, in metres
 * (x east, y north, z up). `floorHeight(x, y)` is the ground or bed height,
 * or a non-finite value where there is none.
 *
 * `waterAt(x, y)` returns null on dry ground, else
 * `{surface_z, bed_z, depth, flow: [vx, vy], speed_mps, body}`:
 * `flow` is a unit direction (zero for a lake), `speed_mps` the declared
 * current, `body` the id of the body or outer reach.
 *
 * Shapes, in the order they win:
 *  1. outer reaches (`mountains.enclosure.river_reaches`): falling polyline;
 *  2. per body, in map order:
 *     lake with `outline_xy_m`: inside the shoreline ring;
 *     river with `polyline_xyz_m`: falling polyline with `half_widths_m`;
 *     oval lake and level river: footprint plus `bank_m` envelope.
 * In every shape the floor must also lie below the surface (+5 cm), so the
 * terrain decides the exact shoreline inside the declared footprint.
 */
const RIVER_MPS=.6;  // a river's current until the map declares `current_mps`
const AWASH_M=.05;   // floor this far above the surface still counts as wet

/** The nearest segment of a falling centreline that covers the point within
 * its interpolated half width: the surface there and the downhill direction. */
function nearestOnLine(line,halfWidths,halfWidth,x,y){
  let nearest=null;
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(!length)continue;
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(length*length)));
    const distance=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);
    const half=halfWidths?halfWidths[i-1]+(halfWidths[i]-halfWidths[i-1])*t:halfWidth;
    if(distance>half||distance>=(nearest?.distance??Infinity))continue;
    const sign=b[2]>a[2]?-1:1;  // the polyline may be listed uphill
    nearest={distance,surface:a[2]+(b[2]-a[2])*t,flow:[dx/length*sign,dy/length*sign]};
  }
  return nearest;
}

/** Even-odd ring test; the ring's last point is not repeated. */
function insideRing(ring,x,y){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<xi+(xj-xi)*(y-yi)/(yj-yi))inside=!inside;
  }
  return inside;
}

export function createWater(worldmap,floorHeight){
  const bodies=worldmap.water?.bodies??[],reaches=worldmap.mountains?.enclosure?.river_reaches??[];
  const waterAt=(x,y)=>{
    const z=floorHeight(x,y);if(!Number.isFinite(z))return null;
    const water=(surface,flow,speed_mps,body)=>({surface_z:surface,bed_z:z,depth:Math.max(0,surface-z),flow,speed_mps,body});
    const wet=surface=>z<surface+AWASH_M;
    for(const reach of reaches){
      const line=reach.polyline_xyz_m;
      // The block's own body wins inside its boundary; beyond the junction
      // the reach wins over the old body's round endpoint envelope.
      if((x-line[0][0])*(line.at(-1)[0]-line[0][0])<0)continue;
      const hit=nearestOnLine(line,reach.half_widths_m,reach.half_width_m,x,y);
      if(hit)return wet(hit.surface)?water(hit.surface,hit.flow,reach.current_mps??RIVER_MPS,reach.id):null;
    }
    for(const b of bodies){
      if(b.kind==='lake'&&b.outline_xy_m){
        if(wet(b.surface_z_m)&&insideRing(b.outline_xy_m,x,y))return water(b.surface_z_m,[0,0],0,b.id);
        continue;
      }
      if(b.kind==='river'&&b.polyline_xyz_m){
        const hit=nearestOnLine(b.polyline_xyz_m,b.half_widths_m,Math.max(b.width_start_m??0,b.width_end_m??0)/2,x,y);
        if(hit&&wet(hit.surface))return water(hit.surface,hit.flow,b.current_mps??RIVER_MPS,b.id);
        continue;
      }
      if(!wet(b.surface_z_m))continue;
      if(b.kind==='lake'&&Math.hypot((x-b.centre_xy_m[0])/(b.size_m[0]/2+b.bank_m),(y-b.centre_xy_m[1])/(b.size_m[1]/2+b.bank_m))<=1)return water(b.surface_z_m,[0,0],0,b.id);
      if(b.kind==='river')for(let i=1;i<b.polyline.length;i++){
        const a=b.polyline[i-1],c=b.polyline[i],dx=c[0]-a[0],dy=c[1]-a[1];
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
        if(Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t)<=Math.max(b.width_start_m,b.width_end_m)/2+b.bank_m)return water(b.surface_z_m,[dx/Math.hypot(dx,dy),dy/Math.hypot(dx,dy)],b.current_mps??RIVER_MPS,b.id);
      }
    }
    return null;
  };
  return {waterAt};
}

const SURFACE_BAND_M=.35;  // within this of the surface is "surface"

/** Which medium height `z` is in for a `waterAt` result (or null): 'air',
 * 'surface' (within 0.35 m of the surface) or 'under', with `submersion`
 * going 0 to 1 linearly across that band (0 in air, 1 under). */
export function mediumAt(water,z){
  if(!water)return {medium:'air',submersion:0};
  const submersion=Math.max(0,Math.min(1,(water.surface_z+SURFACE_BAND_M-z)/(2*SURFACE_BAND_M)));
  return {medium:submersion===0?'air':submersion===1?'under':'surface',submersion};
}
