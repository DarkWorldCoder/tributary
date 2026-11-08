import type { FileContent } from '../types';
export type ImageSnapshot = { src: string | null; bitmap?: ImageBitmap; loading: boolean; error: string; size?: number; mtime?: number; width?: number; height?: number };
export function imageBlobUrl(file: FileContent, rel: string, current?: () => boolean): Promise<string | null>;
export type ImageRendition = 'original' | 'gallery' | 'thumbnail';
export type ImageResourceSource = 'file' | 'attachment';
export function createImageResources(read: (project: string, rel: string, source: ImageResourceSource) => Promise<FileContent>, create?: (file: FileContent, rel: string, current: () => boolean, rendition: ImageRendition) => Promise<string | { src: string | null; bitmap?: ImageBitmap; width?: number; height?: number } | null>, revoke?: (url: string) => void): {
  acquire(project: string, rel: string, revision: string | number, rendition?: ImageRendition, source?: ImageResourceSource): { snapshot(): ImageSnapshot; subscribe(listener: () => void): () => void; release(): void };
  state(): { entries: number; owners: number; active: number; queued: number; urls: number };
};
