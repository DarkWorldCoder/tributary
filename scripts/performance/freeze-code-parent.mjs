// Create an isolated pre-viewport UI/desktop host without changing this checkout.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(repo, 'ui/node_modules/vite/dist/node/index.js')).href);
const ref = process.argv[2] || '867f49a';
if (!/^[0-9a-f]{7,40}$/.test(ref)) throw Error('Pass a commit SHA.');
const host = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-code-parent-'));
const files = ['ui/src/components/markdown.tsx', 'ui/src/components/code-editor.tsx', 'ui/src/components/desktop-titlebar.tsx', 'ui/src/hooks/use-highlighted-code.ts'];
const overrides = new Map(files.map(file => [path.join(repo, file), execFileSync('git', ['show', `${ref}:${file}`], { cwd: repo, encoding: 'utf8' })]));
try {
  await build({ root: path.join(repo, 'ui'), configFile: path.join(repo, 'ui/vite.config.ts'), logLevel: 'error', build: { outDir: path.join(host, 'ui/dist'), emptyOutDir: true }, plugins: [{ name: 'freeze-code-parent', enforce: 'pre', load(id) { return overrides.get(id.split('?')[0]); } }] });
  for (const file of execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'desktop'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean)) {
    const target = path.join(host, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, execFileSync('git', ['show', `${ref}:${file}`], { cwd: repo }));
  }
  for (const name of ['core', 'assets', 'node_modules', 'package.json']) fs.symlinkSync(path.join(repo, name), path.join(host, name));
  const manifest = { ref, host, overriddenFiles: files, uiSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(host, 'ui/dist/assets/app.js'))).digest('hex'), scope: 'Selected revision Markdown/editor/titlebar/highlight hook and desktop; all other current source/config/dependencies and core are shared. Temporary comparison host, not an installer.' };
  fs.writeFileSync(path.join(host, 'baseline.json'), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest));
} catch (error) { fs.rmSync(host, { recursive: true, force: true }); throw error; }
