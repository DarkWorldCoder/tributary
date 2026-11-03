export const SHORTCUTS = [
  { id: 'new', label: 'New chat', group: 'Chat', keys: ['Mod', 'Shift', 'O'], aliases: [['Mod', 'N']] },
  { id: 'search', label: 'Search chats and commands', group: 'Chat', keys: ['Mod', 'K'] },
  { id: 'focus', label: 'Focus message', group: 'Chat', keys: ['Shift', 'Escape'] },
  { id: 'sidebar', label: 'Toggle sidebar', group: 'Navigation', keys: ['Mod', 'B'], aliases: [['Mod', 'Shift', 'S']] },
  { id: 'workspace', label: 'Toggle workspace', group: 'Navigation', keys: ['Mod', 'J'] },
  { id: 'files', label: 'Open files', group: 'Navigation', keys: ['Mod', 'Shift', 'E'] },
  { id: 'changes', label: 'Open changes', group: 'Navigation', keys: ['Mod', 'Shift', 'D'] },
  { id: 'memory', label: 'Open project memory', group: 'Navigation', keys: ['Mod', 'Shift', 'M'] },
  { id: 'preview', label: 'Open preview', group: 'Navigation', keys: ['Mod', 'Shift', 'P'] },
  { id: 'terminal', label: 'Toggle terminal', group: 'Navigation', keys: ['Mod', '`'] },
  { id: 'settings', label: 'Open settings', group: 'App', keys: ['Mod', ','] },
  { id: 'help', label: 'Keyboard shortcuts', group: 'App', keys: ['Mod', '/'] },
];

export function shortcutAction(event) {
  if (event.isComposing || event.repeat || event.altKey) return null;
  for (const item of SHORTCUTS) {
    for (const binding of [item.keys, ...(item.aliases || [])]) {
      if (!!(event.ctrlKey || event.metaKey) !== binding.includes('Mod') || !!event.shiftKey !== binding.includes('Shift')) continue;
      if (event.key.toLowerCase() === binding.at(-1).toLowerCase()) return item.id;
    }
  }
  return null;
}
