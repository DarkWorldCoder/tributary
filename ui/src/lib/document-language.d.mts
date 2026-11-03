import type { ProjectDiagnostic } from '@/types';
export const DOCUMENT_LIMIT: number;
export function documentLanguage(path: string): string | null;
export function validateDocument(path: string, text: string): Promise<ProjectDiagnostic[]>;
export type DocumentCompletion = { label: string; detail: string; type: string; text: string; from: number; to: number };
export function completeDocument(path: string, text: string, offset: number): Promise<DocumentCompletion[]>;
export function outlineDocument(path: string, text: string): Promise<import('./code-outline.mjs').OutlineItem[]>;
