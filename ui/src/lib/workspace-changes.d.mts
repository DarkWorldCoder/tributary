import type { GitInfo } from '@/types';
export type WorkspaceChange = GitInfo['changed'][number] & { rel: string; status: string; label: string };
export function workspaceChanges(project: string, git: GitInfo | null): WorkspaceChange[];
