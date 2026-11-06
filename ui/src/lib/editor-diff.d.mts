export interface ChangeMarker { line: number; added: number; removed: number }
export interface EditorDiffResult { markers: ChangeMarker[]; stats: { added?: number; removed?: number; binary?: boolean } }
export function editorDiff(diff: string): EditorDiffResult;
export function editorDiffMarkers(diff: string): ChangeMarker[];
export function editorDiffStats(diff: string): { added?: number; removed?: number; binary?: boolean };
