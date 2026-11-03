export interface DiffRow { kind: string; text: string; before?: number; after?: number }
export function diffRows(input: string, limit?: number): { rows: DiffRow[]; split: { left?: DiffRow; right?: DiffRow }[]; truncated: boolean; added: number; removed: number };
