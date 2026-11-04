import * as React from 'react';
import { useStore } from '@/store';
import { sourceLanguage } from '@/lib/source-language.mjs';
export interface ExtensionPack { id: string; name: string; publisher: string; version: string; hasRuntime: boolean; themes: { id: string; label: string; dark: boolean }[]; iconThemes: { id: string; label: string }[] }
type Associations = { file?: string; folder?: string; folderExpanded?: string; rootFolder?: string; rootFolderExpanded?: string; fileNames?: Record<string, string>; fileExtensions?: Record<string, string>; folderNames?: Record<string, string>; folderNamesExpanded?: Record<string, string>; languageIds?: Record<string, string> };
interface Icons { id: string; definitions: Record<string, { image?: string; char?: string; font?: string; color?: string }>; fonts: { id: string; data: string }[]; associations: Associations; light: Associations; highContrast: Associations }
interface Appearance { theme: { id: string; dark: boolean; colors: Record<string, string>; tokenColors: { scope?: string | string[]; foreground: string }[] } | null; icons: Icons | null }
const Context = React.createContext<{ icons: Icons | null; light: boolean; fonts: Record<string, string> }>({ icons: null, light: false, fonts: {} });
const COLOR_KEYS: Record<string, string[]> = {
  '--background': ['editor.background'], '--card': ['editor.background'], '--popover': ['editorWidget.background', 'editor.background'], '--popover-foreground': ['editorWidget.foreground', 'editor.foreground'], '--foreground': ['editor.foreground'], '--muted-foreground': ['descriptionForeground', 'editorLineNumber.foreground'], '--muted': ['editor.lineHighlightBackground', 'sideBar.background'], '--border': ['panel.border', 'editorWidget.border'], '--accent': ['list.activeSelectionBackground'], '--accent-foreground': ['list.activeSelectionForeground', 'editor.foreground'], '--brand': ['focusBorder', 'button.background'], '--success': ['gitDecoration.addedResourceForeground', 'diffEditor.insertedLineBackground'], '--destructive': ['gitDecoration.deletedResourceForeground', 'errorForeground'], '--sidebar': ['sideBar.background', 'editor.background'], '--sidebar-foreground': ['sideBar.foreground', 'editor.foreground'], '--sidebar-border': ['sideBar.border', 'panel.border'], '--input': ['input.background'], '--ring': ['focusBorder'],
};
const SCOPE_KEYS: Record<string, string[]> = { '--syn-keyword': ['keyword', 'storage'], '--syn-string': ['string'], '--syn-number': ['constant.numeric', 'constant.language'], '--syn-comment': ['comment'], '--syn-function': ['entity.name.function', 'support.function'], '--syn-type': ['entity.name.type', 'support.type', 'entity.name.class'], '--syn-property': ['variable.other.property', 'support.type.property-name'] };
export function ExtensionAppearance({ children }: { children: React.ReactNode }) {
  const s = useStore(); const themeId = String(s.st?.settings.extensionTheme || ''); const iconsId = String(s.st?.settings.extensionIcons || '');
  const [appearance, setAppearance] = React.useState<Appearance>({ theme: null, icons: null });
  const [light, setLight] = React.useState(!document.documentElement.classList.contains('dark'));
  const [fonts, setFonts] = React.useState<Record<string, string>>({});
  React.useEffect(() => { if (s.hub.platform !== 'desktop') return; let current = true; s.hub.call<Appearance>('extensionAppearance', themeId, iconsId).then((value) => { if (current) setAppearance(value); }).catch(() => { if (current) setAppearance({ theme: null, icons: null }); }); return () => { current = false; }; }, [s.hub, themeId, iconsId, s.st?.settings.extensionRevision]);
  React.useEffect(() => { const root = document.documentElement; const update = () => setLight(!root.classList.contains('dark')); const observer = new MutationObserver(update); observer.observe(root, { attributes: true, attributeFilter: ['class'] }); return () => observer.disconnect(); }, []);
  React.useEffect(() => {
    const root = document.documentElement; const theme = appearance.theme;
    if (!theme) return;
    const variables: Record<string, string> = {};
    for (const [key, candidates] of Object.entries(COLOR_KEYS)) { const color = candidates.map((name) => theme.colors[name]).find(Boolean); if (color) variables[key] = color; }
    for (const [key, scopes] of Object.entries(SCOPE_KEYS)) { const rule = [...theme.tokenColors].reverse().find((rule) => (Array.isArray(rule.scope) ? rule.scope : typeof rule.scope === 'string' ? rule.scope.split(',') : []).some((scope) => scopes.some((prefix) => scope.trim().startsWith(prefix)))); if (rule) variables[key] = rule.foreground; }
    const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, root.style.getPropertyValue(key)]));
    for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
    root.dataset.extensionTheme = theme.id;
    const style = document.createElement('style'); style.textContent = `:root[data-extension-theme] .app-frame, :root[data-extension-theme] .app-frame .workspace-surface { ${Object.entries(variables).map(([key, value]) => `${key}:${value}`).join(';')} }`; document.head.append(style);
    return () => { style.remove(); delete root.dataset.extensionTheme; for (const [key, value] of Object.entries(previous)) value ? root.style.setProperty(key, value) : root.style.removeProperty(key); };
  }, [appearance.theme]);
  React.useEffect(() => {
    const loaded: FontFace[] = []; const names: Record<string, string> = {}; let current = true;
    for (const [index, font] of (appearance.icons?.fonts || []).entries()) { const name = `tributary_pack_${index}_${appearance.icons!.id.replace(/\W/g, '_')}`; names[font.id] = name; const face = new FontFace(name, `url(${font.data})`); loaded.push(face); face.load().then(() => { if (current) document.fonts.add(face); }).catch(() => {}); }
    setFonts(names); return () => { current = false; for (const font of loaded) document.fonts.delete(font); };
  }, [appearance.icons]);
  const context = React.useMemo(() => ({ icons: appearance.icons, light, fonts }), [appearance.icons, light, fonts]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function usePackIcon(path: string, folder = false, open = false, className?: string) {
  const { icons, light, fonts } = React.useContext(Context);
  if (!icons) return null;
  const associations = { ...icons.associations, ...(light ? icons.light : {}) }; const name = path.replaceAll('\\', '/').split('/').pop()?.toLowerCase() || '';
  let id: string | undefined;
  if (folder) id = open ? associations.folderNamesExpanded?.[name] || associations.folderExpanded : associations.folderNames?.[name] || associations.folder;
  else { const language = sourceLanguage(path).id; const extensions = name.split('.').slice(1).map((_, index, parts) => parts.slice(index).join('.')); id = associations.fileNames?.[name] || extensions.map((ext) => associations.fileExtensions?.[ext]).find(Boolean) || associations.languageIds?.[language === 'tsx' ? 'typescriptreact' : language === 'jsx' ? 'javascriptreact' : language] || associations.file; }
  const definition = id ? icons.definitions[id] : undefined; if (!definition) return null;
  if (definition.image) return <img src={definition.image} alt="" aria-hidden="true" className={`size-4 shrink-0 object-contain ${className || ''}`} />;
  if (definition.char && fonts[definition.font || '']) return <span aria-hidden="true" className={`inline-flex size-4 shrink-0 items-center justify-center text-base leading-none ${className || ''}`} style={{ fontFamily: fonts[definition.font!], color: definition.color }}>{definition.char}</span>;
  return null;
}
