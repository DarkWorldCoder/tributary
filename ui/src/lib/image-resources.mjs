import { galleryRendition } from './image-rendition.mjs';
import { imageMime } from './image-preview.mjs';

/** Build an owned pixel/Blob resource; never retain bridge payloads in UI state. */
async function imageResource(file, rel, current = () => true, rendition = 'original') {
  if (!current()) return null;
  const mime = imageMime(rel);
  if (!mime || file.truncated) throw new Error(file.truncated ? 'Image exceeds preview limit.' : 'Unsupported image type.');
  let blob, bytes;
  if (mime === 'image/svg+xml') blob = new Blob([file.content], { type: mime });
  else if (file.bytes !== undefined) {
    if (!(file.bytes instanceof ArrayBuffer) || !file.bytes.byteLength || file.bytes.byteLength > 16 * 1024 ** 2) throw new Error('Image data is unavailable or exceeds preview limit.');
    bytes = new Uint8Array(file.bytes);
    blob = new Blob([bytes], { type: mime });
  } else {
    const encoded = file.base64;
    if (typeof encoded !== 'string' || !encoded.length || encoded.length % 4 || encoded.length > Math.ceil(16 * 1024 ** 2 / 3) * 4) throw new Error('Image data is unavailable.');
    if (typeof Uint8Array.fromBase64 === 'function') bytes = Uint8Array.fromBase64(encoded);
    else {
      const size = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
      bytes = new Uint8Array(size); let at = 0;
      for (let offset = 0; offset < encoded.length; offset += 65536) {
        if (!current()) return null;
        const chunk = atob(encoded.slice(offset, offset + 65536));
        for (let index = 0; index < chunk.length; index++) bytes[at++] = chunk.charCodeAt(index);
        if (offset % (4 * 65536) === 0 && offset) await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (!current()) return null;
    if (bytes.byteLength > 16 * 1024 ** 2) throw new Error('Image exceeds preview limit.');
    blob = new Blob([bytes], { type: mime });
  }
  if (!current()) return null;
  if (mime === 'image/svg+xml' && blob.size > 1024 ** 2) throw new Error('Image exceeds preview limit.');
  file = null; // The bridge response is not part of the pixel lease.
  const preview = rendition !== 'original' && bytes ? await galleryRendition(blob, bytes, mime, current, globalThis, rendition) : null;
  if (!current()) { preview?.bitmap.close(); return null; }
  return preview ? { src: null, ...preview } : { src: URL.createObjectURL(blob) };
}

export async function imageBlobUrl(file, rel, current = () => true) { return (await imageResource(file, rel, current))?.src || null; }

/** Resources exist only while visible consumers own them. Read/decode admission
 * is shared by a bridge, so rapid tab switches cannot start unbounded payloads. */
export function createImageResources(read, create = imageResource, revoke = url => URL.revokeObjectURL(url)) {
  const entries = new Map(), queue = []; let active = 0;
  const alive = entry => entry.refs > 0 && entries.get(entry.key) === entry;
  const publish = (entry, value) => { entry.snapshot = value; for (const listener of entry.listeners) listener(); };
  const pump = () => {
    while (active < 2 && queue.length) {
      const entry = queue.shift(); if (!alive(entry)) continue;
      active++;
      void Promise.resolve().then(() => alive(entry) ? read(entry.project, entry.rel, entry.source) : null).then(async file => {
        if (!file || !alive(entry)) return;
        const { size, mtime } = file;
        const pending = create(file, entry.rel, () => alive(entry), entry.rendition);
        file = null; // Do not keep the bridge response alive across native decode.
        const result = await pending;
        const { src = null, bitmap, width, height } = typeof result === 'string' ? { src: result } : result || {};
        if (!src && !bitmap) { if (alive(entry)) throw new Error('Image data is unavailable.'); return; }
        if (!alive(entry)) { if (src) revoke(src); bitmap?.close(); return; }
        entry.src = src; entry.bitmap = bitmap;
        publish(entry, { src, ...(bitmap ? { bitmap } : {}), loading: false, error: '', size, mtime, ...(width && height ? { width, height } : {}) });
      }).catch(error => { if (alive(entry)) publish(entry, { src: null, loading: false, error: error.message || 'Image unavailable.' }); }).finally(() => { active--; pump(); });
    }
  };
  return {
    acquire(project, rel, revision, rendition = 'original', source = 'file') {
      if (!['original', 'gallery', 'thumbnail'].includes(rendition)) throw new Error('Invalid image rendition.');
      if (!['file', 'attachment'].includes(source)) throw new Error('Invalid image source.');
      const key = JSON.stringify([project, rel, revision, rendition, source]); let entry = entries.get(key);
      if (!entry) {
        if (entries.size >= 128) throw new Error('Too many image previews. Close an unused preview.');
        entry = { key, project, rel, rendition, source, refs: 0, src: null, listeners: new Set(), snapshot: { src: null, loading: true, error: '' } };
        entries.set(key, entry); queue.push(entry);
      }
      entry.refs++; pump(); let released = false; const listeners = new Set();
      return {
        snapshot: () => entry.snapshot,
        subscribe(listener) { if (released) return () => {}; const wrapped = () => listener(); listeners.add(wrapped); entry.listeners.add(wrapped); return () => { listeners.delete(wrapped); entry.listeners.delete(wrapped); }; },
        release() {
          if (released) return; released = true;
          for (const listener of listeners) entry.listeners.delete(listener); listeners.clear();
          if (--entry.refs) return;
          entries.delete(key); entry.listeners.clear(); const index = queue.indexOf(entry); if (index !== -1) queue.splice(index, 1);
          if (entry.src) { revoke(entry.src); entry.src = null; }
          if (entry.bitmap) { entry.bitmap.close(); entry.bitmap = null; }
          entry.snapshot = { src: null, loading: false, error: '' };
        },
      };
    },
    state() { return { entries: entries.size, owners: [...entries.values()].reduce((sum, entry) => sum + entry.refs, 0), active, queued: queue.length, urls: [...entries.values()].filter(entry => entry.src).length }; },
  };
}
