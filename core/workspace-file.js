'use strict';
// VS Code-compatible local folder lists. Settings/tasks/extensions are kept as
// document data; opening a workspace does not execute or import those settings.
const fs = require('node:fs'); const path = require('node:path'); const { fileURLToPath } = require('node:url');
const jsonc = require('jsonc-parser');
function parseWorkspace(filename, text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 256 * 1024) throw new Error('Choose a workspace file up to 256 KB.');
  const errors = []; const data = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !data || !Array.isArray(data.folders) || !data.folders.length || data.folders.length > 33) throw new Error('Choose a workspace with 1–33 local folders.');
  const folders = data.folders.map((folder) => {
    if (!folder || typeof folder !== 'object') throw new Error('Invalid workspace folder.');
    let absolute;
    if (typeof folder.path === 'string' && folder.path && !folder.path.includes('\0')) absolute = path.resolve(path.dirname(filename), folder.path);
    else if (typeof folder.uri === 'string' && folder.uri.startsWith('file:')) absolute = fileURLToPath(folder.uri);
    else throw new Error('This workspace uses a non-local folder. Open a local workspace.');
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) throw new Error(`Workspace folder not found: ${absolute}`);
    return fs.realpathSync(absolute);
  });
  return [...new Set(folders)];
}
function serializeWorkspace(filename, folders, previous = '{}\n') {
  if (!Array.isArray(folders) || !folders.length || folders.length > 33) throw new Error('Choose 1–33 workspace folders.');
  const errors = []; const data = jsonc.parse(previous, errors, { allowTrailingComma: true });
  if (errors.length || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The existing workspace file has invalid JSON. It was not overwritten.');
  const values = folders.map((folder) => {
    const existing = (Array.isArray(data.folders) ? data.folders : []).find((entry) => {
      try { return typeof entry.path === 'string' ? path.resolve(path.dirname(filename), entry.path) === folder : typeof entry.uri === 'string' && fileURLToPath(entry.uri) === folder; } catch { return false; }
    });
    const relative = path.relative(path.dirname(filename), folder);
    const value = existing ? { ...existing } : {};
    if (typeof existing?.path === 'string' || !existing?.uri) value.path = (existing && path.isAbsolute(existing.path) || path.isAbsolute(relative) ? folder : relative || '.').split(path.sep).join('/');
    return value;
  });
  if (JSON.stringify(data.folders) === JSON.stringify(values)) return previous;
  const indent = /\n([ \t]+)\S/.exec(previous)?.[1] || '  ';
  const formattingOptions = { insertSpaces: !indent.startsWith('\t'), tabSize: indent.startsWith('\t') ? 4 : indent.length, eol: previous.includes('\r\n') ? '\r\n' : '\n' };
  return jsonc.applyEdits(previous, jsonc.modify(previous, ['folders'], values, { formattingOptions }));
}
module.exports = { parseWorkspace, serializeWorkspace };
