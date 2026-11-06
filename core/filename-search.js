'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ignored = new Set(['.git', 'node_modules', '.venv', 'venv', 'target', 'dist', 'build', '.next']);
const aborted = () => Object.assign(new Error('File search cancelled'), { name: 'AbortError' });
const check = signal => { if (signal?.aborted) throw aborted(); };

// Visit the complete searchable tree; retain only the smallest result prefix.
// Directory buffers and open handles scale with depth, never folder width.
async function scanFileNames(root, query, { showHidden = true, limit = 2000, signal } = {}, io = fs) {
  if (typeof query !== 'string' || query.length > 512) throw new Error('Invalid file search.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error('Invalid file search limit.');
  check(signal);
  const needle = query.trim().toLowerCase(), files = [];
  let total = 0, visited = 0, unreadable = 0;
  if (!needle) return { files, total, visited, unreadable, limited: false };
  const base = await io.realpath(root); check(signal);
  const accept = name => {
    total++;
    // Max heap: replacing its root keeps a deterministic lexical prefix even
    // when native directory enumeration order changes between calls.
    if (files.length < limit) {
      let at = files.length; files.push(name);
      while (at) { const parent = (at - 1) >> 1; if (files[parent] >= name) break; files[at] = files[parent]; at = parent; }
      files[at] = name;
    } else if (name < files[0]) {
      let at = 0;
      while (at * 2 + 1 < files.length) {
        let child = at * 2 + 1; if (child + 1 < files.length && files[child + 1] > files[child]) child++;
        if (name >= files[child]) break; files[at] = files[child]; at = child;
      }
      files[at] = name;
    }
  };
  const walk = async (rel, depth) => {
    check(signal);
    if (depth > 128) throw new Error('File search exceeded 128 folder levels. Open a more specific project folder.');
    let directory;
    try {
      const physical = await io.realpath(path.join(base, rel)); check(signal);
      const relative = path.relative(base, physical);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) { unreadable++; return; }
      directory = await io.opendir(physical, { bufferSize: 256 });
    } catch (error) {
      check(signal);
      if (rel && ['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) { unreadable++; return; }
      throw error;
    }
    let failed = false;
    try {
      await new Promise((resolve, reject) => {
        const read = () => { try { check(signal); directory.read(next); } catch (error) { reject(error); } };
        const next = (error, entry) => {
          if (error) { reject(error); return; }
          try {
            check(signal); if (!entry) { resolve(); return; }
            visited++;
            const resume = () => visited % 256 === 0 ? setImmediate(read) : read();
            if (entry.isSymbolicLink() || !showHidden && entry.name.startsWith('.') || entry.isDirectory() && ignored.has(entry.name)) { resume(); return; }
            const name = rel ? rel + '/' + entry.name : entry.name;
            if (entry.isDirectory()) { void walk(name, depth + 1).then(resume, reject); return; }
            if (entry.isFile() && name.toLowerCase().includes(needle)) accept(name);
            resume();
          } catch (cause) { reject(cause); }
        };
        read();
      });
    } catch (error) { failed = true; throw error; }
    finally { try { await directory.close(); } catch (error) { if (!failed) throw error; } }
  };
  await walk('', 0); check(signal);
  return { files: files.sort(), total, visited, unreadable, limited: total > files.length };
}

// A renderer owns a lease, not a detached fire-and-forget directory walk.
// At most two walks run; queued requests hold only bounded query metadata.
class FileSearches {
  constructor(scan = scanFileNames) { this.scan = scan; this.owners = new Map(); this.queue = []; this.active = 0; }
  acquire(root) {
    if (this.owners.size >= 128) throw new Error('Too many file search owners. Close an unused workspace.');
    const owner = randomUUID(); this.owners.set(owner, { root, task: null }); return owner;
  }
  search(owner, query, options = {}) {
    const lease = this.owners.get(owner); if (!lease) return Promise.reject(new Error('File search is closed.'));
    if (typeof query !== 'string' || query.length > 512) return Promise.reject(new Error('Invalid file search.'));
    const { showHidden = true, limit = 2000 } = options;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) return Promise.reject(new Error('Invalid file search limit.'));
    this.cancel(owner);
    return new Promise((resolve, reject) => {
      const task = { root: lease.root, query, options: { showHidden: showHidden !== false, limit }, controller: new AbortController(), resolve, reject };
      lease.task = task; this.queue.push(task); this.pump();
    });
  }
  cancel(owner) {
    const lease = this.owners.get(owner), task = lease?.task; if (!task) return;
    lease.task = null; task.controller.abort();
    const index = this.queue.indexOf(task);
    if (index !== -1) { this.queue.splice(index, 1); task.reject(aborted()); }
  }
  close(owner) { this.cancel(owner); this.owners.delete(owner); }
  stopAll() { for (const owner of this.owners.keys()) this.close(owner); }
  pump() {
    while (this.active < 2 && this.queue.length) {
      const task = this.queue.shift(); this.active++;
      void Promise.resolve().then(() => { check(task.controller.signal); return this.scan(task.root, task.query, { ...task.options, signal: task.controller.signal }); }).then(result => { check(task.controller.signal); task.resolve(result); }).catch(task.reject).finally(() => {
        for (const lease of this.owners.values()) if (lease.task === task) { lease.task = null; break; }
        this.active--; this.pump();
      });
    }
  }
}
module.exports = { scanFileNames, FileSearches };
