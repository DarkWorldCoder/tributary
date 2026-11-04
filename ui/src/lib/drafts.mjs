// Unsaved text the host keeps across a crash or restart (core/drafts.js).

// Writes one draft after a short pause in typing, and straight away when the window closes.
export function draftWriter(hub, key, { delay = 400, onError } = {}) {
  let timer; let pending = false; let value = null;
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (!pending) return;
    pending = false;
    Promise.resolve().then(() => hub.call('saveDraft', key, value ?? null)).catch((e) => onError?.(e));
  };
  globalThis.addEventListener?.('pagehide', flush);
  return {
    set(next) { value = next; pending = true; clearTimeout(timer); timer = setTimeout(flush, delay); },
    flush,
    dispose() { flush(); globalThis.removeEventListener?.('pagehide', flush); },
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
