export function formatParser(path: string, text?: string): string | null;
export function formatDocument(path: string, text: string): Promise<string>;

export function nativeFormatTool(path: string): string | null;

export function formattingHint(path: string, text: string): string | null;
