// One in-flight update and one latest desired path set; never a queue of tab
// histories or source contents. A bridge returning a new ID is also supported.
export function createFileWatchSession(hub, project, { onStatus, onPaths, onDirectory }) {
  let disposed = false, working = false, id = '', desired = [], applied = [], attempted = null;
  const same = (a, b) => a && a.length === b.length && a.every((rel, index) => rel === b[index]);
  // Send release before a replacement pane can request the last capacity slot.
  const unwatch = (target) => { try { void Promise.resolve(hub.call('unwatchFiles', target)).catch(() => {}); } catch {} };
  const selected = (paths) => paths.filter(rel => desired.includes(rel));
  const off = hub.on('files-changed', (event) => {
    if (disposed || !id || event.project !== project || event.watchId !== id) return;
    if (event.error) { onStatus('Live updates unavailable'); return; }
    if (event.paths.includes('')) onDirectory();
    const paths = selected(event.paths.filter(Boolean)); if (paths.length) onPaths(paths, true);
  });
  async function drain() {
    if (working || disposed) return; working = true;
    try {
      while (!disposed && !same(attempted, desired)) {
        const paths = desired, previous = id; attempted = paths;
        try {
          const next = await (previous ? hub.call('watchFiles', project, paths, previous) : hub.call('watchFiles', project, paths));
          if (typeof next !== 'string' || !next) throw new Error('No file watch ID.');
          if (disposed) { if (next !== previous) unwatch(next); return; }
          const added = previous === next ? paths.filter(rel => !applied.includes(rel)) : paths;
          id = next; applied = paths;
          if (previous && previous !== next) unwatch(previous);
          onStatus('Live updates');
          const catchup = selected(added); if (catchup.length) onPaths(catchup, false);
        } catch {
          if (disposed) return;
          onStatus('Live updates unavailable');
          // Existing paths stay watched after a rejected update. New paths still
          // get one catch-up read; explicit Refresh starts another connection.
          const catchup = selected(paths.filter(rel => !applied.includes(rel))); if (catchup.length) onPaths(catchup, false);
        }
      }
    } finally { working = false; }
  }
  return {
    set(paths) {
      if (disposed) return;
      const next = [...new Set(paths)].sort(); if (same(desired, next) && attempted !== null) return;
      desired = next; void drain();
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (typeof off === 'function') off(); if (id) unwatch(id);
      // A delayed RPC or a retained cleanup function must not retain the pane.
      onStatus = onPaths = onDirectory = null;
      desired = []; applied = []; attempted = null;
    },
  };
}
