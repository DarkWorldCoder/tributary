'use strict';
// Real local PTY, paced stand-in parser. Queue counts are not Electron RAM.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process'); const { TerminalManager } = require('../../core/terminal');
const round = (value) => Math.round(value * 1000) / 1000;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2; };
async function worker(mode) {
  const controlled = mode === 'controlled';
  const { terminalConsumer } = await import('../../ui/src/lib/terminal-consumer.mjs');
  const tm = new TerminalManager(); const chunk = '0123456789abcdef'.repeat(1024); const repeats = 512;
  const expected = crypto.createHash('sha256'); for (let i = 0; i < repeats; i++) expected.update(chunk);
  const actual = crypto.createHash('sha256');
  let records = []; let head = 0; let queued = 0; let maximumQueued = 0; let maximumRecords = 0;
  let maximumHost = 0; let maximumOutstanding = 0; let maximumNativeRead = 0; let nativeReads = 0;
  let delivered = 0; let parsed = 0; let packetCount = 0; let acknowledgments = 0; let nativeExited = false;
  let id; let interval; let deadline; let monitor; let resolve; let reject;
  const done = new Promise((yes, no) => { resolve = yes; reject = no; });
  const sampleHost = () => { const state = tm.terms.get(id)?.output?.stats(); if (state) { maximumHost = Math.max(maximumHost, state.retained); maximumOutstanding = Math.max(maximumOutstanding, state.outstanding); } };
  const write = (data, callback) => { records.push({ data, offset: 0, callback }); queued += data.length; maximumQueued = Math.max(maximumQueued, queued); maximumRecords = Math.max(maximumRecords, records.length - head); };
  const consumer = terminalConsumer({ owner: 'benchmark', write, acknowledge: (owner, seq) => { acknowledgments++; tm.acknowledge(id, owner, seq); } });
  const finish = () => { if (nativeExited && queued === 0) resolve(); };
  tm.on('data', (packet) => { delivered += packet.data.length; packetCount++; if (controlled) consumer.receive(packet); else write(packet.data, () => {}); sampleHost(); });
  tm.on('exit', ({ code }) => { nativeExited = true; if (code !== 0) reject(new Error(`Producer exited: ${code}`)); else finish(); });
  const script = `const fs=require('fs'),b=Buffer.from(${JSON.stringify(chunk)});for(let i=0;i<${repeats};i++)for(let n=0;n<b.length;)n+=fs.writeSync(1,b,n,b.length-n);`;
  const started = performance.now();
  try {
    id = tm.create({ cwd: os.tmpdir(), shell: process.execPath, args: ['-e', script], flowControl: controlled });
    const native = tm.get(id).p;
    monitor = native.onData((data) => { nativeReads++; maximumNativeRead = Math.max(maximumNativeRead, data.length); sampleHost(); });
    // This is deliberately paced by a fixed character budget, independently of
    // the varying native chunk/frame sizes. It is not an xterm speed benchmark.
    interval = setInterval(() => {
      let budget = 32768;
      while (budget && head < records.length) {
        const record = records[head]; const take = Math.min(budget, record.data.length - record.offset);
        actual.update(record.data.slice(record.offset, record.offset + take)); record.offset += take;
        parsed += take; queued -= take; budget -= take;
        if (record.offset === record.data.length) { records[head++] = null; record.callback(); }
      }
      if (head === records.length) { records = []; head = 0; }
      else if (head >= 64) { records = records.slice(head); head = 0; }
      sampleHost(); finish();
    }, 4);
    deadline = setTimeout(() => reject(new Error('Terminal benchmark timed out')), 30000);
    if (controlled) tm.attach(id, 'benchmark');
    await done;
    const checksum = actual.digest('hex'); const expectedChecksum = expected.digest('hex');
    if (checksum !== expectedChecksum || parsed !== chunk.length * repeats || delivered !== parsed) throw new Error('PTY output parity failed');
    process.stdout.write(JSON.stringify({ mode, elapsedMs: round(performance.now() - started), deliveredCodeUnits: delivered, parsedCodeUnits: parsed, packetCount, acknowledgments,
      parserBudgetCodeUnits: 32768, parserIntervalMs: 4, maximumReceiverQueuedCodeUnits: maximumQueued, maximumReceiverRecords: maximumRecords,
      maximumHostRetainedCodeUnits: maximumHost, maximumOutstandingCodeUnits: maximumOutstanding, maximumNativeReadCodeUnits: maximumNativeRead, nativeReads,
      checksum, outputParity: true, receiverQueuedAfterEnd: queued, managerEntriesAfterEnd: tm.terms.size }));
  } finally { clearInterval(interval); clearTimeout(deadline); monitor?.dispose(); consumer.dispose(); tm.killAll(); }
}
async function main() {
  if (process.platform === 'win32') throw new Error('This recorded PTY workload is currently verified on Unix only.');
  if (process.argv[2] === '--worker') return worker(process.argv[3]);
  const rounds = [];
  for (let index = 0; index < 3; index++) {
    const pair = {};
    for (const mode of index % 2 ? ['controlled','legacy'] : ['legacy','controlled']) {
      const child = spawnSync(process.execPath, [__filename, '--worker', mode], { encoding: 'utf8', timeout: 45000 });
      if (child.status !== 0) throw new Error(child.stderr || `${mode} benchmark failed`); pair[mode] = JSON.parse(child.stdout);
    }
    if (pair.legacy.checksum !== pair.controlled.checksum) throw new Error('Cross-policy checksum mismatch'); rounds.push(pair);
  }
  const files = ['core/terminal.js','core/terminal-output.js','ui/src/lib/terminal-consumer.mjs','scripts/performance/terminal-flow.cjs'];
  const result = { checkedOn: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
    sourceSha256: Object.fromEntries(files.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../..', file))).digest('hex')])),
    scope: 'Actual local PTY produces 8 MiB ASCII via synchronous writes, with fixed-budget paced stand-in parsing. Separate processes, three alternating-order rounds. Legacy=current event-only TerminalManager contract; controlled=current desktop credit protocol. This is not complete before/after releases, actual xterm parsing, Electron IPC, inference, peak RAM or a typing-latency benchmark. Host/receiver queue counts overlap logically and are not summed as physical memory. No forced GC. Throughput is deliberately limited by the stand-in parser budget; OS scheduling is uncontrolled.',
    medians: Object.fromEntries(['legacy','controlled'].map((mode) => [mode, { maximumReceiverQueuedCodeUnits: median(rounds.map((pair) => pair[mode].maximumReceiverQueuedCodeUnits)), elapsedMs: round(median(rounds.map((pair) => pair[mode].elapsedMs))) }])), rounds };
  const at = process.argv.indexOf('--output'); if (at >= 0) { if (!process.argv[at + 1]) throw new Error('Missing output path'); fs.writeFileSync(process.argv[at + 1], JSON.stringify(result, null, 2) + '\n'); }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
