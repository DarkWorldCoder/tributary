import type { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';

export function openEditorFind(view: EditorView, replace = false) {
  openSearchPanel(view);
  if (replace && !view.state.readOnly) requestAnimationFrame(() => {
    if (view.dom.isConnected) view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.focus();
  });
  return true;
}
