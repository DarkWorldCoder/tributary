import * as React from 'react';
import { keyboardDevice, keyboardPlatform, readShortcutPreferences, SHORTCUT_STORAGE, type ShortcutPreferences } from '../../../core/shortcuts.mjs';
const eventName = 'tributary:shortcuts';
let raw: string | null | undefined; let cached = readShortcutPreferences();
function snapshot() {
  let next: string | null = null; try { next = localStorage.getItem(SHORTCUT_STORAGE); } catch { /* storage may be unavailable in a host */ }
  if (next !== raw) { raw = next; cached = readShortcutPreferences(); }
  return cached;
}
function subscribe(fn: () => void) {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === SHORTCUT_STORAGE) fn(); };
  window.addEventListener(eventName, fn); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(eventName, fn); window.removeEventListener('storage', storage); };
}
export function useShortcutPreferences() {
  const preferences = React.useSyncExternalStore(subscribe, snapshot);
  // The installed app's OS wins over browser hints and any old saved manual selection.
  const os = window.hub?.os || (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform + ' ' + navigator.userAgent;
  const platform = keyboardPlatform(os); const device = keyboardDevice(os);
  const update = (next: ShortcutPreferences) => {
    localStorage.setItem(SHORTCUT_STORAGE, JSON.stringify({ ...next, platform: 'auto' })); window.dispatchEvent(new Event(eventName));
  };
  return { preferences, platform, device, overrides: preferences.profiles[platform], update };
}
