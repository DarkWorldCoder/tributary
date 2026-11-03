export interface RoomUser { id: string; name: string; admin: boolean }
export interface RoomProject { id: string; name: string; cursor: number }
export interface RoomTask { id: string; title: string; description: string; dependencies: string[]; status: 'ready' | 'claimed' | 'working' | 'blocked' | 'review' | 'done'; owner: string | null; agent: string; result: string; revision: number; createdBy: string; updatedAt: number }
export interface RoomSnapshot { project: RoomProject; tasks: RoomTask[]; members: RoomUser[]; online: string[] }
export interface RoomState { status: 'disconnected' | 'connecting' | 'connected' | 'live' | 'reconnecting'; endpoint: string; user: RoomUser | null; projects: RoomProject[]; snapshot: RoomSnapshot | null; error: string | null }
export class CollaborationClient {
  constructor(onChange?: (value: RoomState) => void, requestFetch?: (url: string, options: RequestInit, fingerprint?: string) => Promise<Response>);
  state(): RoomState;
  connect(input: { endpoint: string; accessKey: string; fingerprint?: string }): Promise<RoomState>;
  disconnect(): void;
  watch(projectId: string): Promise<RoomState>;
  command<T = unknown>(action: string, input: Record<string, unknown>, commandId?: string): Promise<T>;
}
