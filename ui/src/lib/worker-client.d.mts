interface WorkerResource { worker: Worker; dispose?: () => void }
interface WorkerClock { setTimeout: (callback: () => void, delay: number) => any; clearTimeout: (id: any) => void }
export function createWorkerClient(options: {
  create: (options: { signal: AbortSignal }) => Promise<WorkerResource> | WorkerResource;
  readResult?: (data: any) => unknown; timeoutMs?: number; idleMs?: number; maxPending?: number;
  unavailable?: string; timeoutMessage?: string; clock?: WorkerClock;
}): {
  request<T>(payload: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<T>;
  dispose(reason?: Error | string): void;
  stats(): { ready: boolean; loading: boolean; active: number; waiting: number };
};
export function moduleWorker(source: string, options: { signal: AbortSignal }): Promise<WorkerResource>;
