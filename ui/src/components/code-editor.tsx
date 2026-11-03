import * as React from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { MessageSquare, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { agentFlash, applyRemoteText, askAboutSelection, blameAt, blameGutter, showBlame, type Blame, type BlamePick, type BlameTurn } from '@/lib/agent-editor';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useStore } from '@/store';
import type { ActivityEntry, FileContent } from '@/types';

// Language support loads the first time a file of that kind opens, not with the app.
const load = {
  javascript: (o?: { jsx?: boolean; typescript?: boolean }) => import('@codemirror/lang-javascript').then((m) => m.javascript(o)),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  php: () => import('@codemirror/lang-php').then((m) => m.php()),
};
export async function languageFor(path: string): Promise<Extension | null> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return load.javascript();
    case 'jsx': return load.javascript({ jsx: true });
    case 'ts': case 'mts': case 'cts': return load.javascript({ typescript: true });
    case 'tsx': return load.javascript({ jsx: true, typescript: true });
    case 'py': case 'pyi': return load.python();
    case 'json': case 'jsonc': return load.json();
    case 'css': case 'scss': case 'less': return load.css();
    case 'html': case 'htm': case 'vue': case 'svelte': return load.html();
    case 'md': case 'mdx': case 'markdown': return load.markdown();
    case 'rs': return load.rust();
    case 'go': return load.go();
    case 'java': case 'kt': return load.java();
    case 'c': case 'h': case 'cc': case 'cpp': case 'hpp': case 'cxx': return load.cpp();
    case 'sql': return load.sql();
    case 'yml': case 'yaml': return load.yaml();
    case 'php': return load.php();
    default: return null;
  }
}

// Colors come from CSS variables, so the editor follows the app (and VS Code) theme.
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--card)', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--foreground)', padding: '8px 0' },
  '.cm-line': { padding: '0 12px 0 8px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '32px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in oklch, var(--brand) 22%, transparent) !important' },
  '.cm-gutters': { backgroundColor: 'var(--card)', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--muted) 55%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--muted)', border: 'none', color: 'var(--muted-foreground)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', borderRadius: '8px' },
  '.cm-panels': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--warning) 30%, transparent)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in oklch, var(--brand) 20%, transparent)', outline: 'none' },
});
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.tagName, t.heading], color: 'var(--syn-tag)', fontWeight: '600' },
  { tag: [t.definition(t.variableName)], color: 'var(--foreground)' },
  { tag: t.link, color: 'var(--brand)', textDecoration: 'underline' },
]);

const undoKey = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘⌥Z' : 'Ctrl+Alt+Z';

