export type FileRequest = Readonly<{ rel: string; line?: number; column?: number; editor?: boolean; following?: boolean; intent: 'preview' | 'pinned'; project: string | null; n: number }>;
export interface FileRequests {
  getSnapshot(projects: string | readonly string[]): FileRequest | null;
  subscribe(projects: string | readonly string[], listener: () => void): () => void;
  publish(request: FileRequest): void;
}
export function createFileRequests(): FileRequests;
