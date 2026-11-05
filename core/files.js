'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
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
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.length > 100000) throw new Error('This folder is too large to list. Open a smaller folder in your external editor.');
  const visible = entries.filter((e) => showHidden || !e.name.startsWith('.')).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name) || (a.name < b.name ? -1 : 1));
  return { entries: visible.slice(offset, offset + limit).map((e) => ({ name: e.name, rel: path.join(rel, e.name).split(path.sep).join('/'), directory: e.isDirectory(), symlink: e.isSymbolicLink() })), next: offset + limit < visible.length ? offset + limit : null, total: visible.length };
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
module.exports = { readDirectory, projectPath, createEntry, findFiles };
