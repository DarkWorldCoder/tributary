// One posted request at a time bounds structured-clone overlap. Waiting work
// keeps caller-owned inputs until admission and can be cancelled without posting.
export function createWorkerClient({ create, readResult = (data) => data.result, timeoutMs = 10000, idleMs = 60000, maxPending = 16, unavailable = 'Worker unavailable.', timeoutMessage = unavailable, clock = globalThis }) {
  let resource = null; let active = null; let idle; let sequence = 0;
  const queue = [];
  const error = (reason) => reason instanceof Error ? reason : new Error(String(reason || unavailable));
  const cancelled = () => new DOMException('Request cancelled.', 'AbortError');
  const clearIdle = () => { clock.clearTimeout(idle); idle = undefined; };
  const cleanup = (value) => { if (!value) return; value.worker.onmessage = null; value.worker.onerror = null; value.worker.onmessageerror = null; try { value.worker.terminate(); } finally { value.dispose?.(); } };
  const settle = (item, reason, result) => {
    if (item.settled) return; item.settled = true;
    item.signal?.removeEventListener('abort', item.abort); item.payload = null;
    const { resolve, reject } = item; item.resolve = null; item.reject = null;
    reason ? reject(error(reason)) : resolve(result);
  };
  const reset = (reason = unavailable) => {
    clearIdle(); const old = resource; resource = null;
    if (active) { clock.clearTimeout(active.timer); settle(active, reason); active = null; }
    for (const item of queue.splice(0)) settle(item, reason);
    old?.controller.abort(); cleanup(old?.value);
  };
  const idleWhenUnused = () => {
    clearIdle(); if (!resource || active || queue.length) return;
    idle = clock.setTimeout(() => { if (!active && !queue.length) reset(); }, idleMs);
  };
  const ensure = () => {
    if (resource) return resource.promise;
    const token = { controller: new AbortController(), value: null, promise: null }; resource = token;
    token.promise = Promise.resolve().then(() => create({ signal: token.controller.signal })).then((value) => {
      if (resource !== token) { cleanup(value); throw cancelled(); }
      token.value = value;
      value.worker.onmessage = (event) => {
        if (resource !== token || !active || event.data?.id !== active.id) return;
        const item = active; active = null; clock.clearTimeout(item.timer);
        try { event.data.error ? settle(item, new Error(event.data.error)) : settle(item, null, readResult(event.data)); }
        catch (reason) { settle(item, reason); }
        pump();
      };
      value.worker.onerror = value.worker.onmessageerror = () => { if (resource === token) reset(); };
      return value.worker;
    });
    return token.promise;
  };
  const pump = () => {
    if (active) return;
    const item = queue.shift();
    if (!item) { idleWhenUnused(); return; }
    clearIdle(); active = item;
    item.timer = clock.setTimeout(() => { if (active === item) reset(timeoutMessage); }, timeoutMs);
    ensure().then((worker) => {
      if (active !== item || item.settled) return;
      try { const message = { ...item.payload, id: item.id }; item.payload = null; item.posted = true; worker.postMessage(message); }
      catch { reset(); }
    }).catch((reason) => { if (active === item) reset(reason); });
  };
  return {
    request(payload, { signal } = {}) {
      if (signal?.aborted) return Promise.reject(signal.reason || cancelled());
      if (queue.length + Number(!!active) >= maxPending) return Promise.reject(new Error('Worker is busy. Try again.'));
      clearIdle();
      return new Promise((resolve, reject) => {
        const item = { id: ++sequence, payload, signal, resolve, reject, settled: false, posted: false, timer: undefined, abort: null };
        item.abort = () => {
          settle(item, signal.reason || cancelled());
          const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1);
          // Posted work owns its worker until a response/deadline. If no caller
          // needs it or queued work, terminate immediately instead of retaining it.
          if (active?.settled && !queue.length) reset(cancelled());
          else if (active === item && !item.posted) { clock.clearTimeout(item.timer); active = null; pump(); }
          else if (!active) pump();
        };
        signal?.addEventListener('abort', item.abort, { once: true });
        queue.push(item); pump();
      });
    },
    dispose: reset,
    stats: () => ({ ready: !!resource?.value, loading: !!resource && !resource.value, active: Number(!!active), waiting: queue.length }),
  };
}

// Each startup owns its URL and cancellation token. A disposed asynchronous
// startup cannot publish a late worker or overwrite another startup's URL.
export async function moduleWorker(source, { signal }) {
  let url = source; let blob = '';
  try {
    if (globalThis.window?.hub?.platform === 'vscode') {
      const response = await fetch(source, { signal }); if (!response.ok) throw new Error('Could not load worker.');
      const text = await response.text(); signal.throwIfAborted();
      blob = URL.createObjectURL(new Blob([text], { type: 'text/javascript' })); url = blob;
    }
    signal.throwIfAborted();
    return { worker: new Worker(url, { type: 'module' }), dispose: () => { if (blob) URL.revokeObjectURL(blob); } };
  } catch (reason) { if (blob) URL.revokeObjectURL(blob); throw reason; }
}
