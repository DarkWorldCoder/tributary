'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { projectPath } = require('./files');

class FileWatches {
  constructor(emit) { this.emit = emit; this.watches = new Map(); }
  async start(project, files) {
    if (!Array.isArray(files) || files.length > 24 || files.some((f) => typeof f !== 'string' || f.length > 2048)) throw new Error('Watch up to 24 project files.');
    if (this.watches.size >= 16) throw new Error('Too many live file views. Close an unused view first.');
    const groups = new Map();
    for (const file of new Set(files)) {
      // Validate the file even if it was deleted; its existing parent must stay in the project.
      await projectPath(project, file, true);
      const parent = path.posix.dirname(file); const dir = await projectPath(project, parent === '.' ? '' : parent);
      const list = groups.get(dir) || []; list.push(file); groups.set(dir, list);
    }
    const root = await projectPath(project, ''); if (!groups.has(root)) groups.set(root, []);
    const id = crypto.randomUUID(); const handles = []; let timer; let pollTimer; const pending = new Set(); let active = true;
    const queue = (rel) => { pending.add(rel); clearTimeout(timer); timer = setTimeout(() => { if (!active) return; this.emit({ watchId: id, project, paths: [...pending] }); pending.clear(); }, 150); timer.unref?.(); };
    const close = () => { active = false; clearTimeout(timer); clearInterval(pollTimer); for (const handle of handles) handle.close(); };
    try {
      for (const [dir, rels] of groups) {
        try {
          const handle = fs.watch(dir, { persistent: false }, (event, name) => {
            if (dir === root && event === 'rename') queue('');
            for (const rel of rels) if (!name || path.basename(rel) === name.toString()) queue(rel);
          });
          // Network-mounted folders can lose native events; stat polling remains active below.
          handle.on('error', () => handle.close()); handles.push(handle);
        } catch { /* unsupported native watcher: use bounded polling */ }
      }
      const targets = [];
      const stamp = async (file) => { try { const stat = await fs.promises.stat(file); return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`; } catch (e) { return e.code; } };
      for (const rel of new Set(['', ...files])) {
        const target = await projectPath(project, rel, true);
        targets.push({ rel, target, previous: await stamp(target) });
      }
      let polling = false;
      pollTimer = setInterval(async () => {
        if (polling || !active) return; polling = true;
        try { await Promise.all(targets.map(async (item) => { const next = await stamp(item.target); if (active && next !== item.previous) queue(item.rel); item.previous = next; })); }
        finally { polling = false; }
      }, 2000); pollTimer.unref?.();
      this.watches.set(id, close); return id;
    } catch (e) { close(); throw new Error('Live file updates are unavailable for this folder. Use Refresh files.'); }
  }
  stop(id) { const close = this.watches.get(id); if (close) { close(); this.watches.delete(id); } }
  close() { for (const id of this.watches.keys()) this.stop(id); }
}
module.exports = { FileWatches };
