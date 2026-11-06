export interface TextChange { from: number; to: number; insert: string }
export function minimalChange(before: string, after: string): TextChange | null;
export interface TextChanges {
  readonly length: number;
  readonly empty: boolean;
  iterChanges(f: (fromA: number, toA: number, fromB: number, toB: number, inserted: { toString(): string }) => void): void;
}
export function textAfterChanges(before: string, changes: TextChanges): string;
export function changedLines(after: string, change: TextChange, fromLine?: number): { from: number; to: number };
