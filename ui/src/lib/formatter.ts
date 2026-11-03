import workerSource from './format-worker?worker&url';
let worker: Worker | null = null;
let loading: Promise<Worker> | null = null;
let blobUrl = '';
let sequence = 0;
const pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function reset(message: string) {
  worker?.terminate(); worker = null; loading = null; if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(message)); }
  pending.clear();
}
/** One lazy worker keeps formatting off the typing/rendering thread. No code is executed from the project. */
async function getWorker(): Promise<Worker> {
  if (worker) return worker;
  if (loading) return loading;
  loading = (async () => {
    const source = workerSource;
    let url: string = source;
    // VS Code workers must be loaded through a blob. The worker is built as one self-contained file.
    if (window.hub?.platform === 'vscode') {
      const response = await fetch(source); if (!response.ok) throw new Error('Could not load the formatter.');
      blobUrl = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' })); url = blobUrl;
    }
    worker = new Worker(url, { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; text?: string; error?: string }>) => {
      const item = pending.get(event.data.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(event.data.id);
      if (event.data.error) item.reject(new Error(event.data.error)); else item.resolve(event.data.text ?? '');
    };
    worker.onerror = () => reset('Could not load the formatter. Try again.');
    return worker;
  })();
  try { return await loading; } catch (error) { reset('Could not load the formatter.'); throw error; } finally { loading = null; }
}
export async function formatInWorker(path: string, text: string): Promise<string> {
  const instance = await getWorker();
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, timer: setTimeout(() => reset('Formatting took too long. Your draft is unchanged.'), 15000) });
    try { instance.postMessage({ id, path, text }); } catch { reset('Could not start formatting. Your draft is unchanged.'); }
  });
}
