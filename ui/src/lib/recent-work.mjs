const key = 'tributary.recentFiles';
export function readRecentFiles(storage = globalThis.localStorage) {
  try { const rows = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(rows) ? rows.filter((r) => r && typeof r.project === 'string' && typeof r.rel === 'string' && !!r.rel && !r.rel.includes('\0') && !/^(?:[a-z]:|[\\/])/i.test(r.rel) && !r.rel.split(/[\\/]/).includes('..')).slice(0, 30) : []; } catch { return []; }
}
export function rememberFile(input, storage = globalThis.localStorage) {
  const rows = readRecentFiles(storage).filter((r) => r.project !== input.project || r.rel !== input.rel || r.threadId !== input.threadId);
  try { storage.setItem(key, JSON.stringify([{ ...input, openedAt: Date.now() }, ...rows].slice(0, 30))); } catch { /* optional local history */ }
}
