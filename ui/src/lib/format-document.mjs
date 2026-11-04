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
export function formattingHint(path, text) {
  const lines = text.slice(0, 128 * 1024).split('\n');
  if (lines.some((line) => line.length > 300)) return 'Long lines';
  const parser = formatParser(path, text);
  if (['babel', 'typescript'].includes(parser) && lines.some((line) =>
    /\btry\s*\{.+\}\s*catch\b/.test(line) || line.length > 100 && /;[^;]+;/.test(line))) return 'Compact code';
  return null;
}
