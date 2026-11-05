// Compare static import boundaries with identical current build dependencies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), [output] = process.argv.slice(2);
if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute report path.');
const { build } = await import(pathToFileURL(path.join(repo, 'ui/node_modules/vite/dist/node/index.js')).href);
const overridden = ['ui/src/components/markdown.tsx', 'ui/src/components/code-editor.tsx', 'ui/src/components/desktop-titlebar.tsx'];
const sources = [...overridden, 'ui/src/components/code-viewport.tsx', 'ui/src/lib/code-viewport.mjs', 'ui/src/lib/editor-appearance.ts', 'ui/vite.config.ts', 'scripts/performance/code-viewport-bundles.mjs'];
const hashes = () => Object.fromEntries(sources.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const before = hashes(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-code-bundles-'));
async function capture(baseline) {
  const chunks = [], overrides = new Map(baseline ? overridden.map(file => [path.join(repo, file), execFileSync('git', ['show', `c40ea95:${file}`], { cwd: repo, encoding: 'utf8' })]) : []);
  await build({ root: path.join(repo, 'ui'), configFile: path.join(repo, 'ui/vite.config.ts'), logLevel: 'error', build: { outDir: path.join(temporary, baseline ? 'baseline' : 'current'), emptyOutDir: true }, plugins: [{
    name: 'code-viewport-import-boundaries', enforce: 'pre', load(id) { return overrides.get(id.split('?')[0]); },
    generateBundle(_options, bundle) { for (const item of Object.values(bundle)) if (item.type === 'chunk') chunks.push({ file: item.fileName, bytes: Buffer.byteLength(item.code), gzipBytes: gzipSync(item.code).length, imports: item.imports, modules: Object.keys(item.modules).map(id => id.startsWith(repo + path.sep) ? id.slice(repo.length + 1) : id) }); },
  }] });
  const byFile = new Map(chunks.map(chunk => [chunk.file, chunk]));
  const containing = source => chunks.find(chunk => chunk.modules.includes(source))?.file;
  const closure = roots => {
    const found = new Set(), visit = file => { if (!file || found.has(file)) return; const chunk = byFile.get(file); if (!chunk) throw Error('Missing built import: ' + file); found.add(file); chunk.imports.forEach(visit); }; roots.forEach(visit);
    const selected = [...found].map(file => byFile.get(file)), modules = selected.flatMap(chunk => chunk.modules);
    return { javascriptBytes: selected.reduce((sum, chunk) => sum + chunk.bytes, 0), gzipBytes: selected.reduce((sum, chunk) => sum + chunk.gzipBytes, 0), chunks: [...found].sort(), codeMirrorModuleCount: modules.filter(id => id.includes('/@codemirror/')).length, applicationModules: [...new Set(modules.filter(id => id.startsWith('ui/src/')))].sort() };
  };
  const chatRoots = [containing('ui/src/main.tsx'), containing('ui/src/workspace-app.tsx')];
  if (chatRoots.some(root => !root)) throw Error('Missing app/chat entry chunk');
  const chat = closure(chatRoots), viewer = containing('ui/src/components/code-viewport.tsx');
  if (!baseline && (!viewer || chat.applicationModules.includes('ui/src/components/code-viewport.tsx') || chat.codeMirrorModuleCount)) throw Error('Cold chat unexpectedly imports the code viewer/CodeMirror');
  return { chat, ...(viewer ? { largeCodeStaticClosure: closure([...chatRoots, viewer]) } : {}), shippedJavaScriptBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) };
}
try {
  const baseline = await capture(true), current = await capture(false);
  if (JSON.stringify(before) !== JSON.stringify(hashes())) throw Error('Measured sources changed');
  const report = { date: new Date().toISOString(), baseline: 'Current source/config/dependencies with only markdown, code-editor and desktop-titlebar restored to c40ea95', sourceHashes: before, baselineBuild: baseline, currentBuild: current, scope: 'Minified/gzipped JavaScript static dependency closures from two isolated Vite builds. Cold chat includes main and hydrated workspace-app roots. Dynamic grammar and Shiki requests are excluded, so largeCodeStaticClosure is not a complete loaded-feature download measure. Total shipped JS is counted separately. Not measured startup, paint, parse latency or app RAM. The production dist directory is untouched.' };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ baseline: baseline.chat, current: current.chat, shipped: [baseline.shippedJavaScriptBytes, current.shippedJavaScriptBytes] }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
