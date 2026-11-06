// Agent-aware editing for CodeMirror: which agent wrote each line (blame gutter, with a way to undo one agent's
// change), a short highlight on lines an agent just changed (applied as the smallest change, so your cursor and scroll
// position stay put), and a way to hand a selection to an agent.
import { RangeSet, StateEffect, StateField, Transaction, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, keymap, showTooltip, type DecorationSet, type Tooltip } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { changedLines, minimalChange, type TextChange } from '@/lib/text-change.mjs';

export interface BlameTurn { agent: string; threadId: string; title: string; messageId: string; ts?: number; request?: string }
export interface Blame { authors: number[]; turns: BlameTurn[] }
export interface AgentLook { name: string; color: string }
export interface Selected { text: string; fromLine: number; toLine: number }
/** A click on a blame bar: the turn that wrote the line, the line (1-based) and where the pointer was. */
export interface BlamePick { turn: BlameTurn; line: number; x: number; y: number }

const theme = EditorView.baseTheme({
  '.cm-agent-blame-gutter .cm-gutterElement': { padding: '0 1px 0 3px' },
  '.cm-agent-blame': { width: '3px', height: '100%', borderRadius: '2px', cursor: 'pointer', opacity: '0.8' },
  '.cm-agent-blame:hover': { opacity: '1', width: '5px' },
  '.cm-agent-flash': { backgroundColor: 'color-mix(in oklch, var(--agent-flash) 12%, transparent)' },
  '.cm-tooltip.cm-tooltip-ask, .cm-tooltip:has(> .cm-ask-agent)': { border: 'none', background: 'transparent' },
  '.cm-ask-agent': {
    font: '500 12px/1 var(--app-font, ui-sans-serif)', padding: '5px 9px', borderRadius: '8px', cursor: 'pointer',
    background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', boxShadow: '0 2px 8px rgb(0 0 0 / 0.15)',
  },
  '.cm-ask-agent:hover': { background: 'var(--muted)' },
});

const ago = (ts?: number) => {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};

class BlameMarker extends GutterMarker {
  constructor(readonly turn: number, readonly color: string, readonly label: string) { super(); }
  eq(other: GutterMarker) { return other instanceof BlameMarker && other.turn === this.turn && other.color === this.color && other.label === this.label; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-agent-blame'; el.style.backgroundColor = this.color; el.title = this.label;
    return el;
  }
}

type BlameState = { markers: RangeSet<BlameMarker>; turns: BlameTurn[] };
const setBlame = StateEffect.define<BlameState>();
const blameField = StateField.define<BlameState>({
  create: () => ({ markers: RangeSet.empty, turns: [] }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBlame)) return e.value;
    return tr.docChanged ? { ...value, markers: value.markers.map(tr.changes) } : value;
  },
});

/** The turn that wrote the line at `pos`, or null for a line no agent wrote (or with blame off). */
export function blameAt(state: EditorState, pos: number): BlameTurn | null {
  const field = state.field(blameField, false); if (!field) return null;
  const from = state.doc.lineAt(pos).from; let hit: number | null = null;
  field.markers.between(from, from, (_f, _t, m) => { hit = m.turn; });
  return hit == null ? null : field.turns[hit] ?? null;
}

/** The blame gutter. Clicking a bar hands its turn and line to onPick (a menu: open the conversation, undo the change). */
export function blameGutter(onPick: (pick: BlamePick) => void): Extension {
  return [blameField, gutter({
    class: 'cm-agent-blame-gutter',
    markers: (view) => view.state.field(blameField).markers,
    domEventHandlers: {
      mousedown(view, line, event) {
        const turn = blameAt(view.state, line.from); if (!turn) return false;
        const e = event as MouseEvent;
        onPick({ turn, line: view.state.doc.lineAt(line.from).number, x: e.clientX, y: e.clientY }); return true;
      },
    },
  }), theme];
}

