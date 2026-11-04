import type { LanguageSupport, Language } from '@codemirror/language';
import type { ProjectDiagnostic } from '@/types';
export function sourceGrammar(path: string, text?: string): Promise<LanguageSupport | Language | null>;
export function validateSourceSyntax(path: string, text: string): Promise<ProjectDiagnostic[]>;
