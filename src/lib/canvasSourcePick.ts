import { rgbToHex } from './palettes';
import { getPixelAt } from './pixelEditOps';

export type CanvasSourcePickMode = 'single' | 'manual';
export type CanvasSourcePickEvent = {type:'color';hex:string;mode:CanvasSourcePickMode} | {type:'finish'};

interface PixelRect { left:number; top:number; width:number; height:number }

/** Use the actual canvas content box (not its bordered parent). Works with
 * CSS scaling, zoom, pan, fractional pixels and touch client coordinates. */
export function pixelCoordsFromClient(rect:PixelRect, clientX:number, clientY:number, width:number,height:number) {
  if (![rect.left,rect.top,rect.width,rect.height,clientX,clientY,width,height].every(Number.isFinite) ||
      rect.width<=0 || rect.height<=0 || width<=0 || height<=0) return null;
  const x=Math.floor((clientX-rect.left)/rect.width*width);
  const y=Math.floor((clientY-rect.top)/rect.height*height);
  return x>=0&&y>=0&&x<width&&y<height ? {x,y} : null;
}

/** Fully transparent pixels are not document colors. Preserve visible RGB
 * even when the pixel is partially transparent. */
export function readCanvasSourceColor(image:ImageData,x:number,y:number):string|null {
  if(!Number.isInteger(x)||!Number.isInteger(y)) return null;
  const px=getPixelAt(image,x,y);
  return px && px.a>0 ? rgbToHex(px.r,px.g,px.b) : null;
}

/** Canvas picks add distinct source colors; repeated taps do not deselect.
 * Explicit swatch selection remains the existing toggle behavior. */
export function selectCanvasSourceColor(mode:CanvasSourcePickMode, selected:readonly string[], draft:string, hex:string) {
  if(mode==='single') return {selected:[hex],draft:hex};
  return {selected:selected.includes(hex)?[...selected]:[...selected,hex],draft:selected.length?draft:hex};
}
