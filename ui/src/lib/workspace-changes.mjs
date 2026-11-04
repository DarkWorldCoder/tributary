// Repository-relative Git paths must be scoped to the selected workspace root.
export function workspaceChanges(project, git) {
  if (!git?.root) return [];
  const normalize = (value) => String(value).replaceAll('\\', '/').replace(/\/$/, '');
  const root = normalize(git.root); const base = normalize(project);
  const compare = (value) => /^[a-z]:\//i.test(base) ? value.toLowerCase() : value;
  if (compare(base) !== compare(root) && !compare(base).startsWith(compare(root) + '/')) return [];
  const prefix = base.slice(root.length).replace(/^\//, '');
  return git.changed.flatMap((file) => {
    const path = normalize(file.path);
    if (!path || /^(?:\/|[a-z]:\/)/i.test(path) || path.split('/').includes('..')) return [];
    if (prefix && !compare(path).startsWith(compare(prefix) + '/')) return [];
    const rel = prefix ? path.slice(prefix.length + 1) : path;
    const status = file.code.includes('U') || ['AA', 'DD'].includes(file.code) ? 'U' : file.code.includes('R') ? 'R' : file.code.includes('D') ? 'D' : /[?A]/.test(file.code) ? 'A' : 'M';
    return [{ ...file, rel, status, label: { U: 'Conflict', R: 'Renamed', D: 'Deleted', A: 'Added', M: 'Modified' }[status] }];
  }).sort((a, b) => a.rel.localeCompare(b.rel));
}
