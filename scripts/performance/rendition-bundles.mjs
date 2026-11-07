// Build-only static import-closure audit; leaves measured ui/dist untouched.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = '25c71737476a42c0f8ee996b1ea007e7efd869cb', output = path.resolve(process.argv[2]);
const { build } = await import(pathToFileURL(path.join(repo, 'ui/node_modules/vite/dist/node/index.js')).href);
const overrides = ['ui/src/components/markdown-image.tsx', 'ui/src/lib/image-resources.mjs', 'ui/src/hooks/use-image-resource.ts'];
const files = [...overrides, 'ui/src/lib/image-rendition.mjs', 'ui/src/hooks/use-image-resource.ts', 'ui/vite.config.ts'];
const hashes = () => Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const sourceHashes = hashes(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-gallery-bundles-'));
async function capture(previous) {
  const source = new Map(previous ? overrides.map(file => [path.join(repo, file), execFileSync('git', ['show', baseline + ':' + file], { cwd: repo, encoding: 'utf8' })]) : []), chunks = [];
  await build({ root: path.join(repo, 'ui'), configFile: path.join(repo, 'ui/vite.config.ts'), logLevel: 'error', build: { outDir: path.join(temp, previous ? 'before' : 'after'), emptyOutDir: true }, plugins: [{ name: 'image-closure-audit', enforce: 'pre', load(id) { return source.get(id.split('?')[0]); }, generateBundle(_options, bundle) { for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') chunks.push({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length, imports: chunk.imports, modules: Object.keys(chunk.modules).map(id => id.startsWith(repo + path.sep) ? id.slice(repo.length + 1) : id) }); } }] });
  const byFile = new Map(chunks.map(chunk => [chunk.file, chunk]));
  const containing = file => chunks.find(chunk => chunk.modules.includes(file))?.file;
  const closure = (...roots) => { const selected = new Set(); const visit = file => { if (!file || selected.has(file)) return; selected.add(file); for (const next of byFile.get(file).imports) visit(next); }; roots.forEach(visit); const rows = [...selected].map(file => byFile.get(file)); return { bytes: rows.reduce((n, row) => n + row.bytes, 0), gzipBytes: rows.reduce((n, row) => n + row.gzipBytes, 0), applicationModules: [...new Set(rows.flatMap(row => row.modules.filter(file => file.startsWith('ui/src/'))))].sort() }; };
  const app = containing('ui/src/workspace-app.tsx'), workspace = containing('ui/src/components/workspace-panel.tsx');
  const result = { coldChat: closure(app), workspace: closure(app, workspace), totalJavaScriptBytes: chunks.reduce((n, row) => n + row.bytes, 0) };
  for (const file of ['ui/src/components/code-editor.tsx', 'ui/src/components/settings-dialog.tsx', 'ui/src/components/team-dialog.tsx']) assert.ok(!result.coldChat.applicationModules.includes(file), 'Cold chat eagerly imports ' + file);
  return result;
}
try { const before = await capture(true), after = await capture(false); assert.deepEqual(hashes(), sourceHashes); fs.writeFileSync(output, JSON.stringify({ baseline, sourceHashes, before, after, scope: 'Identical current dependencies/config; complete static JavaScript closures. Production dist is not rewritten. Minified/gzip bytes are not startup, RAM or parse-time measurements.' }, null, 2) + '\n'); console.log(JSON.stringify({ before: { coldChat: before.coldChat.bytes, workspace: before.workspace.bytes }, after: { coldChat: after.coldChat.bytes, workspace: after.workspace.bytes } })); }
finally { fs.rmSync(temp, { recursive: true, force: true }); }
