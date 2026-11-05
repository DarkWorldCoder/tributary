'use strict';
// Synthetic files only. Timing runs do not observe individual entries. Separate
// paused probes use WeakRef and diagnostic GC to count reachable Dirent objects.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { performance, PerformanceObserver, monitorEventLoopDelay } = require('node:perf_hooks');
const repo = path.resolve(__dirname, '../..');
const immediate = () => new Promise(resolve => setImmediate(resolve));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = rows => [...rows].sort((a, b) => a - b)[Math.floor(rows.length / 2)];

async function child(mode, project, baseline, offset, kind) {
  const moduleStarted = performance.now();
  const readDirectory = require(mode === 'baseline' ? baseline : path.join(repo, 'core/files.js')).readDirectory;
  const moduleLoadMs = performance.now() - moduleStarted;
  const options = { showHidden: true, offset: Number(offset), limit: 200 };
  if (kind === 'probe') {
    const refs = []; let release; let ready;
    const held = new Promise(resolve => { ready = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const promises = fs.promises;
    if (mode === 'baseline' || options.offset + options.limit > 4096) {
      const original = promises.readdir.bind(promises);
      promises.readdir = async (...args) => {
        const entries = await original(...args);
        for (const entry of entries) refs.push(new WeakRef(entry));
        ready(); await gate; return entries;
      };
    } else {
      const original = promises.opendir.bind(promises);
      promises.opendir = async (...args) => {
        const dir = await original(...args);
        return {
          read(callback) { dir.read((error, entry) => {
            if (error || entry) { if (entry) refs.push(new WeakRef(entry)); callback(error, entry); }
            else { ready(); void gate.then(() => callback(null, null)); }
          }); },
          close: () => dir.close(),
        };
      };
    }
    const pending = readDirectory(project, '', options);
    await held; await immediate(); global.gc(); await immediate(); global.gc();
    const reachable = refs.reduce((count, ref) => count + Number(!!ref.deref()), 0);
    release(); const result = await pending;
    return { mode, probe: true, observedEntries: refs.length, reachableDirentsAtPausedSelection: reachable, checksum: digest(result), total: result.total, returned: result.entries.length };
  }
  global.gc(); await immediate();
  let gcCount = 0, gcDurationMs = 0;
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) { gcCount++; gcDurationMs += entry.duration; } });
  observer.observe({ entryTypes: ['gc'] });
  const profiled = kind === 'memory';
  const loop = profiled ? monitorEventLoopDelay({ resolution: 1 }) : null; loop?.enable();
  const before = process.memoryUsage(); const times = []; const checksums = new Set();
  let peakSampledHeapUsed = before.heapUsed;
  const sampler = profiled ? setInterval(() => { peakSampledHeapUsed = Math.max(peakSampledHeapUsed, process.memoryUsage().heapUsed); }, 2) : null;
  for (let i = 0; i < 10; i++) {
    const start = performance.now(); const result = await readDirectory(project, '', options);
    times.push(performance.now() - start); checksums.add(digest(result));
    peakSampledHeapUsed = Math.max(peakSampledHeapUsed, process.memoryUsage().heapUsed);
    await immediate();
  }
  if (sampler) clearInterval(sampler); await immediate(); loop?.disable(); observer.disconnect();
  if (checksums.size !== 1) throw Error('Unstable directory page');
  const after = process.memoryUsage(); const maxRssKiB = process.resourceUsage().maxRSS;
  global.gc(); await immediate(); const settled = process.memoryUsage();
  return { mode, kind, moduleLoadMs, firstReadMs: times[0], warmReadMs: times.slice(3), medianWarmReadMs: median(times.slice(3)), checksum: [...checksums][0], before, after, settledAfterDiagnosticGc: settled, peakSampledHeapUsed, maxRssKiB, naturalGcCount: gcCount, naturalGcDurationMs: gcDurationMs, eventLoopMaxDelayMs: loop ? loop.max / 1e6 : null };
}

