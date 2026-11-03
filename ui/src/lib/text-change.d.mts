export interface TextChange { from: number; to: number; insert: string }
export function minimalChange(before: string, after: string): TextChange | null;
export function changedLines(after: string, change: TextChange): { from: number; to: number };
