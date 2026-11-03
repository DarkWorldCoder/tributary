import { formatDocument } from './format-document.mjs';
self.onmessage = async (event: MessageEvent<{ id: number; path: string; text: string }>) => {
  const { id, path, text } = event.data;
  try { self.postMessage({ id, text: await formatDocument(path, text) }); }
  catch (error) { self.postMessage({ id, error: (error as Error).message }); }
};
