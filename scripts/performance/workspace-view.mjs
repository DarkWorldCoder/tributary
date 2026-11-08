// Microbenchmark of the actual map transition and the hook's serialization
// branch. No forced collection; this does not measure whole-app RAM or paint.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const sources = ['test/fixtures/workspace-view-before.mjs', 'ui/src/lib/workspace-view.mjs', 'ui/src/hooks/use-workspace-view.ts', 'scripts/performance/workspace-view.mjs'];
const fingerprints = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const [, , mode, countText, work] = process.argv;
if (mode === 'before' || mode === 'after') {
  const count = Number(countText), iterations = 2000;
  assert.ok([1, 100, 1000].includes(count)); assert.ok(['same', 'change'].includes(work));
  const module = mode === 'before' ? sources[0] : sources[1];
  const { patchWorkspaceViews } = await import(pathToFileURL(path.join(repo, module)));
  const fallback = { layout: 'editor', expanded: false, panel: { open: false, tab: 'files' } };
  const entry = { ...fallback, panel: { open: true, tab: 'files' } };
  const original = Object.fromEntries(Array.from({ length: count }, (_, i) => ['/projects/workspace-' + i, entry]));
  const project = '/projects/workspace-0', same = { panel: entry.panel };
  const changes = [{ panel: { open: true, tab: 'memory' } }, same];
  let views = original, writes = 0, serializedCharacters = 0, mapReplacements = 0;
  const update = (i, tally) => {
    const next = patchWorkspaceViews(views, project, work === 'same' ? same : changes[i % 2], fallback);
    if (mode === 'before' || next !== views) {
      const serialized = JSON.stringify(next);
      if (tally) { writes++; serializedCharacters += serialized.length; mapReplacements += Number(next !== views); }
    }
    views = next;
  };
  for (let i = 0; i < 100; i++) update(i, false);
  const collections = [];
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) collections.push({ start: entry.startTime, duration: entry.duration, kind: entry.detail.kind }); });
  observer.observe({ entryTypes: ['gc'] });
  await new Promise(setImmediate);
  const heapBefore = process.memoryUsage().heapUsed, cpuBefore = process.cpuUsage(), start = performance.now();
  for (let i = 0; i < iterations; i++) update(i, true);
  const end = performance.now(), cpu = process.cpuUsage(cpuBefore), heapAfter = process.memoryUsage().heapUsed;
  await new Promise(resolve => setTimeout(resolve, 20)); observer.disconnect();
  const gc = collections.filter(entry => entry.start >= start && entry.start < end);
  assert.deepEqual(views, original, 'even number of changes restores the same settings');
  assert.equal(writes, mode === 'after' && work === 'same' ? 0 : iterations);
  console.log(JSON.stringify({ mode, projects: count, work, iterations, milliseconds: end - start, cpuMilliseconds: (cpu.user + cpu.system) / 1000,
    writes, serializedCharacters, mapReplacements, observedGc: gc.length, observedGcMilliseconds: gc.reduce((n, entry) => n + entry.duration, 0),
    heapBefore, heapAfter, peakRssKiB: process.resourceUsage().maxRSS, runtime: process.versions }));
} else {
  const output = mode;
  if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute JSON report path.');
  const hashes = fingerprints(), runs = [];
  for (let repeat = 0; repeat < 5; repeat++) for (const projects of [1, 100, 1000]) for (const work of ['same', 'change']) {
    for (const selected of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
      const result = execFileSync(process.execPath, [fileURLToPath(import.meta.url), selected, String(projects), work], { encoding: 'utf8', timeout: 30000 });
      runs.push({ repeat, ...JSON.parse(result) });
    }
  }
  assert.deepEqual(fingerprints(), hashes, 'sources changed during the cohort');
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = [];
  for (const projects of [1, 100, 1000]) for (const work of ['same', 'change']) for (const selected of ['before', 'after']) {
    const rows = runs.filter(row => row.projects === projects && row.work === work && row.mode === selected);
    summary.push({ projects, work, mode: selected, milliseconds: median(rows.map(row => row.milliseconds)), writes: rows[0].writes, serializedCharacters: rows[0].serializedCharacters,
      observedGc: median(rows.map(row => row.observedGc)), observedGcMilliseconds: median(rows.map(row => row.observedGcMilliseconds)) });
  }
  fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), sourceHashes: hashes, scope: '60 sequential fresh Node processes; 5 alternating pairs per workspace-count/workload; 2000 transitions per process after 100 warmups. Real normalization/map/JSON branch, storage call counted but no browser disk I/O or React render. Natural GC only. Heap deltas are not allocation totals; GC and RSS are noisy process diagnostics, not app savings.', summary, runs }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
