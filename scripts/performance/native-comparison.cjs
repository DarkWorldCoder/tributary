'use strict';
// Comparison host: real Tributary app, clean profile, real shared benchmark files.
const fs = require('node:fs'), path = require('node:path'); const { app } = require('electron');
const project = process.env.TRIBUTARY_COMPARE_PROJECT, profile = process.env.TRIBUTARY_COMPARE_PROFILE;
if (!project || !profile || !path.isAbsolute(project) || !path.isAbsolute(profile)) throw Error('Use the comparison driver.');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts');
const seed = new core.Hub({ dataDir: profile, home: profile, secrets: new core.MemorySecrets() }); seed.createThread(project, 'Large project navigation'); seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: 'bench0000.ts', tabs: [{ rel: 'bench0000.ts', mode: 'edit', pinned: true }] });
core.Hub = class extends core.Hub { async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
let seeded = false;
app.on('browser-window-created', (_event, win) => { win.setSize(1280, 900); win.webContents.once('did-finish-load', async () => {
  if (seeded) return; seeded = true;
  await win.webContents.executeJavaScript(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.theme','\"dark\"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
  win.webContents.reload();
}); });
require('../../desktop/main.js');
