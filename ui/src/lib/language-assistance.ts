import { createWorkerClient, moduleWorker } from './worker-client.mjs';
import { sourceSyntaxSupported } from './source-language.mjs';
import workerSource from './language-worker?worker&url';
import type { CompletionSource } from '@codemirror/autocomplete';
import { DOCUMENT_LIMIT, documentLanguage } from './document-language-support.mjs';
import type { DocumentCompletion } from './document-language.mjs';
import type { ProjectDiagnostic } from '@/types';
const client = createWorkerClient({
  create: (options) => moduleWorker(workerSource, options), idleMs: 60000, maxPending: 16,
  unavailable: 'Language assistance unavailable.', timeoutMessage: 'Language assistance timed out.',
});
function request<T>(method: 'validate' | 'complete' | 'outline', path: string, text: string, offset?: number, signal?: AbortSignal): Promise<T> {
  return client.request<T>({ method, path, text, offset }, { signal });
}
export const liveValidation = (path: string, text: string, signal?: AbortSignal) => (documentLanguage(path) || sourceSyntaxSupported(path, text)) && text.length <= DOCUMENT_LIMIT ? request<ProjectDiagnostic[]>('validate', path, text, undefined, signal) : Promise.resolve([]);
export function languageCompletions(path: string): CompletionSource {
  return async (context) => {
    if (context.state.doc.length > DOCUMENT_LIMIT) return null;
    const controller = new AbortController();
    context.addEventListener('abort', () => controller.abort(), { onDocChange: true });
    const text = context.state.doc.toString();
    try {
      const items = await request<DocumentCompletion[]>('complete', path, text, context.pos, controller.signal);
      if (context.aborted || !items.length) return null;
      const from = context.matchBefore(/[\w$-]*/)?.from ?? context.pos;
      return { from, options: items.map((item) => ({ label: item.label, detail: item.detail, type: item.type,
        apply: (view, _completion, start, end) => {
          const shift = start - from;
          view.dispatch({ changes: { from: item.from + shift, to: Math.max(item.to + shift, end), insert: item.text }, selection: { anchor: item.from + shift + item.text.length }, userEvent: 'input.complete' });
        } })) };
    } catch { return null; }
  };
}

export const documentOutline = (path: string, text: string, signal?: AbortSignal) => request<import('./code-outline.mjs').OutlineItem[]>('outline', path, text, undefined, signal);