/** A real code editor (CodeMirror 6): multi-cursor, search, folding, bracket matching, undo history. */
export function CodeEditor({ project: documentProject, path, value, onChange, onSave, readOnly, line, wrap = false, onCursorChange, onToggleWrap }: {
  project?: string; path: string; value: string; onChange?: (v: string) => void; onSave?: () => void; readOnly?: boolean; line?: number; wrap?: boolean; onCursorChange?: (position: { line: number; column: number }) => void; onToggleWrap?: () => void;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const ro = React.useRef(new Compartment());
  const language = React.useRef(new Compartment());
  const wrapping = React.useRef(new Compartment());
  const cb = React.useRef({ onChange, onSave, onCursorChange, onToggleWrap }); cb.current = { onChange, onSave, onCursorChange, onToggleWrap };
  // Agent-aware editing: who wrote each line (Alt+B toggles it), agent edits highlighted, a selection handed to an agent.
  const s = useStore(); const workspace = documentProject ?? s.workdir; const store = React.useRef(s); store.current = s;
  const [blameOn, setBlameOn] = React.useState(() => { try { return localStorage.getItem('tributary.blame') !== 'off'; } catch { return true; } });
  const [diskChanged, setDiskChanged] = React.useState(0);
  // Undo one agent's change: click its blame bar for a menu, or press Mod-Alt-Z on a line it wrote. The hub puts back
  // what that turn replaced there; the editor takes the new text like an agent edit, and Mod-Z brings the change back.
  const [picked, setPicked] = React.useState<BlamePick | null>(null);
  const refocus = React.useRef(true);
  const undo = React.useRef(async (_turn: BlameTurn, _line: number) => {});
  undo.current = async (turn, line) => {
    const v = view.current; const st = store.current; const project = documentProject ?? st.workdir; if (!v || !project || readOnly) return;
    const name = st.agentOf(turn.agent).name;
    try {
      // Line numbers and the text written back come from the saved file, so unsaved edits would be lost.
      const disk = await st.hub.call<FileContent>('readFile', project, path);
      if (disk.content !== v.state.doc.toString()) { toast.error('Save this file first', { description: `Undoing ${name}'s change works on the saved file.` }); return; }
      const r = await st.hub.call<{ text: string }>('revertTurnHunk', project, path, turn.messageId, line);
      if (view.current === v && applyRemoteText(v, r.text, undefined, true)) setDiskChanged((n) => n + 1);
      toast.success(`Undid ${name}'s change`, { description: `${undoKey.replace(/Alt\+|⌥/, '')} brings it back as an unsaved edit.` });
    } catch (e) {
      toast.error(`Couldn't undo ${name}'s change`, { description: String((e as Error).message).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') });
    }
  };

  React.useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup, theme, syntaxHighlighting(highlight), keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave?.(); return true; } }, { key: 'Alt-z', run: () => { if (!cb.current.onToggleWrap) return false; cb.current.onToggleWrap(); return true; } }]),
          EditorView.contentAttributes.of({ 'aria-label': `Edit ${path}`, tabindex: '0' }),
          ro.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && u.transactions.some((transaction) => !transaction.annotation(Transaction.remote))) cb.current.onChange?.(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) { const head = u.state.selection.main.head; const current = u.state.doc.lineAt(head); cb.current.onCursorChange?.({ line: current.number, column: head - current.from + 1 }); }
          }),
          language.current.of([]),
          agentFlash,
          blameGutter((pick) => { const box = host.current!.getBoundingClientRect(); setPicked({ ...pick, x: pick.x - box.left, y: pick.y - box.top }); }),
          keymap.of([{ key: 'Mod-Alt-z', run: (v) => { const head = v.state.selection.main.head; const turn = blameAt(v.state, head); if (!turn) return false; void undo.current(turn, v.state.doc.lineAt(head).number); return true; } }]),
          askAboutSelection(({ text, fromLine, toLine }) => {
            const st = store.current; const fence = path.split('.').pop() || '';
            st.setDraft(`${st.draft ? `${st.draft}\n` : ''}In @${path}:${fromLine}${toLine > fromLine ? `-${toLine}` : ''}:\n\`\`\`${fence}\n${text}\n\`\`\`\n`);
          }),
          keymap.of([{ key: 'Alt-b', run: () => { setBlameOn((on) => { try { localStorage.setItem('tributary.blame', on ? 'off' : 'on'); } catch { /* storage unavailable */ } return !on; }); return true; } }]),
        ],
      }),
    });
    view.current = v;
    languageFor(path).then((lang) => { if (lang && view.current === v) v.dispatch({ effects: language.current.reconfigure(lang) }); }).catch(() => { /* plain text */ });
    cb.current.onCursorChange?.({ line: 1, column: 1 });
    return () => { v.destroy(); view.current = null; };
    // A new path means a new document; the value is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Replace the document when it changes from outside (reload after an agent edit).
  React.useEffect(() => {
    const v = view.current; if (!v) return;
    // Only the changed part is replaced, so the cursor and scroll position stay put; the changed lines light up.
    if (applyRemoteText(v, value)) setDiskChanged((n) => n + 1);
  }, [value]);
  React.useEffect(() => { view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) }); }, [readOnly]);
  React.useEffect(() => { view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);
  React.useEffect(() => {
    const v = view.current; if (!v || !line) return;
    const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
    v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) }); v.focus();
  }, [line, path]);

  // Agents changing this file in the project right now (not those working in their own copy).
  const [editing, setEditing] = React.useState<string[]>([]);
  React.useEffect(() => {
    const pick = (all: ActivityEntry[]) => setEditing([...new Set(all.filter((e) => (e.workdir || e.project) === workspace && (e.kind === 'turn' || e.kind === 'team'))
      .flatMap((e) => e.workers.filter((w) => w.state === 'working' && w.files.some((f) => f.rel === path)).map((w) => w.agent)))]);
    s.hub.call<ActivityEntry[]>('activity').then(pick).catch(() => {});
    const off = s.hub.on('activity', pick);
    return () => { if (typeof off === 'function') off(); };
  }, [s.hub, workspace, path]);

  // Blame for this file, fetched when it opens, after it changes on disk, and when blame is switched on.
  React.useEffect(() => {
    const v = view.current; const project = workspace; if (!v) return;
    if (!blameOn || !project) { showBlame(v, null, s.agentOf); return; }
    let alive = true;
    const timer = setTimeout(() => {
      s.hub.call<Blame>('lineAuthors', project, path).then((b) => { if (alive && view.current === v) showBlame(v, b, (id) => store.current.agentOf(id)); }).catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, blameOn, workspace, diskChanged]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div ref={host} className="h-full min-h-0" />
      {editing.length > 0 && (
        <div role="status" className="pointer-events-none absolute top-2 right-4 z-10 flex items-center gap-1.5 rounded-full border bg-popover/95 px-2.5 py-1 text-xs text-popover-foreground shadow-sm">
          <span className="size-2 animate-pulse rounded-full" style={{ backgroundColor: s.agentOf(editing[0]).color }} />
          {editing.map((id) => s.agentOf(id).name).join(', ')} {editing.length === 1 ? 'is' : 'are'} editing this file
        </div>
      )}
      {picked && (
        <DropdownMenu open onOpenChange={(open) => { if (!open) setPicked(null); }}>
          <DropdownMenuTrigger asChild><span aria-hidden="true" className="pointer-events-none absolute size-0" style={{ left: picked.x, top: picked.y }} /></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64" onCloseAutoFocus={(e) => { e.preventDefault(); if (refocus.current) view.current?.focus(); refocus.current = true; }}>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate">{s.agentOf(picked.turn.agent).name}'s turn, line {picked.line}</span>
              {picked.turn.request && <span className="truncate text-xs font-normal text-muted-foreground">{picked.turn.request.split('\n')[0]}</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { refocus.current = false; s.openThread(picked.turn.threadId); }}><MessageSquare />Open conversation</DropdownMenuItem>
            <DropdownMenuItem disabled={readOnly} onSelect={() => { void undo.current(picked.turn, picked.line); }}><Undo2 />Undo this change<DropdownMenuShortcut>{undoKey}</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
