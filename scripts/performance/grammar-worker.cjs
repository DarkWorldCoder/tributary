'use strict';
// Native worker response parity, not a speed or RAM benchmark.
// electron this-file /absolute/worker.js /absolute/result.json [baseline-result.json]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const [asset, output, reference] = process.argv.slice(2).filter(value => !value.startsWith('--'));
assert.ok(asset && output && path.isAbsolute(asset) && path.isAbsolute(output) && !fs.existsSync(output));
if (reference) assert.ok(path.isAbsolute(reference));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-grammar-worker-'));
app.setPath('userData', path.join(root, 'profile'));
const source = fs.readFileSync(asset, 'utf8'), digest = value => crypto.createHash('sha256').update(value).digest('hex');
fs.writeFileSync(path.join(root, 'worker.js'), source); fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Grammar worker parity</title>');
const code = [
  ['main.js', 'export function greet(name) { return `Hi ${name}`; }', 'function ('],
  ['view.jsx', 'const App = () => <div title="hi">Hi</div>;', 'const App = () => <div>{</div>;'],
  ['main.ts', 'interface User { name: string }; const user: User = {name:"a"};', 'const value: number = ;'],
  ['view.tsx', 'type P = { n: number }; const App = ({n}: P) => <span>{n}</span>;', 'const App = () => <div>{</div>;'],
  ['main.py', 'def greet(name):\n  return f"hi {name}"\n', 'def f(:\n pass'],
  ['main.rs', 'fn main() { let mut n = 1; n += 1; }', 'fn main( { let x = ;'],
  ['main.go', 'package main\nfunc main() { n := 1; _ = n }', 'package main\nfunc main( {'],
  ['Main.java', 'class Main { public static void main(String[] args) { int n = 1; } }', 'class Main { void run( }'],
  ['main.c', 'int main(void) { return 0; }', 'int main( { return;'],
  ['main.cpp', '#include <vector>\nint main() { std::vector<int> values = {1,2}; return values.size(); }', 'template <class T struct Item {'],
  ['page.php', '<?php function greet($name) { return "Hi " . $name; } ?>', '<?php function f( { ?>'],
];
const cases = [];
for (const [file, valid, invalid] of code) for (const [kind, text] of [['valid', valid], ['invalid', invalid]]) cases.push({ label: file + ' ' + kind, method: 'validate', path: file, text });
for (const [file, text] of [
  ['mixed.php', '<section><?php echo "Hi"; ?></section>'],
  ['unicode.ts', '// 😀\r\nfunction hello(name: string) {\r\n return name;\r\n}\r\nconst value = ;\r\n'],
  ['many-errors.js', 'const value = ;\n'.repeat(64)],
  ['huge.ts', ' '.repeat(512 * 1024 + 1)],
  ['main.mts', 'export const value: number = 1;'],
  ['main.cts', 'export const value: number = ;'],
  ['cli', '#!/usr/bin/env node\nconst value = ;'],
  ['script', '#!/usr/bin/env python3\ndef f(:\n pass'],
  ['query.sql', 'select from where'], ['main.sh', 'if ;'], ['main.kt', 'fun f( {'], ['.env.local', 'KEY=value'],
]) cases.push({ label: file, method: 'validate', path: file, text });
for (const [file, text] of [
  ['outline.js', 'export function first() {}\nclass Thing { method() {} }\nconst arrow = () => 1;'],
  ['outline.ts', 'interface User { name: string }\ntype Label = string;\nenum Mode { A, B }\nclass Thing { method() {} }'],
  ['outline.py', 'class Thing:\n def method(self):\n  return 1\ndef run():\n return 2\n'],
  ['outline.rs', 'struct Item { value: i32 }\nenum Mode { A, B }\nimpl Item { fn get(&self) -> i32 { self.value } }\nfn run() {}'],
  ['outline.go', 'package main\ntype Item struct { Value int }\nfunc Run() {}\nfunc (i Item) Get() int { return i.Value }'],
  ['README.md', '# Main\r\n## Detail\r\n```js\r\n// not a heading\r\n```\r\n### Final\r\n'],
  ['many-headings.md', Array.from({length:310}, (_, i) => '# Heading ' + i).join('\n')],
  ['unknown.sql', 'select value from table'],
]) cases.push({ label: file, method: 'outline', path: file, text });
cases.push(
  { label: 'JSON schema', method: 'validate', path: 'package.json', text: '{"private":"yes","scripts":{"test":3}}' },
  { label: 'JSONC', method: 'validate', path: 'settings.jsonc', text: '{ // comment\n "safe": true,\n}' },
  { label: 'CSS', method: 'validate', path: 'style.css', text: 'a { colr: red; }' },
  { label: 'SCSS', method: 'validate', path: 'style.scss', text: '$a:red; a { color:$a; }' },
  { label: 'Less', method: 'validate', path: 'style.less', text: '@a:red; a { color:@a; }' },
  { label: 'JSON completion', method: 'complete', path: 'package.json', text: '{ "pri' },
  { label: 'CSS completion', method: 'complete', path: 'style.css', text: 'a { col' },
  { label: 'HTML completion', method: 'complete', path: 'page.html', text: '<di' },
  { label: 'JSON outline', method: 'outline', path: 'file.json', text: '{"outer":{"inner":true}}' },
  { label: 'HTML outline', method: 'outline', path: 'page.html', text: '<main><h1>Hi</h1></main>' },
  { label: 'Unsupported completion', method: 'complete', path: 'main.ts', text: 'con' },
);
const corpusSha256 = digest(JSON.stringify(cases)); const deadline = setTimeout(() => app.exit(1), 180000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(root, 'index.html')); const results = [];
  for (const mode of ['file', 'blob']) {
    const rows = await win.webContents.executeJavaScript(`(async(source,cases,mode)=>{
      const url=mode==='blob'?URL.createObjectURL(new Blob([source],{type:'text/javascript'})):new URL('worker.js',location.href).href;
      const worker=new Worker(url,{type:'module'});let sequence=0;const rows=[];
      try { for(const item of cases) {
        const result=await new Promise((resolve,reject)=>{
          const id=++sequence;const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('message',message);worker.removeEventListener('error',error);};
          const timer=setTimeout(()=>{cleanup();reject(Error('Worker deadline: '+item.label));},15000);
          const message=event=>{if(event.data.id!==id)return;cleanup();event.data.error?reject(Error(event.data.error)):resolve(event.data.result);};
          const error=event=>{cleanup();reject(Error(event.message));};
          worker.addEventListener('message',message);worker.addEventListener('error',error);worker.postMessage({id,method:item.method,path:item.path,text:item.text,offset:item.text.length});
        });
        if(!Array.isArray(result))throw Error('Non-array response: '+item.label);
        rows.push({label:item.label,result});
      } return rows; } finally {worker.terminate();if(mode==='blob')URL.revokeObjectURL(url);}
    })(${JSON.stringify(source)},${JSON.stringify(cases)},${JSON.stringify(mode)})`);
    assert.equal(rows.length, cases.length);
    assert.ok(rows.find(row => row.label === 'main.ts invalid').result.length > 0);
    assert.equal(rows.find(row => row.label === 'many-errors.js').result.length, 30);
    assert.equal(rows.find(row => row.label === 'many-headings.md').result.length, 300);
    assert.deepEqual(rows.find(row => row.label === 'huge.ts').result, []);
    assert.ok(rows.find(row => row.label === 'HTML completion').result.some(item => item.label === 'div'));
    results.push({ mode, rows });
  }
  assert.deepEqual(results[0].rows, results[1].rows, 'File and blob workers must agree.');
  if (reference) { const before = JSON.parse(fs.readFileSync(reference)); assert.ok(before.passed); assert.equal(before.corpusSha256, corpusSha256); assert.deepEqual(results, before.results, 'All actual worker responses must preserve the baseline.'); }
  assert.equal(digest(fs.readFileSync(asset)), digest(source));
  fs.writeFileSync(output, JSON.stringify({ passed: true, complete: true, asset, workerSha256: digest(source), workerBytes: Buffer.byteLength(source), hostSha256: digest(fs.readFileSync(__filename)), corpusSha256, caseCount: cases.length, reference: reference || null, results, runtime: process.versions, scope: 'Actual uninstrumented single-file worker assets; full response parity across file/blob module workers, code/document languages, invalid syntax, offsets, limits and outlines. Isolated fixture, not whole-workbench UI, timings, allocations, RAM or platform certification.' }, null, 2)+'\n');
  clearTimeout(deadline); app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true }));
