const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' };
export function imageMime(path) { return TYPES[path.split(/[?#]/)[0].split('.').pop()?.toLowerCase()] || null; }
export function imageSource(file) {
  const mime = imageMime(file.rel);
  if (!mime || file.truncated) return null;
  if (mime === 'image/svg+xml') return `data:${mime};charset=utf-8,${encodeURIComponent(file.content)}`;
  return file.base64 ? `data:${mime};base64,${file.base64}` : null;
}
export function fitImageScale(width, height, viewportWidth, viewportHeight) {
  if (!(width > 0 && height > 0 && viewportWidth > 32 && viewportHeight > 32)) return 1;
  return Math.min(1, (viewportWidth - 32) / width, (viewportHeight - 32) / height);
}
export function imageBytes(bytes) {
  if (bytes == null) return '';
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function projectImagePath(source, project, baseFile = '') {
  if (!source || !project || /^[a-z][\w+.-]*:/i.test(source) || source.startsWith('//')) return null;
  let decoded;
  try { decoded = decodeURIComponent(source.split(/[?#]/)[0]); } catch { return null; }
  if (!imageMime(decoded) || decoded.includes('\0') || decoded.includes('\\')) return null;
  const prefix = project.replace(/\/$/, '') + '/';
  if (decoded.startsWith('/')) { if (!decoded.startsWith(prefix)) return null; decoded = decoded.slice(prefix.length); baseFile = ''; }
  const parts = [...baseFile.split('/').slice(0, -1), ...decoded.split('/')];
  const clean = [];
  for (const part of parts) { if (!part || part === '.') continue; if (part === '..') { if (!clean.length) return null; clean.pop(); } else clean.push(part); }
  return clean.join('/') || null;
}