async function main() {
  if (process.argv[2] === '--child') {
    const result = await child(process.argv[3], process.argv[4], process.argv[5], process.argv[6], process.argv[7]);
    process.stdout.write(JSON.stringify(result)); return;
  }
  const output = process.argv[2];
  if (!output || !path.isAbsolute(output)) throw Error('Usage: node scripts/performance/directory-pages.cjs /absolute/report.json');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-directory-pages-'));
  const baselineRevision = 'd4d0663';
  try {
    const baseline = path.join(root, 'baseline-files.cjs');
    const oldSource = execFileSync('git', ['show', `${baselineRevision}:core/files.js`], { cwd: repo, encoding: 'utf8' });
    fs.writeFileSync(baseline, oldSource);
    const cases = [{ name: 'small-first-page', count: 80, offset: 0 }, { name: 'medium-first-page', count: 5000, offset: 0 }, { name: 'large-first-page', count: 25000, offset: 0 }, { name: 'large-later-page', count: 25000, offset: 20000 }];
    const projects = new Map();
    for (const item of cases) {
      if (projects.has(item.count)) continue;
      const project = path.join(root, `folder-${item.count}`); fs.mkdirSync(project); projects.set(item.count, project);
      for (let i = 0; i < item.count; i++) {
        const name = `${i % 31 === 0 ? '.' : ''}entry-${String(i * 7919 % item.count).padStart(6, '0')}-representative-module-file.ts`;
        if (i % 101 === 0) fs.mkdirSync(path.join(project, name)); else fs.writeFileSync(path.join(project, name), '');
      }
    }
    const results = [];
    const run = (mode, item, kind) => {
      const result = spawnSync(process.execPath, ['--expose-gc', __filename, '--child', mode, projects.get(item.count), baseline, String(item.offset), kind], { cwd: repo, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
      if (result.status !== 0) throw Error(result.stderr || 'Directory benchmark subprocess failed');
      return JSON.parse(result.stdout);
    };
    for (const item of cases) {
      const runs = [];
      for (let round = 0; round < 3; round++) for (const mode of round % 2 ? ['current', 'baseline'] : ['baseline', 'current']) runs.push({ round, ...run(mode, item, 'timing') });
      if (new Set(runs.map(r => r.checksum)).size !== 1) throw Error('Previous/current directory results differ');
      const profiles = ['baseline', 'current'].map(mode => run(mode, item, 'memory'));
      const summaries = Object.fromEntries(['baseline', 'current'].map(mode => { const rows = runs.filter(r => r.mode === mode); const profile = profiles.find(r => r.mode === mode); return [mode, { medianWarmReadMs: median(rows.flatMap(r => r.warmReadMs)), medianFirstReadMs: median(rows.map(r => r.firstReadMs)), medianModuleAndFirstReadMs: median(rows.map(r => r.moduleLoadMs + r.firstReadMs)), medianMaxRssKiB: median(rows.map(r => r.maxRssKiB)), profiledPeakSampledHeapUsed: profile.peakSampledHeapUsed, profiledEventLoopMaxDelayMs: profile.eventLoopMaxDelayMs }]; }));
      const probes = ['baseline', 'current'].map(mode => run(mode, item, 'probe'));
      if (new Set(probes.map(p => p.checksum)).size !== 1 || probes[0].checksum !== runs[0].checksum) throw Error('Diagnostic probe changed directory results');
      if (profiles.some(profile => profile.checksum !== runs[0].checksum)) throw Error('Profiled read changed directory results');
      results.push({ ...item, runs, summaries, profiles, probes });
      console.log(JSON.stringify({ case: item.name, summaries, reachableDirents: probes.map(p => ({ mode: p.mode, count: p.reachableDirentsAtPausedSelection })) }));
    }
    const sources = ['core/files.js', 'core/directory-page.js', 'scripts/performance/directory-pages.cjs', 'test/files.test.js'];
    const report = { date: new Date().toISOString(), runtime: process.versions, platform: process.platform, arch: process.arch, baselineRevision, baselineFilesSha256: crypto.createHash('sha256').update(oldSource).digest('hex'), sourceHashes: Object.fromEntries(sources.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')])), results, scope: ['Real synthetic directory reads in isolated Node subprocesses; no Electron UI or provider workload.', 'All returned page entries, totals and next offsets checksum-identical across policies and probes.', 'Timing: 3 processes per policy/case, 10 reads each; first read and last 7 warm reads reported separately. OS caches are warm from fixture creation; not physical disk cold-start timing.', 'GC occurs only before timing and after measurements; observed GC during timing is natural. WeakRef reachability probes use diagnostic GC in separate processes and do not contribute timing samples.', 'maxRSS is process-lifetime high water, not incremental app RAM. Sampled heap can miss peaks. Late pages may retain most entries because exact offset pagination requires the prefix.', 'Directory enumeration is not a filesystem transaction; concurrent filesystem changes can alter totals and pages in both implementations.'] };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
