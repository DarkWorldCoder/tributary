import type { HubBridge } from '../types';
export type FileSearchResult = { files: string[]; total: number; visited: number; unreadable: number; limited: boolean };
export function fileSearch(hub: HubBridge, project: string, query: string, options?: { showHidden?: boolean; limit?: number }): { result: Promise<FileSearchResult>; cancel(): void };
