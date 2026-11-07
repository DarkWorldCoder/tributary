export function staticRaster(bytes: Uint8Array, mime: string): boolean;
export function renditionSize(width: number, height: number, pixelRatio?: number): { width: number; height: number } | null;
export function galleryRendition(blob: Blob, bytes: Uint8Array, mime: string, current?: () => boolean, environment?: typeof globalThis): Promise<{ bitmap: ImageBitmap; width: number; height: number } | null>;
