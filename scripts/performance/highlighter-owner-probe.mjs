import { pathToFileURL } from 'node:url';
if (typeof global.gc !== 'function') throw Error('This diagnostic requires --expose-gc');
const { subscribeHighlighter } = await import(pathToFileURL(process.argv[2]).href);
const tick = () => new Promise(setImmediate);
globalThis.pendingHighlightLoads = []; globalThis.highlightCleanups = [];
const receiverFor = owner => value => owner.receive(value);
async function probe(name, action) {
  let owner = { payload: new Uint8Array(65536), receive() {} }, receiver = receiverFor(owner);
  const reference = new WeakRef(owner); let loads = 0, resolve;
  const pending = new Promise(done => { resolve = done; }); globalThis.pendingHighlightLoads.push(pending);
  const cleanup = subscribeHighlighter(() => { loads++; return pending; }, receiver);
  globalThis.highlightCleanups.push(cleanup); owner = null; receiver = null;
  if (action === 'before') cleanup();
  await tick();
  if (action === 'cancel') cleanup();
  if (action === 'deliver') { resolve({ language: 'fixture' }); await tick(); }
  for (let n = 0; n < 8; n++) { await tick(); global.gc(); }
  return { name, loads, ownerReleased: reference.deref() === undefined };
}
console.log(JSON.stringify({ cases: [await probe('cancel-before-load', 'before'), await probe('cancel-pending-load', 'cancel'), await probe('completed-load', 'deliver'), await probe('active-pending-owner', 'active')] }));
