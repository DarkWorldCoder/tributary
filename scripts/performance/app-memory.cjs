'use strict';
// Linux process-tree accounting only. Does not force GC, attach a debugger,
// signal a process, or read source/profile data. PSS is not summed RSS.
const fs = require('node:fs');
const path = require('node:path');

function identity(pid, proc) {
  const text = fs.readFileSync(path.join(proc, String(pid), 'stat'), 'utf8');
  const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
  if (!/^\d+$/.test(fields[19]) || !/^\d+$/.test(fields[1])) throw new Error('Invalid process identity');
  return { pid, ppid: Number(fields[1]), started: fields[19] };
}
function scan(proc) {
  const result = new Map();
  for (const entry of fs.readdirSync(proc)) if (/^\d+$/.test(entry)) {
    try { const process = identity(Number(entry), proc); result.set(process.pid, process); } catch { /* process exited or is inaccessible */ }
  }
  return result;
}
function tree(root, processes) {
  const children = new Map();
  for (const item of processes.values()) { if (!children.has(item.ppid)) children.set(item.ppid, []); children.get(item.ppid).push(item); }
  const result = new Map(); const queue = [root];
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index]; if (result.has(item.pid)) continue; result.set(item.pid, item);
    queue.push(...(children.get(item.pid) || []));
  }
  return result;
}
function memory(text) {
  const fields = Object.fromEntries([...text.matchAll(/^([A-Za-z_]+):\s+(\d+) kB\s*$/gm)].map((match) => [match[1], Number(match[2])]));
  for (const key of ['Rss', 'Pss', 'Private_Clean', 'Private_Dirty']) if (!Number.isSafeInteger(fields[key])) throw new Error(`Missing ${key} memory field`);
  return { rssKiB: fields.Rss, pssKiB: fields.Pss, privateKiB: fields.Private_Clean + fields.Private_Dirty,
    privateHugetlbKiB: fields.Private_Hugetlb || 0, sharedHugetlbKiB: fields.Shared_Hugetlb || 0, swapPssKiB: fields.SwapPss || 0 };
}
function role(pid, root, proc) {
  if (pid === root) return 'main';
  try {
    const executable = path.basename(fs.readlinkSync(path.join(proc, String(pid), 'exe')));
    // Chromium may rewrite argv into one space-separated process title.
    const command = fs.readFileSync(path.join(proc, String(pid), 'cmdline'), 'utf8');
    const type = executable === 'electron' && /(?:^|[\s\0])--type=([a-z-]+)(?:[\s\0]|$)/.exec(command);
    return type ? type[1] : `child:${executable}`;
  } catch { return 'unknown'; }
}
function sample(rootPid, proc = '/proc') {
  const startedAt = Date.now(); const initial = scan(proc); const root = initial.get(rootPid);
  if (!root) throw new Error('Root process is missing or inaccessible.');
  const selected = tree(root, initial); const processes = []; const issues = [];
  for (const item of selected.values()) {
    try {
      const values = memory(fs.readFileSync(path.join(proc, String(item.pid), 'smaps_rollup'), 'utf8'));
      const now = identity(item.pid, proc);
      if (now.started !== item.started || now.ppid !== item.ppid) throw new Error('Process identity changed');
      processes.push({ ...item, role: role(item.pid, rootPid, proc), ...values });
    } catch (error) { issues.push({ pid: item.pid, reason: error.code || error.message }); }
  }
  const final = scan(proc); const endRoot = final.get(rootPid);
  const ending = endRoot?.started === root.started ? tree(endRoot, final) : new Map();
  const changed = selected.size !== ending.size || [...selected.values()].some((item) => ending.get(item.pid)?.started !== item.started || ending.get(item.pid)?.ppid !== item.ppid);
  const complete = !changed && !issues.length;
  const observedTotals = Object.fromEntries(['rssKiB', 'pssKiB', 'privateKiB', 'privateHugetlbKiB', 'sharedHugetlbKiB', 'swapPssKiB'].map((field) => [field, processes.reduce((sum, item) => sum + item[field], 0)]));
  return { startedAt, finishedAt: Date.now(), rootPid, rootStarted: root.started, complete, processTreeChanged: changed, issues, processes,
    totals: complete ? observedTotals : null, observedTotals,
    scope: 'Linux process-tree sample, not atomic. PSS apportions shared pages; summed RSS double-counts sharing. Hugetlb is separate. Detached/reparented helpers, external model runtimes and display-server/GPU-driver allocations outside these processes are excluded. No forced GC.' };
}
if (require.main === module) {
  try {
    if (process.platform !== 'linux') throw new Error('This sampler requires Linux procfs.');
    const [argument, output, ...extra] = process.argv.slice(2); const pid = Number(argument);
    if (!Number.isSafeInteger(pid) || pid < 2 || extra.length) throw new Error('Usage: node scripts/performance/app-memory.cjs <app-main-pid> [output.json]');
    const result = JSON.stringify(sample(pid), null, 2) + '\n';
    if (output) fs.writeFileSync(output, result); process.stdout.write(result);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { sample, memory };
