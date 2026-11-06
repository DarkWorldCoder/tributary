import type { ProjectDiagnostic } from '@/types';
export interface EditorFileSettings {
  root: string; rel: string; language: string; sources: string[]; formatOnSave?: boolean; defaultFormatter?: string;
  eslint: { enabled: boolean; run: 'onType' | 'onSave'; quiet: boolean; cwd: string; changeProcessCwd: boolean; library: string | null; version: string | null; useFlatConfig?: boolean; format: boolean; fixOnSave: boolean };
}
export interface ProjectEditorTools extends EditorFileSettings { manager: string; install: string; initialize: string; hasPackage: boolean; trusted: boolean }
export interface EslintResult { status: 'ready' | 'ignored' | 'disabled' | 'not-installed' | 'on-save' | 'cancelled'; diagnostics: ProjectDiagnostic[]; output?: string; configured?: boolean }
export const eslintCandidate = (file: string) => /\.(?:[cm]?[jt]sx?|vue|svelte|astro|jsonc?|mdx|css)$/i.test(file);
