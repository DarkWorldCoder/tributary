import { captureEditorTransfer, restoreEditorTransfer, type EditorTransfer, captureEditorMemento, restoreEditorMemento, updateEditorMemento, updateParkedText, type EditorMemento } from '@/lib/editor-memento.mjs';
import { configuredLanguage, serverCompletions } from '@/lib/language-tools';
import { applyLspEdits, type LspEdit } from '@/lib/lsp-edits.mjs';
import { changeGutter, setFileChanges } from '@/lib/change-gutter';
import { editorDiffMarkers, editorDiffStats } from '@/lib/editor-diff.mjs';
import { sourceGrammar } from '@/lib/source-grammar.mjs';
import { configureEditorGrammar } from '@/lib/editor-grammar.mjs';
import { sourceLanguage, sourceSyntaxSupported } from '@/lib/source-language.mjs';
import { useDebugger } from '@/hooks/use-debugger';
import { debugGutter, debugLines } from '@/lib/debug-editor';
import * as React from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment, Prec, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint';
import { autocompletion } from '@codemirror/autocomplete';
import { liveValidation, languageCompletions } from '@/lib/language-assistance';
import { useLanguageOwner } from '@/hooks/use-language-owner';
import { documentLanguage } from '@/lib/document-language-support.mjs';
import { formatInWorker } from '@/lib/formatter';
import { formatParser, nativeFormatTool } from '@/lib/format-document.mjs';
import { editorSpacing } from '@/lib/editor-spacing.mjs';
import { minimalChange } from '@/lib/text-change.mjs';
import { undo as undoEdit, redo as redoEdit, selectAll, undoDepth, redoDepth, isolateHistory, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, indentUnit } from '@codemirror/language';
import { editorTheme as theme, editorHighlight as highlight } from '@/lib/editor-appearance';
import { MessageSquare, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { agentFlash, applyRemoteText, clearAgentFlash, askAboutSelection, blameAt, blameGutter, showBlame, type Blame, type BlamePick, type BlameTurn } from '@/lib/agent-editor';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useStore } from '@/store';
import { EditorContextMenu } from '@/components/editor-context-menu';
import { createEditorSearchPanel, openEditorFind } from '@/lib/editor-search';
import { search } from '@codemirror/search';
import type { ActivityEntry, FileContent, ProjectDiagnostic } from '@/types';

// Grammars are lazy and shared with source outlines and validation.
export async function languageFor(path: string, text = ''): Promise<Extension | null> { return sourceGrammar(path, text); }


const undoKey = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘⌥Z' : 'Ctrl+Alt+Z';

export type { EditorTransfer };
export type EditorInspection = { path: string; revision: string; startLine: number; totalLines: number; content: string; truncated: boolean; line: number; column: number; canUndo: boolean; canRedo: boolean };
export type EditorHistory = { path: string; canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; format: (automatic?: boolean, valid?: () => boolean) => Promise<string | null>; text: () => string | null; snapshot: () => EditorTransfer | null; inspect: (start?: number, count?: number) => EditorInspection; agentEdit: (revision: string, oldText: string, newText: string) => void };

