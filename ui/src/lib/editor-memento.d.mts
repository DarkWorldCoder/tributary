import type { EditorState, StateEffect, Transaction, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
type InputSelection = { start: number | null; end: number | null; direction: 'forward' | 'backward' | 'none' | null } | null;
export type EditorMemento = { state: EditorState; scroll?: StateEffect<unknown>; replaceExpanded: boolean; findSelection: InputSelection; replaceSelection: InputSelection };
export function captureEditorMemento(view: EditorView): EditorMemento;
export function restoreEditorMemento(view: EditorView, memento: EditorMemento): void;
export function updateEditorMemento(memento: EditorMemento, spec: TransactionSpec): Transaction;
export function updateParkedText(memento: EditorMemento, text: string): boolean;
