'use strict';
// Hub data: projects, threads, gateways, notifications and settings.
// SqliteStore keeps them in tributary.db, one row per thread, message, project, gateway, notification and setting,
// so the desktop app and the CLI can use one data folder at once: each process writes only the rows it changed
// and picks up the other's rows. Store is the older single-process JSON file, used where node:sqlite is missing.
const fs = require('fs');
const path = require('path');

let sqlite = null;
try { sqlite = require('node:sqlite'); } catch { /* Node without SQLite: JSON fallback */ }

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
  sync() { return null; }
  watch() {}
  close() { if (this.timer) this.save(true); }
}

const SEP = '\u0000';
const keyOf = (coll, id) => `${coll}${SEP}${id}`;
const LISTS = { projects: 'path', gateways: 'id', notifications: 'id' };
const KNOWN = new Set(['version', 'threads', 'settings', ...Object.keys(LISTS)]);
// These keep a natural order across processes. Messages and gateways keep the position they were first saved at.
const ORDER = { projects: (p) => p.addedAt || 0, notifications: (n) => -(n.ts || 0), threads: (t) => t.createdAt || 0 };
const metaJson = ({ messages, ...meta }) => JSON.stringify(meta);
const replace = (target, src) => { for (const k of Object.keys(target)) delete target[k]; return Object.assign(target, src); };
// Changed here since the last read or write of that row (so a row from another process must not replace it).
const dirty = (local, prev) => (prev ? local !== prev.json : local !== undefined);

