import {style,sunShadowShader} from './style.js';
import {createTreeSurface} from './tree-surface.js';
export function treeMaterial(recipe,options={}){return createTreeSurface(recipe,{sun:style.sun,shadowShader:sunShadowShader,interval:'forestInterval',...options});}
