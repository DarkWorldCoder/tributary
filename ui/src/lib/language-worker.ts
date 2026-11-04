import { validateSourceSyntax } from './source-grammar.mjs';
import { documentLanguage } from './document-language-support.mjs';
import { outlineCode } from './code-outline.mjs';
import { validateDocument, completeDocument, outlineDocument } from './document-language.mjs';
self.onmessage = async (event: MessageEvent<{ id: number; method: 'validate' | 'complete' | 'outline'; path: string; text: string; offset?: number }>) => {
  const { id, method, path, text, offset } = event.data;
  try { const result = method === 'outline' ? (await outlineCode(path, text) ?? await outlineDocument(path, text)) : method === 'validate' ? documentLanguage(path) ? await validateDocument(path, text) : await validateSourceSyntax(path, text) : await completeDocument(path, text, offset || 0); self.postMessage({ id, result }); }
  catch { self.postMessage({ id, error: 'Language assistance unavailable.' }); }
};
