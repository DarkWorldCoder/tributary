'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { projectPath } = require('./files');

const validate = (files) => {
  if (!Array.isArray(files) || files.length > 24 || files.some((f) => typeof f !== 'string' || f.length > 2048)) throw new Error('Watch up to 24 project files.');
};
const stamp = async (file) => { try { const stat = await fs.promises.stat(file); return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`; } catch (e) { return e.code; } };

class FileWatches {
  constructor(emit) { this.emit = emit; this.watches = new Map(); }
  async start(project, files) {
    validate(files);
    // Reserve before path validation yields, including views still connecting.
    if (this.watches.size >= 16) throw new Error('Too many live file views. Close an unused view first.');
    const entry = { id: crypto.randomUUID(), project, active: true, busy: false, targets: new Map(), dirs: new Map(), prepared: new Map(), pending: new Set(), timer: null, pollTimer: null, polling: false };
    this.watches.set(entry.id, entry);
    try {
      await this.replace(entry.id, project, files);
      if (!entry.active) throw new Error('File view closed.');
      entry.pollTimer = setInterval(async () => {
        if (entry.polling || !entry.active) return; entry.polling = true;
        try { await Promise.all([...entry.targets.values()].map(async (item) => {
          const next = await stamp(item.target);
          // A removed/re-added path has another owner, even with the same name.
          if (!entry.active || entry.targets.get(item.rel) !== item) return;
          if (next !== item.previous) this.queue(entry, item.rel);
          item.previous = next;
        })); } finally { entry.polling = false; }
      }, 2000); entry.pollTimer.unref?.();
      return entry.id;
    } catch (error) { this.stop(entry.id); throw error; }
  }
  queue(entry, rel) {
    if (!entry.active || !entry.targets.has(rel)) return;
    entry.pending.add(rel); if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null; if (!entry.active) return;
      const paths = [...entry.pending].filter(rel => entry.targets.has(rel)); entry.pending.clear();
      if (paths.length) this.emit({ watchId: entry.id, project: entry.project, paths });
    }, 150); entry.timer.unref?.();
  }
  watchDirectory(entry, dir) {
    const group = { rels: new Set(), handle: null };
    try {
      group.handle = fs.watch(dir, { persistent: false }, (event, name) => {
        if (!entry.active || entry.dirs.get(dir) !== group) return;
        if (event === 'rename') this.queue(entry, '');
        for (const rel of group.rels) if (!name || path.basename(rel) === name.toString()) this.queue(entry, rel);
      });
      // Directory events may fail on network mounts; bounded stat polling stays.
      group.handle.on('error', () => group.handle.close());
    } catch { /* unsupported native watcher: use bounded polling */ }
    return group;
  }
  async replace(id, project, files) {
    validate(files);
    const entry = this.watches.get(id);
    if (!entry?.active || entry.project !== project) throw new Error('Unknown live file view.');
    if (entry.busy) throw new Error('File view update already in progress.');
    entry.busy = true;
    try {
      const targets = new Map(), groups = new Map();
      for (const rel of new Set(['', ...files])) {
        if (!entry.active) throw new Error('File view closed.');
        let item = entry.targets.get(rel);
        if (!item) {
          // Deleted paths are allowed; existing ancestors must stay in-project.
          const target = await projectPath(project, rel, true);
          const parent = path.posix.dirname(rel);
          const dir = rel ? await projectPath(project, parent === '.' ? '' : parent) : target;
          item = { rel, target, dir, previous: undefined };
        }
        targets.set(rel, item);
        const rels = groups.get(item.dir) || new Set(); if (rel) rels.add(rel); groups.set(item.dir, rels);
      }
      if (!entry.active) throw new Error('File view closed.');
      // Prepare additions before committing. Invalid updates leave old watches
      // intact; close() also owns handles created while stat awaits completion.
      for (const dir of groups.keys()) if (!entry.dirs.has(dir)) entry.prepared.set(dir, this.watchDirectory(entry, dir));
      for (const item of targets.values()) if (item.previous === undefined) item.previous = await stamp(item.target);
      if (!entry.active) throw new Error('File view closed.');
      for (const [dir, group] of entry.dirs) if (!groups.has(dir)) { group.handle?.close(); entry.dirs.delete(dir); }
      for (const [dir, rels] of groups) {
        const group = entry.dirs.get(dir) || entry.prepared.get(dir); group.rels = rels; entry.dirs.set(dir, group);
      }
      entry.prepared.clear(); entry.targets = targets;
      for (const rel of entry.pending) if (!targets.has(rel)) entry.pending.delete(rel);
      return id;
    } finally {
      for (const group of entry.prepared.values()) group.handle?.close(); entry.prepared.clear(); entry.busy = false;
    }
  }
  stop(id) {
    const entry = this.watches.get(id); if (!entry) return;
    this.watches.delete(id); entry.active = false; clearTimeout(entry.timer); clearInterval(entry.pollTimer);
    for (const group of [...entry.dirs.values(), ...entry.prepared.values()]) group.handle?.close();
    entry.dirs.clear(); entry.prepared.clear(); entry.targets.clear(); entry.pending.clear();
  }
  close() { for (const id of this.watches.keys()) this.stop(id); }
}
module.exports = { FileWatches };
