import workerSource from './format-worker?worker&url';
import { createWorkerClient, moduleWorker } from './worker-client.mjs';

/** One reusable worker; idle resources expire without touching editor drafts. */
const client = createWorkerClient({
  create: (options) => moduleWorker(workerSource, options), readResult: (data) => data.text ?? '',
  timeoutMs: 15000, idleMs: 30000, maxPending: 8,
  unavailable: 'Could not load the formatter. Your draft is unchanged.',
  timeoutMessage: 'Formatting took too long. Your draft is unchanged.',
});
export function formatInWorker(path: string, text: string): Promise<string> {
  return client.request<string>({ path, text });
}
