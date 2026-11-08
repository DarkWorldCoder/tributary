// Fresh build-only import-closure comparison; never rewrites the running UI.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url))), output = process.argv[2];
const normalized = file => file.replaceAll('\\', '/'), modulePrefix = normalized(repo) + '/';
assert.ok(output && path.isAbsolute(output) && !fs.existsSync(output), 'Choose a new absolute report path.');
const baseline = '433a61e95d203c2c9b67901f4a43c2191b010560', sourceFile = 'ui/src/components/workspace-files.tsx';
const names = [sourceFile, 'ui/src/lib/file-watch-session.mjs', 'ui/vite.config.ts', 'scripts/performance/file-watch-bundles.mjs'];
const hashes = () => Object.fromEntries(names.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, name))).digest('hex')]));
const sourceHashes = hashes(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-watch-bundles-'));
const { build } = await import(pathToFileURL(path.join(repo, 'ui/node_modules/vite/dist/node/index.js')).href);
async function capture(previous) {
  const chunks = [], workerAssets = []; let overridden = 0;
  const original = previous ? execFileSync('git', ['show', baseline + ':' + sourceFile], { cwd: repo, encoding: 'utf8' }) : undefined;
  await build({ root: path.join(repo, 'ui'), configFile: path.join(repo, 'ui/vite.config.ts'), logLevel: 'error', build: { outDir: path.join(root, previous ? 'before' : 'after'), emptyOutDir: true }, plugins: [{
    name: 'file-watch-closure-audit', enforce: 'pre',
    load(id) { if (previous && normalized(id.split('?')[0]) === normalized(path.join(repo, sourceFile))) { overridden++; return original; } },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') chunks.push({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length, imports: chunk.imports, modules: Object.keys(chunk.modules).map(normalized).map(id => id.startsWith(modulePrefix) ? id.slice(modulePrefix.length) : id) });
        else if (chunk.fileName.endsWith('.js')) workerAssets.push({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.source), gzipBytes: gzipSync(chunk.source).length });
      }
    },
  }] });
  assert.equal(overridden, previous ? 1 : 0, 'Baseline source override must actually be consumed.');
  const byFile = new Map(chunks.map(chunk => [chunk.file, chunk]));
  const containing = module => { const file = chunks.find(chunk => chunk.modules.includes(module))?.file; assert.ok(file, 'Missing module: ' + module); return file; };
  const closure = (...roots) => {
    const selected = new Set(), visit = file => { if (selected.has(file)) return; selected.add(file); assert.ok(byFile.has(file), 'Unknown static import: ' + file); byFile.get(file).imports.forEach(visit); }; roots.forEach(visit);
    const rows = [...selected].map(file => byFile.get(file)); return { bytes: rows.reduce((n, row) => n + row.bytes, 0), gzipBytes: rows.reduce((n, row) => n + row.gzipBytes, 0), applicationModules: [...new Set(rows.flatMap(row => row.modules.filter(name => name.startsWith('ui/src/'))))].sort() };
  };
  const app = containing('ui/src/workspace-app.tsx'), coldChat = closure(app), workspace = closure(app, containing('ui/src/components/workspace-panel.tsx'));
  assert.ok(!coldChat.applicationModules.includes('ui/src/components/code-editor.tsx'), 'Cold chat must not import the editor eagerly.');
  return { coldChat, workspace, generatedJavaScript: { bytes: [...chunks, ...workerAssets].reduce((n, row) => n + row.bytes, 0), gzipBytes: [...chunks, ...workerAssets].reduce((n, row) => n + row.gzipBytes, 0) }, workerAssets };
}
try {
  const before = await capture(true), after = await capture(false); assert.deepEqual(hashes(), sourceHashes);
  fs.writeFileSync(output, JSON.stringify({ baseline, sourceHashes, before, after, scope: 'Fresh identical-dependency/config builds, complete static JavaScript closures and all generated JS including emitted worker assets. Per-file gzip totals are not a network bundle, startup, parsing, allocation or RAM measurement. Old retained development chunks are excluded. Core/backend is not bundled into these renderer figures.' }, null, 2) + '\n');
  console.log(JSON.stringify({ before: { coldChat: before.coldChat.bytes, workspace: before.workspace.bytes, allJs: before.generatedJavaScript.bytes }, after: { coldChat: after.coldChat.bytes, workspace: after.workspace.bytes, allJs: after.generatedJavaScript.bytes } }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
