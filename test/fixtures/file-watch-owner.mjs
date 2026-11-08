import { createFileWatchSession } from '../../ui/src/lib/file-watch-session.mjs';
let release;
const hub = { call(method) { return method === 'watchFiles' ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); }, on() { return () => {}; } };
const kept = (() => {
  const value = { payload: new Uint8Array(1024 * 1024) }, ref = new WeakRef(value);
  const session = createFileWatchSession(hub, '/project', { onStatus: () => value.payload[0], onPaths: () => value.payload[1], onDirectory: () => value.payload[2] });
  session.set(['main.ts']); session.dispose(); return { ref, dispose: session.dispose };
})();
async function collect() { for (let n = 0; n < 10; n++) { await new Promise(setImmediate); global.gc(); } await new Promise(setImmediate); return !kept.ref.deref(); }
const releasedWhilePending = await collect(); kept.dispose();
release('late'); await new Promise(setImmediate);
console.log(JSON.stringify({ releasedWhilePending, releasedAfterCompletion: await collect() }));
