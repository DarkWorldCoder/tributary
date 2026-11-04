export interface PreviewTab { id: string; history: string[]; index: number }
export function newPreviewTab(id: string, address?: string): PreviewTab;
export function previewAddress(tab: PreviewTab): string;
export function navigatePreview(tab: PreviewTab, input: string): PreviewTab | null;
export function movePreview(tab: PreviewTab, direction: number): PreviewTab;
export function previewTitle(tab: PreviewTab): string;
