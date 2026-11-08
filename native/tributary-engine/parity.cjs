'use strict';
// Real filesystem/output parity with the shipped scanner; run after cargo build.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const scanner = require('../../core/filename-search');
const scanFileNames = scanner.scanFileNamesJS || scanner.scanFileNames;
const { nativeScan } = require('./bridge.cjs');
const binary = path.resolve(process.argv[2] || path.join(__dirname, 'target/release/tributary-engine' + (process.platform === 'win32' ? '.exe' : '')));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-native-parity-Ω-'));
const output = process.argv[3];
async function main() {
  const checks = [];
  const write = name => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'Source fixture\n'); };
  for (const name of ['main.ts', 'README.md', '.env', '.hidden/entry.ts', 'src/Main.TS', 'src/components/Button.tsx', 'src/components/button.test.ts', 'src/path-match/other.json', process.platform === 'win32' ? 'quoted-file.ts' : 'quoted"file.ts', 'node_modules/excluded.ts', '.git/excluded.ts', 'target/excluded.ts', 'dist/excluded.ts', '.next/excluded.ts']) write(name);
  if (process.platform !== 'win32') { write('new\nline.ts'); write('tab\tfile.ts'); }
  for (let at = 0; at < 2600; at++) write('wide/entry-' + String(at).padStart(5, '0') + '.ts');
  if (process.platform !== 'win32') fs.symlinkSync(os.tmpdir(), path.join(root, 'outside-link'));
  const cases = [
    ['TS', {}], ['entry', { limit: 7 }], ['entry', { limit: 2000 }], ['src/', {}], ['PATH-MATCH', {}],
    ['main.ts', { limit: 1 }], ['.env', {}], ['entry', { showHidden: false }], ['.hidden', { showHidden: false }],
    ['missing-needle', {}], ['quoted', {}], ['new\n', {}], ['tab\t', {}],
  ];
  for (const [query, options] of cases) {
    const expected = await scanFileNames(root, query, options), actual = await nativeScan(binary, root, query, options);
    assert.ok(actual, 'native result for ' + JSON.stringify(query)); assert.deepEqual(actual, expected);
    checks.push({ query, options, result: { files: actual.files.length, total: actual.total, visited: actual.visited } });
  }
  write('unicode/日本語.ts');
  assert.equal(await nativeScan(binary, root, 'entry'), null, 'Unicode relative names request the complete JS fallback');
  assert.equal(await nativeScan(binary, root, '日本語'), null, 'Unicode queries keep V8 semantics');
  const fallback = async (query, options) => await nativeScan(binary, root, query, options) || scanFileNames(root, query, options);
  assert.deepEqual(await fallback('日本語'), await scanFileNames(root, '日本語'));
  checks.push('Unicode paths and queries preserve complete JS matches through fallback.');
  assert.equal(await nativeScan(binary + '-unavailable', root, 'entry'), null);
  assert.equal(await nativeScan(binary, path.join(root, 'missing-root'), 'entry'), null);
  assert.equal(await nativeScan(binary, root, '  '), null);
  for (const options of [{ limit: 0 }, { limit: 2001 }]) await assert.rejects(nativeScan(binary, root, 'entry', options), /Invalid/);
  await assert.rejects(nativeScan(binary, root, 'x'.repeat(513)), /Invalid/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(nativeScan(binary, root, 'entry', { signal: controller.signal }), { name: 'AbortError' });
  checks.push('Missing engines, failed walks and empty queries use fallback; invalid requests and pre-cancellation reject.');
  fs.rmSync(path.join(root, 'unicode'), { recursive: true });
  const running = new AbortController();
  const pending = nativeScan(binary, root, 'entry', { signal: running.signal });
  running.abort(); await assert.rejects(pending, { name: 'AbortError' });
  checks.push('In-flight child cancellation rejects only after its close event.');
  if (process.platform !== 'win32') {
    const fixture = path.join(root, 'wire-fixture.cjs');
    fs.writeFileSync(fixture, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),query=process.argv[4];
const header=JSON.stringify({protocol:1})+'\\n',file=name=>JSON.stringify({file:name})+'\\n',summary=JSON.stringify({complete:true,total:1,visited:1,unreadable:0,limited:false})+'\\n';
const valid=header+file(query+'.ts')+summary;
if(query==='slow'){fs.writeFileSync(path.join(process.argv[3],'worker-pid'),String(process.pid));process.stdout.write(header);setInterval(()=>{},1000);}
else if(query==='fragmented'){let at=0;const write=()=>{if(at<valid.length){process.stdout.write(valid[at++]);setImmediate(write);}};write();}
else if(query==='truncated')process.stdout.write(header+file(query+'.ts'));
else if(query==='malformed')process.stdout.write(header+'{bad json}\\n');
else if(query==='oversize')process.stdout.write(header+'x'.repeat(256*1024+1));
else if(query==='reordered')process.stdout.write(header+file(query+'-z.ts')+file(query+'-a.ts')+summary);
else if(query==='duplicate')process.stdout.write(header+file(query+'.ts')+file(query+'.ts')+summary);
else if(query==='escaped')process.stdout.write(header+file('../'+query+'.ts')+summary);
else if(query==='tail')process.stdout.write(valid+file(query+'-extra.ts'));
else if(query==='nonzero'){process.stdout.write(valid);process.exitCode=2;}
else process.stdout.write(valid.trimEnd());
`, { mode: 0o700 });
    assert.deepEqual(await nativeScan(fixture, root, 'fragmented'), { files: ['fragmented.ts'], total: 1, visited: 1, unreadable: 0, limited: false });
    for (const query of ['truncated', 'malformed', 'oversize', 'reordered', 'duplicate', 'escaped', 'tail', 'nonzero', 'unterminated']) assert.equal(await nativeScan(fixture, root, query), null, query);
    checks.push('Fragmented records parse exactly; incomplete, oversized, malformed, reordered, duplicate, escaping and trailing records never produce a partial result.');
    const active = new AbortController(), work = nativeScan(fixture, root, 'slow', { signal: active.signal });
    const marker = path.join(root, 'worker-pid'), deadline = Date.now() + 10000;
    while (!fs.existsSync(marker)) { assert.ok(Date.now() < deadline, 'worker started'); await new Promise(resolve => setTimeout(resolve, 10)); }
    const pid = Number(fs.readFileSync(marker, 'utf8')); assert.ok(Number.isInteger(pid) && pid > 1 && pid !== process.pid);
    active.abort(); await assert.rejects(work, { name: 'AbortError' });
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', 'owned worker is already reaped');
    checks.push('A confirmed live worker is gone before cancellation settles.');
  }
  const report = { complete: true, platform: process.platform, versions: process.versions, binary, checks, scope: 'Fresh real filesystem parity with the current complete JS scanner. This does not measure speed, RAM, UI behavior or installer integration.' };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ complete: true, checks: checks.length }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
