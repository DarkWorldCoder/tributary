'use strict';
// Real CPU weights/context sleep and wake, driven by the product Hub/engine.
// Reuses verified portable artifacts; never installs or changes a user service.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function hash(file) { const h = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) h.update(chunk); return h.digest('hex'); }
async function inner() {
  const { Hub } = require('/app/core/hub'), { MemorySecrets } = require('/app/core/store'), { sample } = require('/memory.cjs');
  const hub = new Hub({ dataDir: '/tmp/profile', home: '/tmp/home', secrets: new MemorySecrets() });
  const phases = [], turns = [], idleSeconds = Number(process.env.IDLE_SECONDS); let pid, guardianPid;
  const boundary = async label => {
    const samples = []; for (let n = 0; n < 5; n++) { const row = sample(process.pid); assert.equal(row.complete, true); const nativeMemory = pid && fs.existsSync('/proc/' + pid) ? Object.fromEntries([...fs.readFileSync('/proc/' + pid + '/smaps_rollup', 'utf8').matchAll(/^(Pss_Anon|Pss_File|Pss_Shmem):\s+(\d+) kB$/gm)].map(match => [match[1], Number(match[2])])) : { Pss_Anon: 0, Pss_File: 0, Pss_Shmem: 0 };
      assert.ok(Number.isSafeInteger(nativeMemory.Pss_Anon) && Number.isSafeInteger(nativeMemory.Pss_File)); samples.push({ ...row, nativeMemory }); await delay(100); }
    phases.push({ label, state: await hub.localEngineState(), samples });
  };
  try {
    const started = performance.now();
    const engine = await hub.startLocalEngine({ serverPath: process.env.RUNTIME_BIN, modelPath: '/model.gguf', context: 4096, idleSeconds, threads: 2 }); pid = hub.localEngine.child.runtimePid; guardianPid = hub.localEngine.child.pid; assert.ok(Number.isSafeInteger(pid));
    const id = await hub.connectLocalModel({ service: 'llamacpp', baseUrl: engine.baseUrl, model: engine.model });
    await hub.saveGateway({ ...hub.store.data.gateways.find(g => g.id === id), maxOutputTokens: 16 });
    const thread = hub.createThread(hub.personalWorkspace(), 'Owned native idle fixture');
    const turn = async text => {
      const began = performance.now(), result = await hub.send({ threadId: thread.id, agentId: 'direct:' + id, text, mode: 'read' });
      assert.equal(result.ok, true); assert.ok(result.text.trim()); turns.push({ characters: result.text.length, sha256: crypto.createHash('sha256').update(result.text).digest('hex'), elapsedMs: performance.now() - began });
    };
    await turn('Count from one to twenty. Do not explain.'); await boundary('after-first-generation');
    // Equal deliberate idle observation in both variants, not a speed test.
    await delay(6000); const idle = await hub.localEngineState(); assert.equal(idle.status, idleSeconds === 2 ? 'sleeping' : 'ready'); await boundary('after-idle');
    for (let n = 0; n < 10; n++) {
      const catalog = await hub.inspectLocalModels({ service: 'llamacpp', baseUrl: engine.baseUrl }); assert.equal(catalog.status, 'ready'); assert.ok(catalog.models.some(model => model.id === engine.model));
    }
    assert.equal((await hub.localEngineState()).status, idleSeconds === 2 ? 'sleeping' : 'ready');
    await turn('Now count backwards from twenty to one. Do not explain.'); assert.equal((await hub.localEngineState()).status, 'ready'); await boundary('after-second-generation');
    await hub.stopLocalEngine(); assert.equal(fs.existsSync('/proc/' + pid), false); await boundary('after-stop');
    fs.writeFileSync('/report/' + process.env.CASE + '.json', JSON.stringify({ date: new Date().toISOString(), idleSeconds, pid, guardianPid, phases, turns, runtimeReaped: true, catalogReadsDidNotWake: true, elapsedMs: performance.now() - started, runtime: process.versions, scope: 'Real pinned CPU llama.cpp/Qwen 0.5B Q4_K_M, actual Hub connect/send and owned-engine start/sleep/wake/stop. Fresh private namespace/controller for each case; 4,096 context, two threads, one slot, 16 output tokens per turn. No forced GC. Five complete Linux process-tree samples per boundary. Deliberate six-second waits and metadata polling are not throughput measurements. No GPU, model quality, named third-party runtime, Electron or installer claim.' }, null, 2) + '\n');
  } finally { await hub._localEngine?.dispose(); hub.fileWatches.close(); hub.store.close(); }
}
async function outer() {
  const repo = path.resolve(__dirname, '../..'), [manifestFile, output] = process.argv.slice(2); assert.ok(manifestFile && output && path.isAbsolute(manifestFile) && path.isAbsolute(output));
  const manifest = JSON.parse(fs.readFileSync(manifestFile)), model = manifest.files.find(f => f.path.endsWith('.gguf')), archive = manifest.files.find(f => f.path.endsWith('.tar.gz'));
  for (const file of [model, archive]) { assert.equal(fs.statSync(file.path).size, file.bytes); assert.equal(await hash(file.path), file.sha256); }
  const sources = ['core/local-engine.js', 'core/local-engine-process.js', 'core/local-engine-worker.cjs', 'core/local-models.js', 'core/local-requests.js', 'core/hub.js', 'core/direct.js', 'scripts/performance/local-engine-memory.cjs'];
  const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async file => [file, await hash(path.join(repo, file))]))), before = await hashes();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-engine-memory-')), runtime = path.join(root, 'runtime'), reports = path.join(root, 'reports'); fs.mkdirSync(runtime); fs.mkdirSync(reports); let complete = false;
  try {
    execFileSync('python3', ['-c', "import tarfile,sys;tarfile.open(sys.argv[1]).extractall(sys.argv[2],filter='data')", archive.path, runtime]);
    const server = fs.readdirSync(runtime, { recursive: true, withFileTypes: true }).find(f => f.isFile() && f.name === 'llama-server'), relative = path.relative(runtime, path.join(server.parentPath, server.name));
    const rows = [];
    for (let repeat = 0; repeat < 3; repeat++) for (const idleSeconds of repeat % 2 ? [2, 3600] : [3600, 2]) {
      const name = `${repeat}-${idleSeconds}`; console.log('Starting', name);
      const args = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/tmp', '--setenv', 'RUNTIME_BIN', '/runtime/' + relative, '--setenv', 'LD_LIBRARY_PATH', '/runtime/' + path.dirname(relative), '--setenv', 'IDLE_SECONDS', String(idleSeconds), '--setenv', 'CASE', name, '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--ro-bind', runtime, '/runtime', '--ro-bind', process.execPath, '/node', '--ro-bind', model.path, '/model.gguf', '--ro-bind', path.join(repo, 'core'), '/app/core', '--ro-bind', path.join(repo, 'node_modules'), '/app/node_modules', '--ro-bind', __filename, '/bench.cjs', '--ro-bind', path.join(repo, 'scripts/performance/app-memory.cjs'), '/memory.cjs', '--bind', reports, '/report', '/node', '/bench.cjs', '--inner'];
      const child = spawn('bwrap', args, { stdio: ['ignore', 'pipe', 'pipe'] }); let text = ''; const collect = chunk => { text = (text + chunk).slice(-32768); }; child.stdout.on('data', collect); child.stderr.on('data', collect);
      let timer; const code = await new Promise((resolve, reject) => { timer = setTimeout(() => { child.kill('SIGTERM'); }, 150000); child.once('error', reject); child.once('close', resolve); }); clearTimeout(timer);
      fs.writeFileSync(path.join(reports, name + '.log'), text); assert.equal(code, 0, text);
      rows.push({ repeat, ...JSON.parse(fs.readFileSync(path.join(reports, name + '.json'))) }); console.log('Completed', name);
    }
    assert.deepEqual(await hashes(), before);
    const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
    const summary = Object.fromEntries([3600, 2].map(idle => [idle, Object.fromEntries(['after-first-generation', 'after-idle', 'after-second-generation', 'after-stop'].map(label => [label, {
      nativeAnonPssKiB: median(rows.filter(r => r.idleSeconds === idle).map(r => median(r.phases.find(p => p.label === label).samples.map(s => s.nativeMemory.Pss_Anon)))),
      nativeFilePssKiB: median(rows.filter(r => r.idleSeconds === idle).map(r => median(r.phases.find(p => p.label === label).samples.map(s => s.nativeMemory.Pss_File)))),
      nativePssKiB: median(rows.filter(r => r.idleSeconds === idle).map(r => median(r.phases.find(p => p.label === label).samples.map(s => s.processes.find(p => p.pid === r.pid)?.pssKiB || 0)))),
      guardianPssKiB: median(rows.filter(r => r.idleSeconds === idle).map(r => median(r.phases.find(p => p.label === label).samples.map(s => s.processes.find(p => p.pid === r.guardianPid)?.pssKiB || 0)))),
      ownedProcessTreePssKiB: median(rows.filter(r => r.idleSeconds === idle).map(r => median(r.phases.find(p => p.label === label).samples.map(s => s.totals.pssKiB)))),
    }]))]));
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), sourceHashes: before, artifacts: { runtimeTag: manifest.runtimeTag, runtimeCommit: manifest.runtimeCommit, modelRevision: manifest.modelRevision, files: [archive, model].map(({ url, bytes, sha256 }) => ({ url, bytes, sha256 })) }, summary, rows, scope: 'Three alternating fresh private CPU-runtime/controller pairs, same real model and product code. Long-idle control versus two-second native idle release. Native process PSS and controller-plus-guardian-plus-native process-tree PSS; Linux reclaimable page cache outside those processes is not measured free machine RAM. No system service or user profile changed. Idle automatic reload costs remain separate from any coding-quality or GPU claim.' }, null, 2) + '\n'); complete = true; console.log(JSON.stringify(summary));
  } finally { if (complete) fs.rmSync(root, { recursive: true, force: true }); else console.error('Diagnostic evidence:', root); }
}
(process.argv[2] === '--inner' ? inner() : outer()).catch(error => { console.error(error.stack); process.exitCode = 1; });
