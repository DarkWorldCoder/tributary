'use strict';
// Real local HTTP request bodies, with a fixed response delay instead of model
// inference. This measures admission and payload overlap, not KV cache or VRAM.
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { runDirectTurn } = require('../../core/direct'); const { localRequests } = require('../../core/local-requests');
const round = (n) => Math.round(n * 1000) / 1000;
async function worker() {
  const mode = process.argv[3]; const bodies = new Map(); let next = 0; let bytes = 0; let peakBytes = 0; let peakActive = 0; let received = 0;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const id = ++next; received++; JSON.parse(body); bodies.set(id, body); bytes += Buffer.byteLength(body);
    peakActive = Math.max(peakActive, bodies.size); peakBytes = Math.max(peakBytes, bytes);
    let finished = false; let timer;
    const cleanup = () => { if (finished) return; finished = true; clearTimeout(timer); bytes -= Buffer.byteLength(bodies.get(id)); bodies.delete(id); };
    res.once('finish', cleanup); res.once('close', cleanup);
    timer = setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'local fixture reply' }, finish_reason: 'stop' }] })); }, 30);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const gateway = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'openai', model: 'fixture', ...(mode === 'unlimited' ? {} : { localRuntime: 'ollama', localConcurrency: Number(mode) }) };
    const messages = [{ role: 'system', content: 's'.repeat(4000) }, { role: 'user', content: 'u'.repeat(60000) }];
    let queuedEvents = 0; const started = performance.now();
    const results = await Promise.all(Array.from({ length: 24 }, () => runDirectTurn({ gateway, prompt: 'fixture', messages, onEvent(event) { if (event.kind === 'model-phase' && event.phase === 'waiting-model') queuedEvents++; } })));
    const durationMs = round(performance.now() - started);
    if (!results.every((r) => r.ok && r.text === 'local fixture reply') || received !== 24 || bodies.size || localRequests.counts().services) throw Error('Completion/cleanup parity failed');
    return { mode, requests: received, peakActiveRequestBodies: peakActive, peakRetainedReceiverBodyBytes: peakBytes, queuedEvents, durationMs, completed: results.length, finalActiveBodies: bodies.size, finalClientQueue: localRequests.counts(), checksum: crypto.createHash('sha256').update(results.map((r) => r.text).join('\n')).digest('hex') };
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
async function main() {
  if (process.argv[2] === '--worker') { process.stdout.write(JSON.stringify(await worker())); return; }
  const cases = [];
  for (const mode of ['unlimited', '1', '2', '4']) {
    const child = spawnSync(process.execPath, [__filename, '--worker', mode], { encoding: 'utf8', timeout: 30000 });
    if (child.status !== 0) throw Error(child.stderr || 'Local request benchmark failed'); cases.push(JSON.parse(child.stdout));
  }
  if (!cases.every((c) => c.checksum === cases[0].checksum)) throw Error('Reply parity failed');
  const fingerprintFiles = ['core/local-requests.js', 'core/direct.js', 'core/hub.js', 'scripts/performance/local-requests.cjs'];
  const fingerprint = crypto.createHash('sha256'); for (const file of fingerprintFiles) { fingerprint.update(file); fingerprint.update(fs.readFileSync(path.join(__dirname, '../..', file))); }
  const report = { checkedOn: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, fingerprint: fingerprint.digest('hex'), fingerprintFiles,
    scope: '24 actual HTTP requests to a disposable loopback server. Counts and byte sizes are real received JSON bodies retained until a fixed 30ms reply. The ungated comparison uses the normal compatible-provider path with identical body content. No weights, inference, GPU, KV-cache allocation, other applications, packaged Electron memory or whole-app RAM measured. Lower parallelism trades overlap for queueing latency.', cases };
  const index = process.argv.indexOf('--output'); if (index >= 0) fs.writeFileSync(process.argv[index + 1], JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
