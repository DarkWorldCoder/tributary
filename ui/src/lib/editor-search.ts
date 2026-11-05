import type { EditorView, Panel, ViewUpdate } from '@codemirror/view';
import { runScopeHandlers } from '@codemirror/view';
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, setSearchQuery } from '@codemirror/search';

// Layout follows VS Code's MIT-licensed findWidget: toggle, Find + options,
// match count, navigation, close, and a separately expanded Replace row.
// Commands and history remain owned by CodeMirror; no parallel document model.
export function createEditorSearchPanel(view: EditorView): Panel {
  const doc = view.dom.ownerDocument;
  const el = (tag: string, className: string) => { const node = doc.createElement(tag); node.className = className; return node; };
  const dom = el('div', 'cm-search cm-vscode-search');
  dom.setAttribute('role', 'search'); dom.setAttribute('aria-label', 'Find / Replace');
  const field = (name: string, label: string) => {
    const input = doc.createElement('input'); input.name = name; input.placeholder = label;
    input.setAttribute('aria-label', label); input.autocomplete = 'off'; input.spellcheck = false;
    input.addEventListener('input', commit); return input;
  };
  const button = (name: string, label: string, text: string, run: () => void) => {
    const node = doc.createElement('button'); node.type = 'button'; node.name = name;
    node.title = label; node.setAttribute('aria-label', label); node.textContent = text;
    node.addEventListener('click', run); return node;
  };
  const searchField = field('search', 'Find'); searchField.setAttribute('main-field', 'true');
  const replaceField = field('replace', 'Replace');
  const count = el('span', 'cm-find-count'); count.setAttribute('aria-live', 'polite');
  const findBox = el('div', 'cm-find-input'); findBox.append(searchField);
  const options: Record<string, HTMLButtonElement> = {};
  for (const [key, label, text] of [['caseSensitive', 'Match Case', 'Aa'], ['wholeWord', 'Match Whole Word', 'ab'], ['regexp', 'Use Regular Expression', '.*']]) {
    const toggle = button(key, label, text, () => { toggle.setAttribute('aria-pressed', String(toggle.getAttribute('aria-pressed') !== 'true')); commit(); });
    toggle.setAttribute('aria-pressed', 'false'); options[key] = toggle; findBox.append(toggle);
  }
  const row = el('div', 'cm-find-row');
  const replaceRow = el('div', 'cm-replace-row'); replaceRow.hidden = true;
  const expand = button('toggle-replace', 'Toggle Replace', '›', () => {
    replaceRow.hidden = !replaceRow.hidden; expand.setAttribute('aria-expanded', String(!replaceRow.hidden)); expand.textContent = replaceRow.hidden ? '›' : '⌄';
  });
  expand.setAttribute('aria-expanded', 'false'); expand.disabled = view.state.readOnly;
  const previous = button('prev', 'Previous Match (Shift+Enter)', '↑', () => { findPrevious(view); });
  const next = button('next', 'Next Match (Enter)', '↓', () => { findNext(view); });
  const close = button('close', 'Close (Escape)', '×', () => { closeSearchPanel(view); view.focus(); });
  row.append(findBox, count, previous, next, close);
  const replaceBox = el('div', 'cm-find-input'); replaceBox.append(replaceField);
  replaceRow.append(replaceBox, button('replace', 'Replace (Enter)', 'Replace', () => { replaceNext(view); }), button('replaceAll', 'Replace All', 'All', () => { replaceAll(view); }));
  dom.append(expand, row, replaceRow);
  let query = getSearchQuery(view.state);
  function commit() {
    const next = new SearchQuery({ search: searchField.value, replace: replaceField.value, literal: true,
      caseSensitive: options.caseSensitive.getAttribute('aria-pressed') === 'true',
      wholeWord: options.wholeWord.getAttribute('aria-pressed') === 'true', regexp: options.regexp.getAttribute('aria-pressed') === 'true' });
    if (!next.eq(query)) view.dispatch({ effects: setSearchQuery.of(next) });
  }
  function sync() {
    query = getSearchQuery(view.state);
    if (searchField.value !== query.search) searchField.value = query.search;
    if (replaceField.value !== query.replace) replaceField.value = query.replace;
    for (const key of ['caseSensitive', 'wholeWord', 'regexp'] as const) options[key].setAttribute('aria-pressed', String(query[key]));
    searchField.setAttribute('aria-invalid', String(!!query.search && !query.valid));
    // Bound counting work for very common matches; navigation still searches the entire file.
    let total = 0; let current = 0; let limited = false;
    if (query.valid && query.search) {
      const cursor = query.getCursor(view.state); const selection = view.state.selection.main;
      for (let item = cursor.next(); !item.done; item = cursor.next()) {
        if (++total > 1000) { limited = true; total = 1000; break; }
        if (item.value.from === selection.from && item.value.to === selection.to) current = total;
      }
    }
    count.textContent = !query.search ? '' : !query.valid ? 'Invalid regex' : !total ? 'No results' : `${current || '–'} of ${total}${limited ? '+' : ''}`;
    count.title = limited ? 'Counting limited to 1,000 matches; navigation searches the whole file.' : count.textContent;
    previous.disabled = next.disabled = !query.valid || !total;
    replaceRow.querySelectorAll('button').forEach((node) => { node.disabled = view.state.readOnly || !query.valid || !total; });
  }
  dom.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeSearchPanel(view); view.focus(); }
    else if (event.key === 'Enter' && event.target === searchField) { event.preventDefault(); (event.shiftKey ? findPrevious : findNext)(view); }
    else if (event.key === 'Enter' && event.target === replaceField) { event.preventDefault(); replaceNext(view); }
    else if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault();
    if (event.defaultPrevented) event.stopPropagation();
  });
  sync();
  return { dom, top: true, mount() { searchField.select(); }, update(update: ViewUpdate) { if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))) sync(); } };
}

export function openEditorFind(view: EditorView, replace = false) {
  openSearchPanel(view);
  if (replace && !view.state.readOnly) {
    const panel = view.dom.querySelector('.cm-vscode-search');
    const toggle = panel?.querySelector<HTMLButtonElement>('[name="toggle-replace"]');
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
    panel?.querySelector<HTMLInputElement>('[name="replace"]')?.focus();
  }
  return true;
}
