'use strict';
// Read declarative editor settings without importing project JavaScript.
const fs = require('node:fs/promises'); const path = require('node:path');
const { createRequire } = require('node:module'); const { parse } = require('jsonc-parser');
const { projectPath } = require('./files');
const CONFIG_LIMIT = 256 * 1024;
const FLAT = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts'];
const LEGACY = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml'];
const LANGUAGES = { js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescriptreact', mts: 'typescript', cts: 'typescript', vue: 'vue', svelte: 'svelte', astro: 'astro', json: 'json', jsonc: 'jsonc', md: 'markdown', mdx: 'mdx', css: 'css', scss: 'scss', html: 'html', py: 'python', rs: 'rust', go: 'go' };
const within = (root, filename) => { const rel = path.relative(root, filename); return rel === '' || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
async function configText(root, rel) {
  try {
    const filename = await projectPath(root, rel); const handle = await fs.open(filename, 'r');
    try {
      const stat = await handle.stat(); if (!stat.isFile() || stat.size > CONFIG_LIMIT) throw Error(`${rel} must be a text file up to 256 KB.`);
      // A bounded read also handles a config that grows after stat().
      const buffer = Buffer.allocUnsafe(Math.min(stat.size + 1, CONFIG_LIMIT + 1)); let bytes = 0;
      while (bytes < buffer.length) { const { bytesRead } = await handle.read(buffer, bytes, buffer.length - bytes, bytes); if (!bytesRead) break; bytes += bytesRead; }
      if (bytes > CONFIG_LIMIT) throw Error(`${rel} is too large.`);
      return buffer.toString('utf8', 0, bytes);
    } finally { await handle.close(); }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function exists(root, rel) { try { return (await fs.stat(await projectPath(root, rel))).isFile(); } catch (error) { if (error.code === 'ENOENT' || error.message.startsWith('Path outside project')) return false; throw error; } }
function scopedSettings(settings, language) {
  const result = { ...settings };
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('[') && [...key.matchAll(/\[([^\]]+)\]/g)].some(match => match[1] === language) && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [name, entry] of Object.entries(value)) {
        result[name] = name === 'editor.codeActionsOnSave' && entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...(result[name] || {}), ...entry } : entry;
      }
    }
  }
  return result;
}
function directoryPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 512 || /[\0\r\n?{}\[\]]/.test(pattern)) throw Error('ESLint working-directory patterns support * and ** inside the workspace.');
  const normalized = pattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized.startsWith('/') || normalized.split('/').includes('..') || /^[A-Za-z]:/.test(normalized)) throw Error('ESLint working directories must stay inside the workspace.');
  return new RegExp('^' + normalized.split('/').map(segment => segment === '**' ? '.*' : segment.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('/') + '$');
}
async function editorSettings(root, rel = '') {
  const base = await fs.realpath(root); const filename = await projectPath(base, rel);
  const language = LANGUAGES[path.extname(rel).slice(1).toLowerCase()] || 'plaintext';
  const raw = await configText(base, '.vscode/settings.json'); let settings = {}; const sources = [];
  if (raw !== null) {
    const errors = []; settings = parse(raw, errors, { allowTrailingComma: true });
    if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Could not read .vscode/settings.json. Check its JSON syntax.');
    sources.push('.vscode/settings.json'); settings = scopedSettings(settings, language);
  }
  const ancestors = []; let directory = rel ? path.dirname(filename) : base;
  while (within(base, directory)) { ancestors.push(directory); if (directory === base) break; directory = path.dirname(directory); }
  const markers = [];
  for (const dir of ancestors) {
    const found = [];
    for (const name of [...FLAT, ...LEGACY, '.eslintignore', 'package.json']) if (await exists(base, path.relative(base, path.join(dir, name)))) found.push(name);
    markers.push({ directory: dir, names: found });
    sources.push(...found.map(name => path.relative(base, path.join(dir, name)).split(path.sep).join('/')));
  }
  let cwd = base; let changeProcessCwd = true;
  const flat = markers.find(item => item.names.some(name => FLAT.includes(name)));
  if (flat && settings['eslint.useFlatConfig'] !== false) cwd = flat.directory;
  const directories = settings['eslint.workingDirectories']; let chosen = false;
  if (directories !== undefined && (!Array.isArray(directories) || directories.length > 100)) throw Error('Configure up to 100 ESLint working directories.');
  for (const entry of directories || []) {
    if (entry && typeof entry === 'object' && ['auto', 'location'].includes(entry.mode)) {
      if (!chosen) cwd = entry.mode === 'auto' ? markers.find(item => item.names.length)?.directory || base : flat && settings['eslint.useFlatConfig'] !== false ? flat.directory : base;
      continue;
    }
    const value = typeof entry === 'string' ? entry : entry?.directory;
    let candidate;
    if (typeof value === 'string') {
      if (value.length > 2048 || value.includes('\0')) throw Error('Invalid ESLint working directory.');
      const resolved = path.resolve(base, value); if (!within(base, resolved)) throw Error('ESLint working directories must stay inside the workspace.');
      if (within(resolved, filename)) candidate = resolved;
    } else if (typeof entry?.pattern === 'string') {
      const expression = directoryPattern(entry.pattern);
      candidate = ancestors.find(dir => expression.test(path.relative(base, dir).split(path.sep).join('/')));
    } else throw Error('Unsupported ESLint working-directory entry.');
    if (candidate && (!chosen || candidate.length > cwd.length)) { cwd = candidate; chosen = true; changeProcessCwd = entry?.['!cwd'] !== true; }
  }
  const realCwd = await fs.realpath(cwd); if (!within(base, realCwd)) throw Error('ESLint working directory leaves the workspace.');
  if (!(await fs.stat(realCwd)).isDirectory()) throw Error('ESLint working directory must be a folder.'); cwd = realCwd;
  let library = null, version = null;
  try {
    const resolve = createRequire(path.join(rel ? path.dirname(filename) : cwd, '__tributary_eslint__.cjs'));
    const entry = await fs.realpath(resolve.resolve('eslint'));
    if (within(base, entry)) {
      library = entry;
      let dir = path.dirname(entry);
      while (within(base, dir)) {
        const metadata = await configText(base, path.relative(base, path.join(dir, 'package.json')));
        if (metadata !== null) { const pkg = JSON.parse(metadata); if (pkg.name === 'eslint') { version = typeof pkg.version === 'string' ? pkg.version : null; break; } }
        if (dir === base) break; dir = path.dirname(dir);
      }
    }
  } catch (error) { if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ENOENT') throw error; }
  const actions = settings['editor.codeActionsOnSave'];
  const fixSetting = Array.isArray(actions) ? actions.includes('source.fixAll.eslint') || actions.includes('source.fixAll') : actions?.['source.fixAll.eslint'] ?? actions?.['source.fixAll'];
  const validate = settings['eslint.validate'];
  if (validate !== undefined && validate !== null && (!Array.isArray(validate) || validate.some(item => typeof item !== 'string'))) throw Error('eslint.validate must be an array of language identifiers.');
  return { root: base, rel, language, sources: [...new Set(sources)], formatOnSave: typeof settings['editor.formatOnSave'] === 'boolean' ? settings['editor.formatOnSave'] : undefined,
    defaultFormatter: typeof settings['editor.defaultFormatter'] === 'string' ? settings['editor.defaultFormatter'] : undefined,
    eslint: { enabled: settings['eslint.enable'] !== false && (Array.isArray(validate) ? validate.includes(language) : ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue', 'svelte', 'astro', 'json', 'jsonc', 'markdown', 'mdx', 'css'].includes(language)), run: settings['eslint.run'] === 'onSave' ? 'onSave' : 'onType', quiet: settings['eslint.quiet'] === true,
      cwd, changeProcessCwd, library, version, useFlatConfig: typeof settings['eslint.useFlatConfig'] === 'boolean' ? settings['eslint.useFlatConfig'] : undefined,
      format: settings['eslint.format.enable'] === true, fixOnSave: [true, 'explicit', 'always'].includes(fixSetting) } };
}
async function editorToolSetup(root) {
  const settings = await editorSettings(root); const raw = await configText(settings.root, 'package.json'); const pkg = raw ? JSON.parse(raw) : {};
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
  let manager = ['npm', 'pnpm', 'yarn', 'bun'].includes(declared) ? declared : 'npm';
  if (!declared) for (const [name, lock] of [['pnpm', 'pnpm-lock.yaml'], ['yarn', 'yarn.lock'], ['bun', 'bun.lock'], ['bun', 'bun.lockb']]) if (await exists(settings.root, lock)) { manager = name; break; }
  const workspace = manager === 'pnpm' && await exists(settings.root, 'pnpm-workspace.yaml');
  const install = { npm: 'npm install --save-dev eslint', pnpm: `pnpm add --save-dev${workspace ? ' --workspace-root' : ''} eslint`, yarn: 'yarn add --dev eslint', bun: 'bun add --dev eslint' }[manager];
  return { ...settings, manager, install, initialize: 'npx eslint --init', hasPackage: raw !== null };
}
module.exports = { editorSettings, editorToolSetup, scopedSettings };
