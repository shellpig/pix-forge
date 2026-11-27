import { collectUsedPalette, type PixelEngineResult } from './pixelEngine';

export * from './spriteSheetGeometry';

export function originalFrameResult(image: HTMLImageElement, native: boolean): PixelEngineResult {
  const canvas=document.createElement('canvas');
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('Canvas unavailable');
  ctx.drawImage(image,0,0);
  const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
  const {swatches,totalUnique}=native?collectUsedPalette(imageData.data):{swatches:[],totalUnique:0};
  return {imageData,width:canvas.width,height:canvas.height,palette:swatches,uniqueColorCount:totalUnique,computeMs:0};
}
