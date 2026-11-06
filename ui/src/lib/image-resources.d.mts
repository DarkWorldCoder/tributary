import type { FileContent } from '../types';
export type ImageSnapshot = { src: string | null; loading: boolean; error: string; size?: number; mtime?: number };
export function imageBlobUrl(file: FileContent, rel: string, current?: () => boolean): Promise<string | null>;
export function createImageResources(read: (project: string, rel: string) => Promise<FileContent>, create?: (file: FileContent, rel: string, current: () => boolean) => Promise<string | null>, revoke?: (url: string) => void): {
  acquire(project: string, rel: string, revision: string | number): { snapshot(): ImageSnapshot; subscribe(listener: () => void): () => void; release(): void };
  state(): { entries: number; owners: number; active: number; queued: number; urls: number };
};
