'use strict';
// Paired, serial desktop/model memory measurements. No user model service touched.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), [manifestFile, output] = process.argv.slice(2);
assert.ok(manifestFile && output && path.isAbsolute(manifestFile) && path.isAbsolute(output));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function hash(file) { const h = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) h.update(chunk); return h.digest('hex'); }
async function uiHash() {
  const dir = path.join(repo, 'ui/dist'), h = crypto.createHash('sha256');
  for (const file of fs.readdirSync(dir, { recursive: true }).filter(file => fs.statSync(path.join(dir, file)).isFile()).sort()) h.update(file + '\0').update(fs.readFileSync(path.join(dir, file)));
  return h.digest('hex');
}
async function main() {
  assert.equal(process.platform, 'linux');
  const manifest = JSON.parse(fs.readFileSync(manifestFile)), model = manifest.files.find(file => file.path.endsWith('.gguf')), archive = manifest.files.find(file => file.path.endsWith('.tar.gz'));
  for (const file of [model, archive]) { assert.equal(fs.statSync(file.path).size, file.bytes); assert.equal(await hash(file.path), file.sha256); }
  const sources = ['core/local-engine.js', 'core/local-engine-process.js', 'core/local-engine-worker.cjs', 'core/local-models.js', 'core/local-requests.js', 'core/hub.js', 'core/direct.js', 'core/models.js', 'desktop/main.js', 'desktop/preload.js', 'desktop/message-transport.js', 'ui/src/store.tsx', 'ui/src/components/model-picker.tsx', 'ui/src/components/markdown.tsx', 'scripts/performance/app-memory.cjs', 'scripts/performance/native-local-engine-desktop.cjs', 'scripts/performance/local-engine-desktop.cjs'];
  const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async file => [file, await hash(path.join(repo, file))])));
  const before = await hashes(), build = await uiHash(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-desktop-model-pairs-')), runtime = path.join(root, 'runtime'); fs.mkdirSync(runtime);
  let complete = false;
  try {
    execFileSync('python3', ['-c', "import tarfile,sys;tarfile.open(sys.argv[1]).extractall(sys.argv[2],filter='data')", archive.path, runtime]);
    const executable = fs.readdirSync(runtime, { recursive: true, withFileTypes: true }).find(file => file.isFile() && file.name === 'llama-server'); assert.ok(executable);
    const binary = path.join(executable.parentPath, executable.name), rows = [];
    for (let repeat = 0; repeat < 3; repeat++) for (const idleSeconds of repeat % 2 ? [2, 3600] : [3600, 2]) {
      const name = `${repeat}-${idleSeconds}`, file = path.join(root, name + '.json'); console.log('Starting', name);
      const child = spawn('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(repo, 'scripts/performance/native-local-engine-desktop.cjs'), '--no-sandbox', '--ozone-platform=x11'], {
        cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TRIBUTARY_ENGINE_DESKTOP_OUTPUT: file, TRIBUTARY_ENGINE_DESKTOP_IDLE: String(idleSeconds), TRIBUTARY_ENGINE_DESKTOP_BINARY: binary, TRIBUTARY_ENGINE_DESKTOP_MODEL: model.path },
      });
      // Keep each child's exact diagnostics and one live handle. The fixture owns
      // cancellation/reaping; an observation timeout must not start another app.
      const log = fs.openSync(path.join(root, name + '.log'), 'w');
      child.stdout.on('data', chunk => fs.writeSync(log, chunk)); child.stderr.on('data', chunk => fs.writeSync(log, chunk));
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); fs.closeSync(log);
      assert.equal(code, 0, 'See diagnostics in ' + root); const result = JSON.parse(fs.readFileSync(file)); assert.equal(result.passed, true);
      assert.equal(result.checks.actualUiGeneration && result.checks.automaticWake && result.checks.nativeAndGuardianReaped && result.checks.modelPickerAndTenCatalogReadsPreserveSleep, true);
      for (const phase of result.phases) for (const sample of phase.samples) assert.equal(sample.tree.complete, true);
      rows.push({ repeat, ...result }); assert.deepEqual(await hashes(), before); assert.equal(await uiHash(), build); console.log('Completed', name);
    }
    const labels = rows[0].phases.map(phase => phase.label);
    const metrics = (row, label) => {
      const phase = row.phases.find(phase => phase.label === label);
      return { desktopTreePssKiB: median(phase.samples.map(s => s.tree.totals.pssKiB)), desktopTreePrivateKiB: median(phase.samples.map(s => s.tree.totals.privateKiB)),
        nativePssKiB: median(phase.samples.map(s => s.tree.processes.find(p => p.pid === row.nativePid)?.pssKiB || 0)),
        guardianPssKiB: median(phase.samples.map(s => s.tree.processes.find(p => p.pid === row.guardianPid)?.pssKiB || 0)),
        nativeAnonPssKiB: median(phase.samples.map(s => s.nativeMemory.Pss_Anon)), nativeFilePssKiB: median(phase.samples.map(s => s.nativeMemory.Pss_File)),
        rendererHeapBytes: phase.heap.usedSize, domNodes: phase.dom.nodes };
    };
    const summary = Object.fromEntries([3600, 2].map(idle => [idle, Object.fromEntries(labels.map(label => [label, Object.fromEntries(Object.keys(metrics(rows[0], label)).map(key => [key, median(rows.filter(row => row.idleSeconds === idle).map(row => metrics(row, label)[key]))]))]))]));
    const pairedIdleDifferencesKiB = Array.from({ length: 3 }, (_, repeat) => {
      const pair = rows.filter(row => row.repeat === repeat), control = pair.find(row => row.idleSeconds === 3600), sleep = pair.find(row => row.idleSeconds === 2);
      return { repeat, idleTree: metrics(sleep, 'after-idle').desktopTreePssKiB - metrics(control, 'after-idle').desktopTreePssKiB, catalogTree: metrics(sleep, 'after-catalog').desktopTreePssKiB - metrics(control, 'after-catalog').desktopTreePssKiB };
    });
    fs.copyFileSync(path.join(root, '2-2.json.png'), output + '.png');
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), sourceHashes: before, uiBuildSha256: build, artifacts: { runtimeTag: manifest.runtimeTag, runtimeCommit: manifest.runtimeCommit, modelRevision: manifest.modelRevision, files: [archive, model].map(({ url, bytes, sha256 }) => ({ url, bytes, sha256 })) }, summary, pairedIdleDifferencesKiB, rows,
      method: 'Three fresh alternating pairs: one-hour control versus two-second idle unloading. Six settled boundaries per app, five complete Linux process-tree samples per boundary, medians within app and across three apps. Incomplete procfs attempts are preserved in rejectedSamples and excluded from totals; at most twenty attempts per boundary. Real UI sends two CPU generations capped at 16 output tokens; actual model picker and ten bridge catalog reads. Same 4K context, two threads, one slot and native cache settings. No concurrent tests/builds/benchmarks. No forced GC; one read-only CDP heap/DOM observation after each boundary.',
      scope: 'Full source Electron descendant-process PSS including Electron Node-mode guardian and real CPU server; Xvfb, detached/reparented helpers, OS page cache and external driver allocations excluded. Same-machine paired descriptive observations, not randomized inference. No whole-machine freed-RAM, natural peak/GC latency, GPU, model quality, installer, native Windows/macOS or universal speed claim. Automatic agent discovery and update polling disabled only in fixture. No user profile/service changed.' }, null, 2) + '\n');
    complete = true; console.log(JSON.stringify({ summary, pairedIdleDifferencesKiB }));
  } finally { if (complete) fs.rmSync(root, { recursive: true, force: true }); else console.error('Diagnostic evidence:', root); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
