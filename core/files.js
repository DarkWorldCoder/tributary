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
module.exports = { readDirectory, projectPath };
