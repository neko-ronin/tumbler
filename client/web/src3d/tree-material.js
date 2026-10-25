import {style,sunShadowShader} from './style.js';
import {createTreeSurface} from './tree-surface.js';
import {updateTreeSunShadow} from './tree-shadows.js';
export function treeMaterial(recipe,options={}){const material=createTreeSurface(recipe,{sun:style.sun,shadowShader:sunShadowShader,interval:'forestInterval',...options});material.onBeforeRender=updateTreeSunShadow;return material;}

/** The occupied bole uses the same wood surface as Canopy and Giant. */
export function villageBarkMaterial(){return treeMaterial({toonBands:4,rimStrength:0,canopyShade:.85,transmission:0,leafThickness:.4,leafProfile:'redwood'});}
