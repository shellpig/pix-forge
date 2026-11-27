import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetCells,detectSheetGrid} from '../src/lib/spriteSheetGeometry.ts';

test('4x4 odd-sized sheet covers every input pixel without resampling and uses common output dimensions',()=>{
  const cells=sheetCells(1254,1254,4,4);
  assert.equal(cells.length,16);
  assert.deepEqual(cells[0],{x:0,y:0,w:314,h:314,outputW:314,outputH:314});
  assert.equal(cells[4].y,314);
  assert.equal(cells.at(-1).x+cells.at(-1).w,1254);
  assert.equal(cells.at(-1).y+cells.at(-1).h,1254);
  assert.equal(cells.reduce((sum,c)=>sum+c.w*c.h,0),1254*1254);
  assert.ok(cells.every(c=>c.outputW===314&&c.outputH===314));
});
test('grid detector finds foreground bands in transparent and white sheets',()=>{
  for(const transparent of [true,false]){
    const width=120,height=80,data=new Uint8ClampedArray(width*height*4);
    if(!transparent)data.fill(255);
    for(let row=0;row<2;row++)for(let col=0;col<3;col++)
      for(let y=row*40+5;y<row*40+35;y++)for(let x=col*40+8;x<col*40+32;x++)
        data.set([60,40,20,255],(y*width+x)*4);
    assert.deepEqual(detectSheetGrid({width,height,data}),{cols:3,rows:2});
  }
});
test('blank image is uncertain; invalid or excessive grids rejected',()=>{
  assert.equal(detectSheetGrid({width:20,height:20,data:new Uint8ClampedArray(1600)}),null);
  assert.throws(()=>sheetCells(100,100,0,4));
  assert.throws(()=>sheetCells(100,100,16,16));
  assert.throws(()=>sheetCells(5000,5000,2,2));
});
