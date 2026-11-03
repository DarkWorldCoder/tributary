export type FileTab = { rel: string; pinned: boolean; dirty: boolean };
export function openFileTab<T extends FileTab>(tabs: T[], incoming: T, intent?: 'preview' | 'pinned'): T[];
export function closeFileTabs<T extends FileTab>(tabs: T[], active: string | null, paths: string[]): { tabs: T[]; active: string | null };
export function fileTabLabel(rel: string, paths: string[]): string;
