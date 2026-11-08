import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import type { ChangeMarker } from './editor-diff.mjs';

export const setFileChanges = StateEffect.define<ChangeMarker[]>();
class FileChangeMarker extends GutterMarker {
  constructor(readonly added: number, readonly removed: number) { super(); }
  eq(other: GutterMarker) { return other instanceof FileChangeMarker && this.added === other.added && this.removed === other.removed; }
  toDOM() {
    const marker = document.createElement('span');
    marker.className = `cm-file-change${this.added ? ' cm-file-added' : ''}${this.removed ? ' cm-file-removed' : ''}`;
    marker.title = `${this.added} lines added, ${this.removed} lines removed · Review saved changes`;
    return marker;
  }
}
const changes = StateField.define<RangeSet<FileChangeMarker>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setFileChanges)) {
      const lines = new Map<number, ChangeMarker>();
      for (const marker of effect.value) {
        const line = Math.min(transaction.state.doc.lines, Math.max(1, marker.line));
        const current = lines.get(line) || { line, added: 0, removed: 0 };
        lines.set(line, { line, added: current.added + marker.added, removed: current.removed + marker.removed });
      }
      return RangeSet.of([...lines.values()].sort((a, b) => a.line - b.line).map((marker) => new FileChangeMarker(marker.added, marker.removed).range(transaction.state.doc.line(marker.line).from)));
    }
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
});

// Style modules live for the document; reuse this static theme across editor mounts.
const gutterTheme = EditorView.baseTheme({
    '.cm-file-change-gutter': { width: '7px', cursor: 'pointer' },
    '.cm-file-change-gutter .cm-gutterElement': { padding: '0 2px' },
    '.cm-file-change': { position: 'relative', display: 'block', height: '100%', width: '3px' },
    '.cm-file-added': { background: 'var(--success)' },
    '.cm-file-removed::after': { content: '""', position: 'absolute', top: '0', left: '-2px', borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: '5px solid var(--destructive)' },
  });

export function changeGutter(onReview: () => void): Extension {
  return [changes, gutter({ class: 'cm-file-change-gutter', markers: (view) => view.state.field(changes), domEventHandlers: { mousedown(view, line) { let found = false; view.state.field(changes).between(line.from, line.from, () => { found = true; }); if (found) onReview(); return found; } } }), gutterTheme];
}
