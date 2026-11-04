export const SHORTCUTS = [
  { id: 'new', label: 'New chat', group: 'Chat', keys: ['Mod', 'Shift', 'O'], aliases: [['Mod', 'N']] },
  { id: 'search', label: 'Search chats and commands', group: 'Chat', keys: ['Mod', 'K'] },
  { id: 'attention', label: 'Next chat that needs you', group: 'Chat', keys: ['Mod', 'Shift', 'J'] },
  { id: 'focus', label: 'Focus message', group: 'Chat', keys: ['Shift', 'Escape'] },
  { id: 'sidebar', label: 'Toggle sidebar', group: 'Navigation', keys: ['Mod', 'B'], aliases: [['Mod', 'Shift', 'S']] },
  { id: 'workspace', label: 'Toggle workspace', group: 'Navigation', keys: ['Mod', 'J'] },
  { id: 'zoom-workspace', label: 'Focus / Restore workspace', group: 'Navigation', keys: ['Mod', 'Shift', 'Enter'] },
  { id: 'files', label: 'Open files', group: 'Navigation', keys: ['Mod', 'Shift', 'E'] },
  { id: 'changes', label: 'Open changes', group: 'Navigation', keys: ['Mod', 'Shift', 'D'] },
  { id: 'memory', label: 'Open project memory', group: 'Navigation', keys: ['Mod', 'Shift', 'M'] },
  { id: 'preview', label: 'Open preview', group: 'Navigation', keys: ['Mod', 'Shift', 'P'] },
  { id: 'debug', label: 'Toggle debugger', group: 'Navigation', keys: ['Mod', 'Alt', 'D'] },
  { id: 'terminal', label: 'Toggle terminal', group: 'Navigation', keys: ['Mod', '`'] },
  { id: 'recent', label: 'Open recent files and folders', group: 'Navigation', keys: ['Mod', 'Alt', 'O'] },
  { id: 'team', label: 'Start agent team', group: 'Agents', keys: ['Mod', 'Alt', 'T'] },
  { id: 'room', label: 'Open project room', group: 'Agents', keys: ['Mod', 'Alt', 'R'] },
  { id: 'activity', label: 'Live activity', group: 'Agents', keys: ['Mod', 'Alt', 'A'] },
  { id: 'fullscreen', label: 'Toggle full screen', group: 'App', keys: ['Mod', 'Alt', 'Enter'] },
  { id: 'settings', label: 'Open settings', group: 'App', keys: ['Mod', ','] },
  { id: 'help', label: 'Keyboard shortcuts', group: 'App', keys: ['Mod', '/'] },
];

export const SHORTCUT_STORAGE = 'tributary.shortcuts.v1';
export function keyboardPlatform(platform = '') { return /Mac|iPhone|iPad/i.test(platform) ? 'mac' : 'pc'; }
export function validBinding(keys) {
  if (!Array.isArray(keys) || keys.length < 2 || keys.length > 4 || new Set(keys).size !== keys.length) return false;
  const key = keys.at(-1);
  return keys.slice(0, -1).every((k) => ['Mod', 'Alt', 'Shift'].includes(k)) &&
    (keys.includes('Mod') || (keys.includes('Alt') && /^F[1-9][0-2]?$/.test(key)) || (keys.includes('Shift') && key === 'Escape')) &&
    typeof key === 'string' && (/^[a-z0-9`,./;=\[\]\\-]$/i.test(key) || /^(Escape|Enter|Space|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-2]))$/.test(key));
}
const signature = (keys) => keys.map((k) => k.toLowerCase()).sort().join('+');
export function shortcutBindings(overrides = {}) {
  return SHORTCUTS.map((item) => {
    const custom = overrides[item.id];
    return Array.isArray(custom) && (!custom.length || validBinding(custom)) ? { ...item, keys: custom, aliases: [] } : item;
  });
}
export function bindingConflict(id, keys, overrides = {}) {
  if (!keys.length) return null;
  const sig = signature(keys);
  return shortcutBindings(overrides).find((item) => item.id !== id && [item.keys, ...(item.aliases || [])].some((binding) => signature(binding) === sig)) || null;
}
export function readShortcutPreferences(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(SHORTCUT_STORAGE) || '{}');
    const profiles = {};
    for (const platform of ['mac', 'pc']) {
      profiles[platform] = {};
      for (const item of SHORTCUTS) {
        const keys = value.profiles?.[platform]?.[item.id];
        if (Array.isArray(keys) && (!keys.length || validBinding(keys))) profiles[platform][item.id] = keys;
      }
    }
    return { platform: ['auto', 'mac', 'pc'].includes(value.platform) ? value.platform : 'auto', send: value.send === 'mod-enter' ? 'mod-enter' : 'enter', profiles };
  } catch { return { platform: 'auto', send: 'enter', profiles: { mac: {}, pc: {} } }; }
}
export function bindingFromEvent(event, platform) {
  if (event.isComposing || event.repeat || event.getModifierState?.('AltGraph') || ['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return null;
  if (platform === 'mac' ? event.ctrlKey : event.metaKey) return null;
  let key = event.altKey && /^Key[A-Z]$/.test(event.code || '') ? event.code.slice(3) : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (key === ' ') key = 'Space';
  const keys = [...((platform === 'mac' ? event.metaKey : event.ctrlKey) ? ['Mod'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key];
  return validBinding(keys) ? keys : null;
}
export function shortcutAction(event, options = {}) {
  if (event.isComposing || event.repeat || event.getModifierState?.('AltGraph')) return null;
  if (options.platform && (options.platform === 'mac' ? event.ctrlKey : event.metaKey)) return null;
  const mod = options.platform === 'mac' ? event.metaKey : options.platform === 'pc' ? event.ctrlKey : event.ctrlKey || event.metaKey;
  for (const item of shortcutBindings(options.overrides)) {
    for (const binding of [item.keys, ...(item.aliases || [])]) {
      if (!binding.length || !!mod !== binding.includes('Mod') || !!event.shiftKey !== binding.includes('Shift') || !!event.altKey !== binding.includes('Alt')) continue;
      const key = event.altKey && /^Key[A-Z]$/.test(event.code || '') ? event.code.slice(3) : event.key === ' ' ? 'Space' : event.key;
      if (key.toLowerCase() === binding.at(-1).toLowerCase()) return item.id;
    }
  }
  return null;
}
