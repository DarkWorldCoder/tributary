// Real CodeMirror style ownership/callback regression, not a timing/RAM benchmark.
// Run: node scripts/performance/gutter-styles.mjs /tmp/fresh-result.json
// Optional second argument reproduces the known pre-fix rule-growth baseline.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [output, reference] = process.argv.slice(2);
assert.ok(output && path.isAbsolute(output) && !fs.existsSync(output), 'Pass a fresh absolute output path.');
const files = ['ui/src/lib/debug-editor.ts', 'ui/src/lib/change-gutter.ts'];
const revision = reference ? execFileSync('git', ['rev-parse', '--verify', `${reference}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim() : null;
const sources = new Map(files.map(file => [path.join(repo, file), revision ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: repo, encoding: 'utf8' }) : fs.readFileSync(path.join(repo, file), 'utf8')]));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-gutter-styles-'));
const { build } = await import(pathToFileURL(path.join(repo, 'ui/node_modules/vite/dist/node/index.js')).href);
try {
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, `import {EditorState} from ${JSON.stringify(path.join(repo, 'ui/node_modules/@codemirror/state/dist/index.js'))};
import {EditorView} from ${JSON.stringify(path.join(repo, 'ui/node_modules/@codemirror/view/dist/index.js'))};
import {debugGutter,debugLines} from ${JSON.stringify(path.join(repo, files[0]))};
import {changeGutter,setFileChanges} from ${JSON.stringify(path.join(repo, files[1]))};
window.gutterFixture={EditorState,EditorView,debugGutter,debugLines,changeGutter,setFileChanges};`);
  const consumed = new Set();
  await build({ configFile: false, root: path.join(repo, 'ui'), logLevel: 'error', plugins: [{ name: 'gutter-source', enforce: 'pre', load(id) { const file = id.split('?')[0]; if (sources.has(file)) { consumed.add(file); return sources.get(file); } } }], build: { outDir: root, emptyOutDir: false, lib: { entry, formats: ['iife'], name: 'GutterFixture', fileName: () => 'fixture.js' } } });
  assert.deepEqual([...consumed].sort(), [...sources.keys()].sort(), 'Both exact gutter sources must be compiled.');
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><style>:root{--success:rgb(0,128,0);--destructive:rgb(220,0,0);--warning:rgb(255,180,0);--ring:blue}body{display:flex;gap:20px}.host{height:300px;width:300px}</style><div id="left" class="host"></div><div id="right" class="host"></div><script src="fixture.js"></script>');
  fs.writeFileSync(path.join(root, 'case.json'), JSON.stringify({ output, expectedBounded: !reference, baseline: revision, sourceHashes: Object.fromEntries([...sources].map(([file, source]) => [path.relative(repo, file), crypto.createHash('sha256').update(source).digest('hex')])) }));
  execFileSync('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(repo, 'scripts/performance/native-gutter-styles.cjs'), root, '--no-sandbox', '--ozone-platform=x11'], { cwd: repo, stdio: 'inherit', timeout: 150000 });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
