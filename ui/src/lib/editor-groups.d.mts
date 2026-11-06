export interface EditorGroup { id: string; paths: string[]; active: string | null }
export interface EditorGroups { direction: 'horizontal' | 'vertical'; focused: string; groups: EditorGroup[] }
export function editorGroups(paths?: string[], active?: string | null): EditorGroups;
export function selectGroupFile(state: EditorGroups, id: string, rel: string | null): EditorGroups;
export function splitEditorGroup(state: EditorGroups, direction?: EditorGroups['direction']): EditorGroups;
export function closeGroupFiles(state: EditorGroups, id: string, paths: string[]): EditorGroups;
export function joinEditorGroup(state: EditorGroups, id: string): EditorGroups;
export function restoreEditorGroups(saved: unknown, paths: string[], active: string | null): EditorGroups;
