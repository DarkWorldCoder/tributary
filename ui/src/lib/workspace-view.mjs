const TABS = ['files', 'review', 'changes', 'memory', 'preview', 'tests'];
const layout = (value, fallback) => value === 'chat' || value === 'editor' ? value : fallback;
const expanded = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const tab = (value, fallback) => TABS.includes(value) ? value : fallback;
const has = (value, key) => value != null && Object.prototype.propertyIsEnumerable.call(value, key);

export function normalizeWorkspaceView(value, fallback) {
  return {
    layout: layout(value?.layout, fallback.layout),
    expanded: expanded(value?.expanded, fallback.expanded),
    panel: { open: expanded(value?.panel?.open, fallback.panel.open), tab: tab(value?.panel?.tab, fallback.panel.tab) },
  };
}

export function patchWorkspaceViews(views, project, patch, fallback) {
  if (!project) return views;
  const previous = views[project];
  // Match object-spread patches: explicit undefined resets to the fallback,
  // and a supplied panel replaces the panel rather than merging its fields.
  const nextLayout = layout(has(patch, 'layout') ? patch.layout : previous?.layout, fallback.layout);
  const nextExpanded = expanded(has(patch, 'expanded') ? patch.expanded : previous?.expanded, fallback.expanded);
  const panel = has(patch, 'panel') ? patch.panel : previous?.panel;
  const open = expanded(panel?.open, fallback.panel.open), nextTab = tab(panel?.tab, fallback.panel.tab);
  // Compare the stored fields so a missing/invalid entry still gets repaired
  // and the first explicit save is persisted even if it matches the fallback.
  if (previous?.layout === nextLayout && previous?.expanded === nextExpanded && previous?.panel?.open === open && previous?.panel?.tab === nextTab) return views;
  return { ...views, [project]: { layout: nextLayout, expanded: nextExpanded, panel: { open, tab: nextTab } } };
}
