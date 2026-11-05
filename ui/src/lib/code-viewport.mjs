import { SOURCE_LANGUAGES } from './source-language.mjs';
const aliases = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', shellscript: 'shell', md: 'markdown', yml: 'yaml', env: 'dotenv', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', rs: 'rust' };
export function codeLanguageFile(language) {
  const id = String(language || '').toLowerCase(), profile = SOURCE_LANGUAGES.find(p => p.id === (aliases[id] || id) || p.extensions.includes(id));
  return profile ? `snippet.${profile.extensions[0]}` : 'snippet.txt';
}
export function supportsCodeViewport(language) { return !['ansi', 'diff', 'patch'].includes(language.toLowerCase()); }
export function shouldWindowCode(code, language) {
  // ANSI keeps its existing color/escape parser. This viewer handles source
  // text; changing terminal control-sequence semantics is a separate change.
  if (!supportsCodeViewport(language)) return false;
  if (code.length > 100000) return true;
  let start = 0;
  for (let line = 0; line < 1000; line++) { start = code.indexOf('\n', start); if (start < 0) return false; start++; }
  return true;
}
export function codeHasInteraction(element) {
  const document = element.ownerDocument;
  if (element.contains(document.activeElement)) return true;
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed) for (let n = 0; n < selection.rangeCount; n++) {
    try { if (selection.getRangeAt(n).intersectsNode(element)) return true; } catch { /* detached native range */ }
  }
  return false;
}
// Appended slices must not keep every previous streaming snapshot alive through
// a rope's line strings. Copy UTF-16 code units without normalizing lone surrogates.
export function detachedCodeText(text) {
  const blocks = [];
  for (let start = 0; start < text.length; start += 16384) {
    const units = new Uint16Array(Math.min(16384, text.length - start));
    for (let n = 0; n < units.length; n++) units[n] = text.charCodeAt(start + n);
    blocks.push(String.fromCharCode(...units));
  }
  return blocks.join('');
}
