import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const requireBrowser = createRequire(resolve(process.env.PIXFORGE_BROWSER_TOOLS || '.', 'package.json'));
const { chromium } = requireBrowser('playwright');
const browser = await chromium.launch({headless:true});
const base=process.env.PIXFORGE_BROWSER_URL || 'http://127.0.0.1:4173';
const out=resolve('browser-artifacts');
await mkdir(out,{recursive:true});
const canvasSelector='[data-testid="pixel-edit-canvas"] canvas';
const paletteSelector='#document-palette';
let passed=0;
const cases=[];
const check=(name,fn)=>cases.push({name,fn});
const pageFor=async (viewport, touch=false)=>{
  const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,deviceScaleFactor:1,locale:'en-US'});
  await context.addInitScript(()=>{
    localStorage.setItem('pixforge:locale','en');
    localStorage.setItem('pixforge:showRealSize','false');
  });
  const page=await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(base);
  await page.getByRole('button',{name:'Pixel Edit',exact:true}).click();
  await page.waitForFunction(()=> {
    const c=document.querySelector('[data-testid="pixel-edit-canvas"] canvas');
    return c && c.width>0 && c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3 && v===255);
  });
  await page.getByRole('button',{name:'Replace color',exact:true}).waitFor({state:'visible'});
  return {context,page};
};
const brushButton=page=>page.getByTitle('Choose active brush / fill color',{exact:true});
const palette=page=>page.locator(paletteSelector);
const brushPicker=page=>page.locator('.brush-color-picker');
const canvas=page=>page.locator(canvasSelector);
const target=page=>palette(page).getByRole('textbox',{name:'HEX code'});
const readPixels=page=>canvas(page).evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
const findPixel=async(page,exclude=[])=>canvas(page).evaluate((c,exclude)=>{
  const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  const r=c.getBoundingClientRect();
  // Choose a visible opaque pixel near the center, away from edges/overlays.
  const candidates=[];
  for(let y=2;y<c.height-2;y++) for(let x=2;x<c.width-2;x++){
    const i=(y*c.width+x)*4;
    if(a[i+3]!==255) continue;
    const hex='#'+[a[i],a[i+1],a[i+2]].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(exclude.includes(hex)) continue;
    candidates.push({x,y,hex,score:Math.abs(x-c.width/2)+Math.abs(y-c.height/2)});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const p=candidates[0]; if(!p) throw Error('No matching opaque pixel in test image');
  return {...p,clientX:r.left+(p.x+.5)*r.width/c.width,clientY:r.top+(p.y+.5)*r.height/c.height};
},exclude);
const pick=async(page,touch=false,exclude=[])=>{
  await canvas(page).scrollIntoViewIfNeeded();
  const p=await findPixel(page,exclude);
  if(touch) await page.touchscreen.tap(p.clientX,p.clientY);
  else await page.mouse.click(p.clientX,p.clientY);
  return p;
};
const waitHex=async (locator,hex)=>locator.evaluate((el,hex)=>new Promise((res,rej)=>{
  const deadline=performance.now()+5000;
  const tick=()=>el.value.toLowerCase()===hex?res(true):performance.now()>deadline?rej(Error('Expected HEX '+hex+', got '+el.value)):requestAnimationFrame(tick);
  tick();
}),hex);
const waitPixels=async(page,expected)=>page.waitForFunction(expected=>{
  const c=document.querySelector('[data-testid="pixel-edit-canvas"] canvas');
  if(!c)return false;
  const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  return data.length===expected.length&&data.every((v,i)=>v===expected[i]);
},expected);
const remap=(pixels,from,to)=>{
  const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
  const a=rgb(from),b=rgb(to),next=[...pixels];
  for(let i=0;i<next.length;i+=4) if(next[i+3]&&a.every((v,j)=>v===next[i+j])) for(let j=0;j<3;j++)next[i+j]=b[j];
  return next;
};
const distinctTarget=hex=>hex==='#12a7ef'?'#ef12a7':'#12a7ef';
const snapshot=async(page,name)=>page.screenshot({path:resolve(out,name+'.png')});

check('desktop: compact geometry, RGB/HSL, direct HEX and document palette navigation',async()=>{
  const {context,page}=await pageFor({width:1440,height:900});
  try{
    const before=await readPixels(page);
    await brushButton(page).click();
    const picker=brushPicker(page);
    await picker.waitFor();
    const geometry=await picker.evaluate(el=>{
      const a=el.querySelector('.color-picker-controls').getBoundingClientRect(),b=el.querySelector('.color-picker-channels').getBoundingClientRect();
      const sliderRects=[...el.querySelectorAll('input[type="range"]')].map(x=>x.getBoundingClientRect());
      return {height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,sideBySide:b.left>=a.right-1,aligned:sliderRects.every(x=>Math.abs(x.left-sliderRects[0].left)<1),sliderWidth:sliderRects[0].width};
    });
    assert.ok(geometry.sideBySide,JSON.stringify(geometry));
    assert.ok(geometry.aligned,JSON.stringify(geometry));
    assert.ok(geometry.height<=150,JSON.stringify(geometry));
    assert.ok(geometry.sliderWidth>=80,JSON.stringify(geometry));
    console.log('MEASURE desktop picker',JSON.stringify(geometry));
    const hex=picker.getByRole('textbox',{name:'HEX code'});
    await hex.fill('#a55753');
    await waitHex(hex,'#a55753');
    await picker.getByRole('button',{name:'HSL',exact:true}).click();
    assert.equal(await picker.getByRole('slider').count(),3);
    await picker.getByRole('slider',{name:'Hue H'}).press('ArrowRight');
    assert.notEqual(await hex.inputValue(),'#a55753');
    await picker.getByRole('button',{name:'RGB',exact:true}).click();
    await picker.getByRole('textbox',{name:'HEX code'}).fill('#123456');
    await page.setViewportSize({width:800,height:800});
    await page.waitForFunction(()=>{const e=document.querySelector('.brush-color-picker');const a=e?.querySelector('.color-picker-controls')?.getBoundingClientRect(),b=e?.querySelector('.color-picker-channels')?.getBoundingClientRect();return a&&b&&b.top>=a.bottom-1;});
    assert.equal(await hex.inputValue(),'#123456');
    await page.setViewportSize({width:1440,height:900});
    await page.waitForFunction(()=>{const e=document.querySelector('.brush-color-picker');const a=e?.querySelector('.color-picker-controls')?.getBoundingClientRect(),b=e?.querySelector('.color-picker-channels')?.getBoundingClientRect();return a&&b&&b.left>=a.right-1;});
    await hex.press('Enter');
    await picker.waitFor({state:'hidden'});
    assert.match(await brushButton(page).innerText(),/#123456/i);
    await waitPixels(page,before);
    const canvasBefore=await canvas(page).boundingBox();
    await page.getByRole('button',{name:'Document palette',exact:true}).click();
    assert.equal(await palette(page).evaluate(el=>document.activeElement===el),true);
    const canvasAfter=await canvas(page).boundingBox();
    assert.ok(Math.abs(canvasAfter.y-canvasBefore.y)<2);
    await snapshot(page,'desktop-navigation');
  }finally{await context.close()}
});

check('desktop: direct pick samples committed RGB, preview cancels before undo and apply is reversible',async()=>{
  const {context,page}=await pageFor({width:1440,height:900});
  try{
    const original=await readPixels(page);
    const brush=await brushButton(page).innerText();
    await page.getByRole('button',{name:'Replace color',exact:true}).click();
    const p=await pick(page);
    await waitHex(target(page),p.hex);
    assert.equal(await palette(page).locator('[data-palette-hex="'+p.hex+'"]').getAttribute('aria-pressed'),'true');
    assert.equal(await brushButton(page).innerText(),brush);
    await waitPixels(page,original);
    const next=distinctTarget(p.hex);
    const changed=remap(original,p.hex,next);
    await target(page).fill(next);
    await waitPixels(page,changed);
    await palette(page).getByRole('button',{name:'Apply global replacement',exact:true}).click();
    await waitPixels(page,changed);
    await page.getByRole('button',{name:'Replace color',exact:true}).click();
    const p2=await pick(page);
    await waitHex(target(page),p2.hex);
    const preview2=distinctTarget(p2.hex);
    await target(page).fill(preview2);
    await waitPixels(page,remap(changed,p2.hex,preview2));
    await page.keyboard.press('Control+z');
    await waitPixels(page,changed);
    await page.mouse.click(2,2);
    await page.keyboard.press('Control+z');
    await waitPixels(page,original);
    await page.keyboard.press('Control+y');
    await waitPixels(page,changed);
    await snapshot(page,'desktop-replacement');
  }finally{await context.close()}
});

check('phone touch emulation: vertical picker, scrollable palette and direct touch source selection',async()=>{
  const {context,page}=await pageFor({width:390,height:844},true);
  try{
    await brushButton(page).click();
    const picker=brushPicker(page);
    const geometry=await picker.evaluate(el=>{
      const a=el.querySelector('.color-picker-controls').getBoundingClientRect(),b=el.querySelector('.color-picker-channels').getBoundingClientRect();
      return {height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,vertical:b.top>=a.bottom-1,sliderHeight:el.querySelector('input[type="range"]').getBoundingClientRect().height,viewport:innerWidth};
    });
    assert.ok(geometry.vertical,JSON.stringify(geometry));
    assert.ok(geometry.width<=geometry.viewport,JSON.stringify(geometry));
    assert.ok(geometry.sliderHeight>=24,JSON.stringify(geometry));
    console.log('MEASURE phone picker',JSON.stringify(geometry));
    await snapshot(page,'phone-picker');
    await picker.getByRole('button',{name:'Close color picker'}).click();
    const bounds=await canvas(page).boundingBox();
    assert.ok(bounds.width>=120 && bounds.height>=120,JSON.stringify(bounds));
    const before=await readPixels(page);
    await page.getByRole('button',{name:'Replace color',exact:true}).click();
    const p=await pick(page,true);
    await waitHex(target(page),p.hex);
    await waitPixels(page,before);
    const next=distinctTarget(p.hex);
    await target(page).fill(next);
    await waitPixels(page,remap(before,p.hex,next));
    await palette(page).getByRole('button',{name:'Cancel changes',exact:true}).click();
    await waitPixels(page,before);
    await page.getByRole('button',{name:'Document palette',exact:true}).click();
    const rect=await palette(page).evaluate(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,viewport:innerHeight}));
    assert.ok(rect.top<rect.viewport && rect.bottom>0,JSON.stringify(rect));
    await snapshot(page,'phone-navigation');
  }finally{await context.close()}
});

try{
  for(const {name,fn} of cases){await fn();passed++;console.log('PASS '+name);}
  console.log('BROWSER '+passed+'/'+cases.length+' passed');
}finally{await browser.close()}
