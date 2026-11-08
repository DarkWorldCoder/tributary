import * as React from 'react';
import { normalizeWorkspaceView as valid, patchWorkspaceViews, type WorkspaceView } from '@/lib/workspace-view.mjs';
export type { WorkspaceView } from '@/lib/workspace-view.mjs';
const KEY = 'tributary.workspaceViews.v1';
function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
export function useWorkspaceView(project: string | null) {
  const fallback = React.useMemo<WorkspaceView>(() => {
    const layout = read<string>('tributary.workspaceLayout', 'editor') === 'chat' ? 'chat' : 'editor';
    return valid({ layout, expanded: read('tributary.workspaceExpanded', false), panel: { open: false, tab: read('tributary.panelTab', 'files') } }, { layout: 'editor', expanded: false, panel: { open: true, tab: 'files' } });
  }, []);
  const [views, setViews] = React.useState<Record<string, WorkspaceView>>(() => read(KEY, {}));
  const current = React.useRef(views); current.current = views;
  const stored = project ? views[project] : undefined;
  const view = React.useMemo(() => valid(stored, fallback), [stored, fallback]);
  const update = React.useCallback((patch: Partial<WorkspaceView>) => {
    if (!project) return;
    const next = patchWorkspaceViews(current.current, project, patch, fallback);
    if (next === current.current) return;
    current.current = next; setViews(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Session state still works. */ }
  }, [project, fallback]);
  return { view, update, saved: !!project && !!views[project] };
}
