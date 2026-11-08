import type { LanguageSupport, Language } from '@codemirror/language';
export function codeGrammarSupported(id: string): boolean;
export function codeGrammar(path: string, text?: string): Promise<LanguageSupport | Language | null>;
