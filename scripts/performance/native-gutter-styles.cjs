'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const root = process.argv[2], config = JSON.parse(fs.readFileSync(path.join(root, 'case.json')));
app.setPath('userData', path.join(root, 'profile'));
const deadline = setTimeout(() => app.exit(1), 90000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(root, 'index.html'));
  const result = await win.webContents.executeJavaScript(`(async()=>{
    const {EditorState,EditorView,debugGutter,debugLines,changeGutter,setFileChanges}=window.gutterFixture;
    const calls=[];
    const styleCounts=()=>{
      let debug=0,changes=0,total=0;
      for(const sheet of document.styleSheets)for(const rule of sheet.cssRules){
        total++;
        if(/cm-debug-gutter|debug-breakpoint|cm-debug-paused-line/.test(rule.cssText))debug++;
        if(/cm-file-change|cm-file-added|cm-file-removed/.test(rule.cssText))changes++;
      }
      return {debug,changes,total};
    };
    const create=(side,id)=>new EditorView({parent:document.getElementById(side),state:EditorState.create({doc:'first\\nsecond\\nthird\\n',extensions:[debugGutter(line=>calls.push({id,kind:'breakpoint',line})),changeGutter(()=>calls.push({id,kind:'review'}))]})});
    const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    let left=create('left','left-0'),right=create('right','right-0');
    const exercise=async(view,id)=>{
      view.dispatch({effects:[debugLines.of({lines:[1],paused:2}),setFileChanges.of([{line:2,added:2,removed:1}])]});
      await frames();
      const breakpoint=view.dom.querySelector('.debug-breakpoint.is-set');
      const marker=view.dom.querySelector('.cm-file-change');
      if(!breakpoint||!marker||!view.dom.querySelector('.cm-debug-paused-line'))throw Error('Missing real gutter/paused decoration for '+id);
      breakpoint.click(); marker.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      const own=calls.filter(call=>call.id===id);
      if(own.length!==2||own[0].kind!=='breakpoint'||own[0].line!==1||own[1].kind!=='review')throw Error('Wrong editor callback ownership for '+id);
      return {debugWidth:getComputedStyle(view.dom.querySelector('.cm-debug-gutter')).width,changeWidth:getComputedStyle(view.dom.querySelector('.cm-file-change-gutter')).width,markerColor:getComputedStyle(marker).backgroundColor,breakpointColor:getComputedStyle(breakpoint).color};
    };
    const initialStyles=await exercise(left,'left-0');await exercise(right,'right-0');
    const before=styleCounts(),samples=[before];
    for(let index=1;index<=40;index++){
      left.destroy();right.destroy();
      left=create('left','left-'+index);right=create('right','right-'+index);
      const next=await exercise(left,'left-'+index);await exercise(right,'right-'+index);
      if(JSON.stringify(next)!==JSON.stringify(initialStyles))throw Error('Gutter appearance changed across mounts');
      samples.push(styleCounts());
    }
    left.destroy();right.destroy();
    return {before,after:styleCounts(),samples,initialStyles,callbackCount:calls.length,connectedEditors:document.querySelectorAll('.cm-editor').length,mounts:82};
  })()`);
  assert.equal(result.connectedEditors, 0); assert.equal(result.callbackCount, 164);
  assert.equal(result.initialStyles.debugWidth, '20px'); assert.equal(result.initialStyles.changeWidth, '7px');
  assert.equal(result.initialStyles.markerColor, 'rgb(0, 128, 0)'); assert.equal(result.initialStyles.breakpointColor, 'rgb(220, 0, 0)');
  const bounded = result.samples.every(sample => sample.debug === result.before.debug && sample.changes === result.before.changes);
  const report = { complete: true, passed: bounded === config.expectedBounded, bounded, ...result, ...config, runtime: process.versions, scope: 'Isolated Electron, real compiled production gutter extensions and CodeMirror; 82 mounts, 164 callback checks, rendered appearance and CSS rule ownership. No provider, full-workbench, RAM, timing or forced-GC claim.' };
  fs.writeFileSync(config.output, JSON.stringify(report, null, 2)+'\n');
  assert.equal(bounded, config.expectedBounded, 'Gutter styles must remain bounded across editor mounts.');
  clearTimeout(deadline); app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
