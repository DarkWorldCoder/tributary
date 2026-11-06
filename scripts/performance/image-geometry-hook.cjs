'use strict';
// Optional verification-only preload, never used by memory measurements/product.
// NODE_OPTIONS='--require /absolute/path/to/this.cjs' ... image-ownership.cjs ... verify
if (process.versions.electron && process.type === 'browser' && process.env.TRIBUTARY_IMAGE_CASE) setImmediate(() => {
  const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
  const { app, BrowserWindow } = require('electron/main'); const config = JSON.parse(fs.readFileSync(process.env.TRIBUTARY_IMAGE_CASE, 'utf8'));
  let win = BrowserWindow.getAllWindows()[0], closing = false; app.on('browser-window-created', (_event, created) => { win = created; });
  app.on('before-quit', event => {
    if (closing || !config.verify || !fs.existsSync(config.output)) return;
    event.preventDefault(); closing = true;
    (async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      const geometry = await win.webContents.executeJavaScript(`(()=>{const i=document.querySelector('img.image-preview-content'),v=i?.closest('.image-canvas');if(!i||!v)throw Error('Missing visible image');const a=i.getBoundingClientRect(),b=v.getBoundingClientRect();return {image:{x:a.x,y:a.y,width:a.width,height:a.height},viewport:{x:b.x,y:b.y,width:b.width,height:b.height},zoom:document.querySelector('[aria-label="Image zoom"]')?.textContent,visibility:getComputedStyle(i).visibility,display:getComputedStyle(i).display};})()`);
      assert.ok(geometry.image.width > 200 && geometry.image.height > 200, 'Decoded image must be visibly sized, not a zero-size DOM load');
      assert.ok(geometry.image.width <= geometry.viewport.width && geometry.image.height <= geometry.viewport.height, 'Default fit must fit both viewport dimensions');
      assert.notEqual(geometry.visibility, 'hidden'); assert.notEqual(geometry.display, 'none');
      const screenshot = await win.webContents.capturePage(); if (config.evidence) fs.writeFileSync(config.evidence, screenshot.toPNG());
      // Record a source center pixel; scaling prevents exact screen-pixel equality.
      const expected = await win.webContents.executeJavaScript(`(()=>{const i=document.querySelector('img.image-preview-content');const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(i,Math.floor(i.naturalWidth/2),Math.floor(i.naturalHeight/2),1,1,0,0,1,1);return [...c.getContext('2d').getImageData(0,0,1,1).data];})()`);
      const report = JSON.parse(fs.readFileSync(config.output)); report.geometry = { ...geometry, centerSourcePixel: expected, screenshotSha256: crypto.createHash('sha256').update(screenshot.toPNG()).digest('hex'), hookSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'), scope: 'Settled image geometry and screenshot; not latency or memory measurement. Source center pixel is recorded, no exact scaled-screen pixel equality is implied.' };
      fs.writeFileSync(config.output, JSON.stringify(report, null, 2) + '\n'); console.log('Settled image geometry', geometry); app.quit();
    })().catch(error => { console.error(error.stack); app.exit(1); });
  });
});
