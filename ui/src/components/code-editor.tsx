import * as React from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { php } from '@codemirror/lang-php';

export function languageFor(path: string): Extension | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'mts': case 'cts': return javascript({ typescript: true });
    case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'py': case 'pyi': return python();
    case 'json': case 'jsonc': return json();
    case 'css': case 'scss': case 'less': return css();
    case 'html': case 'htm': case 'vue': case 'svelte': return html();
    case 'md': case 'mdx': case 'markdown': return markdown();
    case 'rs': return rust();
    case 'go': return go();
    case 'java': case 'kt': return java();
    case 'c': case 'h': case 'cc': case 'cpp': case 'hpp': case 'cxx': return cpp();
    case 'sql': return sql();
    case 'yml': case 'yaml': return yaml();
    case 'php': return php();
    default: return null;
  }
}

// Colors come from CSS variables, so the editor follows the app (and VS Code) theme.
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--card)', color: 'var(--foreground)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--foreground)', padding: '8px 0' },
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

/** A real code editor (CodeMirror 6): multi-cursor, search, folding, bracket matching, undo history. */
export function CodeEditor({ path, value, onChange, onSave, readOnly, line }: {
  path: string; value: string; onChange?: (v: string) => void; onSave?: () => void; readOnly?: boolean; line?: number;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const ro = React.useRef(new Compartment());
  const cb = React.useRef({ onChange, onSave }); cb.current = { onChange, onSave };

  React.useEffect(() => {
    const lang = languageFor(path);
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup, theme, syntaxHighlighting(highlight), keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave?.(); return true; } }]),
          ro.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange?.(u.state.doc.toString()); }),
          ...(lang ? [lang] : []),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // A new path means a new document; the value is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Replace the document when it changes from outside (reload after an agent edit).
  React.useEffect(() => {
    const v = view.current; if (!v) return;
    if (v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);
  React.useEffect(() => { view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) }); }, [readOnly]);
  React.useEffect(() => {
    const v = view.current; if (!v || !line) return;
    const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
    v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) }); v.focus();
  }, [line, path]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
