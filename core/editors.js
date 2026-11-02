'use strict';
// "Open in editor": find installed code editors and open a folder or a file at a line.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const EDITORS = [
  { id: 'vscode', name: 'VS Code', bins: ['code'], style: 'goto' },
  { id: 'cursor', name: 'Cursor', bins: ['cursor'], style: 'goto' },
  { id: 'windsurf', name: 'Windsurf', bins: ['windsurf'], style: 'goto' },
  { id: 'zed', name: 'Zed', bins: ['zed', 'zeditor'], style: 'colon' },
  { id: 'codium', name: 'VSCodium', bins: ['codium'], style: 'goto' },
  { id: 'antigravity', name: 'Antigravity IDE', bins: ['antigravity'], style: 'goto' },
  { id: 'sublime', name: 'Sublime Text', bins: ['subl'], style: 'colon' },
  { id: 'idea', name: 'IntelliJ IDEA', bins: ['idea'], style: 'jetbrains' },
];

function editorArgs(id, { path: p, line }) {
  const e = EDITORS.find((x) => x.id === id); if (!e) throw new Error(`Unknown editor ${id}`);
  if (!line) return [p];
  if (e.style === 'goto') return ['-g', `${p}:${line}`];
  if (e.style === 'jetbrains') return ['--line', String(line), p];
  return [`${p}:${line}`];
}

function isExec(p) { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } }

function detectEditors(env = process.env, { extraDirs = [path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/snap/bin'] } = {}) {
  const dirs = [...new Set([...(env.PATH || '').split(path.delimiter), ...extraDirs].filter(Boolean))];
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  const found = [];
  for (const e of EDITORS) {
    let hit = null;
    for (const b of e.bins) { for (const d of dirs) { for (const x of exts) { const c = path.join(d, b + x); if (isExec(c)) { hit = c; break; } } if (hit) break; } if (hit) break; }
    if (hit) found.push({ id: e.id, name: e.name, path: hit });
  }
  return found;
}

function openInEditor(editor, target) {
  const child = spawn(editor.path, editorArgs(editor.id, target), { detached: true, stdio: 'ignore', shell: false });
  child.on('error', () => {});
  child.unref();
}

module.exports = { EDITORS, editorArgs, detectEditors, openInEditor };