class SqliteStore {
  constructor(dir, defaults) {
    this.file = path.join(dir, 'tributary.db');
    this.defaults = defaults;
    this.timer = null; this.poll = null; this.listener = null;
    fs.mkdirSync(dir, { recursive: true });
    this.db = new sqlite.DatabaseSync(this.file);
    try { fs.chmodSync(this.file, 0o600); } catch { /* not supported here */ }
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS clock(id INTEGER PRIMARY KEY CHECK(id = 1), rev INTEGER NOT NULL);
      INSERT OR IGNORE INTO clock VALUES(1, 0);
      CREATE TABLE IF NOT EXISTS records(coll TEXT NOT NULL, id TEXT NOT NULL, pos REAL NOT NULL, rev INTEGER NOT NULL, data TEXT, PRIMARY KEY(coll, id));
      CREATE INDEX IF NOT EXISTS records_rev ON records(rev);`);
    // data is NULL for a deleted row, so other processes learn about the deletion.
    this.q = {
      upsert: this.db.prepare('INSERT INTO records(coll, id, pos, rev, data) VALUES(?, ?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET pos = excluded.pos, rev = excluded.rev, data = excluded.data'),
      tick: this.db.prepare('UPDATE clock SET rev = rev + 1 WHERE id = 1 RETURNING rev'),
      since: this.db.prepare('SELECT coll, id, pos, rev, data FROM records WHERE rev > ? ORDER BY rev'),
      all: this.db.prepare('SELECT coll, id, pos, data FROM records WHERE data IS NOT NULL ORDER BY pos, rev'),
      rev: this.db.prepare('SELECT rev FROM clock WHERE id = 1'),
      version: this.db.prepare('PRAGMA data_version'),
      meta: this.db.prepare('SELECT value FROM meta WHERE key = ?'),
      setMeta: this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?, ?)'),
    };
    this.migrate(path.join(dir, 'hub.json'));
    this.load();
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const v = fn(); this.db.exec('COMMIT'); return v; } catch (e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; }
  }

  // One-time import of the JSON file earlier versions wrote. The file is kept as hub.json.migrated.
  migrate(legacy) {
    if (this.q.meta.get('migrated')) return;
    let old = null;
    if (fs.existsSync(legacy)) { try { old = JSON.parse(fs.readFileSync(legacy, 'utf8')); } catch { return; } }
    const moved = this.tx(() => {
      if (this.q.meta.get('migrated')) return false;
      if (old) {
        this.snap = new Map(); this.data = { ...JSON.parse(JSON.stringify(this.defaults)), ...old };
        const { rev } = this.q.tick.get();
        for (const r of this.collect().values()) this.q.upsert.run(r.coll, r.id, r.pos, rev, r.json);
      }
      this.q.setMeta.run('migrated', old ? new Date().toISOString() : 'nothing to import');
      return !!old;
    });
    if (moved) try { fs.renameSync(legacy, `${legacy}.migrated`); } catch { /* another process moved it */ }
  }

  load() {
    this.db.exec('BEGIN');
    let rows;
    try { this.version = this.q.version.get().data_version; rows = this.q.all.all(); this.lastRev = this.q.rev.get().rev; } finally { this.db.exec('COMMIT'); }
    const data = JSON.parse(JSON.stringify(this.defaults));
    for (const k of [...Object.keys(LISTS), 'threads']) data[k] = [];
    this.snap = new Map();
    const byId = new Map();
    const msgs = [];
    for (const r of rows) {
      if (r.coll.startsWith('m:')) { msgs.push(r); continue; }
      const value = JSON.parse(r.data);
      if (r.coll === 'threads') { const t = { ...value, messages: [] }; data.threads.push(t); byId.set(r.id, t); }
      else if (LISTS[r.coll]) data[r.coll].push(value);
      else if (r.coll === 'settings') data.settings[r.id] = value;
      else if (r.coll === 'data') data[r.id] = value;
      else continue;
      this.snap.set(keyOf(r.coll, r.id), { json: r.data, pos: r.pos });
    }
    for (const r of msgs) {
      const t = byId.get(r.coll.slice(2)); if (!t) continue;
      t.messages.push(JSON.parse(r.data));
      this.snap.set(keyOf(r.coll, r.id), { json: r.data, pos: r.pos });
    }
    // Unsaved defaults are not local edits: a setting saved by another process replaces them.
    for (const [k, v] of Object.entries(data.settings)) { const key = keyOf('settings', k); if (!this.snap.has(key)) this.snap.set(key, { json: JSON.stringify(v ?? null), pos: 0, virtual: true }); }
    this.data = data;
  }

  // Every row of the in-memory data, keyed like the snapshot.
  collect() {
    const out = new Map(); const d = this.data;
    const list = (coll, items, idOf, valueOf, order) => {
      let max = -1;
      for (const it of items) { const p = this.snap.get(keyOf(coll, idOf(it)))?.pos; if (p != null && p > max) max = p; }
      for (const it of items) {
        const id = idOf(it); if (id == null) continue;
        const k = keyOf(coll, id);
        out.set(k, { coll, id: String(id), pos: order ? order(it) : (this.snap.get(k)?.pos ?? ++max), json: valueOf(it) });
      }
    };
    for (const coll of Object.keys(LISTS)) list(coll, d[coll] || [], (x) => x[LISTS[coll]], JSON.stringify, ORDER[coll]);
    list('threads', d.threads || [], (t) => t.id, metaJson, ORDER.threads);
    for (const t of d.threads || []) list(`m:${t.id}`, t.messages || [], (m) => m.id, JSON.stringify);
    for (const [k, v] of Object.entries(d.settings || {})) out.set(keyOf('settings', k), { coll: 'settings', id: k, pos: 0, json: JSON.stringify(v ?? null) });
    for (const [k, v] of Object.entries(d)) if (!KNOWN.has(k) && v !== undefined) out.set(keyOf('data', k), { coll: 'data', id: k, pos: 0, json: JSON.stringify(v) });
    return out;
  }

  // Write the rows that changed since they were last read or written, in one transaction.
  flush() {
    const rows = this.collect();
    const writes = []; const gone = [];
    for (const [k, r] of rows) { const prev = this.snap.get(k); if (!prev || prev.json !== r.json || prev.pos !== r.pos) writes.push([k, r]); }
    for (const [k, prev] of this.snap) if (!rows.has(k) && !prev.virtual) gone.push([k, prev]);
    if (!writes.length && !gone.length) return;
    this.tx(() => {
      const { rev } = this.q.tick.get();
      for (const [, r] of writes) this.q.upsert.run(r.coll, r.id, r.pos, rev, r.json);
      for (const [k, prev] of gone) { const [coll, id] = k.split(SEP); this.q.upsert.run(coll, id, prev.pos, rev, null); }
    });
    for (const [k, r] of writes) this.snap.set(k, { json: r.json, pos: r.pos });
    for (const [k] of gone) this.snap.delete(k);
  }

  save(now = false) {
    if (this.closed) return; // quitting: turns still winding down have nothing left to write to
    if (now) { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.flush(); return; }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        try { this.flush(); } catch (e) { console.error(`Tributary could not save its data, retrying: ${e.message}`); this.save(); }
      }, 300);
    }
  }

  // Apply rows other processes wrote since the last look. Rows changed here and not yet saved win.
  // Returns what changed ({ state, projects, messages }) or null, and tells the watch() listener.
  sync() {
    if (this.closed) return null;
    const v = this.q.version.get().data_version;
    if (v === this.version) return null;
    this.version = v;
    const rows = this.q.since.all(this.lastRev);
    if (!rows.length) return null;
    this.lastRev = rows[rows.length - 1].rev;
    const change = { state: false, projects: new Set(), messages: [] };
    const touched = new Set();
    rows.sort((a, b) => Number(a.coll.startsWith('m:')) - Number(b.coll.startsWith('m:')));
    for (const r of rows) this.apply(r, change, touched);
    const pos = (coll, id) => this.snap.get(keyOf(coll, id))?.pos ?? Infinity;
    for (const t of touched) t.messages.sort((a, b) => pos(`m:${t.id}`, a.id) - pos(`m:${t.id}`, b.id));
    if (change.state) {
      this.data.projects.sort((a, b) => ORDER.projects(a) - ORDER.projects(b));
      this.data.notifications.sort((a, b) => ORDER.notifications(a) - ORDER.notifications(b));
      this.data.gateways.sort((a, b) => pos('gateways', a.id) - pos('gateways', b.id));
    }
    if (!change.state && !change.projects.size && !change.messages.length) return null;
    if (this.listener) this.listener(change);
    return change;
  }

  apply(r, change, touched) {
    const k = keyOf(r.coll, r.id); const prev = this.snap.get(k); const d = this.data;
    if (prev && prev.json === r.data && prev.pos === r.pos) return;
    if (!prev && r.data == null) return;
    const value = r.data == null ? null : JSON.parse(r.data);
    if (r.coll.startsWith('m:')) {
      const t = d.threads.find((x) => x.id === r.coll.slice(2));
      if (!t) { if (r.data == null) this.snap.delete(k); return; }
      const i = t.messages.findIndex((m) => m.id === r.id);
      if (dirty(i >= 0 ? JSON.stringify(t.messages[i]) : undefined, prev)) return;
      if (value == null) { if (i >= 0) t.messages.splice(i, 1); }
      else { const m = i >= 0 ? replace(t.messages[i], value) : value; if (i < 0) t.messages.push(m); touched.add(t); change.messages.push({ threadId: t.id, message: m }); }
      change.projects.add(t.project);
    } else if (r.coll === 'threads') {
      const i = d.threads.findIndex((x) => x.id === r.id);
      if (dirty(i >= 0 ? metaJson(d.threads[i]) : undefined, prev)) return;
      if (value == null) { if (i >= 0) { change.projects.add(d.threads[i].project); d.threads.splice(i, 1); } }
      else {
        if (i >= 0) { const t = d.threads[i]; const { messages } = t; replace(t, value).messages = messages; } else d.threads.push({ ...value, messages: [] });
        change.projects.add(value.project);
      }
    } else if (LISTS[r.coll]) {
      const list = d[r.coll]; const i = list.findIndex((x) => String(x[LISTS[r.coll]]) === r.id);
      if (dirty(i >= 0 ? JSON.stringify(list[i]) : undefined, prev)) return;
      if (value == null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) replace(list[i], value); else list.push(value);
      change.state = true;
    } else if (r.coll === 'settings' || r.coll === 'data') {
      const target = r.coll === 'settings' ? d.settings : d;
      const has = Object.prototype.hasOwnProperty.call(target, r.id);
      if (dirty(has ? JSON.stringify(target[r.id] ?? null) : undefined, prev)) return;
      if (value == null && r.data == null) delete target[r.id]; else target[r.id] = value;
      change.state = true;
    } else return; // written by a newer version; leave it alone
    if (r.data == null) this.snap.delete(k); else this.snap.set(k, { json: r.data, pos: r.pos });
  }

  // Poll for other processes' writes (cheap: one pragma unless something changed).
  watch(fn, ms = 1000) {
    this.listener = fn;
    if (!this.poll) { this.poll = setInterval(() => { try { this.sync(); } catch (e) { console.error(`Tributary could not read shared data: ${e.message}`); } }, ms); this.poll.unref?.(); }
  }

  close() {
    if (this.closed) return;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (this.timer) this.save(true);
    this.closed = true;
    this.db.close();
  }
}

// The data folder's store: SQLite when this Node has it, else the JSON file.
function openStore(dir, defaults) { return sqlite ? new SqliteStore(dir, defaults) : new Store(path.join(dir, 'hub.json'), defaults); }

// In-memory secret store (used in tests). Desktop and VS Code supply encrypted ones.
class MemorySecrets { constructor() { this.m = new Map(); } async get(k) { return this.m.get(k); } async set(k, v) { this.m.set(k, v); } async delete(k) { this.m.delete(k); } }

module.exports = { Store, SqliteStore, openStore, MemorySecrets };
