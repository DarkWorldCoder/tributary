// A saved document can be fetched again. Only the visible document and unsaved
// drafts need to remain in the panel's cache after changing selection.
export const documentDirty = (entry) => !!entry && (entry.title !== entry.saved.title || entry.content !== entry.saved.content);

export function retainDocumentDrafts(entries, activeKey) {
  let retained = entries;
  for (const [key, entry] of Object.entries(entries)) {
    if (key === activeKey || documentDirty(entry)) continue;
    if (retained === entries) retained = { ...entries };
    delete retained[key];
  }
  return retained;
}
