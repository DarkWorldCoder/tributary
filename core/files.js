'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { directoryPage, compareDirectoryEntries } = require('./directory-page');
function contained(root, target) { const r = path.relative(root, target); return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r)); }
async function projectPath(root, rel, create = false) {
  if (typeof rel !== 'string' || rel.includes('\0') || path.isAbsolute(rel)) throw new Error('Choose a relative path inside the project.');
  const base = await fs.realpath(root); const target = path.resolve(base, rel);
  if (!contained(base, target)) throw new Error('Path outside project');
  let ancestor = target;
  while (true) {
    try { const real = await fs.realpath(ancestor); if (!contained(base, real)) throw new Error('Path outside project: symbolic link leaves the folder'); return ancestor === target ? real : path.join(real, path.relative(ancestor, target)); }
    catch (e) { if (e.code !== 'ENOENT' || !create || ancestor === base) throw e; ancestor = path.dirname(ancestor); }
  }
}
async function readDirectory(root, rel = '', { showHidden = false, offset = 0, limit = 200 } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid folder page.');
  const dir = await projectPath(root, rel);
  let selected;
  if (offset + limit <= 4096) {
    selected = await directoryPage(await fs.opendir(dir, { bufferSize: 256 }), { showHidden, offset, limit });
  } else {
    // Deep pages need most of the prefix anyway. The measured native bulk-read
    // path is faster there than building a large selection heap entry by entry.
    const entries = await fs.readdir(dir, { withFileTypes: true });
    if (entries.length > 100000) throw new Error('This folder is too large to list. Open a smaller folder in your external editor.');
    const visible = entries.filter(e => showHidden || !e.name.startsWith('.')).sort(compareDirectoryEntries);
    selected = { entries: visible.slice(offset, offset + limit), next: offset + limit < visible.length ? offset + limit : null, total: visible.length };
  }
  const page = await Promise.all(selected.entries.map(async (e) => {
    const entry = { name: e.name, rel: path.join(rel, e.name).split(path.sep).join('/'), directory: e.isDirectory(), symlink: e.isSymbolicLink() };
    // pnpm and other package managers expose dependencies as directory links.
    // Resolve only this bounded page and keep the project containment checks.
    if (entry.symlink) {
      try { entry.directory = (await fs.stat(await projectPath(root, entry.rel))).isDirectory(); }
      catch { /* Broken or external links stay visible; opening reports the cause. */ }
    }
    return entry;
  }));
  return { entries: page, next: selected.next, total: selected.total };
}
async function createEntry(root, rel, kind) {
  if (!['file', 'folder'].includes(kind) || typeof rel !== 'string' || !rel.trim() || rel.split(/[\\/]/).some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error('Choose a file or folder name inside the project.');
  const target = await projectPath(root, rel, true);
  // Require an existing parent; never overwrite existing files or follow a final symlink.
  await projectPath(root, path.dirname(rel));
  if (kind === 'folder') await fs.mkdir(target);
  else { const handle = await fs.open(target, 'wx', 0o600); await handle.close(); }
  return { rel: path.relative(await fs.realpath(root), target).split(path.sep).join('/'), kind };
}
async function findFiles(root, query, { showHidden = true } = {}) {
  if (typeof query !== 'string' || query.length > 512) throw new Error('Invalid file search.');
  const needle = query.trim().toLowerCase(); if (!needle) return [];
  const base = await fs.realpath(root); const pending = ['']; const found = [];
  const skip = new Set(['.git', 'node_modules', '.venv', 'venv', 'target', 'dist', 'build', '.next']); let visited = 0;
  while (pending.length && visited < 20000 && found.length < 2000) {
    const rel = pending.pop(); let entries;
    try { entries = await fs.readdir(path.join(base, rel), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++visited > 20000 || found.length >= 2000) break;
      if (entry.isSymbolicLink() || skip.has(entry.name) || !showHidden && entry.name.startsWith('.')) continue;
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (name.split('/').length < 20) pending.push(name); }
      else if (entry.isFile() && name.toLowerCase().includes(needle)) found.push(name);
    }
  }
  return found.sort();
}
async function searchProject(root, query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 512) throw new Error('Enter search text of up to 512 characters.');
  const base = await fs.realpath(root); const pending = ['']; const matches = []; let scanned = 0; let bytes = 0; let truncated = false;
  const skip = new Set(['.git', 'node_modules', '.venv', 'venv', 'target', 'dist', 'build', '.next', 'vendor', '__pycache__']);
  const needle = query.toLowerCase();
  while (pending.length && !truncated) {
    const folder = pending.pop();
    let directory;
    try { directory = await fs.opendir(path.join(base, folder)); } catch { continue; }
    for await (const entry of directory) {
      if (++scanned > 20000) { truncated = true; break; }
      const rel = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!skip.has(entry.name) && rel.split('/').length < 20) pending.push(rel); continue; }
      if (!entry.isFile()) continue;
      try {
        // Recheck containment at read time, and bound both individual reads and the scan.
        const handle = await fs.open(await projectPath(base, rel), 'r');
        let buffer;
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 1024 * 1024) continue;
          if (bytes + stat.size > 16 * 1024 * 1024) { truncated = true; break; }
          buffer = Buffer.alloc(stat.size); const read = await handle.read(buffer, 0, buffer.length, 0); buffer = buffer.subarray(0, read.bytesRead); bytes += read.bytesRead;
        } finally { await handle.close(); }
        if (buffer.subarray(0, 8000).includes(0)) continue;
        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const column = lines[i].toLowerCase().indexOf(needle);
          if (column < 0) continue;
          const start = Math.max(0, column - 80);
          matches.push({ rel, line: i + 1, column: column + 1, text: (start ? '…' : '') + lines[i].slice(start, start + 300) });
          if (matches.length >= 200) { truncated = true; break; }
        }
      } catch { /* Deleted, inaccessible or escaped entries do not stop other results. */ }
      if (truncated) break;
    }
  }
  return { matches, truncated };
}
module.exports = { readDirectory, projectPath, createEntry, findFiles, searchProject };
