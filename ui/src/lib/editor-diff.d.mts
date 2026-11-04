export interface ChangeMarker { line: number; added: number; removed: number }
export function editorDiffMarkers(diff: string): ChangeMarker[];
export function editorDiffStats(diff: string): { added?: number; removed?: number; binary?: boolean };
