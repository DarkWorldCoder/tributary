import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter } from '@codemirror/view';
export const debugLines = StateEffect.define<{ lines: number[]; paused: number | null }>();
const debugField = StateField.define({ create: () => ({ lines: [] as number[], paused: null as number | null }), update: (value, transaction) => { for (const effect of transaction.effects) if (effect.is(debugLines)) return effect.value; return value; } });
class Breakpoint extends GutterMarker {
  constructor(readonly line: number, readonly enabled: boolean, readonly paused: boolean, readonly toggle: (line: number) => void) { super(); }
  eq(other: Breakpoint) { return this.line === other.line && this.enabled === other.enabled && this.paused === other.paused && this.toggle === other.toggle; }
  toDOM() { const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1; button.className = `debug-breakpoint${this.enabled ? ' is-set' : ''}${this.paused ? ' is-paused' : ''}`; button.textContent = this.paused ? '➜' : '●'; button.setAttribute('aria-label', `${this.enabled ? 'Remove' : 'Add'} breakpoint at line ${this.line}`); button.title = `${this.enabled ? 'Remove' : 'Add'} breakpoint · line ${this.line}`; button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); this.toggle(this.line); }; return button; }
}
// Style modules live for the document; reuse this static theme across editor mounts.
const gutterTheme = EditorView.baseTheme({ '.cm-debug-gutter': { width: '20px', cursor: 'pointer' }, '.debug-breakpoint': { display: 'grid', placeItems: 'center', width: '20px', height: '20px', border: '0', background: 'transparent', color: 'var(--destructive)', opacity: '0', cursor: 'pointer', lineHeight: '1', fontSize: '13px' }, '.debug-breakpoint:hover, .debug-breakpoint:focus-visible, .debug-breakpoint.is-set, .debug-breakpoint.is-paused': { opacity: '1' }, '.debug-breakpoint:focus-visible': { outline: '1px solid var(--ring)' }, '.debug-breakpoint.is-paused': { color: 'var(--warning)' }, '.cm-debug-paused-line': { backgroundColor: 'color-mix(in oklch, var(--warning) 12%, transparent)' } });

export function debugGutter(toggle: (line: number) => void): Extension {
  return [debugField, gutter({ class: 'cm-debug-gutter', lineMarker: (view, line) => { const n = view.state.doc.lineAt(line.from).number; const data = view.state.field(debugField); return new Breakpoint(n, data.lines.includes(n), data.paused === n, toggle); }, lineMarkerChange: (update) => update.transactions.some((t) => t.effects.some((e) => e.is(debugLines))) }), EditorView.decorations.compute([debugField], (state) => { const n = state.field(debugField).paused; return n && n <= state.doc.lines ? Decoration.set([Decoration.line({ class: 'cm-debug-paused-line' }).range(state.doc.line(n).from)]) : Decoration.none; }), gutterTheme];
}
