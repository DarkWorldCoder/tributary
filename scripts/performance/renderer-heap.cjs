'use strict';
// Disposable native-app diagnostics. --gc is an explicit measurement boundary,
// never app behavior. Only attaches to Tributary's file-backed renderer.
const fs = require('node:fs');
const { once } = require('node:events');
async function sample(port, collect, clearConsole = false) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) }).then((response) => {
    if (!response.ok) throw new Error(`Debug endpoint returned ${response.status}`); return response.json();
  });
  const ws = new WebSocket(version.webSocketDebuggerUrl); let id = 0; const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data); const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const next = ++id; const timer = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(next, { resolve, reject, timer }); ws.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
    const { targetInfos } = await call('Target.getTargets');
    const pages = targetInfos.filter((target) => target.type === 'page' && /^file:/.test(target.url) && /\/ui\/dist\/index\.html(?:[?#]|$)/.test(target.url));
    if (pages.length !== 1) throw new Error('Expected exactly one Tributary renderer.');
    const { sessionId } = await call('Target.attachToTarget', { targetId: pages[0].targetId, flatten: true });
    try {
      if (clearConsole) await call('Runtime.discardConsoleEntries', {}, sessionId);
      if (collect) await call('HeapProfiler.collectGarbage', {}, sessionId);
      return { at: Date.now(), rendererId: pages[0].targetId, browser: version.Browser, gcRequested: collect, consoleEntriesDiscarded: clearConsole,
        heap: await call('Runtime.getHeapUsage', {}, sessionId), dom: await call('Memory.getDOMCounters', {}, sessionId),
        observedWorkerTargets: targetInfos.filter((target) => target.type === 'worker').length,
        scope: 'Renderer isolate heap and DOM counters reported by CDP; not main-process heap, other isolates, RSS, PSS or GPU memory. Debugger detaches after measurement.' };
    } finally { await call('Target.detachFromTarget', { sessionId }); }
  } finally { ws.close(); for (const request of pending.values()) clearTimeout(request.timer); }
}
if (require.main === module) {
  const args = process.argv.slice(2); const collect = args.includes('--gc'); const clearConsole = args.includes('--clear-console');
  const positional = args.filter((argument) => !['--gc', '--clear-console'].includes(argument)); const port = Number(positional[0]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || positional.length > 2) { console.error('Usage: node scripts/performance/renderer-heap.cjs <loopback-debug-port> [output.json] [--gc] [--clear-console]'); process.exitCode = 1; }
  else sample(port, collect, clearConsole).then((result) => { const text = JSON.stringify(result, null, 2) + '\n'; if (positional[1]) fs.writeFileSync(positional[1], text); process.stdout.write(text); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { sample };
