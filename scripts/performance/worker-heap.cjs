'use strict';
// Read one native worker-isolate heap sample. No forced GC, page evaluation,
// worker execution, or persistent debugger attachment. Start a disposable app
// with --remote-debugging-port first; this does not launch or change user data.
const fs = require('node:fs');
const { once } = require('node:events');

async function sample(port) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) }).then((response) => {
    if (!response.ok) throw new Error(`Debug endpoint returned ${response.status}`);
    return response.json();
  });
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  const pending = new Map(); let id = 0;
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data); const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
    pending.set(next, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
    const { targetInfos } = await call('Target.getTargets'); const workers = [];
    for (const target of targetInfos.filter((target) => target.type === 'worker')) {
      const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      try {
        workers.push({ id: target.targetId, script: target.url.split('/').at(-1), heap: await call('Runtime.getHeapUsage', {}, sessionId) });
      } finally { await call('Target.detachFromTarget', { sessionId }); }
    }
    return { at: Date.now(), browser: version.Browser, workers, scope: 'Worker isolates only; no GC forced. Not whole-app RAM or a before/after savings estimate.' };
  } finally { ws.close(); for (const request of pending.values()) clearTimeout(request.timer); }
}

async function main() {
  const args = process.argv.slice(2); const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || args.length > 2) throw new Error('Usage: node scripts/performance/worker-heap.cjs <loopback-debug-port> [output.json]');
  const result = JSON.stringify(await sample(port), null, 2) + '\n';
  if (args[1]) fs.writeFileSync(args[1], result);
  process.stdout.write(result);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
