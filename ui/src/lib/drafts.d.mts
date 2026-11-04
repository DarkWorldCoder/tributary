import type { HubBridge } from '@/types';
export interface DraftWriter { set(value: unknown): void; flush(): void; dispose(): void }
export function draftWriter(hub: Pick<HubBridge, 'call'>, key: string, options?: { delay?: number; onError?: (error: Error) => void }): DraftWriter;
export interface SavedFileTab { rel: string; pinned: boolean; mode: 'edit' | 'preview'; wrap: boolean; text?: string; base?: string; mtime?: number }
export interface FileSession { active: string | null; tabs: SavedFileTab[] }
export function fileSession(docs: { rel: string; pinned: boolean; mode: 'edit' | 'preview'; wrap?: boolean; dirty: boolean; binary: boolean; truncated: boolean; text: string; content: string; mtime: number }[], active: string | null): FileSession | null;
export function savedFileSession(saved: unknown): FileSession;
