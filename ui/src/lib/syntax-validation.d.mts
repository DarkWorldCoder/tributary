import type { LanguageSupport, Language } from '@codemirror/language';
import type { ProjectDiagnostic } from '@/types';
export function validateSourceWithGrammar(path: string, text: string, loadGrammar: (path: string, text: string) => Promise<LanguageSupport | Language | null>): Promise<ProjectDiagnostic[]>;
