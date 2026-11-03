import type { Thread } from '@/types';
export function recentFiles(paths: string[], history?: string[], active?: string | null): string[];
export function folderChains(files: string[]): Map<string, string[]>;
export function followedFile(thread: Thread | null, root: string | null): { rel: string; key: string } | null;
