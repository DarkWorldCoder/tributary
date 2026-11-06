// Build-only dependency audit. Never rewrites the measured production dist.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), output = process.argv[2];
assert.ok(output && path.isAbsolute(output));
const { build } = await import(pathToFileURL(path.join(repo, 'ui/node_modules/vite/dist/node/index.js')).href);
const files = ['ui/src/components/conversation.tsx', 'ui/src/components/thread-header.tsx', 'ui/src/components/ui/message-scroller.tsx', 'ui/src/store.tsx'], sources = [...files, 'ui/src/components/transcript-body.tsx', 'ui/vite.config.ts', 'scripts/performance/transcript-bundles.mjs'];
const hashes = () => Object.fromEntries(sources.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const before = hashes(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-transcript-bundles-'));
async function capture(baseline) {
  const overrides = new Map(baseline ? files.map(file => [path.join(repo, file), execFileSync('git', ['show', `8083acb:${file}`], { cwd: repo, encoding: 'utf8' })]) : []), chunks = [];
  await build({ root: path.join(repo, 'ui'), configFile: path.join(repo, 'ui/vite.config.ts'), logLevel: 'error', build: { outDir: path.join(temp, baseline ? 'before' : 'after'), emptyOutDir: true }, plugins: [{
    name: 'transcript-dependency-audit', enforce: 'pre', load(id) { return overrides.get(id.split('?')[0]); },
    generateBundle(_options, bundle) { for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') chunks.push({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length, imports: chunk.imports, modules: Object.keys(chunk.modules).map(id => id.startsWith(repo + path.sep) ? id.slice(repo.length + 1) : id) }); },
  }] });
  const byFile = new Map(chunks.map(chunk => [chunk.file, chunk])), found = new Set();
  const visit = file => { if (found.has(file)) return; const chunk = byFile.get(file); assert.ok(chunk, 'Missing static import ' + file); found.add(file); chunk.imports.forEach(visit); };
  for (const source of ['ui/src/main.tsx', 'ui/src/workspace-app.tsx']) { const chunk = chunks.find(chunk => chunk.modules.includes(source)); assert.ok(chunk); visit(chunk.file); }
  const selected = [...found].map(file => byFile.get(file)), modules = selected.flatMap(chunk => chunk.modules);
  assert.equal(modules.some(id => id.includes('/@codemirror/') || id === 'ui/src/components/code-viewport.tsx' || id === 'ui/src/components/local-models.tsx'), false, 'Editor/viewer/local setup must stay out of cold chat');
  return { coldChat: { bytes: selected.reduce((n, c) => n + c.bytes, 0), gzipBytes: selected.reduce((n, c) => n + c.gzipBytes, 0), chunks: [...found].sort(), applicationModules: [...new Set(modules.filter(id => id.startsWith('ui/src/')))].sort() }, shippedJavaScriptBytes: chunks.reduce((n, c) => n + c.bytes, 0) };
}
try {
  const baseline = await capture(true), incremental = await capture(false); assert.deepEqual(hashes(), before);
  const delta = { coldChatBytes: incremental.coldChat.bytes - baseline.coldChat.bytes, coldChatGzipBytes: incremental.coldChat.gzipBytes - baseline.coldChat.gzipBytes, shippedJavaScriptBytes: incremental.shippedJavaScriptBytes - baseline.shippedJavaScriptBytes };
  fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), sourceHashes: before, baseline: 'Four preexisting transcript UI/store files restored to 8083acb; new transcript-body module is unreachable in that baseline. Same current dependencies/config/other source.', baselineBuild: baseline, incrementalBuild: incremental, delta, scope: 'Minified JS static dependency closure of main plus hydrated workspace-app; gzip per emitted chunk. Includes the transcript lifetime controller; excludes dynamically requested grammars and optional surfaces. No startup, paint, RAM or download-time claim.' }, null, 2) + '\n'); console.log(JSON.stringify(delta));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
