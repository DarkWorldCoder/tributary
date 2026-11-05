'use strict';
// Per-process admission control for generation requests, shared by all local
// chats and tool rounds. The service owns weights, KV cache and other clients.
const { localAddress } = require('./local-models');
const LIMITS = [1, 2, 4];
const MAX_WAITING = 64;
function requestLimit(value = 1) {
  if (!LIMITS.includes(value)) throw new Error('Choose 1, 2 or 4 parallel local requests.');
  return value;
}
function endpointKey(baseUrl) {
  const url = new URL(localAddress(baseUrl));
  // All accepted hostnames are loopback; aliases must share one pool. Include
  // the origin port but not model/profile IDs, credentials or API path aliases.
  return `${url.protocol}//loopback:${url.port || (url.protocol === 'https:' ? 443 : 80)}`;
}
class LocalRequests {
  constructor() { this.pools = new Map(); }
  acquire(gateway, { signal, onQueued } = {}) {
    signal?.throwIfAborted();
    const key = endpointKey(gateway.baseUrl); const limit = requestLimit(gateway.localConcurrency);
    let pool = this.pools.get(key);
    if (!pool) { pool = { active: new Set(), waiting: [] }; this.pools.set(key, pool); }
    const drain = () => {
      while (pool.waiting.length) {
        const next = pool.waiting[0];
        const ceiling = Math.min(next.limit, ...[...pool.active].map((item) => item.limit));
        if (pool.active.size >= ceiling) break;
        pool.waiting.shift(); next.detach();
        const token = { limit: next.limit }; pool.active.add(token);
        let released = false;
        next.resolve(() => { if (released) return; released = true; pool.active.delete(token); drain(); });
      }
      if (!pool.active.size && !pool.waiting.length) this.pools.delete(key);
    };
    if (pool.waiting.length >= MAX_WAITING) return Promise.reject(new Error('The local model queue is full. Wait for current requests to finish.'));
    return new Promise((resolve, reject) => {
      const cancel = (reason = signal?.reason) => {
        const index = pool.waiting.indexOf(entry); if (index < 0) return;
        pool.waiting.splice(index, 1); entry.detach(); reject(reason || new Error('Local request cancelled.')); drain();
      };
      const entry = { limit, resolve, detach: () => signal?.removeEventListener('abort', aborted) };
      const aborted = () => cancel();
      pool.waiting.push(entry); signal?.addEventListener('abort', aborted, { once: true });
      drain();
      if (pool.waiting.includes(entry)) {
        try { onQueued?.(); } catch (error) { cancel(error); }
      }
    });
  }
  // Bounded operational counts only. Never return prompts, keys or callbacks.
  counts() { return { services: this.pools.size, active: [...this.pools.values()].reduce((n, p) => n + p.active.size, 0), waiting: [...this.pools.values()].reduce((n, p) => n + p.waiting.length, 0) }; }
}
const localRequests = new LocalRequests();
module.exports = { LocalRequests, localRequests, requestLimit, endpointKey, MAX_WAITING };
