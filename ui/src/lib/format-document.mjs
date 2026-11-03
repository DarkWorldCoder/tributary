const PARSERS = { js: 'babel', jsx: 'babel', mjs: 'babel', cjs: 'babel', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', json: 'json', jsonc: 'jsonc', json5: 'json5', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', vue: 'vue', md: 'markdown', markdown: 'markdown', mdx: 'mdx', yaml: 'yaml', yml: 'yaml', graphql: 'graphql', gql: 'graphql' };
export const formatParser = (path) => PARSERS[String(path).split('.').pop().toLowerCase()] ?? null;
export async function formatDocument(path, text) {
  const parser = formatParser(path);
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
  return prettier.format(text, { parser, plugins, endOfLine: 'auto', embeddedLanguageFormatting: 'off' });
}
