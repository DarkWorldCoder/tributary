import type { Compartment, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
export function configureEditorGrammar(view: Pick<EditorView, 'dispatch'>, compartment: Compartment, active: boolean, load: () => Promise<Extension | null>): () => void;
