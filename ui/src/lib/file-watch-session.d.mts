import type { HubBridge } from '../types';
export interface FileWatchSession { set(paths: readonly string[]): void; dispose(): void }
export function createFileWatchSession(hub: HubBridge, project: string, callbacks: {
  onStatus(status: string): void;
  onPaths(paths: string[], force: boolean): void;
  onDirectory(): void;
}): FileWatchSession;
