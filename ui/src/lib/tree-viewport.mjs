// Hit-testing a few points avoids measuring every row on each scroll event.
// Only paths and numbers survive when the rendered tree is released.
export function captureTreeViewport(element) {
  const box = element.getBoundingClientRect(); let anchor = null;
  for (const distance of [1, 25, 49, 73]) {
    if (distance >= box.height) break;
    const hit = element.ownerDocument.elementFromPoint(box.left + Math.min(box.width / 2, 100), box.top + distance);
    const row = hit?.closest('[data-tree-path]');
    if (!row || !element.contains(row) || element.ownerDocument.defaultView.getComputedStyle(row).position === 'sticky') continue;
    anchor = { project: row.closest('[data-tree-project]')?.dataset.treeProject || '', path: row.dataset.treePath, offset: row.getBoundingClientRect().top - box.top }; break;
  }
  return { top: element.scrollTop, left: element.scrollLeft, anchor };
}
export function restoreTreeViewport(element, saved) {
  const row = saved.anchor && [...element.querySelectorAll('[data-tree-path]')].find((row) => row.dataset.treePath === saved.anchor.path && (row.closest('[data-tree-project]')?.dataset.treeProject || '') === saved.anchor.project);
  if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.anchor.offset;
  else element.scrollTop = saved.top;
  element.scrollLeft = saved.left;
}
