export type SheetMode = 'convert' | 'original' | 'native';
export const MAX_SHEET_PIXELS = 16_777_216;
export const MAX_SHEET_FRAMES = 128;

/** Row-major cells; pad uneven edge lengths to a common size without resampling. */
export function sheetCells(width: number, height: number, cols: number, rows: number) {
  if (![width,height,cols,rows].every(n => Number.isInteger(n) && n > 0) ||
      cols * rows > MAX_SHEET_FRAMES || width * height > MAX_SHEET_PIXELS ||
      cols > width || rows > height) throw new Error('Invalid grid (maximum 128 frames / 16 MP).');
  const outputW=Math.ceil(width/cols),outputH=Math.ceil(height/rows);
  return Array.from({length:cols*rows}, (_,i) => {
    const col=i%cols,row=Math.floor(i/cols);
    const x=Math.round(col*width/cols),y=Math.round(row*height/rows);
    return {x,y,w:Math.round((col+1)*width/cols)-x,h:Math.round((row+1)*height/rows)-y,outputW,outputH};
  });
}

/** Estimate grid using gaps in foreground projections, not individual disconnected sprites. */
export function detectSheetGrid(image: ImageData): {cols:number;rows:number} | null {
  const {width:w,height:h,data:d}=image;
  const x = new Uint32Array(w), y = new Uint32Array(h);
  const bg = [d[0],d[1],d[2],d[3]];
  for(let j=0;j<h;j++) for(let i=0;i<w;i++){
    const p=(j*w+i)*4;
    if(d[p+3]<16 || (bg[3]>=16 && Math.max(Math.abs(d[p]-bg[0]),Math.abs(d[p+1]-bg[1]),Math.abs(d[p+2]-bg[2]))<35)) continue;
    x[i]++; y[j]++;
  }
  function bands(a:Uint32Array, orth:number){
    const threshold=Math.max(1,Math.floor(orth*.006));
    let count=0, start=-1, end=-1;
    for(let i=0;i<=a.length;i++){
      if(i<a.length && a[i]>=threshold){if(start<0)start=i;end=i;}
      else if(start>=0){if(end-start+1>=Math.max(2,a.length*.025))count++;start=-1;}
    }
    return count;
  }
  const cols=bands(x,h),rows=bands(y,w);
  try {sheetCells(w,h,cols,rows);return cols*rows>1?{cols,rows}:null;}catch{return null;}
}

