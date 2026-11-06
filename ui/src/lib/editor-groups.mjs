// Groups own tabs and selection; file text and drafts have one owner in FolderFiles.
export function editorGroups(paths = [], active = paths[0] ?? null) {
  return { direction: 'horizontal', focused: 'editor-1', groups: [{ id: 'editor-1', paths: [...paths], active }] };
}
export function selectGroupFile(state, id, rel) {
  return { ...state, focused: id, groups: state.groups.map(group => group.id === id ? { ...group, active: rel, paths: rel && !group.paths.includes(rel) ? [...group.paths, rel] : group.paths } : group) };
}
export function splitEditorGroup(state, direction = state.direction) {
  const source = state.groups.find(group => group.id === state.focused);
  if (!source?.active) return state;
  let n = 1; while (state.groups.some(group => group.id === `editor-${n}`)) ++n;
  const next = { id: `editor-${n}`, paths: [source.active], active: source.active };
  const index = state.groups.indexOf(source);
  return { direction, focused: next.id, groups: [...state.groups.slice(0, index + 1), next, ...state.groups.slice(index + 1)] };
}
export function closeGroupFiles(state, id, paths) {
  const removed = new Set(paths);
  return { ...state, groups: state.groups.map(group => {
    if (group.id !== id) return group;
    const remaining = group.paths.filter(path => !removed.has(path));
    const index = Math.max(0, group.paths.indexOf(group.active));
    return { ...group, paths: remaining, active: removed.has(group.active) ? remaining[Math.min(index, remaining.length - 1)] ?? null : group.active };
  }) };
}
export function joinEditorGroup(state, id) {
  if (state.groups.length === 1) return state;
  const index = state.groups.findIndex(group => group.id === id);
  if (index < 0) return state;
  const removed = state.groups[index], target = state.groups[index ? index - 1 : 1];
  return { ...state, focused: target.id, groups: state.groups.filter(group => group !== removed).map(group => group === target ? { ...group, paths: [...new Set([...group.paths, ...removed.paths])], active: state.focused === id ? removed.active ?? group.active : group.active } : group) };
}
export function restoreEditorGroups(saved, paths, active) {
  if (!saved || !Array.isArray(saved.groups)) return editorGroups(paths, active);
  const allowed = new Set(paths);
  const ids = new Set();
  const groups = saved.groups.slice(0, 16).map((group, index) => {
    const selected = [...new Set(Array.isArray(group?.paths) ? group.paths.filter(path => allowed.has(path)) : [])];
    let id = /^editor-\d+$/.test(group?.id) && !ids.has(group.id) ? group.id : `editor-${index + 1}`;
    while (ids.has(id)) id += '0'; ids.add(id);
    return { id, paths: selected, active: selected.includes(group?.active) ? group.active : selected[0] ?? null };
  }).filter(group => group.paths.length);
  if (!groups.length) return editorGroups(paths, active);
  // Keep drafts that were not assigned to a surviving group reachable.
  groups[0].paths.push(...paths.filter(path => !groups.some(group => group.paths.includes(path))));
  const focused = groups.some(group => group.id === saved.focused) ? saved.focused : groups[0].id;
  return { direction: saved.direction === 'vertical' ? 'vertical' : 'horizontal', focused, groups };
}
