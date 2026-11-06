import { sourceLanguage } from './source-language.mjs';
import { editorSpacing } from './editor-spacing.mjs';
const PARSERS = { js: 'babel', jsx: 'babel', mjs: 'babel', cjs: 'babel', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', json: 'json', jsonc: 'jsonc', json5: 'json5', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', vue: 'vue', md: 'markdown', markdown: 'markdown', mdx: 'mdx', yaml: 'yaml', yml: 'yaml', graphql: 'graphql', gql: 'graphql' };
export const formatParser = (path, text = '') => { const language = sourceLanguage(path, text).id; return language === 'jsonc' ? 'jsonc' : PARSERS[String(path).split('.').pop().toLowerCase()] ?? ({ yaml: 'yaml', json: 'json', markdown: 'markdown' }[language] || null); };
export async function formatDocument(path, text) {
  const parser = formatParser(path, text);
  if (!parser) throw new Error('Formatting is not available for this file type.');
  const prettier = await import('prettier/standalone');
  const plugins = [];
  if (['babel', 'typescript', 'json', 'jsonc', 'json5', 'vue', 'markdown', 'mdx', 'html'].includes(parser)) {
    plugins.push(...await Promise.all([import('prettier/plugins/babel'), import('prettier/plugins/estree'), import('prettier/plugins/typescript')]));
  }
  if (['html', 'vue', 'markdown', 'mdx'].includes(parser)) plugins.push(await import('prettier/plugins/html'));
  if (['css', 'scss', 'less', 'vue', 'html', 'markdown', 'mdx'].includes(parser)) plugins.push(await import('prettier/plugins/postcss'));
  if (['markdown', 'mdx'].includes(parser)) plugins.push(await import('prettier/plugins/markdown'));
  if (['yaml', 'markdown', 'mdx'].includes(parser)) plugins.push(await import('prettier/plugins/yaml'));
  if (parser === 'graphql') plugins.push(await import('prettier/plugins/graphql'));
  return prettier.format(text, { parser, plugins, useTabs: editorSpacing(path, text).useTabs, tabWidth: editorSpacing(path, text).tabSize, endOfLine: 'auto', embeddedLanguageFormatting: 'off' });
}

export const nativeFormatTool = (path) => ({ sh: 'shfmt', bash: 'shfmt', bats: 'shfmt', lua: 'StyLua', luau: 'StyLua', toml: 'Taplo', go: 'gofmt', rs: 'rustfmt', py: 'Ruff or Black', pyi: 'Ruff or Black', c: 'clang-format', h: 'clang-format', cc: 'clang-format', cpp: 'clang-format', cxx: 'clang-format', hh: 'clang-format', hpp: 'clang-format', hxx: 'clang-format', java: 'clang-format', cs: 'clang-format', m: 'clang-format', mm: 'clang-format', zig: 'zig fmt' }[String(path).split('.').pop().toLowerCase()] || null);

/** A small, bounded hint; only the real parser/formatter may change source. */
// LF is absent from each old per-line input. Exclude it explicitly here so the
// whole-prefix regex cannot join a multi-line try/catch into a compact line.
const compactTry = /\btry[^\S\n]*\{.+\}[^\S\n]*catch\b/;
const compactStatements = /;[^;]+;/;
export function formattingHint(path, text) {
  const sample = text.slice(0, 128 * 1024);
  for (let start = 0;;) {
    const newline = sample.indexOf('\n', start), end = newline < 0 ? sample.length : newline;
    if (end - start > 300) return 'Long lines';
    if (newline < 0) break;
    start = newline + 1;
  }
  const parser = formatParser(path, text);
  if (parser !== 'babel' && parser !== 'typescript') return null;
  if (compactTry.test(sample)) return 'Compact code';
  for (let start = 0;;) {
    const newline = sample.indexOf('\n', start), end = newline < 0 ? sample.length : newline;
    if (end - start > 100 && compactStatements.test(sample.slice(start, end))) return 'Compact code';
    if (newline < 0) break;
    start = newline + 1;
  }
  return null;
}
