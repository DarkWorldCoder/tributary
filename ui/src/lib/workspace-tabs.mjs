// File-tab transitions are independent of the filesystem and renderer.
export function openFileTab(tabs, incoming, intent = 'preview') {
  const existing = tabs.find((tab) => tab.rel === incoming.rel);
  if (existing) return tabs.map((tab) => tab === existing && intent === 'pinned' ? { ...tab, pinned: true } : tab);
  const next = { ...incoming, pinned: intent === 'pinned' || incoming.dirty };
  const preview = tabs.findIndex((tab) => !tab.pinned && !tab.dirty);
  if (intent === 'preview' && preview !== -1) return tabs.map((tab, index) => index === preview ? next : tab);
  return [...tabs, next];
}

export function closeFileTabs(tabs, active, paths) {
  const removed = new Set(paths);
  const remaining = tabs.filter((tab) => !removed.has(tab.rel));
  if (!removed.has(active)) return { tabs: remaining, active };
  const index = tabs.findIndex((tab) => tab.rel === active);
  return { tabs: remaining, active: remaining[Math.min(index, remaining.length - 1)]?.rel ?? null };
}

export function fileTabLabel(rel, paths) {
  const name = rel.split('/').pop();
  if (!paths.some((path) => path !== rel && path.split('/').pop() === name)) return name;
  const parents = rel.split('/').slice(0, -1);
  // Use the shortest parent suffix that actually distinguishes duplicate names.
  for (let depth = 1; depth <= parents.length; depth++) {
    const suffix = parents.slice(-depth).join('/');
    if (!paths.some((path) => path !== rel && path.split('/').pop() === name && path.split('/').slice(0, -1).slice(-depth).join('/') === suffix)) return `${name} · ${suffix}`;
  }
  return `${name} · ${parents.join('/') || '.'}`;
}
