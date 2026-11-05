import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection, StateEffect, Transaction } from '../ui/node_modules/@codemirror/state/dist/index.js';
import { history, undo, redo, undoDepth } from '../ui/node_modules/@codemirror/commands/dist/index.js';
import { codeFolding, foldEffect, foldedRanges } from '../ui/node_modules/@codemirror/language/dist/index.js';
import { search, SearchQuery, setSearchQuery, getSearchQuery } from '../ui/node_modules/@codemirror/search/dist/index.js';
import { updateEditorMemento, updateParkedText } from '../ui/src/lib/editor-memento.mjs';

function fixture() {
  const source = 'function answer() {\n  return 42;\n}\n';
  const scroll = StateEffect.define({ map: (position, changes) => changes.mapPos(position) });
  let state = EditorState.create({ doc: source, extensions: [history(), codeFolding(), search(), EditorState.allowMultipleSelections.of(true)] });
  state = state.update({ changes: { from: 0, insert: '// draft\n' }, annotations: Transaction.userEvent.of('input') }).state;
  state = state.update({ selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.range(12, 15)]), effects: [foldEffect.of({ from: 27, to: 40 }), setSearchQuery.of(new SearchQuery({ search: 'return', replace: 'yield', caseSensitive: true }))] }).state;
  return { state, scroll: scroll.of(30), replaceExpanded: true, findSelection: { start: 1, end: 4, direction: 'forward' }, replaceSelection: null };
}

test('parked external revisions preserve exact undo, selections, folds and Find state without a view', () => {
  const saved = fixture(), original = saved.state.doc.toString();
  const beforeSelection = saved.state.selection.toJSON(), beforeFolds = foldedRanges(saved.state).size;
  const first = original + '// external 1\n', second = first + '// external 2\n';
  assert.equal(updateParkedText(saved, first), true);
  assert.equal(updateParkedText(saved, second), true);
  assert.equal(undoDepth(saved.state), 3);
  assert.deepEqual(saved.state.selection.toJSON(), beforeSelection);
  assert.equal(foldedRanges(saved.state).size, beforeFolds);
  assert.equal(getSearchQuery(saved.state).search, 'return');
  assert.equal(getSearchQuery(saved.state).replace, 'yield');
  assert.equal(saved.replaceExpanded, true);
  const target = { get state() { return saved.state; }, dispatch(transaction) { saved.state = transaction.state; } };
  assert.equal(undo(target), true); assert.equal(saved.state.doc.toString(), first);
  assert.equal(undo(target), true); assert.equal(saved.state.doc.toString(), original);
  assert.equal(redo(target), true); assert.equal(saved.state.doc.toString(), first);
  assert.equal(redo(target), true); assert.equal(saved.state.doc.toString(), second);
});

test('parked changes map the scroll anchor and no-op revisions retain identity', () => {
  const saved = fixture(); const state = saved.state, effect = saved.scroll;
  assert.equal(updateParkedText(saved, state.doc.toString()), false);
  assert.equal(saved.state, state); assert.equal(saved.scroll, effect);
  updateEditorMemento(saved, { changes: { from: 0, insert: 'prefix\n' } });
  assert.equal(saved.scroll.value, 37);
  assert.equal(saved.state.doc.toString().startsWith('prefix\n'), true);
});
