'use strict';
// Explicit stdin/stdout formatting. No shell, file writes, package installs, or project scripts.
const fs = require('node:fs'); const path = require('node:path');
const { projectPath } = require('./files'); const { which } = require('./agents'); const { start, killTree } = require('./proc');
const LIMIT = 2 * 1024 * 1024;
const FORMATTERS = [
  { id: 'gofmt', name: 'Go', command: 'gofmt', docs: 'https://pkg.go.dev/cmd/gofmt' },
  { id: 'rustfmt', name: 'Rust', command: 'rustfmt', docs: 'https://github.com/rust-lang/rustfmt' },
  { id: 'ruff', name: 'Python', command: 'ruff', docs: 'https://docs.astral.sh/ruff/installation/' },
  { id: 'black', name: 'Python (alternative)', command: 'black', docs: 'https://black.readthedocs.io/en/stable/getting_started.html' },
  { id: 'clang-format', name: 'C / C++ / C# / Java / Objective-C', command: 'clang-format', docs: 'https://clang.llvm.org/docs/ClangFormat.html' },
  { id: 'zig', name: 'Zig', command: 'zig', docs: 'https://ziglang.org/learn/getting-started/' },
  { id: 'shfmt', name: 'Shell / Bash', command: 'shfmt', docs: 'https://github.com/mvdan/sh' },
  { id: 'stylua', name: 'Lua / Luau', command: 'stylua', docs: 'https://github.com/JohnnyMorganz/StyLua' },
  { id: 'taplo', name: 'TOML', command: 'taplo', docs: 'https://taplo.tamasfe.dev/cli/installation/binary.html' },
];
function rustEdition(root, filename) {
  let dir = path.dirname(filename);
  while (dir === root || dir.startsWith(root + path.sep)) {
    try { const file = path.join(dir, 'Cargo.toml'); if (fs.statSync(file).size < 128 * 1024) { const edition = /^\s*edition\s*=\s*["'](2015|2018|2021|2024)["']/m.exec(fs.readFileSync(file, 'utf8')); if (edition) return edition[1]; } } catch {}
    if (dir === root) break; dir = path.dirname(dir);
  }
  return '2021';
}
async function formatSource(root, rel, text, { env = process.env, timeoutMs = 10000, respectConfig = false } = {}) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024 || text.includes('\0')) throw new Error('Format a text file up to 1 MB.');
  const filename = await projectPath(root, rel); const ext = path.extname(filename).slice(1).toLowerCase();
  let tools;
  if (ext === 'go') tools = [['gofmt', []]];
  else if (ext === 'rs') tools = [['rustfmt', ['--emit', 'stdout', '--edition', rustEdition(await fs.promises.realpath(root), filename), '--config', 'skip_children=true']]];
  else if (['py', 'pyi'].includes(ext)) tools = [['ruff', ['format', ...(respectConfig ? [] : ['--isolated']), '--stdin-filename', filename, '-']], ['black', [...(respectConfig ? [] : ['--isolated']), '--quiet', '--stdin-filename', filename, '-']]];
  else if (['c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx', 'java', 'cs', 'm', 'mm'].includes(ext)) tools = [['clang-format', ['--style=file', `--assume-filename=${filename}`]]];
  else if (ext === 'zig') tools = [['zig', ['fmt', '--stdin']]];
  else if (['sh', 'bash', 'bats'].includes(ext)) tools = [['shfmt', ['-filename', filename]]];
  else if (['lua', 'luau'].includes(ext)) tools = [['stylua', ['--stdin-filepath', filename, '-']]];
  else if (ext === 'toml') tools = [['taplo', ['format', '-']]];
  else throw new Error('No formatter is available for this file type.');
  const tool = tools.map(([name, args]) => ({ name, args, bin: which(name, env) })).find((entry) => entry.bin && !/\.(cmd|bat)$/i.test(entry.bin));
  if (!tool) throw new Error(`Install ${tools.map(([name]) => name).join(' or ')} to format this file.`);
  return new Promise((resolve, reject) => {
    const child = start(tool.bin, tool.args, { cwd: path.dirname(filename), env, stdin: text });
    let output = ''; let error = ''; let size = 0; let settled = false;
    const finish = (failure) => { if (settled) return; settled = true; clearTimeout(timer); if (failure) { killTree(child); reject(failure); } else resolve(output); };
    const timer = setTimeout(() => finish(new Error('Formatting took too long. Your draft is unchanged.')), timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { size += Buffer.byteLength(chunk); if (size > LIMIT) finish(new Error('Formatted output is too large. Your draft is unchanged.')); else output += chunk; });
    child.stderr.on('data', (chunk) => { error = (error + chunk).slice(0, 2000); });
    child.once('error', () => finish(new Error(`Could not start ${tool.name}. Your draft is unchanged.`)));
    child.once('close', (code) => finish(code === 0 ? null : new Error(`${tool.name}: ${error.trim().slice(0, 300) || 'Could not format this file.'}`)));
  });
}
module.exports = { formatSource, FORMATTERS };
