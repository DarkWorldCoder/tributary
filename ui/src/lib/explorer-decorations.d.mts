import type { GitInfo } from '@/types';
export interface FileDecoration { code?: string; label?: string; dirty: boolean }
export function explorerDecorations(project: string, git: GitInfo | null | undefined, dirty?: string[]): { files: Map<string, FileDecoration>; folders: Set<string> };
