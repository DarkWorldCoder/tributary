import https from 'node:https';
import { Readable } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
export const normalizeFingerprint = (value) => String(value || '').replaceAll(':', '').toLowerCase();
/** An explicit certificate pin permits private LAN TLS without weakening global certificate checks. */
export function pinnedFetch(url, options, fingerprint) {
  const expected = normalizeFingerprint(fingerprint);
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Enter the 64-character certificate fingerprint from the owner.');
  const address = new URL(url); if (address.protocol !== 'https:') throw new Error('Certificate pinning requires HTTPS.');
  return new Promise((resolve, reject) => {
    // Headers (including the access key) are sent only after the certificate has been checked.
    const request = https.request(address, { method: options.method, headers: options.headers, rejectUnauthorized: false, agent: false }, (response) => {
      const headers = new Headers(); for (const [key, value] of Object.entries(response.headers)) if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers }));
    });
    const abort = () => request.destroy(options.signal?.reason instanceof Error ? options.signal.reason : new Error('Connection cancelled.'));
    if (options.signal?.aborted) { abort(); reject(options.signal.reason); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    request.once('close', () => options.signal?.removeEventListener('abort', abort));
    request.once('error', reject);
    request.once('socket', (socket) => socket.once('secureConnect', () => {
      const actual = normalizeFingerprint(socket.getPeerCertificate().fingerprint256);
      if (actual.length !== 64 || !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) { request.destroy(new Error('Certificate fingerprint does not match. Verify it with the owner.')); return; }
      request.end(options.body);
    }));
  });
}
