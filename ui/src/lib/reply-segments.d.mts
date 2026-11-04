import type { AgentMessage, PermissionRequest, ReplyActivity, ReplyTrace } from '../types';
export type ReplySegment = { kind: 'text'; text: string } | { kind: 'permission'; request: PermissionRequest } | { kind: 'activity'; id: string; entries: ReplyActivity[] };
export function replySegments(text: string, requests?: PermissionRequest[], trace?: ReplyTrace[]): ReplySegment[];
export function thinkingExcerpt(message: Pick<AgentMessage, 'thinking' | 'thinkingLength'>, entry: Extract<ReplyTrace, { kind: 'thinking' }>): string;
