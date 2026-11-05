import type { CompletionSource } from '@codemirror/autocomplete';
import type { HubBridge } from '@/types';
import type { LspPosition } from './lsp-edits.mjs';
export interface LanguageServerSetting { id: string; command: string; args: string[]; enabled: boolean }
export interface LanguageServerInfo extends LanguageServerSetting { name: string; extensions: string[]; available: boolean; running: boolean; install?: string }
export interface LanguageToolCatalog { servers: LanguageServerInfo[]; formatters: { id: string; name: string; available: boolean; bundled?: boolean; command?: string; docs?: string }[] }
const extensions: Record<string, string[]> = { typescript: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'], go: ['go'], rust: ['rs'], python: ['py', 'pyi'], clang: ['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh'], vue: ['vue'] };
export function configuredLanguage(settings: unknown, path: string) { return Array.isArray(settings) && settings.some((server: LanguageServerSetting) => server.enabled && extensions[server.id]?.includes(path.split('.').pop()?.toLowerCase() || '')); }
export function serverCompletions(hub: HubBridge, project: string, path: string, owner: string, valid: () => boolean): CompletionSource {
  return async (context) => {
    if (!valid() || context.aborted) return null;
    const word = context.matchBefore(/[\w$]*/); if (!context.explicit && !word?.text) return null;
    const text = context.state.doc.toString(); if (text.length > 1024 * 1024) return null;
    const line = context.state.doc.lineAt(context.pos); const from = word?.from ?? context.pos;
    try {
      const items = await hub.call<{ label: string; detail: string; insertText: string; range?: { start: LspPosition; end: LspPosition }; kind?: number }[]>('languageComplete', project, path, text, { line: line.number - 1, character: context.pos - line.from }, owner);
      if (!valid() || context.aborted || !items.length) return null;
      return { from, options: items.filter((item) => typeof item.insertText === 'string').map((item) => ({ label: item.label, detail: item.detail, apply: (view, _completion, start, end) => { const position = (value: LspPosition) => { if (!Number.isSafeInteger(value?.line) || !Number.isSafeInteger(value.character) || value.line < 0 || value.character < 0) return start; const row = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, value.line + 1))); return Math.min(row.to, row.from + Math.max(0, value.character)); }; const a = item.range ? position(item.range.start) : start; const b = item.range ? position(item.range.end) : end; view.dispatch({ changes: { from: a, to: Math.max(a, b), insert: item.insertText }, selection: { anchor: a + item.insertText.length }, userEvent: 'input.complete' }); } })) };
    } catch { return null; }
  };
}
