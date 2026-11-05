'use strict';
// Keep the first N distinct NUL-delimited paths. The rest of a command's output
// is drained by the caller so exit status and late failures remain observable.
function createPathPrefix(limit, { maxRecordBytes = 200000000, stripDot = false } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1) throw new RangeError('Invalid path prefix bounds');
  let paths = new Set(), buffer = null, used = 0, full = limit === 0, disposed = false;
  const append = (data, start, end) => {
    const needed = used + end - start;
    if (needed > maxRecordBytes) throw new Error('Filename record exceeds output limit');
    if (!buffer || buffer.length < needed) {
      const next = Buffer.allocUnsafeSlow(Math.min(maxRecordBytes, Math.max(4096, needed, (buffer?.length || 0) * 2)));
      buffer?.copy(next, 0, 0, used); buffer = next;
    }
    data.copy(buffer, used, start, end); used = needed;
  };
  const accept = value => {
    if (stripDot) value = value.replace(/^\.\//, '');
    if (value) paths.add(value);
    if (paths.size === limit) { full = true; buffer = null; used = 0; }
  };
  return {
    write(data) {
      if (disposed || full) return;
      let start = 0, end;
      while (!full && (end = data.indexOf(0, start)) >= 0) {
        if (used) { append(data, start, end); accept(buffer.toString('utf8', 0, used)); used = 0; }
        else { if (end - start > maxRecordBytes) throw new Error('Filename record exceeds output limit'); accept(data.toString('utf8', start, end)); }
        start = end + 1;
      }
      if (!full && start < data.length) append(data, start, data.length);
    },
    finish({ partial = true } = {}) {
      if (disposed) return [];
      if (partial && !full && used) accept(buffer.toString('utf8', 0, used));
      const result = [...paths]; paths = null; buffer = null; used = 0; disposed = true; return result;
    },
    dispose() { paths = null; buffer = null; used = 0; disposed = true; },
  };
}

// Legacy/custom hosts without spawn already own a complete decoded string. Do
// not split its unused tail, or retain that string through sliced filenames.
function pathPrefixFromText(text, limit, { stripDot = false, separator = '\0' } = {}) {
  const paths = new Set(); let start = 0;
  while (start < text.length && paths.size < limit) {
    const at = text.indexOf(separator, start), end = at < 0 ? text.length : at;
    let value = text.slice(start, end); if (stripDot) value = value.replace(/^\.\//, '');
    if (value && !paths.has(value)) paths.add(Buffer.from(value, 'utf16le').toString('utf16le'));
    if (at < 0) break; start = at + separator.length;
  }
  return [...paths];
}
module.exports = { createPathPrefix, pathPrefixFromText };
