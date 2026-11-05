'use strict';
// Mutable histories have explicit async owners. Idle eviction is permitted only
// after every nested operation and transport lease has released the thread.
const { AsyncLocalStorage } = require('node:async_hooks');
class HistoryCache {
  constructor(store, { idleMs = 1500, retryMs = 5000, onError = (error) => console.error(`Could not release saved history: ${error.message}`) } = {}) {
    this.store = store; this.idleMs = idleMs; this.retryMs = retryMs; this.onError = onError;
    this.context = new AsyncLocalStorage(); this.pins = new Map(); this.unmanaged = new Set(); this.idle = new Map(); this.closed = false;
    store.historyCache = this;
  }
  run(fn) {
    if (this.closed) return fn();
    const owner = { parent: this.context.getStore(), ids: new Set(), active: true };
    const finish = () => { if (!owner.active) return; owner.active = false; for (const id of owner.ids) this.unpin(id, false); owner.ids.clear(); this.schedule(); };
    let result;
    try {
      result = this.context.run(owner, fn);
      if (result && typeof result.then === 'function') return Promise.resolve(result).finally(finish);
    } catch (error) { finish(); throw error; }
    finish(); return result;
  }
  touch(id) {
    if (this.closed || !id) return;
    let owned = false;
    for (let owner = this.context.getStore(); owner; owner = owner.parent) {
      if (!owner.active) continue;
      owned = true;
      if (!owner.ids.has(id)) { owner.ids.add(id); this.pin(id); }
    }
    // Direct mutable access outside an operation keeps its original lifetime.
    // CLI/SDK users can still keep a message reference and change it much later.
    if (!owned) { this.unmanaged.add(id); this.idle.delete(id); }
  }
  pin(id) { this.pins.set(id, (this.pins.get(id) || 0) + 1); this.idle.delete(id); }
  unpin(id, schedule = true) {
    const count = this.pins.get(id);
    if (count > 1) { this.pins.set(id, count - 1); return; }
    this.pins.delete(id);
    if (!this.closed && !this.unmanaged.has(id)) { this.idle.set(id, Date.now() + this.idleMs); if (schedule) this.schedule(); }
  }
  hold(id) {
    if (this.closed) return () => {};
    this.pin(id); let held = true;
    return () => { if (held) { held = false; this.unpin(id); } };
  }
  schedule() {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.idle.size) {
      let next = Infinity; for (const deadline of this.idle.values()) if (deadline < next) next = deadline;
      this.timer = setTimeout(() => { this.timer = null; this.trim(); }, Math.max(1, next - Date.now()));
      this.timer.unref?.();
    }
  }
  trim(now = Date.now()) {
    if (this.closed) return 0;
    let released = 0;
    for (const [id, deadline] of this.idle) {
      if (deadline > now || this.pins.has(id) || this.unmanaged.has(id)) continue;
      const thread = this.store.data.threads.find((thread) => thread.id === id);
      try {
        if (thread && this.store.releaseMessages(thread)) released++;
        this.idle.delete(id);
      } catch (error) {
        const retryAt = Date.now() + this.retryMs;
        for (const [key, due] of this.idle) if (due <= now) this.idle.set(key, retryAt);
        this.onError(error); break; // A locked database must not be retried once per cached chat.
      }
    }
    const live = new Set(this.store.data.threads.map((thread) => thread.id));
    for (const id of this.unmanaged) if (!live.has(id)) this.unmanaged.delete(id);
    this.schedule(); return released;
  }
  close() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.idle.clear(); this.unmanaged.clear(); this.pins.clear(); this.context.disable(); }
}
// Every async entry that may hold mutable messages across an await needs its
// own owner, including fire-and-forget verification and nested race judgments.
const HISTORY_OPERATIONS = [
  'lineAuthors', 'revertTurnHunk', 'send', 'resumeTurn', 'withTurn', 'sendReserved',
  'stop', 'askPermission', 'permissions', 'answerPermission', 'runTeam', 'teamRuns',
  'runRace', 'raceReserved', 'judgeRace', 'applyRace', 'turnDiff', 'attention',
  'reviewChanges', 'createPullRequest', 'pushPullRequest', 'pullRequestStatus',
  'fixFailingChecks', 'conversationDiff', 'threadChanges', 'exportMarkdown',
  'restoreCheckpoint', 'turnFolder', 'runVerify', 'runSetup', 'changeCopy',
  'removeCopy', 'createWorktree', 'worktreeStatus', 'mergeWorktree',
  'resolveCopyConflicts', 'abortCopyMerge', 'discardWorktree',
];
function manageHistories(hub, options) {
  if (typeof hub.store.releaseMessages !== 'function') return null; // JSON fallback keeps its existing semantics.
  const cache = new HistoryCache(hub.store, options);
  for (const name of HISTORY_OPERATIONS) {
    const method = hub[name];
    if (typeof method !== 'function') throw new Error(`Unknown history owner: ${name}`);
    Object.defineProperty(hub, name, { configurable: true, writable: true, value: (...args) => cache.run(() => method.apply(hub, args)) });
  }
  return cache;
}
module.exports = { HistoryCache, manageHistories, HISTORY_OPERATIONS };