/** Show (or clear, with null) the authors from hub.lineAuthors for the current document. */
export function showBlame(view: EditorView, blame: Blame | null, look: (agentId: string) => AgentLook) {
  const doc = view.state.doc; const ranges = [];
  if (blame) {
    for (let i = 0; i < blame.authors.length && i < doc.lines; i++) {
      const who = blame.authors[i]; const turn = blame.turns[who]; if (who < 0 || !turn) continue;
      const a = look(turn.agent);
      const label = `Changed during ${a.name}'s turn${turn.request ? `: "${turn.request.split('\n')[0].slice(0, 80)}"` : ''}\n${turn.title}${turn.ts ? `, ${ago(turn.ts)}` : ''}. Click to open the conversation or undo this change.`;
      ranges.push(new BlameMarker(who, a.color, label).range(doc.line(i + 1).from));
    }
  }
  view.dispatch({ effects: setBlame.of({ markers: RangeSet.of(ranges), turns: blame?.turns ?? [] }) });
}

const flash = StateEffect.define<{ from: number; to: number; color: string } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(flash)) continue;
      if (!e.value) return Decoration.none;
      const doc = tr.state.doc; const lines = [];
      for (let n = e.value.from; n <= Math.min(e.value.to, doc.lines); n++) lines.push(Decoration.line({ class: 'cm-agent-flash', attributes: { style: `--agent-flash: ${e.value.color}` } }).range(doc.line(n).from));
      value = Decoration.set(lines);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const flashTimers = new WeakMap<EditorView, number>();

/** Highlights for agent edits; pair with applyRemoteText. */
export const agentFlash: Extension = [flashField, theme];

/** Release a pane's transient edit highlight and its timer. */
export function clearAgentFlash(view: EditorView) {
  clearTimeout(flashTimers.get(view)); flashTimers.delete(view);
  view.dispatch({ effects: flash.of(null) });
}

/**
 * Bring the editor up to date with the file on disk after someone else (an agent) changed it. Only the changed part
 * is replaced, outside the undo history unless `undoable`. Visible panes can briefly highlight those lines.
 */
export function applyRemoteText(view: EditorView, text: string, color = 'var(--success)', undoable = false, animate = true, knownChange?: TextChange | null) {
  const change = knownChange === undefined ? minimalChange(view.state.doc.toString(), text) : knownChange;
  if (!change) return false;
  const highlight = animate ? { ...changedLines(text, change, view.state.doc.lineAt(change.from).number), color } : null;
  view.dispatch({ changes: change, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(undoable), ...(undoable ? [isolateHistory.of('full')] : [])], effects: flash.of(highlight) });
  clearTimeout(flashTimers.get(view));
  flashTimers.delete(view);
  if (animate) flashTimers.set(view, window.setTimeout(() => { flashTimers.delete(view); if (view.dom.isConnected) view.dispatch({ effects: flash.of(null) }); }, 2600));
  return true;
}

function selected(state: EditorState): Selected | null {
  const r = state.selection.main; if (r.empty) return null;
  return { text: state.sliceDoc(r.from, r.to), fromLine: state.doc.lineAt(r.from).number, toLine: state.doc.lineAt(r.to).number };
}

/** A small "Ask an agent" button on a selection (and Mod-L), handing the lines to onAsk. */
export function askAboutSelection(onAsk: (sel: Selected) => void, label = 'Ask an agent'): Extension {
  const tooltips = (state: EditorState): readonly Tooltip[] => {
    const r = state.selection.main; if (r.empty) return [];
    return [{ pos: r.head, above: r.head === r.to ? false : true, strictSide: false, arrow: false, create: (view) => {
      const dom = document.createElement('button'); dom.type = 'button'; dom.className = 'cm-ask-agent';
      dom.textContent = label; dom.title = `${label} (${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}L)`;
      dom.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
      dom.addEventListener('click', () => { const s = selected(view.state); if (s) onAsk(s); });
      return { dom };
    } }];
  };
  const field = StateField.define<readonly Tooltip[]>({ create: tooltips, update: (v, tr) => (tr.docChanged || tr.selection ? tooltips(tr.state) : v), provide: (f) => showTooltip.computeN([f], (s) => s.field(f)) });
  return [field, keymap.of([{ key: 'Mod-l', preventDefault: true, run: (view) => { const s = selected(view.state); if (!s) return false; onAsk(s); return true; } }]), theme];
}

