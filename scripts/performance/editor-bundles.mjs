// Build-only audit. Both outputs are temporary; measured ui/dist stays intact.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), [reference, output] = process.argv.slice(2);
assert.ok(reference && output && path.isAbsolute(output));
const { build } = await import(pathToFileURL(path.join(repo, 'ui/node_modules/vite/dist/node/index.js')).href);
const files = ['ui/src/components/code-editor.tsx', 'ui/src/lib/agent-editor.ts', 'ui/src/lib/editor-spacing.mjs', 'ui/src/lib/format-document.mjs', 'ui/src/lib/text-change.mjs'];
const sources = [...files, 'ui/vite.config.ts', 'scripts/performance/editor-bundles.mjs'];
const hashes = () => Object.fromEntries(sources.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const before = hashes(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-editor-bundles-'));
async function capture(baseline) {
  const overrides = new Map(baseline ? files.map(file => [path.join(repo, file), execFileSync('git', ['show', `${reference}:${file}`], { cwd: repo, encoding: 'utf8' })]) : []), chunks = [];
  await build({ root: path.join(repo, 'ui'), configFile: path.join(repo, 'ui/vite.config.ts'), logLevel: 'error', build: { outDir: path.join(temp, baseline ? 'before' : 'after'), emptyOutDir: true }, plugins: [{
    name: 'editor-dependency-audit', enforce: 'pre', load(id) { return overrides.get(id.split('?')[0]); },
    generateBundle(_options, bundle) { for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') chunks.push({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length, imports: chunk.imports, modules: Object.keys(chunk.modules).map(id => id.startsWith(repo + path.sep) ? id.slice(repo.length + 1) : id) }); },
  }] });
  const byFile = new Map(chunks.map(chunk => [chunk.file, chunk]));
  const closure = entries => {
    const found = new Set();
    const visit = file => { if (found.has(file)) return; const chunk = byFile.get(file); assert.ok(chunk, 'Missing static import ' + file); found.add(file); chunk.imports.forEach(visit); };
    for (const source of entries) { const chunk = chunks.find(chunk => chunk.modules.includes(source)); assert.ok(chunk, 'Missing source ' + source); visit(chunk.file); }
    const selected = [...found].map(file => byFile.get(file)), modules = selected.flatMap(chunk => chunk.modules);
    return { bytes: selected.reduce((n, chunk) => n + chunk.bytes, 0), gzipBytes: selected.reduce((n, chunk) => n + chunk.gzipBytes, 0), chunks: [...found].sort(), applicationModules: [...new Set(modules.filter(id => id.startsWith('ui/src/')))].sort(), modules };
  };
  const coldChat = closure(['ui/src/main.tsx', 'ui/src/workspace-app.tsx']);
  assert.equal(coldChat.modules.some(id => id.includes('/@codemirror/') || id === 'ui/src/components/code-viewport.tsx' || id === 'ui/src/components/local-models.tsx'), false, 'Optional editor/viewer/model setup must stay out of cold chat');
  const editor = closure(['ui/src/components/workspace-panel.tsx', 'ui/src/components/code-editor.tsx']);
  delete coldChat.modules; delete editor.modules;
  return { coldChat, editor, shippedJavaScriptBytes: chunks.reduce((n, chunk) => n + chunk.bytes, 0) };
}
try {
  const baseline = await capture(true), optimized = await capture(false); assert.deepEqual(hashes(), before);
  const delta = { coldChatBytes: optimized.coldChat.bytes - baseline.coldChat.bytes, coldChatGzipBytes: optimized.coldChat.gzipBytes - baseline.coldChat.gzipBytes, editorBytes: optimized.editor.bytes - baseline.editor.bytes, editorGzipBytes: optimized.editor.gzipBytes - baseline.editor.gzipBytes, shippedJavaScriptBytes: optimized.shippedJavaScriptBytes - baseline.shippedJavaScriptBytes };
  fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), baseline: reference, restoredFiles: files, sourceHashes: before, baselineBuild: baseline, optimizedBuild: optimized, delta, scope: 'Only the five changed UI implementation files restored to the baseline reference; same current dependencies/config/other source. Minified JavaScript static closures, gzip per emitted chunk. Editor closure includes workspace-panel and code-editor static dependencies, not dynamically requested grammars. No startup, paint, download-time or RAM claim.' }, null, 2) + '\n');
  console.log(JSON.stringify(delta));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
