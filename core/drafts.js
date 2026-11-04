'use strict';
// Unsaved work the window has not written anywhere else yet: the message being typed and edited files.
// One private file per key in <data>/drafts, replaced by rename, so a crash or forced quit loses at most
// the last pause in typing and never leaves half a draft. Old drafts expire; the folder has size limits.
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const MAX_DRAFT = 16 * 1024 * 1024; const MAX_TOTAL = 64 * 1024 * 1024; const MAX_DRAFTS = 200; const MAX_AGE = 30 * 24 * 3600e3;

function directory(dataDir) { const dir = path.join(dataDir, 'drafts'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }
function fileOf(dataDir, key) {
  if (typeof key !== 'string' || !key || key.length > 4096 || key.includes('\0')) throw new Error('Invalid draft.');
  return path.join(directory(dataDir), crypto.createHash('sha256').update(key).digest('hex').slice(0, 40) + '.json');
}

function read(dataDir, key, now = Date.now()) {
  const file = fileOf(dataDir, key);
  let saved; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!saved || saved.key !== key) return null;
  if (!(now - saved.savedAt < MAX_AGE)) { fs.rmSync(file, { force: true }); return null; }
  return saved.data ?? null;
}

// data null or undefined removes the draft.
function save(dataDir, key, data, now = Date.now()) {
  const file = fileOf(dataDir, key);
  if (data == null) { fs.rmSync(file, { force: true }); return null; }
  const json = JSON.stringify({ key, savedAt: now, data });
  if (Buffer.byteLength(json) > MAX_DRAFT) throw new Error('These unsaved changes are larger than 16 MB, so they are not kept for recovery. Save them to keep them.');
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, json, { mode: 0o600 }); fs.renameSync(tmp, file); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return now;
}

// Expired drafts and leftovers go first; then the oldest, until the folder is within its limits.
function prune(dataDir, now = Date.now()) {
  const dir = directory(dataDir); const kept = [];
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name); let st; try { st = fs.lstatSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    const age = now - st.mtimeMs;
    // Another process may be writing a .tmp file right now.
    if (name.endsWith('.tmp')) { if (age > 60e3) fs.rmSync(file, { force: true }); continue; }
    if (!/^[a-f0-9]{40}\.json$/.test(name)) continue;
    if (age >= MAX_AGE) { fs.rmSync(file, { force: true }); continue; }
    kept.push({ file, size: st.size, mtime: st.mtimeMs });
  }
  kept.sort((a, b) => b.mtime - a.mtime);
  let total = 0; let removed = 0;
  kept.forEach((entry, i) => { total += entry.size; if (i >= MAX_DRAFTS || total > MAX_TOTAL) { fs.rmSync(entry.file, { force: true }); removed++; } });
  return removed;
}

module.exports = { directory, read, save, prune, MAX_DRAFT, MAX_DRAFTS, MAX_AGE };
