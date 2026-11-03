export interface FileLink { start: number; end: number; path: string; line?: number; col?: number }
export function findFileLinks(text: string): FileLink[];
export function projectRelative(project: string, file: string): string | null;
