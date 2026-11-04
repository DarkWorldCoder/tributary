import { projectRelative } from './terminal-links.mjs';

// Git paths belong to the repository root, which can differ from the open folder.
// Never decorate a sibling project's files using the active project's Git state.
export function explorerDecorations(project, git, dirty = []) {
  const files = new Map(); const folders = new Set();
  const normalize = (value) => String(value).replaceAll('\\', '/').replace(/\/$/, '');
  const root = git && normalize(git.root); const base = normalize(project);
  const compare = (value) => /^[a-z]:\//i.test(base) ? value.toLowerCase() : value;
  if (root && (compare(base) === compare(root) || compare(base).startsWith(compare(root) + '/'))) for (const item of git.changed || []) {
    const localPath = normalize(item.path || '');
    if (!localPath || localPath.startsWith('/') || localPath.split('/').includes('..')) continue;
    const absolute = root + '/' + localPath.split('/').filter((part) => part && part !== '.').join('/');
    const rel = compare(absolute).startsWith(compare(base) + '/') ? absolute.slice(base.length + 1) : null; if (!rel) continue;
    const code = item.code.includes('?') || item.code.includes('A') ? 'A' : item.code.includes('D') ? 'D' : item.code.includes('R') ? 'R' : 'M';
    files.set(rel, { code, label: { A: 'Added', D: 'Deleted', R: 'Renamed', M: 'Modified' }[code], dirty: false });
  }
  for (const path of dirty) {
    const rel = projectRelative(base, path); if (!rel) continue;
    files.set(rel, { ...files.get(rel), dirty: true });
  }
  for (const rel of files.keys()) {
    const parts = rel.split('/'); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  return { files, folders };
}
