export type ShortcutAction = 'new' | 'search' | 'attention' | 'focus' | 'sidebar' | 'workspace' | 'files' | 'changes' | 'memory' | 'preview' | 'terminal' | 'settings' | 'help';
export const SHORTCUTS: { id: ShortcutAction; label: string; group: string; keys: string[]; aliases?: string[][] }[];
export function shortcutAction(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'repeat'>): ShortcutAction | null;
