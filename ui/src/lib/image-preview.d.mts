export function imageMime(path: string): string | null;
export function imageSource(file: { rel: string; content: string; base64?: string; truncated?: boolean }): string | null;
export function fitImageScale(width: number, height: number, viewportWidth: number, viewportHeight: number): number;
export function imageBytes(bytes?: number): string;
export function projectImagePath(source: string, project: string | null, baseFile?: string): string | null;
