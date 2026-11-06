// Unsaved text the host keeps across a crash or restart (core/drafts.js).

// One admitted save per writer while typing; intermediate complete snapshots can
// be replaced by the newest one. Shutdown submits that final snapshot immediately
// behind any admitted call, since its acknowledgement may outlive this document.
export function draftWriter(hub, key, { delay = 400, onError } = {}) {
  let timer, value = null;
  let pending = false, ready = false, active = 0, disposed = false;
  const settle = () => { --active; drain(); };
  const submit = () => {
    let data = value; value = null; pending = false; ready = false; ++active;
    let result;
    // Invoke synchronously so an exit flush cannot overtake an admitted save.
    try { result = hub.call('saveDraft', key, data ?? null); }
    catch (error) { result = Promise.reject(error); }
    data = null;
    Promise.resolve(result).then(settle, (error) => { settle(); onError?.(error); });
  };
  const drain = () => { if (!disposed && !active && pending && ready) submit(); };
  const flush = () => {
    if (disposed) return;
    clearTimeout(timer); timer = undefined;
    if (pending) { ready = true; drain(); }
  };
  const flushFinal = () => {
    clearTimeout(timer); timer = undefined;
    // Recovery is a whole-snapshot replacement, and the host writes each call
    // synchronously. FIFO submission preserves the newest exit save/deletion.
    if (pending) submit();
  };
  const pagehide = () => { if (!disposed) flushFinal(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    globalThis.removeEventListener?.('pagehide', pagehide);
    flushFinal();
  };
  // pagehide may put a document in the browser's back/forward cache. Only an
  // explicit owner disposal makes this writer terminal.
  globalThis.addEventListener?.('pagehide', pagehide);
  return {
    set(next) { if (disposed) return; value = next; pending = true; ready = false; clearTimeout(timer); timer = setTimeout(flush, delay); },
    flush,
    dispose,
  };
}

// What the Files tab reopens: its tabs, the active one, and each unsaved file's text with the version
// it was based on, so a file changed on disk meanwhile is reported instead of overwritten.
export function fileSession(docs, active) {
  if (!docs.length) return null;
  return { active, tabs: docs.map((doc) => {
    const tab = { rel: doc.rel, pinned: !!doc.pinned, mode: doc.mode, wrap: !!doc.wrap };
    return doc.dirty && !doc.binary && !doc.truncated ? { ...tab, text: doc.text, base: doc.content, mtime: doc.mtime } : tab;
  }) };
}

const relative = (rel) => typeof rel === 'string' && !!rel && !rel.includes('\0') && !/^(?:[a-z]:|[\\/])/i.test(rel) && !rel.split(/[\\/]/).includes('..');
export function savedFileSession(saved) {
  if (!saved || !Array.isArray(saved.tabs)) return { tabs: [], active: null };
  const seen = new Set();
  const tabs = saved.tabs.filter((tab) => tab && relative(tab.rel) && !seen.has(tab.rel) && seen.add(tab.rel)).slice(0, 50).map((tab) => ({
    rel: tab.rel, pinned: !!tab.pinned, mode: tab.mode === 'preview' ? 'preview' : 'edit', wrap: !!tab.wrap,
    ...(typeof tab.text === 'string' && typeof tab.base === 'string' && Number.isFinite(tab.mtime) && tab.text !== tab.base ? { text: tab.text, base: tab.base, mtime: tab.mtime } : {}),
  }));
  return { tabs, active: tabs.some((tab) => tab.rel === saved.active) ? saved.active : tabs[0]?.rel ?? null };
}
