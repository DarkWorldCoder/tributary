import { sourceSyntaxSupported } from './source-language.mjs';
import workerSource from './language-worker?worker&url';
import type { CompletionSource } from '@codemirror/autocomplete';
import { DOCUMENT_LIMIT, documentLanguage } from './document-language-support.mjs';
import type { DocumentCompletion } from './document-language.mjs';
import type { ProjectDiagnostic } from '@/types';
let worker: Worker | null = null;
let loading: Promise<Worker> | null = null;
let blobUrl = '';
let sequence = 0;
const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function reset() {
  worker?.terminate(); worker = null; loading = null;
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Language assistance unavailable.')); }
  pending.clear();
}
async function getWorker(): Promise<Worker> {
  if (worker) return worker; if (loading) return loading;
  loading = (async () => {
    let url = workerSource;
    if (window.hub?.platform === 'vscode') {
      const response = await fetch(url); if (!response.ok) throw new Error('Language assistance unavailable.');
      blobUrl = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' })); url = blobUrl;
    }
    worker = new Worker(url, { type: 'module' });
    worker.onmessage = (event) => { const item = pending.get(event.data.id); if (!item) return; clearTimeout(item.timer); pending.delete(event.data.id); if (event.data.error) item.reject(new Error(event.data.error)); else item.resolve(event.data.result); };
    worker.onerror = reset; return worker;
  })();
  try { return await loading; } catch (error) { reset(); throw error; } finally { loading = null; }
}
async function request<T>(method: 'validate' | 'complete' | 'outline', path: string, text: string, offset?: number): Promise<T> {
  const instance = await getWorker(); const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (result) => resolve(result as T), reject, timer: setTimeout(reset, 10000) });
    try { instance.postMessage({ id, method, path, text, offset }); } catch { reset(); }
  });
}
export const liveValidation = (path: string, text: string) => (documentLanguage(path) || sourceSyntaxSupported(path, text)) && text.length <= DOCUMENT_LIMIT ? request<ProjectDiagnostic[]>('validate', path, text) : Promise.resolve([]);
export function languageCompletions(path: string): CompletionSource {
  return async (context) => {
    if (context.state.doc.length > DOCUMENT_LIMIT) return null;
    context.addEventListener('abort', () => {}, { onDocChange: true });
    const text = context.state.doc.toString();
    try {
      const items = await request<DocumentCompletion[]>('complete', path, text, context.pos);
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

export const documentOutline = (path: string, text: string) => request<import('./code-outline.mjs').OutlineItem[]>('outline', path, text);
