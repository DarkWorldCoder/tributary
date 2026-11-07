import test from 'node:test';
import assert from 'node:assert/strict';
import { staticRaster, renditionSize, galleryRendition } from '../ui/src/lib/image-rendition.mjs';
const chunk = (type, size = 0) => { const bytes = new Uint8Array(size + 12); new DataView(bytes.buffer).setUint32(0, size); bytes.set([...type].map(c => c.charCodeAt(0)), 4); return bytes; };
const png = (...extra) => {
  const header = chunk('IHDR', 13); header[16] = 8;
  const chunks = [Uint8Array.of(137,80,78,71,13,10,26,10), header, ...extra, chunk('IDAT', 1), chunk('IEND')];
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length; } return bytes;
};
test('only known static containers may be flattened; animation, HDR and malformed chunks stay original', () => {
  assert.equal(staticRaster(png(), 'image/png'), true);
  assert.equal(staticRaster(png(chunk('tEXt', 4)), 'image/png'), true);
  for (const type of ['acTL','fcTL','fdAT','cICP','cLLI','mDCV', 'mDCv','UNKN']) assert.equal(staticRaster(png(chunk(type, 8)), 'image/png'), false, type);
  const sixteen = png(); sixteen[24] = 16; assert.equal(staticRaster(sixteen, 'image/png'), false);
  const oversized = png(); new DataView(oversized.buffer).setUint32(33, 0xffffffff); assert.equal(staticRaster(oversized, 'image/png'), false);
  assert.equal(staticRaster(png().subarray(0, 40), 'image/png'), false);
  assert.equal(staticRaster(png(), 'image/jpeg'), false, 'renaming APNG as JPEG cannot flatten its animation');
  assert.equal(staticRaster(Uint8Array.of(255,216,255), 'image/jpeg'), true);
  for (const mime of ['image/gif','image/webp','image/avif','image/svg+xml','image/bmp','image/x-icon']) assert.equal(staticRaster(png(), mime), false);
});
test('renditions preserve aspect, at least two-pixel density, denser screens and never upscale', () => {
  assert.deepEqual(renditionSize(1536,1536), {width:512,height:512});
  assert.deepEqual(renditionSize(512,2048), {width:128,height:512});
  assert.equal(renditionSize(2048,512), null);
  assert.deepEqual(renditionSize(1536,1536,3), {width:768,height:768});
  assert.deepEqual(renditionSize(8000,100,2), {width:2048,height:26});
  assert.equal(renditionSize(32,32), null);
  for (const args of [[0,2],[2,NaN],[Infinity,2]]) assert.equal(renditionSize(...args), null);
});
function environment(options = {}) {
  const closed = [], calls = []; let created = 0;
  const env = { devicePixelRatio: 1, async createImageBitmap(input, settings) {
    const kind = ++created === 1 ? 'original' : 'resized'; calls.push({kind,settings});
    if (options.fail === kind) throw Error('Unsupported decoder');
    if (options.wait === kind) await options.gate;
    return { width: kind === 'original' ? options.width || 1536 : settings.resizeWidth, height: kind === 'original' ? options.height || 1536 : settings.resizeHeight, close() { closed.push(kind); } };
  }, OffscreenCanvas: class {
    constructor(width, height) { this.width=width;this.height=height;calls.push({canvas:this}); }
    getContext() { return options.noContext ? null : { drawImage() { if (options.fail === 'draw') throw Error('Cannot draw'); } }; }
    transferToImageBitmap() { if (options.fail === 'transfer') throw Error('Transfer unavailable'); options.transfer?.(); return { width:this.width, height:this.height, close() { closed.push('surface'); } }; }
  } };
  return {env,closed,calls};
}
const source = new Blob([new Uint8Array(5000)]);
test('a derived card resource retains original oriented dimensions and transfers an owned surface and closes the temporary bitmaps/canvas', async () => {
  const fixture = environment(), result = await galleryRendition(source,png(),'image/png',()=>true,fixture.env);
  assert.equal(result.width,1536);assert.equal(result.height,1536);assert.equal(result.bitmap.width,512);assert.equal(result.bitmap.height,512);
  assert.deepEqual(fixture.closed,['resized','original']);
  assert.deepEqual(fixture.calls[1].settings,{resizeWidth:512,resizeHeight:512,resizeQuality:'high'});
  const canvas=fixture.calls.find(c=>c.canvas).canvas;assert.equal(canvas.width,0);assert.equal(canvas.height,0);
  result.bitmap.close(); assert.deepEqual(fixture.closed,['resized','original','surface']);
});
test('small images, missing APIs, codec failures and compressed inputs preserve the original path', async () => {
  for (const options of [{width:32,height:32},{fail:'original'},{fail:'resized'},{fail:'draw'},{fail:'transfer'},{noContext:true}]) {
    const fixture=environment(options);assert.equal(await galleryRendition(source,png(),'image/png',()=>true,fixture.env),null);
    if (options.fail !== 'original') assert.ok(fixture.closed.includes('original'));
  }
  const fixture=environment();assert.ok(await galleryRendition(new Blob(['tiny']),png(),'image/png',()=>true,fixture.env),'a small compressed input may still need a smaller decoded bitmap');assert.deepEqual(fixture.closed,['resized','original']);
  assert.equal(await galleryRendition(source,png(),'image/png',()=>true,{}),null);
  const untouched=environment();assert.equal(await galleryRendition(source,png(chunk('acTL',8)),'image/png',()=>true,untouched.env),null);assert.equal(untouched.calls.length,0);
});
test('closing during decode or resize discards work and closes every acquired bitmap', async () => {
  for (const wait of ['original','resized']) {
    let release,alive=true;const gate=new Promise(resolve=>release=resolve),fixture=environment({wait,gate});
    const result=galleryRendition(source,png(),'image/png',()=>alive,fixture.env);
    while(!fixture.calls.some(c=>c.kind===wait)) await new Promise(setImmediate);
    alive=false;release();assert.equal(await result,null);assert.ok(fixture.closed.includes('original'));
    if(wait!=='original')assert.ok(fixture.closed.includes('resized'));
  }
});

test('already-small PNG headers bypass native bitmap work, including rotated small images', async () => {
  const bytes=png(),view=new DataView(bytes.buffer);view.setUint32(16,32);view.setUint32(20,48);const fixture=environment();assert.equal(await galleryRendition(source,bytes,'image/png',()=>true,fixture.env),null);assert.equal(fixture.calls.length,0);
  assert.equal(await galleryRendition(source,bytes,'image/png',()=>true,new Proxy({},{get(){throw Error('Small images must not initialize native API bindings');}})),null);
});

test('large sources already inside the density box still get an explicitly owned surface', async () => {
  const fixture=environment({width:2048,height:512}), result=await galleryRendition(source,png(),'image/png',()=>true,fixture.env);
  assert.equal(result.bitmap.width,2048);assert.equal(result.bitmap.height,512);
  assert.deepEqual(fixture.closed,['original']);assert.equal(fixture.calls.filter(c=>c.kind).length,1);
  result.bitmap.close();assert.deepEqual(fixture.closed,['original','surface']);
});
test('cancellation after transfer closes the produced surface as well as decoder temporaries', async () => {
  let alive=true;const fixture=environment({transfer(){alive=false;}});
  assert.equal(await galleryRendition(source,png(),'image/png',()=>alive,fixture.env),null);
  assert.deepEqual(fixture.closed,['surface','resized','original']);
});
