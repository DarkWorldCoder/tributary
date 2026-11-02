'use strict';
// Small JSON store with atomic writes.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, defaults) {
    this.file = file;
    try { this.data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { this.data = JSON.parse(JSON.stringify(defaults)); }
    this.timer = null;
  }
  save(now = false) {
    const write = () => {
      this.timer = null;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      fs.renameSync(tmp, this.file);
    };
    if (now) { if (this.timer) clearTimeout(this.timer); write(); return; }
    if (!this.timer) this.timer = setTimeout(write, 300);
  }
}

// In-memory secret store (used in tests). Desktop and VS Code supply encrypted ones.
class MemorySecrets { constructor() { this.m = new Map(); } async get(k) { return this.m.get(k); } async set(k, v) { this.m.set(k, v); } async delete(k) { this.m.delete(k); } }

module.exports = { Store, MemorySecrets };
