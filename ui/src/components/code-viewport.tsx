import * as React from 'react';
import { Compartment, EditorSelection, EditorState, type StateEffect } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { getSearchQuery, openSearchPanel, SearchQuery, search, searchKeymap, searchPanelOpen, setSearchQuery } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { editorTheme, editorHighlight } from '@/lib/editor-appearance';
import { configureEditorGrammar } from '@/lib/editor-grammar.mjs';
import { sourceGrammar } from '@/lib/source-grammar.mjs';
import { codeLanguageFile, detachedCodeText, codeHasInteraction } from '@/lib/code-viewport.mjs';
import { minimalChange } from '@/lib/text-change.mjs';
import { createEditorSearchPanel } from '@/lib/editor-search';

type Memento = { selection: ReturnType<EditorSelection['toJSON']>; scroll?: StateEffect<unknown>; query: { search: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean; literal: boolean }; find: boolean; findSelection?: { start: number | null; end: number | null } };
const grammarLoader = (file: string) => () => sourceGrammar(file);
const viewerTheme = EditorView.theme({
  '&': { height: '28rem', maxHeight: '28rem', fontSize: 'inherit', backgroundColor: 'transparent' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.625' },
  '.cm-content': { padding: '10px 0' }, '.cm-line': { padding: '0 10px' },
  '.cm-gutters': { backgroundColor: 'transparent' },
});

// This stable owner stores only values while parked. Mount's temporary scope
// is never captured by a registered React cleanup or the grammar loader.
function createViewerOwner() {
  let view: EditorView | null = null, text: string | null = null, cancelGrammar: (() => void) | null = null;
  let memento: Memento | null = null;
  const remember = () => {
    if (!view) return;
    const query = getSearchQuery(view.state);
    const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="search"]');
    memento = { selection: view.state.selection.toJSON(), scroll: view.inView || !memento ? view.scrollSnapshot() : memento.scroll, find: searchPanelOpen(view.state), query: { search: query.search, caseSensitive: query.caseSensitive, regexp: query.regexp, wholeWord: query.wholeWord, literal: query.literal }, findSelection: field ? { start: field.selectionStart, end: field.selectionEnd } : undefined };
  };
  return {
    mount(parent: HTMLElement, code: string, language: string, wrap: boolean, numbered: boolean) {
      if (view) return;
      const priorFocus = parent.ownerDocument.activeElement;
      const grammar = new Compartment();
      const extensions = [EditorState.readOnly.of(true), EditorState.lineSeparator.of('\n'), EditorView.editable.of(false), editorTheme, viewerTheme, syntaxHighlighting(editorHighlight), grammar.of([]),
        keymap.of([...searchKeymap, ...defaultKeymap]), search({ top: true, createPanel: createEditorSearchPanel }),
        EditorView.contentAttributes.of({ 'aria-label': `Code preview: ${language}`, 'aria-readonly': 'true', tabindex: '0' }),
        ...(wrap ? [EditorView.lineWrapping] : []), ...(numbered ? [lineNumbers()] : [])];
      const selection = memento && EditorSelection.fromJSON(memento.selection);
      view = new EditorView({ parent, state: EditorState.create({ doc: code, extensions,
        ...(selection && selection.ranges.every(r => r.to <= code.length) ? { selection } : {}) }), scrollTo: memento?.scroll });
      text = code;
      if (memento) { if (memento.find) openSearchPanel(view); view.dispatch({ effects: setSearchQuery.of(new SearchQuery(memento.query)) }); }
      if (memento?.findSelection) { const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="search"]'); if (field && memento.findSelection.start !== null && memento.findSelection.end !== null) field.setSelectionRange(memento.findSelection.start, memento.findSelection.end); }
      // Reappearing during a scroll must not pull focus into a restored Find box.
      if (priorFocus !== parent && view.dom.contains(parent.ownerDocument.activeElement)) {
        (parent.ownerDocument.activeElement as HTMLElement)?.blur();
        if (priorFocus instanceof HTMLElement) priorFocus.focus({ preventScroll: true });
      }
      cancelGrammar = configureEditorGrammar(view, grammar, true, grammarLoader(codeLanguageFile(language)));
      view.scrollDOM.addEventListener('scroll', remember, { passive: true });
    },
    update(code: string) {
      if (!view || code === text) return;
      const change = text !== null && code.startsWith(text) ? { from: text.length, to: text.length, insert: code.slice(text.length) } : minimalChange(view.state.doc.toString(), code);
      if (change) { change.insert = detachedCodeText(change.insert); view.dispatch({ changes: change }); }
      text = code;
    },
    focus() { view?.focus(); },
    park() {
      if (!view) return;
      remember(); cancelGrammar?.(); cancelGrammar = null;
      view.scrollDOM.removeEventListener('scroll', remember); view.destroy(); view = null; text = null;
    },
  };
}

/** Large read-only code with viewport rendering; never starts LSP/debug/filesystem work. */
export default function CodeViewport({ code, language, wrap = false, lineNumbers: numbered = false, inactive = false }: { code: string; language: string; wrap?: boolean; lineNumbers?: boolean; inactive?: boolean }) {
  const host = React.useRef<HTMLDivElement>(null), owner = React.useRef<ReturnType<typeof createViewerOwner> | null>(null);
  if (!owner.current) owner.current = createViewerOwner();
  const [visible, setVisible] = React.useState(false), [pinned, setPinned] = React.useState(false);
  const active = !inactive && (visible || pinned);
  React.useEffect(() => {
    const target = host.current; if (!target) return;
    let alive = true;
    const pin = () => {
      if (!alive) return;
      setPinned(codeHasInteraction(target));
    };
    const blur = () => queueMicrotask(pin);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' }); observer.observe(target);
    target.addEventListener('focusin', pin); target.addEventListener('focusout', blur); target.ownerDocument.addEventListener('selectionchange', pin);
    return () => { alive = false; observer.disconnect(); target.removeEventListener('focusin', pin); target.removeEventListener('focusout', blur); target.ownerDocument.removeEventListener('selectionchange', pin); };
  }, []);
  React.useEffect(() => {
    const target = host.current; if (!active || !target) return;
    const owned = owner.current!; owned.mount(target, code, language, wrap, numbered);
    if (document.activeElement === target) owned.focus();
    return () => owned.park();
    // Text updates are incremental; they do not recreate the viewer.
  }, [active, language, wrap, numbered]);
  React.useEffect(() => { owner.current?.update(code); }, [code]);
  return <div ref={host} className="code-viewport h-112 min-w-0 text-inherit outline-none" tabIndex={active ? -1 : 0} aria-label={active ? undefined : `Code preview: ${language}`} />;
}
