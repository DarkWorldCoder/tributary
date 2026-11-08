import { createFileRequests } from '../../ui/src/lib/file-request.mjs';
const store = createFileRequests();
const kept = (() => {
  const owner = { payload: new Uint8Array(1024 * 1024) }, ref = new WeakRef(owner);
  const off = store.subscribe('/one', () => owner.payload[0]); off();
  return { ref, off };
})();
const previous = (() => { const value = { project: '/one', rel: 'old.ts', intent: 'pinned', n: 1 }; store.publish(value); return new WeakRef(value); })();
const latest = (() => { const value = { project: '/one', rel: 'new.ts', intent: 'pinned', n: 2 }; store.publish(value); return new WeakRef(value); })();
for (let i = 0; i < 10; i++) { await new Promise(setImmediate); global.gc(); }
await new Promise(setImmediate);
kept.off();
console.log(JSON.stringify({ subscriberReleased: !kept.ref.deref(), previousReleased: !previous.deref(), latestRetained: !!latest.deref() && store.getSnapshot('/one') === latest.deref() }));
