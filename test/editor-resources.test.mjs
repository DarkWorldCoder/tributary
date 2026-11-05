import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection, Compartment, Transaction } from '../ui/node_modules/@codemirror/state/dist/index.js';
import { history, undo, redo, undoDepth, redoDepth } from '../ui/node_modules/@codemirror/commands/dist/index.js';
import { javascript } from '../ui/node_modules/@codemirror/lang-javascript/dist/index.js';
import { codeFolding, foldEffect, foldedRanges } from '../ui/node_modules/@codemirror/language/dist/index.js';
import { search, SearchQuery, setSearchQuery, getSearchQuery } from '../ui/node_modules/@codemirror/search/dist/index.js';
import { configureEditorGrammar } from '../ui/src/lib/editor-grammar.mjs';
const tick = () => new Promise(setImmediate);
function fixture() {
  const compartment = new Compartment(), grammar = javascript({ typescript: true });
  const text = 'export function answer() {\n  return 42;\n}\n';
  let state = EditorState.create({ doc: text, extensions: [history(), codeFolding(), search(), EditorState.allowMultipleSelections.of(true), compartment.of(grammar)] });
  const view = { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; } };
  return { view, compartment, grammar, text };
}

test('suspending grammar releases its tree without losing document, multi-selection, folds, search or undo/redo', async () => {
  const { view, compartment, grammar, text } = fixture();
  view.dispatch({ changes: { from: 0, insert: '// unsaved\n' }, annotations: Transaction.userEvent.of('input') });
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.range(20, 25)]), effects: [foldEffect.of({ from: view.state.doc.toString().indexOf('{') + 1, to: view.state.doc.toString().lastIndexOf('}') }), setSearchQuery.of(new SearchQuery({ search: 'return', caseSensitive: true }))] });
  const doc = view.state.doc.toString(), selection = view.state.selection.toJSON(), folded = foldedRanges(view.state).size, depth = undoDepth(view.state);
  assert.ok(view.state.tree.length > 0); assert.ok(folded); assert.ok(depth);
  for (let i = 0; i < 8; i++) {
    configureEditorGrammar(view, compartment, false, () => { throw Error('Inactive panes must not load a grammar'); });
    assert.equal(view.state.tree.length, 0); assert.equal(view.state.doc.toString(), doc); assert.deepEqual(view.state.selection.toJSON(), selection);
    assert.equal(foldedRanges(view.state).size, folded); assert.equal(getSearchQuery(view.state).search, 'return'); assert.equal(undoDepth(view.state), depth);
    configureEditorGrammar(view, compartment, true, async () => grammar); await tick();
    assert.ok(view.state.tree.length > 0); assert.deepEqual(view.state.selection.toJSON(), selection); assert.equal(foldedRanges(view.state).size, folded);
  }
  assert.ok(undo(view)); assert.equal(view.state.doc.toString(), text); assert.ok(redoDepth(view.state));
  configureEditorGrammar(view, compartment, false, async () => grammar); assert.ok(redo(view)); assert.equal(view.state.doc.toString(), doc);
});

test('late grammar completion cannot repopulate a hidden or replaced pane', async () => {
  const { view, compartment, grammar } = fixture(); let resolve, calls = 0;
  const promise = new Promise(done => { resolve = done; });
  const cancel = configureEditorGrammar(view, compartment, true, () => { calls++; return promise; }); await tick(); assert.equal(calls, 1);
  cancel(); configureEditorGrammar(view, compartment, false, async () => grammar); resolve(grammar); await tick();
  assert.equal(view.state.tree.length, 0);
  const cancelledBeforeStart = configureEditorGrammar(view, compartment, true, () => { calls++; return Promise.resolve(grammar); }); cancelledBeforeStart(); await tick();
  assert.equal(calls, 1); assert.equal(view.state.tree.length, 0);
  configureEditorGrammar(view, compartment, true, async () => grammar); await tick(); assert.ok(view.state.tree.length > 0);
});

test('shared grammar loading keeps independent pane lifetimes and absorbs a failed import', async () => {
  const a = fixture(), b = fixture(); let resolve;
  const promise = new Promise(done => { resolve = done; });
  const cancelA = configureEditorGrammar(a.view, a.compartment, true, () => promise);
  configureEditorGrammar(b.view, b.compartment, true, () => promise); await tick();
  cancelA(); configureEditorGrammar(a.view, a.compartment, false, async () => a.grammar); resolve(a.grammar); await tick();
  assert.equal(a.view.state.tree.length, 0); assert.ok(b.view.state.tree.length > 0);
  configureEditorGrammar(a.view, a.compartment, true, () => { throw Error('Synthetic import failure'); }); await tick();
  assert.equal(a.view.state.tree.length, 0); assert.ok(b.view.state.tree.length > 0);
});
