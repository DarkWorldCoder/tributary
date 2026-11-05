import { pathToFileURL } from 'node:url';
if (typeof global.gc !== 'function') throw Error('Run the diagnostic probe with --expose-gc.');
const { configureEditorGrammar } = await import(pathToFileURL(process.argv[2]).href);
const tick = () => new Promise(setImmediate);
globalThis.pendingLoads = []; globalThis.currentCleanups = [];
async function probe(name, active, waitForLoad) {
  let owner = { dispatch() {}, payload: new Uint8Array(65536) };
  const reference = new WeakRef(owner); let loads = 0;
  const pending = new Promise(() => {}); globalThis.pendingLoads.push(pending);
  let cleanup = configureEditorGrammar(owner, { reconfigure() { return null; } }, active, () => { loads++; return pending; });
  owner = null;
  if (waitForLoad) await tick();
  if (active) { cleanup(); cleanup = null; }
  else globalThis.currentCleanups.push(cleanup); // An inactive effect remains registered.
  for (let i = 0; i < 8; i++) { await tick(); global.gc(); }
  return { name, loads, ownerReleased: reference.deref() === undefined };
}
console.log(JSON.stringify({cases:[await probe('cancel-pending-load',true,true),await probe('inactive-effect',false,false),await probe('cancel-before-load',true,false)]}));
