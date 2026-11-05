import { folderChains } from './workbench-navigation.mjs';
const EMPTY = []; const EMPTY_CHAINS = new Map();
const same = (left, right) => !!left && left.length === right.length && left.every((value, index) => value === right[index]);
function buildTree(files) {
  const root = { name: '', path: '', dir: true, children: [] };
  for (const file of files) {
    let current = root; const parts = file.split('/');
    parts.forEach((name, index) => {
      const dir = index < parts.length - 1; const path = parts.slice(0, index + 1).join('/');
      let node = current.children.find((child) => child.name === name && child.dir === dir);
      if (!node) { node = { name, path, dir, children: [] }; current.children.push(node); }
      current = node;
    });
  }
  const sort = node => { node.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)); node.children.forEach(sort); };
  sort(root); return root.children;
}

// Stable ownership indirection matters: old UI callbacks can keep a render scope
// alive. They retain this cell, whose large contents can still be released.
export function createExplorerIndex() {
  let epoch = 0, list = 0, search = 0, files = null, matches = EMPTY, selection = null, chains = null;
  const valid = (token, sequence) => token.epoch === epoch && token.sequence === sequence;
  return {
    get files() { return files; },
    get shown() { return selection?.shown || EMPTY; },
    get tree() { return selection?.tree || EMPTY; },
    get chains() { return chains?.value || EMPTY_CHAINS; },
    beginList() { return { epoch, sequence: ++list }; },
    acceptFiles(token, next) {
      if (!valid(token, list) || same(files, next)) return false;
      files = next; selection = null; chains = null; return true;
    },
    beginSearch() { const changed = matches.length > 0; matches = EMPTY; if (changed) selection = null; return { token: { epoch, sequence: ++search }, changed }; },
    acceptMatches(token, next) {
      if (!valid(token, search) || same(matches, next)) return false;
      matches = next; selection = null; return true;
    },
    derive(filter, hidden, compact, warm) {
      if (!warm) { selection = null; chains = null; return; }
      if (!compact || !files) chains = null;
      else if (chains?.source !== files) chains = { source: files, value: folderChains(files) };
      const query = filter.trim().toLowerCase();
      if (selection?.query === query && selection.hidden === hidden && selection.files === files && selection.matches === matches) return;
      const shown = query ? [...new Set([...(files || EMPTY), ...matches])].filter(file => file.toLowerCase().includes(query) && (hidden || !file.split('/').some(part => part.startsWith('.')))).slice(0, 2000) : EMPTY;
      selection = { files, matches, query, hidden, shown, tree: query ? buildTree(shown) : EMPTY };
    },
    release() { epoch++; files = null; matches = EMPTY; selection = null; chains = null; },
  };
}
