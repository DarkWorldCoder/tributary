import { getLanguageService as jsonService } from 'vscode-json-languageservice';
import { getCSSLanguageService, getSCSSLanguageService, getLESSLanguageService } from 'vscode-css-languageservice';
import { getLanguageService as htmlService } from 'vscode-html-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { DOCUMENT_LIMIT, documentLanguage } from './document-language-support.mjs';
export { DOCUMENT_LIMIT, documentLanguage };
// Parsing only: no filesystem provider, remote schemas, project plugins or code execution.
const json = jsonService({ schemaRequestService: () => Promise.reject(new Error('Remote schemas are disabled.')) });
const css = { css: getCSSLanguageService(), scss: getSCSSLanguageService(), less: getLESSLanguageService() };
const html = htmlService();
const stringMap = { type: 'object', additionalProperties: { type: 'string' } };
const packageSchema = { type: 'object', properties: {
  name: { type: 'string' }, version: { type: 'string' }, private: { type: 'boolean' },
  scripts: stringMap, dependencies: stringMap, devDependencies: stringMap, peerDependencies: stringMap,
  description: { type: 'string' }, type: { enum: ['module', 'commonjs'] }, engines: stringMap,
} };
json.configure({ validate: true, allowComments: false, schemas: [{ uri: 'tributary://schemas/package', fileMatch: ['*/package.json'], schema: packageSchema }] });
const cache = new Map();
function document(path, text) {
  const language = documentLanguage(path); if (!language || text.length > DOCUMENT_LIMIT) return null;
  const previous = cache.get(path); if (previous?.text === text) return previous;
  const doc = TextDocument.create(`file:///workspace/${path.split('/').map(encodeURIComponent).join('/')}`, language, 1, text);
  const service = language === 'json' || language === 'jsonc' ? json : language === 'html' ? html : css[language];
  const parsed = service === json ? json.parseJSONDocument(doc) : service === html ? html.parseHTMLDocument(doc) : service.parseStylesheet(doc);
  const value = { language, text, doc, service, parsed }; cache.delete(path); cache.set(path, value);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return value;
}
export async function validateDocument(path, text) {
  const value = document(path, text); if (!value || value.service === html) return [];
  const { doc, service, parsed, language } = value;
  const jsonc = language === 'jsonc' || /(^|\/)tsconfig(?:\.[^/]+)?\.json$/i.test(path);
  const diagnostics = service === json
    ? await json.doValidation(doc, parsed, { comments: jsonc ? 'ignore' : 'error', trailingCommas: jsonc ? 'ignore' : 'error', schemaRequest: 'ignore' }, path.split('/').pop() === 'package.json' ? packageSchema : undefined)
    : service.doValidation(doc, parsed);
  return diagnostics.slice(0, 500).map((d) => ({ rel: path, line: d.range.start.line + 1, column: d.range.start.character + 1,
    severity: d.severity === 2 ? 'warning' : d.severity > 2 ? 'info' : 'error', message: d.message,
    source: service === json ? 'JSON' : language.toUpperCase() }));
}
const plainSnippet = (text) => text.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\|([^,|}]+)[^}]*\}/g, '$1').replace(/\$\{\d+\}|\$\d+/g, '').replace(/\\([\\$}])/g, '$1');
export async function completeDocument(path, text, offset) {
  const value = document(path, text); if (!value) return [];
  const { doc, service, parsed } = value;
  const list = await service.doComplete(doc, doc.positionAt(Math.max(0, Math.min(text.length, offset))), parsed);
  return (list?.items || []).slice(0, 1000).filter((item) => !item.additionalTextEdits?.length).map((item) => {
    const edit = item.textEdit; const range = edit?.range || edit?.replace;
    const insert = edit?.newText ?? item.insertText ?? item.label;
    return { label: item.label, detail: item.detail || '', type: item.kind === 10 ? 'property' : item.kind === 9 ? 'namespace' : item.kind === 12 ? 'value' : 'keyword',
      text: item.insertTextFormat === 2 ? plainSnippet(insert) : insert,
      from: range ? doc.offsetAt(range.start) : offset, to: range ? doc.offsetAt(range.end) : offset };
  });
}

export async function outlineDocument(path, text) {
  const value = document(path, text); if (!value) return [];
  const { doc, service, parsed } = value;
  const symbols = service.findDocumentSymbols2 ? service.findDocumentSymbols2(doc, parsed) : service.findDocumentSymbols(doc, parsed);
  const result = [];
  const visit = (items, depth = 0) => { for (const item of items) {
    if (result.length >= 300) break;
    const range = item.selectionRange || item.range || item.location?.range; if (!range) continue;
    result.push({ name: item.name, kind: 'symbol', line: range.start.line + 1, column: range.start.character + 1, depth });
    if (item.children) visit(item.children, depth + 1);
  } };
  visit(await symbols); return result;
}
