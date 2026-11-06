import { EditorState, Transaction } from '@codemirror/state';
import { historyField, isolateHistory } from '@codemirror/commands';
import { minimalChange } from './text-change.mjs';
import { editorText } from './editor-text.mjs';

// A group handoff must rebuild extensions with the destination's callbacks.
// Serialize only text, selection and undo/redo; no source view or DOM crosses.
export function captureEditorTransfer(view) {
  return { text: view.state.doc.toString(), json: view.state.toJSON({ history: historyField }), top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft };
}
export function restoreEditorTransfer(saved, config) {
  return saved?.text === config.doc ? EditorState.fromJSON(saved.json, config, { history: historyField }) : EditorState.create(config);
}

// Only immutable editor state and value data cross the parked boundary. Never
// retain a DOM node, view plugin instance, timer or EditorView in this record.
export function captureEditorMemento(view) {
  const selection = (name) => {
    const input = view.dom.querySelector(`.cm-search input[name="${name}"]`);
    return input ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
  };
  return { state: view.state, scroll: view.scrollSnapshot(),
    replaceExpanded: view.dom.querySelector('.cm-search [name="toggle-replace"]')?.getAttribute('aria-expanded') === 'true',
    findSelection: selection('search'), replaceSelection: selection('replace') };
}

export function restoreEditorMemento(view, memento) {
  if (memento.replaceExpanded) view.dom.querySelector('.cm-search [name="toggle-replace"][aria-expanded="false"]')?.click();
  for (const [name, saved] of [['search', memento.findSelection], ['replace', memento.replaceSelection]]) {
    const input = view.dom.querySelector(`.cm-search input[name="${name}"]`);
    if (input && saved && saved.start !== null && saved.end !== null) input.setSelectionRange(saved.start, saved.end, saved.direction || 'none');
  }
}

export function updateEditorMemento(memento, spec) {
  const transaction = memento.state.update(spec);
  memento.state = transaction.state;
  memento.scroll = memento.scroll?.map(transaction.changes);
  return transaction;
}

// Apply each observed external revision while parked, preserving the same
// remote/undo boundary as applyRemoteText without creating a hidden UI.
export function updateParkedText(memento, text) {
  const change = minimalChange(memento.state.doc.toString(), editorText(text));
  if (!change) return false;
  updateEditorMemento(memento, { changes: change, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(true), isolateHistory.of('full')] });
  return true;
}
