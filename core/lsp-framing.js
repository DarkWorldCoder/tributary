'use strict';
// LSP lengths count bytes, not decoded characters. Complete bodies can be read
// directly from the transport; fragmented bodies grow geometrically as received.
const SEPARATOR = Buffer.from('\r\n\r\n');
const EMPTY = Buffer.alloc(0);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_HEADER_BYTES = 8 * 1024;
function contentLength(header, maximum) {
  const pattern = /^Content-Length:[\t ]*([^\r\n]*)$/gim;
  const match = pattern.exec(header);
  if (/[^\x00-\x7f]/.test(header) || !match || !/^[0-9]+[\t ]*$/.test(match[1]) || pattern.exec(header)) throw new Error('Invalid language server frame.');
  const length = Number(match[1]);
  if (!Number.isSafeInteger(length) || length > maximum) throw new Error('Language server response is too large.');
  return length;
}
function createLspFramer(onFrame, onError, { maxBodyBytes = MAX_BODY_BYTES, maxHeaderBytes = MAX_HEADER_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || !Number.isSafeInteger(maxHeaderBytes) || maxHeaderBytes < 4) throw new RangeError('Invalid LSP frame limits');
  let header = null; let headerBytes = 0; let marker = 0; let expected = null; let body = null; let bodyBytes = 0; let disposed = false;
  const dispose = () => { disposed = true; header = body = null; headerBytes = bodyBytes = marker = 0; expected = null; };
  const fail = (error) => { dispose(); onError(error instanceof Error ? error : new Error(error)); };
  const emit = (frame) => {
    expected = null; body = null; bodyBytes = 0;
    try { onFrame(frame); } catch (error) { dispose(); throw error; }
  };
  const push = (chunk) => {
    if (disposed) return;
    if (!Buffer.isBuffer(chunk)) { fail('Language server protocol requires byte buffers.'); return; }
    let offset = 0;
    while (!disposed && offset < chunk.length) {
      if (expected == null) {
        // The ordinary path avoids allocating/copying a header buffer at all.
        if (!headerBytes) {
          const end = chunk.indexOf(SEPARATOR, offset);
          if (end >= 0) {
            if (end - offset + 4 > maxHeaderBytes) { fail('Language server header is too large.'); return; }
            try { expected = contentLength(chunk.toString('latin1', offset, end), maxBodyBytes); }
            catch (error) { fail(error); return; }
            offset = end + 4;
          }
        }
        if (expected == null) {
          header ||= Buffer.allocUnsafeSlow(maxHeaderBytes);
          while (offset < chunk.length && expected == null) {
            if (headerBytes === maxHeaderBytes) { fail('Language server header is too large.'); return; }
            const byte = chunk[offset++]; header[headerBytes++] = byte; marker = ((marker << 8) | byte) >>> 0;
            if (marker === 0x0d0a0d0a) {
              try { expected = contentLength(header.toString('latin1', 0, headerBytes - 4), maxBodyBytes); }
              catch (error) { fail(error); return; }
              headerBytes = marker = 0;
            }
          }
        }
        if (expected === 0) { emit(EMPTY); continue; }
        if (expected == null) return;
      }
      const remaining = chunk.length - offset;
      if (!remaining) return;
      if (!body && remaining >= expected) {
        const frame = chunk.subarray(offset, offset + expected); offset += expected; emit(frame); continue;
      }
      const take = Math.min(remaining, expected - bodyBytes); const required = bodyBytes + take;
      if (!body || required > body.length) {
        const capacity = Math.min(expected, Math.max(4096, required, (body?.length || 0) * 2));
        // A tiny retained fragment must not pin Node's shared Buffer pool.
        const next = Buffer.allocUnsafeSlow(capacity); if (bodyBytes) body.copy(next, 0, 0, bodyBytes); body = next;
      }
      chunk.copy(body, bodyBytes, offset, offset + take); bodyBytes += take; offset += take;
      if (bodyBytes === expected) emit(body);
    }
  };
  return { push, dispose,
    end() { if (disposed) return; if (headerBytes || expected != null) fail('Language server ended inside a response.'); else dispose(); },
    stats: () => ({ disposed, headerBytes, headerCapacity: header?.length || 0, headerBackingBytes: header?.buffer.byteLength || 0, bodyBytes, bodyCapacity: body?.length || 0, bodyBackingBytes: body?.buffer.byteLength || 0, expectedBodyBytes: expected }),
  };
}
module.exports = { createLspFramer, MAX_BODY_BYTES, MAX_HEADER_BYTES };
