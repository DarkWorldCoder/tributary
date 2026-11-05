'use strict';

const compare = (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Retain the smallest offset + limit entries, with the largest at the root.
// The stream still visits every entry so totals and pagination remain exact.
async function directoryPage(source, { showHidden, offset, limit }) {
  const capacity = offset + limit;
  const heap = [];
  let scanned = 0;
  let total = 0;
  const accept = (entry) => {
    if (++scanned > 100000) throw new Error('This folder is too large to list. Open a smaller folder in your external editor.');
    if (!showHidden && entry.name.startsWith('.')) return;
    total++;
    if (heap.length < capacity) {
      let at = heap.length;
      heap.push(entry);
      while (at) {
        const parent = (at - 1) >> 1;
        if (compare(heap[parent], entry) >= 0) break;
        heap[at] = heap[parent];
        at = parent;
      }
      heap[at] = entry;
    } else if (compare(entry, heap[0]) < 0) {
      let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) > 0) child++;
        if (compare(entry, heap[child]) >= 0) break;
        heap[at] = heap[child];
        at = child;
      }
      heap[at] = entry;
    }
  };
  if (typeof source.read === 'function') {
    let failed = false;
    try {
      // Dir.read(callback) reuses one callback for buffered entries instead of
      // creating an async-iterator/promise chain for every directory entry.
      await new Promise((resolve, reject) => {
        const next = (error, entry) => {
          if (error) { reject(error); return; }
          if (!entry) { resolve(); return; }
          try { accept(entry); source.read(next); } catch (cause) { reject(cause); }
        };
        source.read(next);
      });
    } catch (error) { failed = true; throw error; }
    finally { try { await source.close(); } catch (error) { if (!failed) throw error; } }
  } else {
    for await (const entry of source) accept(entry);
  }
  heap.sort(compare);
  return { entries: heap.slice(offset), total, next: offset + limit < total ? offset + limit : null };
}
module.exports = { directoryPage, compareDirectoryEntries: compare };
