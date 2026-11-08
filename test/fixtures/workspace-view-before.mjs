// Reference algorithm from use-workspace-view.ts at 3c5ac08, kept for parity
// tests and before/after allocation measurements. No renderer or storage mocks.
export function normalizeWorkspaceView(value, fallback) {
  return { layout: value?.layout === 'chat' || value?.layout === 'editor' ? value.layout : fallback.layout,
    expanded: typeof value?.expanded === 'boolean' ? value.expanded : fallback.expanded,
    panel: { open: typeof value?.panel?.open === 'boolean' ? value.panel.open : fallback.panel.open,
      tab: ['files', 'review', 'changes', 'memory', 'preview', 'tests'].includes(value?.panel?.tab || '') ? value.panel.tab : fallback.panel.tab } };
}
export function patchWorkspaceViews(views, project, patch, fallback) {
  if (!project) return views;
  return { ...views, [project]: normalizeWorkspaceView({ ...normalizeWorkspaceView(views[project], fallback), ...patch }, fallback) };
}
