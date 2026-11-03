export interface RecentFile { project: string; rel: string; threadId?: string; openedAt: number }
export function readRecentFiles(storage?: Storage): RecentFile[];
export function rememberFile(input: { project: string; rel: string; threadId?: string }, storage?: Storage): void;
