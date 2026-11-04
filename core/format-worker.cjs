'use strict';
// Runs separately: project config/plugins never block the app's event loop.
const fs = require('node:fs'); const path = require('node:path');
const bundledPrettier = require('prettier');
const { formatSource } = require('./format-source');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; if (Buffer.byteLength(input) > 10 * 1024 * 1024) process.exit(1); });
process.stdin.on('end', async () => {
  try {
    const { root, files, trusted } = JSON.parse(input); process.chdir(root);
    let prettier = bundledPrettier;
    if (trusted) { try { const local = require.resolve('prettier', { paths: [root] }); const rel = path.relative(root, local); if (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) prettier = require(local); } catch {} }
    const results = []; const sources = new Set();
    const ignorePath = ['.gitignore', '.prettierignore'].map((name) => path.join(root, name)).filter((file) => fs.existsSync(file));
    for (const file of files) {
      try {
        const filename = path.join(root, file.rel);
        let ancestor = path.dirname(filename);
        while (ancestor === root || ancestor.startsWith(root + path.sep)) {
          for (const name of ['.editorconfig', '.clang-format', '_clang-format', 'rustfmt.toml', '.rustfmt.toml', 'pyproject.toml', 'ruff.toml', '.ruff.toml', 'stylua.toml', '.stylua.toml', 'taplo.toml', '.taplo.toml']) { const config = path.join(ancestor, name); if (fs.existsSync(config)) sources.add(config); }
          if (ancestor === root) break; ancestor = path.dirname(ancestor);
        }
        const info = await prettier.getFileInfo(filename, { ignorePath, resolveConfig: false });
        if (info.ignored) { results.push({ rel: file.rel, status: 'ignored' }); continue; }
        if (!info.inferredParser) {
          try { results.push({ rel: file.rel, text: await formatSource(root, file.rel, file.text, { respectConfig: trusted }) }); }
          catch (error) { results.push({ rel: file.rel, status: /No formatter|Install /.test(error.message) ? 'unsupported' : 'error', message: error.message }); }
          continue;
        }
        const configFile = await prettier.resolveConfigFile(filename);
        if (configFile) {
          const real = fs.realpathSync(configFile); const relative = path.relative(root, real);
          if (!trusted && (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative))) throw new Error('Trust this project to use inherited formatting config.');
          sources.add(real);
          if (!trusted) throw new Error('Trust this project to load its formatting config.');
        }
        const options = await prettier.resolveConfig(filename, { editorconfig: true, useCache: false }) || {};
        if (!trusted && (options.plugins?.length || typeof options.parser === 'function')) throw new Error('Trust this project to use its formatting plugins.');
        let directory = path.dirname(filename);
        while (directory === root || directory.startsWith(root + path.sep)) {
          const editorconfig = path.join(directory, '.editorconfig'); if (fs.existsSync(editorconfig)) sources.add(editorconfig);
          if (directory === root) break; directory = path.dirname(directory);
        }
        let baseline = file.text;
        try { if (fs.statSync(filename).size <= 1024 * 1024) baseline = fs.readFileSync(filename, 'utf8'); } catch {}
        const indent = /^( +|\t+)\S/m.exec(baseline)?.[1] || '';
        const quoteSample = baseline.slice(0, 128 * 1024).match(/'[^'\n]*'|"[^"\n]*"/g) || [];
        const single = quoteSample.filter((quote) => quote.startsWith("'")).length;
        const statementLines = baseline.split(/\r?\n/).filter((line) => /^\s*(?:const|let|var|return|throw|import|export)\b/.test(line));
        const semi = !statementLines.length || statementLines.filter((line) => /;\s*$/.test(line)).length >= statementLines.length / 2;
        const inferred = configFile ? {} : { useTabs: indent.startsWith('\t'), tabWidth: indent.length === 4 ? 4 : 2, singleQuote: single > quoteSample.length / 2, semi,
          jsxSingleQuote: /[\w:-]+='[^']*'/.test(baseline) && !/[\w:-]+="[^"]*"/.test(baseline), trailingComma: /,\s*\r?\n\s*\)/.test(baseline) ? 'all' : /,\s*\r?\n\s*[}\]]/.test(baseline) ? 'es5' : 'none' };
        const text = await prettier.format(file.text, { filepath: filename, endOfLine: baseline.includes('\r\n') ? 'crlf' : 'lf', ...inferred, ...options });
        results.push({ rel: file.rel, text });
      } catch (error) { results.push({ rel: file.rel, status: 'error', message: String(error.message).slice(0, 300) }); }
    }
    for (const file of ignorePath) sources.add(file);
    process.stdout.write('\nTRIBUTARY_FORMAT_RESULT:' + JSON.stringify({ results, sources: [...sources] }));
  } catch (error) { process.stderr.write(String(error.message).slice(0, 500)); process.exitCode = 1; }
});
