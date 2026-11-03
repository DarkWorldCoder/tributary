export const DOCUMENT_LIMIT = 512 * 1024;
export function documentLanguage(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return ['json', 'jsonc', 'css', 'scss', 'less', 'html', 'htm'].includes(ext) ? ext === 'htm' ? 'html' : ext : null;
}
