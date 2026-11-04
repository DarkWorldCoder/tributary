export type Mode = 'read' | 'edit' | 'full';
export interface UiSkill { id: string; title: string; description: string; instructions?: string }
export type Protocol = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'lmstudio';

export interface ModelCatalog { supportsSelection: boolean; source: string; note: string; updatedAt: number; error?: string; models: { id: string; name: string; hidden?: boolean; resolvedModel?: string }[] }

export interface Agent {
  id: string; name: string; vendor?: string; color: string; glyph?: string; docs?: string; login?: string;
  available: boolean; headless: boolean; protocol: string; verified?: boolean;
  capabilities?: { tools: boolean; plans: boolean; approvals: boolean; questions: boolean; resume: boolean };
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
  taskTemplates?: TaskTemplate[]; credentialStorage?: 'encrypted' | 'weak' | 'session';
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
export interface ProjectDiagnostic { rel: string; line: number; column: number; severity: 'error' | 'warning' | 'info'; message: string; source: string }
export interface ProjectCheckResult { toolId: string; label: string; command: string; code: number; stopped: boolean; startedAt: number; finishedAt: number; output: string; diagnostics: ProjectDiagnostic[] }
export interface ProjectCheckState { running: boolean; toolId: string | null; result: ProjectCheckResult | null }
export interface ProjectCheckCatalog extends ProjectCheckState { tools: { id: string; label: string; command: string; available: boolean }[] }
export interface MemoryInfo { enabled: boolean; memory: string | null; worklog: string[]; revision?: string; bytes?: number; context?: { includeInPrompts: boolean; budget: number } }
export interface ThreadChange { rel: string; turns: { messageId: string; agent: string; ts?: number; change?: string; team?: string; added?: number; removed?: number; binary?: boolean }[] }
export type ThreadStatus = 'working' | 'permission' | 'review' | 'failed' | 'done';
export interface PermissionOption { optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string }
/** A tool call the agent asked to make. Pending until the person answers, the turn is stopped, or it ends. */
export interface PermissionRequest {
  questions?: { question: string; multiSelect: boolean; options: { label: string; description: string }[] }[];
  answers?: Record<string, string>;
  id: string; threadId: string; messageId: string; agent: string; toolCallId?: string; title: string; kind: string;
  textOffset?: number; command?: string; path?: string; detail?: string; options: PermissionOption[]; status: 'pending' | 'allowed' | 'always' | 'rejected' | 'cancelled'; ts: number;
}
export interface ThreadSummary { id: string; title: string; updatedAt: number; lastAgent: string | null; count?: number; running?: boolean; agents: string[]; status?: ThreadStatus | null; branch?: string }
export interface Tool { id?: string; name: string; title?: string; input?: Record<string, unknown> & { command?: unknown }; status: 'running' | 'done' | 'error'; output?: string; files?: string[] }
export interface FileChange { path: string; rel: string; external?: boolean; change?: string; viaGit?: boolean; added?: number; removed?: number; binary?: boolean }
export interface Attachment { id: string; name: string; mime: string; size: number }
export interface UserMessage { attachments?: Attachment[]; id: string; role: 'user'; text: string; target: string; ts?: number; kind?: 'chat' | 'plan' | 'research' | 'implement' | 'race'; team?: { recipe: string; role: string } }
export type ReplyTrace =
  | { kind: 'thinking'; textOffset: number; start: number; end: number }
  | { kind: 'tool'; textOffset: number; toolIndex: number }
  | { kind: 'plan'; textOffset: number; items: { text: string; done: boolean }[] }
  | { kind: 'permission'; textOffset: number; requestId: string };
export type ReplyActivity = Exclude<ReplyTrace, { kind: 'permission' }>;
export interface AgentMessage {
  trace?: ReplyTrace[]; thinkingLength?: number;
  delegations?: { id: string; agentId: string; title: string; state: string; branch?: string; model?: string; error?: string; files?: string[]; fileCount?: number }[];
  memoryContext?: { characters: number; budget: number; sources: { source: string; line: number }[] };
  id: string; role: 'assistant'; model?: string | null; gatewayId?: string | null; agent: string; text: string; thinking?: string; tools: Tool[]; files: FileChange[];
  plan?: { text: string; done: boolean }[] | null; notices: string[]; error?: string | null; ok: boolean | null;
  mode: Mode; gateway?: string | null; handoff?: 'new' | 'resume' | 'join' | 'catch-up'; resumed?: boolean;
  durationMs?: number; costUsd?: number; usage?: Record<string, number>; ts?: number;
  kind?: 'chat' | 'plan' | 'research' | 'implement' | 'race'; planFrom?: string; checkpoint?: string;
  team?: { recipe: string; role: string }; race?: RaceInfo; permissions?: PermissionRequest[];
  /** The project's checks after this turn (.tributary/settings.json scripts.verify). */
  verify?: { state: 'untrusted' | 'running' | 'passed' | 'failed' | 'stopped'; command: string; hash: string; output?: string; ms?: number };
}
export type Message = UserMessage | AgentMessage;
/** A conversation's separate working copy: its own git worktree (path) and branch, made from the project's last commit on `from`. */
export interface Worktree { path: string; cwd: string; branch: string; base: string; from: string; createdAt: number; mergedAt?: number; pr?: PullRequest }
/** A separate copy's GitHub pull request, made and read through the gh CLI. */
export interface PullRequest { number: number; url: string; title: string; base: string | null; state: 'OPEN' | 'CLOSED' | 'MERGED'; createdAt: number; mergedAt?: number }
export interface PullRequestCheck { name: string; workflow: string; state: string; bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'; link: string; description: string; runId?: string }
export interface PullRequestStatus extends PullRequest { isDraft: boolean; checks: PullRequestCheck[]; unpushed: number }
export interface WorktreeStatus { branch: string; path: string; cwd: string; into: string; ahead: number; behind: number; uncommitted: number; files: { path: string; code: string }[]; missing?: boolean; copied?: string[]; port?: number; setup?: CopySetup; conflicts?: string[]; merging?: boolean; unresolved?: string[] }
/** The project's setup script in a separate copy (.tributary/settings.json scripts.setup). */
export interface CopySetup { state: 'untrusted' | 'pending' | 'running' | 'done' | 'failed' | 'stopped'; command: string; hash: string; output?: string; ms?: number }
export interface MergeResult { into: string; branch: string; commit: string; files: string[] }
export interface Thread { id: string; project: string; title: string; messages: Message[]; agentSessions: Record<string, string>; lastAgent?: string | null; updatedAt?: number; task?: { templateId: string; material?: string }; documents?: SavedDocument[]; worktree?: Worktree; delegation?: { parentThreadId: string; parentMessageId: string; agentId: string; state: string } }
export interface GitInfo { root: string; branch: string; changed: { code: string; path: string; from?: string; added?: number; removed?: number; binary?: boolean }[]; stat?: string }

export interface HubEvents {
  'preview-server': { project: string; status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'; command: string; url: string; output: string; error: string; code: number | null };
  'language-diagnostics': { project: string; rel: string; text: string; version: number; diagnostics: ProjectDiagnostic[] };
  debugger: import('./lib/debug-types').DebugState;
  'window-state': { maximized: boolean; fullscreen?: boolean; platform: string };
  'files-changed': { watchId: string; project: string; paths: string[]; error?: string };
  collaboration: import('../../core/collaboration/client.mjs').RoomState;
  state: undefined; threads: string; message: { threadId: string; message: Message }; 'message-patch': { threadId: string; id: string; patch: import('./lib/message-patch.mjs').MessagePatch };
  running: { threadId: string; running: boolean }; insert: string; 'focus-project': string;
  activity: ActivityEntry[]; notification: AppNotification; 'term-data': { id: string; data: string }; 'term-exit': { id: string; code: number }; 'open-thread': string;
}
// The live view (core/activity.js): every busy thread and the agents working in it.
export interface ActivityWorker {
  key: string; agent: string; role: string | null; messageId?: string; startedAt?: number; taskId?: string;
  state: 'working' | 'testing' | 'merging' | 'waiting' | 'done' | 'failed' | 'skipped' | 'stopped'; doing: string; attention?: boolean; task?: string; note?: string; dependsOn?: { id: string; title: string; state: string }[];
  files: { rel: string; change?: string; added?: number; removed?: number; binary?: boolean }[]; tests?: string; branch?: string; tools?: number;
}
export interface ActivityEntry { parentThreadId?: string; threadId: string; title: string; project: string; workdir?: string; startedAt?: number; kind: 'turn' | 'team' | 'race' | 'manager'; recipe?: string; recipeName?: string; messageId?: string; phase?: string; workers: ActivityWorker[] }
export interface HubBridge {
  platform: 'desktop' | 'vscode' | 'mock';
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  on<K extends keyof HubEvents>(name: K, fn: (data: HubEvents[K]) => void): void | (() => void);
}
declare global { interface Window { hub?: HubBridge } }
