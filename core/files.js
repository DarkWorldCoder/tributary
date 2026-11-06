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
async function findFiles(root, query, options) {
  return (await require('./filename-search').scanFileNames(root, query, options)).files;
}
async function searchProject(root, query, options = {}) {
  options = options && typeof options === 'object' ? options : {};
  const caseSensitive = options.caseSensitive === true; const wholeWord = options.wholeWord === true;
  const regexp = options.regexp === true; const detail = options.detail === true;
  const include = typeof options.include === 'string' ? options.include.trim() : '';
  const exclude = typeof options.exclude === 'string' ? options.exclude.trim() : '';
  if (include.length > 512 || exclude.length > 512) throw new Error('File filters must be up to 512 characters.');
  if (typeof query !== 'string' || !query.trim() || query.length > 512) throw new Error('Enter search text of up to 512 characters.');
  let expression;
  if (regexp) {
    try { expression = new RegExp(query, caseSensitive ? 'g' : 'gi'); }
    catch { throw new Error('Invalid regular expression.'); }
    const { isMainThread, Worker } = require('node:worker_threads');
    if (isMainThread) return new Promise((resolve, reject) => {
      const filename = path.join(__dirname, 'search-worker.cjs').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      const worker = new Worker(filename, { workerData: { root, query, options: { caseSensitive, wholeWord, regexp, detail, include, exclude } } });
      const finish = (error, result) => { clearTimeout(timer); worker.removeAllListeners(); void worker.terminate(); error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => finish(new Error('Search took too long. Simplify the regular expression.')), 3000);
      worker.once('message', (message) => finish(message.error ? new Error(message.error) : null, message.result));
      worker.once('error', (error) => finish(error));
      worker.once('exit', (code) => finish(new Error(`Search worker stopped (${code}).`)));
    });
  }
  // Comma-separated glob filters, as in VS Code's search details. A bare folder
  // includes descendants; a bare filename is matched at any depth.
  const filters = (value) => {
    const parts = []; let start = 0; let depth = 0;
    for (let i = 0; i <= value.length; i++) {
      if (value[i] === '{') depth++;
      else if (value[i] === '}') depth = Math.max(0, depth - 1);
      if (i === value.length || value[i] === ',' && !depth) { const part = value.slice(start, i).trim(); if (part) parts.push(part); start = i + 1; }
    }
    return parts;
  };
  const globMatch = (rel, pattern) => path.matchesGlob(rel, pattern) || path.matchesGlob(rel, `**/${pattern}`) || path.matchesGlob(rel, `${pattern}/**`) || path.matchesGlob(rel, `**/${pattern}/**`);
  const includes = filters(include); const excludes = filters(exclude);
  const base = await fs.realpath(root); const pending = ['']; const matches = []; let scanned = 0; let bytes = 0; let truncated = false;
  const skip = new Set(['.git', 'node_modules', '.venv', 'venv', 'target', 'dist', 'build', '.next', 'vendor', '__pycache__']);
  if (!expression) expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  const word = (char) => !!char && /[\p{L}\p{N}_]/u.test(char);
  while (pending.length && !truncated) {
    const folder = pending.pop();
    let directory;
    try { directory = await fs.opendir(path.join(base, folder)); } catch { continue; }
    for await (const entry of directory) {
      if (++scanned > 20000) { truncated = true; break; }
      const rel = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!skip.has(entry.name) && rel.split('/').length < 20) pending.push(rel); continue; }
      if (!entry.isFile() || (includes.length && !includes.some((pattern) => globMatch(rel, pattern))) || excludes.some((pattern) => globMatch(rel, pattern))) continue;
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
          const line = lines[i];
          let offset = 0;
          if (expression) expression.lastIndex = 0;
          while (offset <= line.length) {
            const found = expression.exec(line);
            const column = found?.index ?? -1;
            if (column < 0) break;
            const length = found[0].length;
            const end = column + length;
            offset = Math.max(end, column + 1);
            if (expression && !length) expression.lastIndex = offset;
            if (wholeWord && (word(line[column - 1]) || word(line[end]))) continue;
            const start = Math.max(0, column - 80);
            const match = { rel, line: i + 1, column: column + 1, text: (start ? '…' : '') + line.slice(start, start + 300) };
            if (detail) { match.matchStart = column - start + (start ? 1 : 0); match.matchLength = length; }
            matches.push(match);
            if (matches.length >= 200) { truncated = true; break; }
            if (!detail) break; // Preserve the original one-result-per-line API.
          }
          if (truncated) break;
        }
      } catch { /* Deleted, inaccessible or escaped entries do not stop other results. */ }
      if (truncated) break;
    }
  }
  return { matches, truncated };
}
module.exports = { readDirectory, projectPath, createEntry, findFiles, searchProject };
