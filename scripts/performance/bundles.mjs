// Build a historical UI and current UI in temporary folders; compare complete static import closures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(root, 'ui/node_modules/vite/dist/node/index.js')).href);
const flag = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; };
const ref = flag('--baseline-ref', 'bc0a582');
const sources = ['ui/src/App.tsx', 'ui/src/components/workspace-files.tsx', 'ui/src/components/memory-panel.tsx'];
const fingerprintSources = [...sources, 'ui/src/components/deferred-surface.tsx', 'ui/src/components/deferred-code-editor.tsx', 'ui/src/components/team-dialog.tsx', 'ui/vite.config.ts'];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-bundle-benchmark-'));
async function capture(previous) {
  const chunks = [];
  const overrides = new Map(previous ? sources.map((file) => [path.join(root, file), execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' })]) : []);
  await build({ root: path.join(root, 'ui'), configFile: path.join(root, 'ui/vite.config.ts'), logLevel: 'error', build: { outDir: path.join(temporary, previous ? 'baseline' : 'current'), emptyOutDir: true }, plugins: [{
    name: 'measure-feature-closures', enforce: 'pre',
    load(id) { return overrides.get(id.split('?')[0]); },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) if (output.type === 'chunk') chunks.push({ file: output.fileName, bytes: Buffer.byteLength(output.code), gzipBytes: gzipSync(output.code).length, imports: output.imports, modules: Object.keys(output.modules).map((id) => id.startsWith(root + path.sep) ? id.slice(root.length + 1).split(path.sep).join('/') : id) });
    },
  }] });
  const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const containing = (source) => chunks.find((chunk) => chunk.modules.includes(source))?.file;
  const closure = (...roots) => {
    const found = new Set();
    const visit = (file) => { if (!file || found.has(file)) return; const chunk = byFile.get(file); if (!chunk) throw new Error(`Missing chunk ${file}`); found.add(file); chunk.imports.forEach(visit); };
    roots.forEach(visit); const selected = [...found].map((file) => byFile.get(file));
    return { javascriptBytes: selected.reduce((sum, chunk) => sum + chunk.bytes, 0), gzipBytes: selected.reduce((sum, chunk) => sum + chunk.gzipBytes, 0), chunks: selected.map((chunk) => chunk.file).sort(), applicationModules: [...new Set(selected.flatMap((chunk) => chunk.modules.filter((id) => id.startsWith('ui/src/'))))].sort() };
  };
  const app = containing('ui/src/workspace-app.tsx'); const workspace = containing('ui/src/components/workspace-panel.tsx');
  const result = { chat: closure(app), filePreview: closure(app, workspace), codeEditor: closure(app, workspace, containing('ui/src/components/code-editor.tsx')), settings: closure(app, containing('ui/src/components/settings-dialog.tsx')), allJavaScriptBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) };
  if (!previous) {
    for (const source of ['ui/src/components/settings-dialog.tsx', 'ui/src/components/team-dialog.tsx', 'ui/src/components/collaboration-dialog.tsx', 'ui/src/components/document-panel.tsx']) if (result.chat.applicationModules.includes(source)) throw new Error(`Cold chat eagerly imports ${source}`);
    if (result.filePreview.applicationModules.includes('ui/src/components/code-editor.tsx')) throw new Error('Read-only file preview eagerly imports the editor engine');
  }
  return result;
}
try {
  const previous = await capture(true); const optimized = await capture(false);
  const report = { baseline: ref, node: process.version, platform: process.platform, arch: process.arch, fingerprintSources, sourceSha256: crypto.createHash('sha256').update(fingerprintSources.map((file) => `${file}\n${fs.readFileSync(path.join(root, file), 'utf8')}`).join('\n')).digest('hex'), previous, optimized, reductionPercent: Object.fromEntries(['chat', 'filePreview'].map((scenario) => [scenario, Math.round((1 - optimized[scenario].javascriptBytes / previous[scenario].javascriptBytes) * 10000) / 100])), scope: 'Minified JavaScript in the complete static dependency closure needed for each feature. Vite production builds with identical current dependencies and config; baseline restores the historical App/files/memory import boundaries. Not a historical installer comparison, total app RAM, download latency, parse time or user interaction latency. All features and deferred chunks remain shipped.' };
  const output = flag('--output'); if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reductionPercent: report.reductionPercent, previous: Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'allJavaScriptBytes').map(([key, value]) => [key, value.javascriptBytes])), optimized: Object.fromEntries(Object.entries(optimized).filter(([key]) => key !== 'allJavaScriptBytes').map(([key, value]) => [key, value.javascriptBytes])) }, null, 2));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
