export interface OutlineItem { name: string; kind: string; line: number; column: number; depth: number }
export function outlineSupported(path: string): boolean;
export function outlineCode(path: string, text: string): Promise<OutlineItem[] | null>;
