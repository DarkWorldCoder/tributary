// One observer per document owner, not one observer per gallery image.
export function createImageVisibility(Observer = globalThis.IntersectionObserver) {
  const entries = new Map(); let observer = null, generation = 0;
  return {
    observe(element, listener) {
      if (typeof Observer !== 'function') { listener(true); return () => {}; }
      if (!observer) {
        const owner = ++generation;
        try { observer = new Observer(changes => {
          if (owner !== generation) return;
          for (const change of changes) {
            const entry = entries.get(change.target); if (!entry) continue;
            if (Number.isFinite(change.time) && change.time < entry.since) continue;
            entry.near = change.isIntersecting; for (const callback of entry.callbacks) callback(change.isIntersecting);
          }
        }, { rootMargin: '200px' }); }
        catch { listener(true); return () => {}; }
      }
      let entry = entries.get(element);
      if (!entry) { entry = { callbacks: new Set(), since: globalThis.performance?.now() ?? 0, near: undefined }; entries.set(element, entry); observer.observe(element); }
      entry.callbacks.add(listener); if (entry.near !== undefined) listener(entry.near); let released = false;
      return () => {
        if (released) return; released = true; entry.callbacks.delete(listener);
        if (!entry.callbacks.size) { entries.delete(element); observer?.unobserve(element); }
        if (!entries.size) { observer?.disconnect(); observer = null; ++generation; }
      };
    },
    state() { return { targets: entries.size, observing: !!observer }; },
  };
}
export function imagePlaceholder(width, height) {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null;
  const scale = Math.min(1, 256 / height);
  return { width: width * scale, height: height * scale, viewBox: `0 0 ${width} ${height}` };
}

const documents = new WeakMap();
export function observeImage(element, listener) {
  const document = element.ownerDocument;
  let visibility = documents.get(document);
  if (!visibility) { visibility = createImageVisibility(); documents.set(document, visibility); }
  return visibility.observe(element, listener);
}
