'use strict';
// Small catalog rows are separate from theme/icon payloads. Connections are
// operation-scoped: no process-wide cache of parsed images or SQLite pages.
const fs = require('node:fs'); const path = require('node:path');
let DatabaseSync; try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* Older standalone Node keeps the JSON format. */ }
const MAX_PACK = 100 * 1024 * 1024;
const summary = (pack) => ({ id: pack.id, name: pack.name, publisher: pack.publisher, version: pack.version, hasRuntime: pack.hasRuntime, themes: pack.themes.map(({ id, label, dark }) => ({ id, label, dark })), iconThemes: pack.iconThemes.map(({ id, label }) => ({ id, label })) });
class ExtensionCache {
  constructor(dir, { database = DatabaseSync } = {}) { this.dir = dir; this.Database = database; this.migrations = new Map(); this.migrationTail = Promise.resolve(); }
  filename(id) { if (typeof id !== 'string' || !/^[a-z\d][a-z\d_.-]{0,201}$/i.test(id)) throw new Error('Invalid extension pack.'); return path.join(this.dir, `${id}.json`); }
  withDatabase(fn, transaction = false) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, 'catalog.sqlite'); const db = new this.Database(file);
    try {
      try { fs.chmodSync(file, 0o600); } catch { /* unsupported filesystem */ }
      db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS packs(id TEXT PRIMARY KEY, summary TEXT);
        CREATE TABLE IF NOT EXISTS contributions(pack TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE, kind TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(pack, kind, id));`);
      if (transaction) db.exec('BEGIN');
      try { const value = fn(db); if (transaction) db.exec('COMMIT'); return value; }
      catch (error) { if (transaction) { try { db.exec('ROLLBACK'); } catch {} } throw error; }
    } finally { db.close(); }
  }
  async legacyRead(id) {
    const file = this.filename(id);
    if ((await fs.promises.stat(file)).size > MAX_PACK) throw new Error('Invalid extension cache.');
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  }
  persist(pack, onlyIfAbsent = false) {
    this.filename(pack.id); const head = summary(pack);
    if (pack.themes.length > 100 || pack.iconThemes.length > 40) throw new Error('Invalid extension contributions.');
    const header = JSON.stringify(head); if (Buffer.byteLength(header) > 256 * 1024) throw new Error('Extension catalog entry is too large.');
    this.withDatabase((db) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (onlyIfAbsent && db.prepare('SELECT 1 FROM packs WHERE id=?').get(pack.id)) { db.exec('COMMIT'); return; }
        db.prepare('INSERT INTO packs(id, summary) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary').run(pack.id, header);
        db.prepare('DELETE FROM contributions WHERE pack=?').run(pack.id);
        const put = db.prepare('INSERT INTO contributions(pack, kind, id, ordinal, data) VALUES(?, ?, ?, ?, ?)'); let bytes = Buffer.byteLength(header);
        for (const kind of ['themes', 'iconThemes']) for (const [ordinal, item] of pack[kind].entries()) {
          if (typeof item.id !== 'string' || !item.id.startsWith(`${pack.id}:`)) throw new Error('Invalid extension contribution identity.');
          const data = JSON.stringify(item); bytes += Buffer.byteLength(data); if (bytes > MAX_PACK + 256 * 1024) throw new Error('Invalid extension cache size.');
          put.run(pack.id, kind, item.id, ordinal, data);
        }
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    });
    return head;
  }
  async archiveLegacy(id) { const file = this.filename(id); await fs.promises.rename(file, `${file}.migrated`).catch(() => {}); }
  async ensurePack(id) {
    this.filename(id);
    if (!this.Database) return;
    if (this.migrations.has(id)) return this.migrations.get(id);
    if (this.migrations.size >= 64) throw new Error('Extension cache migration queue is full. Try again shortly.');
    const migration = this.migrationTail.then(async () => {
      if (this.withDatabase((db) => !!db.prepare('SELECT 1 FROM packs WHERE id=?').get(id))) return;
      let pack;
      try { pack = await this.legacyRead(id); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (pack.id !== id) throw new Error('Invalid extension cache identity.');
      try { this.persist(pack, true); } catch { return pack; } // Preserve a readable legacy pack if an upgrade cannot write.
      await this.archiveLegacy(id);
    });
    // The queue retains no full pack result after a job completes, and errors do not poison it.
    this.migrationTail = migration.then(() => undefined, () => undefined);
    this.migrations.set(id, migration);
    try { return await migration; } finally { if (this.migrations.get(id) === migration) this.migrations.delete(id); }
  }
  async install(pack) {
    if (this.Database) { const result = this.persist(pack); await this.archiveLegacy(pack.id); return result; }
    await fs.promises.mkdir(this.dir, { recursive: true }); const file = this.filename(pack.id); const temp = `${file}.${require('node:crypto').randomUUID()}.tmp`;
    try { const data = JSON.stringify(pack); if (Buffer.byteLength(data) > MAX_PACK) throw new Error('Invalid extension cache size.'); await fs.promises.writeFile(temp, data, { mode: 0o600 }); await fs.promises.rename(temp, file); return summary(pack); }
    finally { await fs.promises.rm(temp, { force: true }); }
  }
  async list() {
    // Legacy migration is sequential. A one-time upgrade must not parse every
    // installed image pack concurrently, or retain those objects in a cache.
    const names = await fs.promises.readdir(this.dir).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
    const legacy = [];
    for (const name of names) if (name.endsWith('.json')) {
      try { if (this.Database) { const fallback = await this.ensurePack(name.slice(0, -5)); if (fallback) legacy.push(summary(fallback)); } else legacy.push(summary(await this.legacyRead(name.slice(0, -5)))); } catch { /* retain invalid legacy files for inspection; other packs remain usable */ }
    }
    if (!this.Database) return legacy;
    return this.withDatabase((db) => { const rows = new Map(legacy.map((pack) => [pack.id, pack])); for (const row of db.prepare('SELECT summary FROM packs WHERE summary IS NOT NULL ORDER BY id').iterate()) { const pack = JSON.parse(row.summary); rows.set(pack.id, pack); } return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)); });
  }
  async read(id) {
    if (!this.Database) return this.legacyRead(id);
    const fallback = await this.ensurePack(id); if (fallback) return fallback;
    return this.withDatabase((db) => {
      const row = db.prepare('SELECT summary FROM packs WHERE id=?').get(id); if (!row?.summary) throw new Error('Extension pack not found.');
      const pack = JSON.parse(row.summary); pack.themes = []; pack.iconThemes = [];
      for (const item of db.prepare('SELECT kind, data FROM contributions WHERE pack=? ORDER BY kind, ordinal').iterate(id)) pack[item.kind].push(JSON.parse(item.data));
      return pack;
    }, true);
  }
  async appearance(themeId, iconsId) {
    const requested = [{ id: themeId, kind: 'themes', key: 'theme' }, { id: iconsId, kind: 'iconThemes', key: 'icons' }].filter((item) => item.id);
    if (!requested.length) return { theme: null, icons: null };
    const ids = [...new Set(requested.map((item) => item.id.split(':')[0]))];
    if (!this.Database) {
      const result = { theme: null, icons: null };
      for (const id of ids) { const pack = await this.legacyRead(id); for (const item of requested) if (item.id.split(':')[0] === id) result[item.key] = pack[item.kind].find((entry) => entry.id === item.id) || null; }
      return result;
    }
    const fallbacks = new Map();
    for (const id of ids) { const fallback = await this.ensurePack(id); if (fallback) fallbacks.set(id, fallback); }
    return this.withDatabase((db) => {
      const get = db.prepare('SELECT data FROM contributions WHERE pack=? AND kind=? AND id=?'); const result = { theme: null, icons: null };
      for (const item of requested) { const id = item.id.split(':')[0]; const fallback = fallbacks.get(id); if (fallback) result[item.key] = fallback[item.kind].find((entry) => entry.id === item.id) || null; else { const row = get.get(id, item.kind, item.id); if (row) result[item.key] = JSON.parse(row.data); } }
      return result;
    }, true); // One consistent snapshot if an install/removal commits concurrently.
  }
  async remove(id) {
    const file = this.filename(id);
    // Remove any unmigrated source first, so a later list cannot reinstall it.
    await fs.promises.rm(file, { force: true });
    await fs.promises.rm(`${file}.migrated`, { force: true });
    if (this.Database) this.withDatabase((db) => {
      db.prepare('INSERT INTO packs(id, summary) VALUES(?, NULL) ON CONFLICT(id) DO UPDATE SET summary=NULL').run(id);
      db.prepare('DELETE FROM contributions WHERE pack=?').run(id);
    }, true); // A tombstone prevents an in-flight legacy migration from resurrecting an uninstall.
  }
}
module.exports = { ExtensionCache, summary };
