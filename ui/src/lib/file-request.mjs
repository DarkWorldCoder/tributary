// Keep one pending intent, not a per-project history or document cache. Only
// mounted file panes subscribe; opening a file need not update the app context.
export function createFileRequests() {
  let current = null;
  const listeners = new Map();
  return {
    getSnapshot(projects) {
      if (!current) return null;
      return (typeof projects === 'string' ? projects === current.project : projects.includes(current.project)) ? current : null;
    },
    subscribe(projects, listener) {
      const paths = typeof projects === 'string' ? [projects] : [...new Set(projects)];
      let owner = listener;
      const notify = () => owner?.();
      for (const project of paths) {
        if (!listeners.has(project)) listeners.set(project, new Set());
        listeners.get(project).add(notify);
      }
      return () => {
        if (!owner) return;
        owner = null;
        for (const project of paths) {
          const set = listeners.get(project);
          set?.delete(notify);
          if (!set?.size) listeners.delete(project);
        }
      };
    },
    publish(request) {
      if (request === current) return;
      const previous = listeners.get(current?.project);
      current = request;
      const next = listeners.get(current?.project);
      if (!previous?.size && !next?.size) return;
      // Snapshot before callbacks: a synchronous React commit can subscribe or
      // unsubscribe panes. Multi-root subscribers are notified only once.
      const pending = new Set(previous);
      if (next) for (const notify of next) pending.add(notify);
      for (const notify of pending) notify();
    },
  };
}
