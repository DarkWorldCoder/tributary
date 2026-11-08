import type { PanelTab } from '../store';
export interface WorkspaceView { layout: 'editor' | 'chat'; expanded: boolean; panel: { open: boolean; tab: PanelTab } }
export function normalizeWorkspaceView(value: unknown, fallback: WorkspaceView): WorkspaceView;
export function patchWorkspaceViews(views: Record<string, WorkspaceView>, project: string | null, patch: Partial<WorkspaceView>, fallback: WorkspaceView): Record<string, WorkspaceView>;
