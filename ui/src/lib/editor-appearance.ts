import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Colors come from CSS variables, so the editor follows the app (and VS Code) theme.
export const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--card)', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '22px' },
  '.cm-content': { caretColor: 'var(--foreground)', padding: '8px 0' },
  '.cm-line': { padding: '0 12px 0 8px' },
  '.cm-lineNumbers .cm-gutterElement': { fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '0 8px 0 12px', minWidth: '32px' },
  '.cm-gutter-lint': { width: '14px' },
  '.cm-gutter-lint .cm-gutterElement': { width: '14px', padding: '0 1px' },
  '.cm-lint-marker': { width: '12px', height: '12px' },
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
export const editorHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: t.special(t.variableName), color: 'var(--syn-type)' },
  { tag: [t.tagName, t.heading], color: 'var(--syn-tag)', fontWeight: '600' },
  { tag: [t.operator, t.punctuation], color: 'var(--syn-operator, var(--foreground))' },
  { tag: [t.definition(t.variableName)], color: 'var(--foreground)' },
  { tag: t.link, color: 'var(--brand)', textDecoration: 'underline' },
]);
