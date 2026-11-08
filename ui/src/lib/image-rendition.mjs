// Animated/unknown containers stay on the original browser image path.
export function staticRaster(bytes, mime) {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime !== 'image/png' || bytes.length < 33 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, at) => bytes[at] !== value)) return false;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 8, header = false, image = false;
  while (offset + 12 <= bytes.length) {
    const size = data.getUint32(offset), end = offset + 12 + size;
    if (end > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!header) { if (type !== 'IHDR' || size !== 13 || bytes[offset + 16] !== 8) return false; header = true; }
    else if (type === 'IHDR') return false;
    if (['acTL', 'fcTL', 'fdAT', 'cICP', 'cLLI', 'mDCV', 'mDCv'].includes(type)) return false;
    // Unknown critical chunks may define image data we must not flatten.
    if (type[0] >= 'A' && type[0] <= 'Z' && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) return false;
    if (type === 'IDAT') image = true;
    if (type === 'IEND') return image && size === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

export function renditionSize(width, height, pixelRatio = 1) {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null;
  // Cards are at most 256 CSS px high. Keep at least 2x density, including
  // wide images, and respect denser displays without upscaling the source.
  const density = Math.max(2, Math.min(4, Number.isFinite(pixelRatio) ? pixelRatio : 2));
  const scale = Math.min(1, 1024 * density / width, 256 * density / height);
  return scale < 1 ? { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) } : null;
}

export async function galleryRendition(blob, bytes, mime, current = () => true, environment = globalThis, layout = 'gallery') {
  if (!current() || !staticRaster(bytes, mime)) return null;
  if (mime === 'image/png') {
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = header.getUint32(16), height = header.getUint32(20);
    if (width > 0 && height > 0 && width <= 64 && height <= 64) return null;
  }
  let original, resized, canvas, bitmap;
  try {
    if (typeof environment.createImageBitmap !== 'function' || typeof environment.OffscreenCanvas !== 'function') return null;
    original = await environment.createImageBitmap(blob);
    if (!current() || original.width <= 64 && original.height <= 64) return null;
    const dimensions = renditionSize(original.width, original.height, environment.devicePixelRatio);
    if (layout === 'thumbnail') {
      const side = Math.min(original.width, original.height), density = Math.max(2, Math.min(4, Number.isFinite(environment.devicePixelRatio) ? environment.devicePixelRatio : 2)), target = Math.max(1, Math.round(Math.min(side, 48 * density)));
      resized = await environment.createImageBitmap(original, Math.floor((original.width - side) / 2), Math.floor((original.height - side) / 2), side, side, { resizeWidth: target, resizeHeight: target, resizeQuality: 'high' });
    } else if (dimensions) {
      resized = await environment.createImageBitmap(original, { resizeWidth: dimensions.width, resizeHeight: dimensions.height, resizeQuality: 'high' });
    }
    if (resized) {
      if (!current()) return null;
    }
    const pixels = resized || original;
    canvas = new environment.OffscreenCanvas(pixels.width, pixels.height);
    if (typeof canvas.transferToImageBitmap !== 'function') return null;
    const context = canvas.getContext('2d'); if (!context) return null;
    context.drawImage(pixels, 0, 0);
    // Materialize pixels rather than re-encoding another IMG source. The lease
    // owns this surface and can close it without waiting for decoded-IMG caches.
    bitmap = canvas.transferToImageBitmap();
    if (!current()) return null;
    const result = { bitmap, width: original.width, height: original.height };
    bitmap = null; // Ownership transfers to the resource manager.
    return result;
  } catch { return null; } // Unsupported codecs/canvas keep the original image accessible.
  finally { bitmap?.close(); resized?.close(); original?.close(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
