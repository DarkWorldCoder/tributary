// Retained directory state is navigation intent, not cached entries or promises.
export function createDirectorySession() { return { counts: new Map(), focusPath: '', lastActive: undefined }; }
const key = (folder, hidden) => `${hidden ? 'hidden' : 'visible'}\0${folder}`;
export function directoryTarget(session, folder, hidden, previousCount, offset, pageSize = 200) {
  const target = Math.max(pageSize, previousCount, session.counts.get(key(folder, hidden)) || 0, offset ? offset + pageSize : 0);
  session.counts.set(key(folder, hidden), target);
  return target;
}
export function rememberDirectoryCount(session, folder, hidden, count) { session.counts.set(key(folder, hidden), count); }
export function shouldRevealDirectorySelection(session, active) {
  const changed = session.lastActive !== active; session.lastActive = active; return changed;
}
