export type TreeViewport = { top: number; left: number; anchor: { project: string; path: string; offset: number } | null };
export function captureTreeViewport(element: HTMLElement): TreeViewport;
export function restoreTreeViewport(element: HTMLElement, saved: TreeViewport): void;