/** A real code editor (CodeMirror 6): multi-cursor, search, folding, bracket matching, undo history. */
export function CodeEditor({ project: documentProject, active = true, keepAlive = false, path, value, onChange, onSave, readOnly, line, column, wrap = false, onCursorChange, onToggleWrap, diagnostics = [], onDiagnostics, onNavigate, onHistoryChange, onChangeStats, followChanges = false, onReview, takeTransfer }: {
  takeTransfer?: () => EditorTransfer | null; active?: boolean; keepAlive?: boolean; onReview?: () => void; project?: string; onChangeStats?: (stats: { rel: string; added?: number; removed?: number; binary?: boolean } | null) => void; followChanges?: boolean; path: string; value: string; onChange?: (v: string) => void; onSave?: () => void; readOnly?: boolean; line?: number; column?: number; wrap?: boolean; onCursorChange?: (position: { line: number; column: number }) => void; onToggleWrap?: () => void; diagnostics?: ProjectDiagnostic[]; onDiagnostics?: (diagnostics: ProjectDiagnostic[]) => void; onNavigate?: () => void; onHistoryChange?: (history: EditorHistory | null) => void;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const latestScroll = React.useRef<EditorMemento['scroll']>(undefined);
  const parked = React.useRef<(EditorMemento & { path: string; workspace: string | null }) | null>(null);
  const [pendingEdit, setPendingEdit] = React.useState(0);
  const [composing, setComposing] = React.useState(false);
  const ro = React.useRef(new Compartment());
  const language = React.useRef(new Compartment());
  const wrapping = React.useRef(new Compartment());
  const cb = React.useRef({ onChange, onSave, onCursorChange, onToggleWrap, onDiagnostics, onNavigate, onHistoryChange, onChangeStats, onReview }); cb.current = { onChange, onSave, onCursorChange, onToggleWrap, onDiagnostics, onNavigate, onHistoryChange, onChangeStats, onReview };
  const [liveDiagnostics, setLiveDiagnostics] = React.useState<{ path: string; text: string; items: ProjectDiagnostic[] } | null>(null);
  // Agent-aware editing: who wrote each line (Alt+B toggles it), agent edits highlighted, a selection handed to an agent.
  const s = useStore(); const workspace = documentProject ?? s.workdir; const store = React.useRef(s); store.current = s;
  const hasServer = configuredLanguage(s.st?.settings.languageServers, path);
  const serverRevision = JSON.stringify(s.st?.settings.languageServers || []);
  const { owner: languageOwner, error: ownerError } = useLanguageOwner(s.hub, workspace, path, serverRevision, active && hasServer);
  const currentOwner = React.useRef(languageOwner); currentOwner.current = languageOwner;
  const isActive = React.useRef(active); isActive.current = active;
  const debug = useDebugger(workspace, active); const debugRef = React.useRef(debug); debugRef.current = debug;
  const toggleBreakpoint = React.useRef((line: number) => {});
  toggleBreakpoint.current = (line) => { const exists = debugRef.current.breakpoints.some((b) => b.rel === path && b.line === line); void store.current.hub.call('debugBreakpoint', workspace, path, line, !exists).catch((e) => toast.error(e.message)); };
  const [blameOn, setBlameOn] = React.useState(() => { try { return localStorage.getItem('tributary.blame') !== 'off'; } catch { return true; } });
  const [diskChanged, setDiskChanged] = React.useState(0);
  const [formatting, setFormatting] = React.useState(false);
  const serverCompletion = React.useRef(new Compartment());
  const formatBusy = React.useRef(false);
  const format = React.useRef<(automatic?: boolean, valid?: () => boolean) => Promise<string | null>>(async () => null);
  format.current = async (automatic = false, valid) => {
    const v = view.current; if (!v || readOnly || formatBusy.current || !(formatParser(path) || nativeFormatTool(path) || configuredLanguage(store.current.st?.settings.languageServers, path))) return null;
    const original = v.state.doc.toString(); formatBusy.current = true; setFormatting(true);
    try {
      const configured = configuredLanguage(store.current.st?.settings.languageServers, path);
      // Web languages use the bundled formatter consistently, even when an LSP
      // also offers whitespace edits that leave compact blocks on one line.
      const serverEdits = !formatParser(path) && configured && languageOwner ? await store.current.hub.call<LspEdit[] | null>('languageFormat', workspace, path, original, { tabSize: editorSpacing(path, original).tabSize, insertSpaces: !editorSpacing(path, original).useTabs }, languageOwner) : null;
      const text = serverEdits ? applyLspEdits(original, serverEdits) : formatParser(path) && store.current.hub.platform === 'mock' ? await formatInWorker(path, original) : await store.current.hub.call<string>('formatSource', workspace, path, original, automatic);
      if (view.current !== v || valid && !valid()) return null;
      if (v.state.doc.toString() !== original) { toast.message('Draft changed while formatting. Try again.'); return null; }
      const change = minimalChange(original, text);
      if (change) v.dispatch({ changes: change, annotations: [Transaction.userEvent.of('input.format'), isolateHistory.of('full')] });
      if (isActive.current) v.focus();
      return text;
    } catch (error) { if (view.current === v) toast.error('Could not format document', { description: (error as Error).message.slice(0, 220) }); return null; }
    finally { formatBusy.current = false; if (view.current === v) setFormatting(false); }
  };
  React.useEffect(() => {
    const run = (event: Event) => { const target = (event as CustomEvent).detail; if (target.project === workspace && target.path === path) void format.current(); };
    window.addEventListener('tributary:format-file', run); return () => window.removeEventListener('tributary:format-file', run);
  }, [workspace, path]);
  // Undo one agent's change: click its blame bar for a menu, or press Mod-Alt-Z on a line it wrote. The hub puts back
  // what that turn replaced there; the editor takes the new text like an agent edit, and Mod-Z brings the change back.
  const [picked, setPicked] = React.useState<BlamePick | null>(null);
  const refocus = React.useRef(true);
  const undo = React.useRef(async (_turn: BlameTurn, _line: number) => {});
  undo.current = async (turn, line) => {
    const v = view.current; const st = store.current; const project = documentProject ?? st.workdir; if (!v || !project || readOnly) return;
    const name = st.agentOf(turn.agent).name;
    setPendingEdit((count) => count + 1);
    try {
      // Line numbers and the text written back come from the saved file, so unsaved edits would be lost.
      const disk = await st.hub.call<FileContent>('readFile', project, path);
      if (disk.content !== v.state.doc.toString()) { toast.error('Save this file first', { description: `Undoing ${name}'s change works on the saved file.` }); return; }
      const r = await st.hub.call<{ text: string }>('revertTurnHunk', project, path, turn.messageId, line);
      if (view.current === v && applyRemoteText(v, r.text, undefined, true, isActive.current)) setDiskChanged((n) => n + 1);
      toast.success(`Undid ${name}'s change`, { description: `${undoKey.replace(/Alt\+|⌥/, '')} brings it back as an unsaved edit.` });
    } catch (e) {
      toast.error(`Couldn't undo ${name}'s change`, { description: String((e as Error).message).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') });
    } finally { setPendingEdit((count) => count - 1); }
  };

  const needsView = active || keepAlive || formatting || pendingEdit > 0 || composing;
  React.useEffect(() => {
    if (parked.current && (parked.current.path !== path || parked.current.workspace !== workspace)) parked.current = null;
    if (!needsView) return;
    let historyKey = ''; let revision = 0; const revisionOwner = crypto.randomUUID();
    const reportHistory = (v: EditorView) => {
      const canUndo = !v.state.readOnly && undoDepth(v.state) > 0;
      const canRedo = !v.state.readOnly && redoDepth(v.state) > 0;
      const key = `${canUndo}:${canRedo}`; if (key === historyKey) return; historyKey = key;
      const run = (command: typeof undoEdit) => { if (view.current === v && !v.state.readOnly) { command(v); v.focus(); } };
      cb.current.onHistoryChange?.({ path, canUndo, canRedo, undo: () => run(undoEdit), redo: () => run(redoEdit), format: (automatic, valid) => format.current(automatic, valid), text: () => (view.current?.state ?? parked.current?.state)?.doc.toString() ?? null,
        inspect: (start = 1, count = 200) => {
          if (view.current !== v) throw new Error('The editor is no longer active.');
          const doc = v.state.doc, from = doc.line(Math.min(start, doc.lines)).from, to = doc.line(Math.min(start + count - 1, doc.lines)).to;
          const head = v.state.selection.main.head, line = doc.lineAt(head);
          return { path, revision: `${revisionOwner}:${revision}`, startLine: Math.min(start, doc.lines), totalLines: doc.lines, content: doc.sliceString(from, Math.min(to, from + 12000)), truncated: from > 0 || to < doc.length || to - from > 12000, line: line.number, column: head - line.from + 1, canUndo: undoDepth(v.state) > 0, canRedo: redoDepth(v.state) > 0 };
        },
        agentEdit: (expected, oldText, newText) => {
          if (view.current !== v || v.state.readOnly || v.composing) throw new Error('The editor cannot be changed right now.');
          if (expected !== `${revisionOwner}:${revision}`) throw new Error('The editor changed. Read its current revision before editing.');
          const text = v.state.doc.toString(), from = text.indexOf(oldText);
          if (!oldText || from < 0 || text.indexOf(oldText, from + oldText.length) !== -1) throw new Error('old_text must match exactly one occurrence in the editor.');
          v.dispatch({ changes: { from, to: from + oldText.length, insert: newText }, annotations: [Transaction.userEvent.of('input.agent'), isolateHistory.of('full')] });
        }, snapshot: () => view.current === v ? captureEditorTransfer(v) : null });
    };
    const memento = parked.current;
    let transferred = memento ? null : takeTransfer?.();
    latestScroll.current = memento?.scroll;
    if (memento) updateEditorMemento(memento, { effects: [ro.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]), wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : [])] });
    // Clear this binding in cleanup: retained extension callbacks share its scope.
    // Keeping the old view in that closure would retain its destroyed DOM.
    let v: EditorView | null = new EditorView({
      parent: host.current!,
      scrollTo: memento?.scroll,
      state: memento?.state ?? restoreEditorTransfer(transferred, {
        doc: value,
        extensions: [
          basicSetup, search({ top: true, createPanel: createEditorSearchPanel }), theme, EditorState.tabSize.of(editorSpacing(path, value).tabSize), indentUnit.of(editorSpacing(path, value).indentUnit), Prec.high(lintGutter()), keymap.of(lintKeymap), syntaxHighlighting(highlight), keymap.of([indentWithTab, { key: 'Mod-h', mac: 'Mod-Alt-f', scope: 'editor search-panel', run: (editor) => openEditorFind(editor, true) }, { key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave?.(); return true; } }, { key: 'Alt-z', run: () => { if (!cb.current.onToggleWrap) return false; cb.current.onToggleWrap(); return true; } }]),
          EditorView.contentAttributes.of({ 'aria-label': `Edit ${path}`, tabindex: '0' }),
          ro.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          EditorView.updateListener.of((u) => {
            if (latestScroll.current && u.docChanged) for (const transaction of u.transactions) latestScroll.current = latestScroll.current?.map(transaction.changes);
            if (u.docChanged) ++revision;
            reportHistory(u.view);
            if (u.docChanged && u.transactions.some((transaction) => !transaction.annotation(Transaction.remote))) cb.current.onChange?.(u.state.doc.toString());
            if (u.selectionSet && u.transactions.some((transaction) => transaction.isUserEvent('select'))) cb.current.onNavigate?.();
            if (u.selectionSet || u.docChanged) { const head = u.state.selection.main.head; const current = u.state.doc.lineAt(head); cb.current.onCursorChange?.({ line: current.number, column: head - current.from + 1 }); }
          }),
          language.current.of([]),
          ...(documentLanguage(path) ? [autocompletion({ override: [languageCompletions(path)] })] : []),
          serverCompletion.current.of([]), agentFlash, changeGutter(() => { if (cb.current.onReview) cb.current.onReview(); else store.current.openReview(path); }),
          ...(/\.(?:[cm]?js|[cm]?ts)$/i.test(path) ? [Prec.highest(debugGutter((line) => toggleBreakpoint.current(line))), keymap.of([{ key: 'F9', run: (editor) => { toggleBreakpoint.current(editor.state.doc.lineAt(editor.state.selection.main.head).number); return true; } }])] : []),
          blameGutter((pick) => { const box = host.current!.getBoundingClientRect(); setPicked({ ...pick, x: pick.x - box.left, y: pick.y - box.top }); }),
          keymap.of([{ key: 'Shift-Alt-f', run: () => { void format.current(); return !readOnly && !!(formatParser(path) || nativeFormatTool(path) || configuredLanguage(store.current.st?.settings.languageServers, path)); } }, { key: 'Mod-Alt-z', run: (v) => { const head = v.state.selection.main.head; const turn = blameAt(v.state, head); if (!turn) return false; void undo.current(turn, v.state.doc.lineAt(head).number); return true; } }]),
          askAboutSelection(({ text, fromLine, toLine }) => {
            const st = store.current; const fence = path.split('.').pop() || '';
            st.setDraft(`${st.draft ? `${st.draft}\n` : ''}In @${workspace && workspace !== st.workdir ? `${workspace}/${path}` : path}:${fromLine}${toLine > fromLine ? `-${toLine}` : ''}:\n\`\`\`${fence}\n${text}\n\`\`\`\n`);
          }),
          keymap.of([{ key: 'Alt-b', run: () => { setBlameOn((on) => { try { localStorage.setItem('tributary.blame', on ? 'off' : 'on'); } catch { /* storage unavailable */ } return !on; }); return true; } }]),
        ],
      }),
    });
    view.current = v; parked.current = null;
    if (memento) restoreEditorMemento(v, memento);
    else if (transferred?.text === value) {
      const { top, left } = transferred;
      v.requestMeasure({ read: () => null, write: () => { if (v) { v.scrollDOM.scrollTop = top; v.scrollDOM.scrollLeft = left; } } });
    }
    transferred = null; // The handoff must not retain a second serialized undo stack.
    reportHistory(v);
    const head = v.state.selection.main.head; const row = v.state.doc.lineAt(head);
    cb.current.onCursorChange?.({ line: row.number, column: head - row.from + 1 });
    const rememberScroll = () => {
      const editor = view.current;
      if (editor && isActive.current && editor.dom.getBoundingClientRect().width) latestScroll.current = editor.scrollSnapshot();
    };
    v.scrollDOM.addEventListener('scroll', rememberScroll, { passive: true });
    const scrollFrame = requestAnimationFrame(rememberScroll);
    const startComposition = () => setComposing(true);
    // An ended composition in a hidden pane stays pinned until the pane returns.
    // The browser/CodeMirror can finish committing its DOM before any parking.
    const endComposition = () => { if (isActive.current) requestAnimationFrame(() => { if (v && view.current === v && !v.composing) setComposing(false); }); };
    v.contentDOM.addEventListener('compositionstart', startComposition);
    v.contentDOM.addEventListener('compositionend', endComposition);
    return () => {
      if (!v) return;
      v.contentDOM.removeEventListener('compositionstart', startComposition); v.contentDOM.removeEventListener('compositionend', endComposition);
      cancelAnimationFrame(scrollFrame); v.scrollDOM.removeEventListener('scroll', rememberScroll);
      const snapshot = captureEditorMemento(v);
      snapshot.scroll = latestScroll.current ?? snapshot.scroll;
      showBlame(v, null, store.current.agentOf); clearAgentFlash(v);
      v.dispatch({ effects: [language.current.reconfigure([]), serverCompletion.current.reconfigure([]), setFileChanges.of([]), debugLines.of({ lines: [], paused: null })] });
      v.dispatch(setDiagnostics(v.state, [])); snapshot.state = v.state;
      parked.current = { ...snapshot, path, workspace };
      v.destroy(); v = null; view.current = null; cb.current.onHistoryChange?.(null);
    };
    // A new path means a new document; the value is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, workspace, needsView]);

  React.useEffect(() => { if (active && view.current && !view.current.composing) setComposing(false); }, [active]);

  React.useEffect(() => { const editor = view.current; if (editor && workspace) editor.dispatch({ effects: serverCompletion.current.reconfigure(languageOwner ? autocompletion({ override: [serverCompletions(s.hub, workspace, path, languageOwner, () => currentOwner.current === languageOwner)] }) : []) }); }, [workspace, path, languageOwner, s.hub]);
  const [serverDiagnostics, setServerDiagnostics] = React.useState<{ text: string; items: ProjectDiagnostic[] } | null>(null);
  const [serverError, setServerError] = React.useState('');
  const currentText = React.useRef(value); currentText.current = value;
  React.useEffect(() => {
    if (!languageOwner || !workspace) { setServerDiagnostics(null); setServerError(''); return; }
    const off = s.hub.on('language-diagnostics', (event) => { if (event.project === workspace && event.rel === path && event.text === currentText.current) setServerDiagnostics({ text: event.text, items: event.diagnostics }); });
    return () => { if (typeof off === 'function') off(); };
  }, [workspace, path, languageOwner, s.hub]);
  React.useEffect(() => {
    if (!languageOwner || !workspace) return;
    let current = true;
    const timer = setTimeout(() => { s.hub.call<{ active: boolean; diagnostics: ProjectDiagnostic[] }>('languageDocument', workspace, path, value, languageOwner).then((result) => { if (current) { setServerDiagnostics({ text: value, items: result.diagnostics }); setServerError(''); } }).catch((error) => { if (current) setServerError(error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }); }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [workspace, path, value, languageOwner, s.hub]);

  const sourceId = sourceLanguage(path, value).id;
  React.useEffect(() => {
    const editor = view.current; if (!editor) return;
    return configureEditorGrammar(editor, language.current, active, () => languageFor(path, value));
  }, [path, workspace, sourceId, active]);

  React.useEffect(() => {
    if (active) return;
    const editor = view.current;
    if (editor) {
      showBlame(editor, null, store.current.agentOf); clearAgentFlash(editor);
      editor.dispatch({ effects: [setFileChanges.of([]), debugLines.of({ lines: [], paused: null })] });
      editor.dispatch(setDiagnostics(editor.state, []));
    }
    setLiveDiagnostics(null); setServerDiagnostics(null); setServerError('');
    if (picked) { refocus.current = false; setPicked(null); }
    cb.current.onDiagnostics?.([]); cb.current.onChangeStats?.(null);
  }, [active, workspace, path]);

  React.useEffect(() => {
    if (!active) return;
    const run = (event: Event) => { const v = view.current; if (!v?.hasFocus) return; const action = (event as CustomEvent).detail; if (action === 'find' || action === 'replace') openEditorFind(v, action === 'replace'); else if (action === 'undo') undoEdit(v); else if (action === 'redo') redoEdit(v); else if (action === 'selectAll') selectAll(v); else document.execCommand(action); };
    window.addEventListener('tributary:editor-command', run); return () => window.removeEventListener('tributary:editor-command', run);
  }, [active]);

  const debugKey = JSON.stringify([debug.breakpoints.filter((b) => b.rel === path).map((b) => b.line), debug.status, debug.frames.find((f) => f.id === debug.selectedFrame) || debug.frames[0]]);
  React.useEffect(() => { const v = view.current; if (!active || !v || !/\.(?:[cm]?js|[cm]?ts)$/i.test(path)) return; const frame = debug.frames.find((f) => f.id === debug.selectedFrame) || debug.frames[0]; v.dispatch({ effects: debugLines.of({ lines: debug.breakpoints.filter((b) => b.rel === path).map((b) => b.line), paused: debug.status === 'paused' && frame?.rel === path ? frame.line : null }) }); }, [debugKey, path, active]);

  // Replace the document when it changes from outside (reload after an agent edit).
  React.useEffect(() => {
    const v = view.current;
    if (!v) { if (parked.current && updateParkedText(parked.current, value)) { latestScroll.current = parked.current.scroll; setDiskChanged((n) => n + 1); } return; }
    // Only the changed part is replaced, so the cursor and scroll position stay put; the changed lines light up.
    const change = followChanges ? minimalChange(v.state.doc.toString(), value) : null;
    if (applyRemoteText(v, value, undefined, true, active)) {
      setDiskChanged((n) => n + 1);
      if (active && change) v.dispatch({ effects: EditorView.scrollIntoView(Math.min(value.length, change.from), { y: 'center' }) });
    }
  }, [value, followChanges]);
  React.useEffect(() => {
    const editor = view.current; if (!active || !editor || !workspace) return;
    let alive = true;
    const timer = setTimeout(() => {
      s.hub.call<string>('fileDiff', workspace, path).then((diff) => { if (alive && view.current === editor) { editor.dispatch({ effects: setFileChanges.of(editorDiffMarkers(diff)) }); cb.current.onChangeStats?.({ rel: path, ...editorDiffStats(diff) }); } }).catch(() => { if (alive && view.current === editor) { editor.dispatch({ effects: setFileChanges.of([]) }); cb.current.onChangeStats?.(null); } });
    }, 150);
    return () => { alive = false; clearTimeout(timer); };
  }, [workspace, path, diskChanged, s.git?.stat, s.git?.branch, s.hub, active]);
  React.useEffect(() => {
    let current = true;
    if (!active || readOnly || !(documentLanguage(path) || sourceSyntaxSupported(path, value))) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      liveValidation(path, value, controller.signal).then((items) => { if (current) { setLiveDiagnostics({ path, text: value, items }); } }).catch(() => { if (current) setLiveDiagnostics(null); });
    }, 300);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [path, value, readOnly, active]);
  const allDiagnostics = active ? [...diagnostics, ...(serverDiagnostics?.text === value ? serverDiagnostics.items : []), ...(liveDiagnostics?.path === path && liveDiagnostics.text === value ? liveDiagnostics.items : [])] : [];
  const diagnosticKey = JSON.stringify(allDiagnostics);
  React.useEffect(() => {
    const v = view.current; if (!v) return;
    cb.current.onDiagnostics?.(allDiagnostics);
    v.dispatch(setDiagnostics(v.state, allDiagnostics.map((d) => {
      const row = v.state.doc.line(Math.min(v.state.doc.lines, Math.max(1, d.line)));
      const from = Math.min(row.to, row.from + Math.max(0, d.column - 1));
      return { from, to: Math.min(v.state.doc.length, Math.max(from, Math.min(row.to, from + 1))), severity: d.severity, message: d.message, source: d.source || undefined };
    })));
    // Diagnostics are value data; equivalent arrays must not dispatch on every cursor update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticKey, path]);
  React.useEffect(() => { view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) }); }, [readOnly]);
  React.useEffect(() => { view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);
  React.useEffect(() => {
    const v = view.current; if (!v || !line) return;
    const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
    const at = Math.min(l.to, l.from + Math.max(0, (column || 1) - 1));
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) }); v.focus();
  }, [line, column, path]);

  // Agents changing this file in the project right now (not those working in their own copy).
  const [editing, setEditing] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!active) { setEditing((previous) => previous.length ? [] : previous); return; }
    let current = true;
    const pick = (all: ActivityEntry[]) => { if (current) setEditing([...new Set(all.filter((e) => (e.workdir || e.project) === workspace && (e.kind === 'turn' || e.kind === 'team'))
      .flatMap((e) => e.workers.filter((w) => w.state === 'working' && w.files.some((f) => f.rel === path)).map((w) => w.agent)))]); };
    s.hub.call<ActivityEntry[]>('activity').then(pick).catch(() => {});
    const off = s.hub.on('activity', pick);
    return () => { current = false; if (typeof off === 'function') off(); };
  }, [s.hub, workspace, path, active]);

  // Blame for this file, fetched when it opens, after it changes on disk, and when blame is switched on.
  React.useEffect(() => {
    const v = view.current; const project = workspace; if (!active || !v) return;
    if (!blameOn || !project) { showBlame(v, null, s.agentOf); return; }
    let alive = true;
    const timer = setTimeout(() => {
      s.hub.call<Blame>('lineAuthors', project, path).then((b) => { if (alive && view.current === v) showBlame(v, b, (id) => store.current.agentOf(id)); }).catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, blameOn, workspace, diskChanged, active]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <EditorContextMenu editor={view} project={workspace} path={path} languageOwner={languageOwner} format={() => void format.current()} canFormat={!!(formatParser(path) || nativeFormatTool(path) || hasServer)} hasServer={hasServer} wrap={wrap} toggleWrap={onToggleWrap}><div ref={host} className="h-full min-h-0" /></EditorContextMenu>
      {(serverError || ownerError) && <button type="button" className="absolute right-3 bottom-3 max-w-[calc(100%-24px)] truncate rounded border bg-popover px-2 py-1 text-left text-xs text-muted-foreground" title={serverError || ownerError} onClick={() => s.openSettings('language-tools')}>Language server unavailable · Settings</button>}
      {formatting && <span role="status" className="pointer-events-none absolute right-3 bottom-3 rounded bg-popover px-2 py-1 text-xs text-muted-foreground">Formatting…</span>}
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
