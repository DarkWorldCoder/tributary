export type Mode = 'read' | 'edit' | 'full';
export type Protocol = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'lmstudio';

export interface Agent {
  id: string; name: string; vendor?: string; color: string; glyph?: string; docs?: string; login?: string;
  available: boolean; headless: boolean; protocol: string; verified?: boolean;
  version?: string | null; path?: string | null; gateways?: Protocol[]; note?: string; custom?: boolean; connectionId?: string; registry?: string;
}
export interface RegistryAgent {
  id: string; name: string; version: string; description: string; website: string; installed: boolean;
  install: { kind: 'npx' | 'uvx' | 'binary' | 'unknown'; runnable: boolean; command?: string; args?: string[] };
}
export interface Project { path: string; name: string; trusted?: boolean; folders?: string[]; kind?: 'personal' }
export interface Gateway { id: string; name: string; protocol: Protocol; baseUrl: string; model: string; wireApi?: 'chat' | 'responses'; hasKey?: boolean; apiKey?: string; clearKey?: boolean; direct?: boolean; maxOutputTokens?: number }
export interface TaskTemplate { id: string; title: string; group: string; description: string; needsMaterial?: boolean }
export interface TaskInput { templateId: string; goal: string; audience?: string; material?: string }
export interface DocumentVersion { title: string; content: string; revision: number; updatedAt: number }
export interface SavedDocument extends DocumentVersion { id: string; sourceMessageId: string; history: DocumentVersion[] }
export interface Preset { name: string; protocol: Protocol; baseUrl: string; model?: string; wireApi?: 'chat' | 'responses' }
export interface TeamRole { id: string; label: string; multi?: boolean }
export interface Recipe { name: string; description: string; roles: TeamRole[] }
export interface TeamStep { role: string; agentId: string; state: 'running' | 'done' | 'failed'; messageId?: string }
export interface HubState {
  taskTemplates?: TaskTemplate[]; credentialStorage?: 'encrypted' | 'session';
  scanningAgents?: boolean;
  agents: Agent[]; projects: Project[]; gateways: Gateway[]; presets: Preset[];
  settings: Record<string, unknown>; running: string[]; customAgentsFile: string;
  teams?: Record<string, { recipe: string; steps: TeamStep[] }>; recipes?: Record<string, Recipe>; unread?: number;
}
export interface RaceCandidate {
  agent: string; status: 'running' | 'done'; ok?: boolean | null; text?: string; files?: string[]; diff?: string; stat?: string;
  tests?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'; testOutput?: string; activity?: string; durationMs?: number; error?: string;
  branch?: string; commit?: string;
}
export interface RaceInfo { task: string; testCommand: string; agents: string[]; candidates: RaceCandidate[]; applied: string | null; base?: string; judge?: { agent: string; winner: string | null; messageId: string } }
export interface AppNotification { id: string; ts: number; read: boolean; kind: 'done' | 'failed' | 'attention' | 'info' | 'permission'; threadId?: string; title: string; body?: string }
export interface FileContent { rel: string; size: number; binary: boolean; truncated: boolean; content: string; mtime: number; base64?: string }
export interface MemoryInfo { enabled: boolean; memory: string | null; worklog: string[] }
export interface ThreadChange { rel: string; turns: { messageId: string; agent: string; ts?: number; change?: string; team?: string }[] }
export type ThreadStatus = 'working' | 'permission' | 'review' | 'failed' | 'done';
export interface PermissionOption { optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string }
/** A tool call the agent asked to make. Pending until the person answers, the turn is stopped, or it ends. */
export interface PermissionRequest {
  id: string; threadId: string; messageId: string; agent: string; toolCallId?: string; title: string; kind: string;
  command?: string; path?: string; options: PermissionOption[]; status: 'pending' | 'allowed' | 'always' | 'rejected' | 'cancelled'; ts: number;
}
export interface ThreadSummary { id: string; title: string; updatedAt: number; lastAgent: string | null; count?: number; running?: boolean; agents: string[]; status?: ThreadStatus | null }
export interface Tool { id?: string; name: string; input?: Record<string, unknown> & { command?: unknown }; status: 'running' | 'done' | 'error'; output?: string; files?: string[] }
export interface FileChange { path: string; rel: string; external?: boolean; change?: string; viaGit?: boolean }
export interface UserMessage { id: string; role: 'user'; text: string; target: string; ts?: number; kind?: 'chat' | 'plan' | 'implement' | 'race'; team?: { recipe: string; role: string } }
export interface AgentMessage {
  id: string; role: 'assistant'; agent: string; text: string; thinking?: string; tools: Tool[]; files: FileChange[];
  plan?: { text: string; done: boolean }[] | null; notices: string[]; error?: string | null; ok: boolean | null;
  mode: Mode; gateway?: string | null; handoff?: 'new' | 'resume' | 'join' | 'catch-up'; resumed?: boolean;
  durationMs?: number; costUsd?: number; usage?: Record<string, number>; ts?: number;
  kind?: 'chat' | 'plan' | 'implement' | 'race'; planFrom?: string; checkpoint?: string;
  team?: { recipe: string; role: string }; race?: RaceInfo; permissions?: PermissionRequest[];
}
export type Message = UserMessage | AgentMessage;
export interface Thread { id: string; project: string; title: string; messages: Message[]; agentSessions: Record<string, string>; lastAgent?: string | null; updatedAt?: number; task?: { templateId: string; material?: string }; documents?: SavedDocument[] }
export interface GitInfo { root: string; branch: string; changed: { code: string; path: string }[]; stat?: string }

export interface HubEvents {
  collaboration: import('../../core/collaboration/client.mjs').RoomState;
  state: undefined; threads: string; message: { threadId: string; message: Message }; 'message-patch': { threadId: string; id: string; patch: import('./lib/message-patch.mjs').MessagePatch };
  running: { threadId: string; running: boolean }; insert: string; 'focus-project': string;
  activity: ActivityEntry[]; notification: AppNotification; 'term-data': { id: string; data: string }; 'term-exit': { id: string; code: number }; 'open-thread': string;
}
// The live view (core/activity.js): every busy thread and the agents working in it.
export interface ActivityWorker {
  key: string; agent: string; role: string | null; messageId?: string; startedAt?: number; taskId?: string;
  state: 'working' | 'testing' | 'merging' | 'waiting' | 'done' | 'failed' | 'skipped'; doing: string;
  files: { rel: string; change?: string }[]; tests?: string; branch?: string; tools?: number;
}
export interface ActivityEntry { threadId: string; title: string; project: string; startedAt?: number; kind: 'turn' | 'team' | 'race' | 'manager'; recipe?: string; recipeName?: string; messageId?: string; phase?: string; workers: ActivityWorker[] }
export interface HubBridge {
  platform: 'desktop' | 'vscode' | 'mock';
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  on<K extends keyof HubEvents>(name: K, fn: (data: HubEvents[K]) => void): void | (() => void);
}
declare global { interface Window { hub?: HubBridge } }
