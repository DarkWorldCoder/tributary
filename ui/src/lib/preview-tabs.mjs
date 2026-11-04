import { localPreviewUrl } from './project-profile.mjs';
export const newPreviewTab = (id, address = '') => ({ id, history: address && localPreviewUrl(address) ? [localPreviewUrl(address)] : [], index: address && localPreviewUrl(address) ? 0 : -1 });
export const previewAddress = (tab) => tab?.history[tab.index] || '';
export function navigatePreview(tab, input) {
  const address = localPreviewUrl(input.trim()); if (!address) return null;
  if (previewAddress(tab) === address) return tab;
  const history = [...tab.history.slice(0, tab.index + 1), address].slice(-50);
  return { ...tab, history, index: history.length - 1 };
}
export function movePreview(tab, direction) { return { ...tab, index: Math.max(-1, Math.min(tab.history.length - 1, tab.index + direction)) }; }
export function previewTitle(tab) { const address = previewAddress(tab); if (!address) return 'New tab'; const url = new URL(address); return url.host + (url.pathname === '/' ? '' : url.pathname); }
