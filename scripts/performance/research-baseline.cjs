'use strict';

// Synthetic research measurements of the existing core. No app data is touched.
// Run: node scripts/performance/research-baseline.cjs [output.json]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '../..');
const { Store } = require(path.join(root, 'core/store'));
const { digest } = require(path.join(root, 'core/handoff'));
const { readMemory } = require(path.join(root, 'core/memory'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-research-'));
const samples = 7;
function time(fn) {
  fn(); // Warm code and filesystem cache; results are explicitly warm measurements.
  const values = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return { medianMs: +values[Math.floor(samples / 2)].toFixed(3),
    minMs: +values[0].toFixed(3), maxMs: +values.at(-1).toFixed(3), samples };
}
function messages(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `message-${i}`, role: i % 2 ? 'assistant' : 'user', agent: 'codex',
    text: `${i}: ${'Project decision and implementation evidence. '.repeat(47)}`,
    tools: i % 2 ? [{ id: `tool-${i}`, name: 'shell', input: { command: 'npm test' },
      output: 'synthetic output '.repeat(15), files: ['src/example.ts'] }] : [],
  }));
}
const result = {
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch,
    cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
  sourceHashes: Object.fromEntries(['core/store.js', 'core/handoff.js', 'core/memory.js'].map((p) =>
    [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex')])),
  limitations: [
    'Synthetic fixtures; not a live Electron, provider, native-bridge, or coding-task benchmark.',
    'Standalone Node runtime; warm filesystem/cache; temporary filesystem may differ from user data storage.',
    'Store timings include synchronous stringify/write/rename, without fsync or a crash-durability claim.',
    'IPC comparison uses JSON byte counts as a payload proxy; Electron uses structured cloning.',
    'No proposed optimized or Rust implementation is measured.',
  ],
  store: [], handoff: [], worklog: [], streamPayload: {},
};

try {
  for (const count of [500, 2500, 10000]) {
    const msgs = messages(count);
    const store = new Store(path.join(temp, `hub-${count}.json`), {
      projects: [], threads: [{ id: 'thread', project: '/synthetic', messages: msgs }],
    });
    const timing = time(() => store.save(true));
    result.store.push({ messages: count, bytes: fs.statSync(store.file).size, ...timing });
    let output = '';
    result.handoff.push({ messages: count, ...time(() => { output = digest(msgs, { codex: 'Codex' }); }),
      outputCharacters: output.length });
  }
  const project = path.join(temp, 'project');
  fs.mkdirSync(path.join(project, '.tributary'), { recursive: true });
  fs.writeFileSync(path.join(project, '.tributary/memory.md'), '# Decisions\n- Synthetic fixture\n');
  for (const count of [1000, 10000, 100000]) {
    const log = '# Work log\n' + Array.from({ length: count }, (_, i) =>
      `- 2026-11-02 12:00 Codex: turn ${i}. Changed src/example.ts; checked synthetic result.\n`).join('');
    fs.writeFileSync(path.join(project, '.tributary/worklog.md'), log);
    let returned = 0;
    const timing = time(() => { returned = readMemory(project).worklog.length; });
    result.worklog.push({ entries: count, bytes: Buffer.byteLength(log), returned, ...timing });
  }
  // One event per already-coalesced UI update: compare entire message vs appended text.
  const count = 1000;
  const chunk = 'x'.repeat(128);
  const message = { id: 'message', role: 'assistant', text: '', thinking: '', tools: [], files: [] };
  let snapshotBytes = 0;
  let deltaBytes = 0;
  for (let seq = 1; seq <= count; seq++) {
    message.text += chunk;
    snapshotBytes += Buffer.byteLength(JSON.stringify({ threadId: 'thread', message }));
    deltaBytes += Buffer.byteLength(JSON.stringify({ threadId: 'thread', messageId: 'message', seq,
      kind: 'text', text: chunk }));
  }
  result.streamPayload = { updates: count, charactersPerUpdate: chunk.length,
    finalTextCharacters: message.text.length, snapshotBytes, deltaBytes,
    payloadRatio: +(snapshotBytes / deltaBytes).toFixed(2) };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), json);
  process.stdout.write(json);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
