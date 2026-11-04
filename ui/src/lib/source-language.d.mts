export interface SourceLanguage { id: string; label: string; extensions: string[] }
export const SOURCE_LANGUAGES: SourceLanguage[];
export function sourceLanguage(path: string, text?: string): SourceLanguage;
export function sourceSyntaxSupported(path: string, text?: string): boolean;
