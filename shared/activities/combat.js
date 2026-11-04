/** Shared attack intent. Each fresh press chooses a cut from the live blade
 * side and lateral travel. There is no attack number, queue or combo sequence. */
export function chooseCut({side=0,lateralSpeed=0}={}){
  const departure=side+lateralSpeed*.06;
  return departure>0?'backhand':'forehand';
}

/** Facial intent, independent of a rendering engine. Values are rig offsets
 * in radians. Blink and nap remain separate layers. */
export function actionExpression({attack=false,charge=false,slide=false,climb=false,jump=false,fall=false,landing=false}={}){
  if(fall)return {name:'startled',lid:-.10,lower:0,ear:-.42,eye:.08};
  if(landing)return {name:'wince',lid:.45,lower:-.12,ear:-.32,eye:0};
  if(charge)return {name:'determined',lid:.28,lower:-.08,ear:-.25,eye:0};
  if(attack)return {name:'focused',lid:.22,lower:-.06,ear:-.18,eye:0};
  if(slide)return {name:'braced',lid:.25,lower:-.08,ear:-.32,eye:0};
  if(climb||jump)return {name:'alert',lid:.08,lower:-.02,ear:.12,eye:.04};
  return {name:'relaxed',lid:0,lower:0,ear:0,eye:0};
}
