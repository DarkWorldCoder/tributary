import type { Tool } from '@/types';
export interface ToolFileReference { rel: string; line?: number; column?: number }
export function toolFileReferences(tool: Tool, root: string | null): ToolFileReference[];
