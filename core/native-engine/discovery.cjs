'use strict';
const { engineRequest } = require('./transport.cjs');
async function nativeScan(binary, root, query, { showHidden = true, limit = 2000, signal } = {}) {
  if (signal?.aborted) throw Object.assign(Error('File search cancelled'), { name: 'AbortError' });
  if (typeof query !== 'string' || query.length > 512 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw Error('Invalid file search.');
  const needle = query.trim().toLowerCase();
  if (!needle || /[^\x01-\x7f]/.test(needle)) return null;
  let files = [], header = false, summary = null;
  return engineRequest(binary, ['scan-files', root, needle, String(limit), String(!!showHidden), '--parent-pipe'], {
    signal,
    record(value) {
      if (!header) { if (value.protocol !== 1 || Object.keys(value).length !== 1) throw Error(); header = true; return; }
      if (summary) throw Error();
      if (Object.hasOwn(value, 'file')) {
        const file = value.file;
        if (Object.keys(value).length !== 1 || files.length >= limit || typeof file !== 'string' || !file || /[^\x01-\x7f]|\\/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..') || !file.toLowerCase().includes(needle) || files.length && files.at(-1) >= file) throw Error();
        files.push(file);
      } else {
        const { complete, total, visited, unreadable, limited } = value;
        if (complete !== true || ![total, visited, unreadable].every(n => Number.isSafeInteger(n) && n >= 0) || total < files.length || total > visited || unreadable > visited || limited !== (total > files.length)) throw Error();
        summary = { total, visited, unreadable, limited };
      }
    },
    finish() { if (!header || !summary) throw Error(); return { files, ...summary }; },
    dispose() { files = []; summary = null; },
  });
}
module.exports = { nativeScan };
