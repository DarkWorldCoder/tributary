'use strict';
const { Readable } = require('node:stream');

// net.fetch cancels manual redirects instead of exposing their response. Use a
// single Chromium request so AppUpdates can validate each hop and strip tokens.
function createUpdateFetch(net) {
  return (url, { headers, signal } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Download cancelled.', 'AbortError')); return; }
    let settled = false, response;
    const request = net.request({ url, headers, redirect: 'manual', credentials: 'omit', useSessionCookies: false });
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      const error = new DOMException('Download cancelled.', 'AbortError');
      response?.destroy(error); request.abort();
      if (!settled) { settled = true; cleanup(); reject(error); }
    };
    const responseHeaders = values => {
      const result = new Headers();
      for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) result.append(key, item);
      return result;
    };
    request.on('redirect', (status, _method, location, values) => {
      if (settled) return;
      settled = true; cleanup();
      const nextHeaders = responseHeaders(values); nextHeaders.set('location', location);
      resolve(new Response(null, { status, headers: nextHeaders }));
      request.abort();
    });
    request.on('response', incoming => {
      if (settled) { incoming.destroy(); return; }
      response = incoming; settled = true;
      incoming.once('end', cleanup); incoming.once('close', cleanup); incoming.once('error', cleanup);
      // Readable.toWeb preserves stream backpressure; installers never become
      // an in-memory buffer. Cancelling the consumer also stops the request.
      incoming.once('close', () => { if (!incoming.complete) request.abort(); });
      const body = Readable.toWeb(incoming, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } });
      resolve(new Response(body, { status: incoming.statusCode, headers: responseHeaders(incoming.headers) }));
    });
    request.on('error', error => {
      if (response) response.destroy(error);
      if (!settled) { settled = true; cleanup(); reject(error); }
    });
    signal?.addEventListener('abort', abort, { once: true });
    request.end();
  });
}

module.exports = { createUpdateFetch };
