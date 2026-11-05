export type DocumentDraft = { title: string; content: string; saved: { title: string; content: string } };
export function documentDirty(entry: DocumentDraft | undefined): boolean;
export function retainDocumentDrafts<T extends DocumentDraft>(entries: Record<string, T>, activeKey: string): Record<string, T>;
