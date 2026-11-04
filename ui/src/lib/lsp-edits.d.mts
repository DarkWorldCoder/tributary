export interface LspPosition { line: number; character: number }
export interface LspEdit { range: { start: LspPosition; end: LspPosition }; newText: string }
export function applyLspEdits(text: string, edits: LspEdit[]): string;
