import * as React from 'react';
import type { PanelTab } from '@/store';
export interface WorkspaceView { layout: 'editor' | 'chat'; expanded: boolean; panel: { open: boolean; tab: PanelTab } }
const KEY = 'tributary.workspaceViews.v1';
function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function valid(value: Partial<WorkspaceView> | undefined, fallback: WorkspaceView): WorkspaceView {
  return { layout: value?.layout === 'chat' || value?.layout === 'editor' ? value.layout : fallback.layout,
    expanded: typeof value?.expanded === 'boolean' ? value.expanded : fallback.expanded,
    panel: { open: typeof value?.panel?.open === 'boolean' ? value.panel.open : fallback.panel.open,
      tab: ['files', 'review', 'changes', 'memory', 'preview'].includes(value?.panel?.tab || '') ? value!.panel!.tab : fallback.panel.tab } };
}
export function useWorkspaceView(project: string | null) {
  const fallback = React.useMemo<WorkspaceView>(() => {
    const layout = read<string>('tributary.workspaceLayout', 'editor') === 'chat' ? 'chat' : 'editor';
    return valid({ layout, expanded: read('tributary.workspaceExpanded', false), panel: { open: false, tab: read('tributary.panelTab', 'files') } }, { layout: 'editor', expanded: false, panel: { open: true, tab: 'files' } });
  }, []);
  const [views, setViews] = React.useState<Record<string, WorkspaceView>>(() => read(KEY, {}));
  const current = React.useRef(views); current.current = views;
  const view = valid(project ? views[project] : undefined, fallback);
  const update = React.useCallback((patch: Partial<WorkspaceView>) => {
    if (!project) return;
    const next = { ...current.current, [project]: valid({ ...valid(current.current[project], fallback), ...patch }, fallback) };
    current.current = next; setViews(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Session state still works. */ }
  }, [project, fallback]);
  return { view, update, saved: !!project && !!views[project] };
}
