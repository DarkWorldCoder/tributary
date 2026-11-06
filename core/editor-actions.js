'use strict';
const fs = require('node:fs/promises'); const { projectPath } = require('./files'); const { editorSettings } = require('./editor-settings');
const { formatProjectResult, supportsProjectFormat } = require('./project-format');
const ESLINT_FORMATTER = 'dbaeumer.vscode-eslint';
async function preserveEol(root, rel, text) {
  const handle = await fs.open(await projectPath(root, rel), 'r'); const buffer = Buffer.allocUnsafe(64 * 1024);
  let eol = '\n', previous = -1;
  try {
    for (let position = 0; position < 1024 * 1024;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position); if (!bytesRead) break;
      const at = buffer.subarray(0, bytesRead).indexOf(10);
      if (at >= 0) { if ((at ? buffer[at - 1] : previous) === 13) eol = '\r\n'; break; }
      previous = buffer[bytesRead - 1]; position += bytesRead;
    }
  } finally { await handle.close(); }
  return eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
}
async function editorAction(root, rel, text, { automatic = false, formatOnSave = true, trusted = false, skipFormat = false, fix }) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024 || text.includes('\0')) throw Error('Edit text files up to 1 MB.');
  let config; const warnings = [];
  try { config = await editorSettings(root, rel); }
  catch (error) { if (!automatic) throw error; return { text: await preserveEol(root, rel, text), warnings: [error.message] }; }
  let output = text; let fixed = false, formatted = false;
  const shouldFormat = !skipFormat && (!automatic || (config.formatOnSave ?? formatOnSave));
  const applyFixes = async () => {
    if (!trusted) throw Error('Trust this project before loading its ESLint library and plugins.');
    if (!config.eslint.enabled) throw Error('ESLint is disabled for this file in .vscode/settings.json.');
    if (!config.eslint.library) throw Error('Install ESLint in this project from Settings → Language tools.');
    const result = await fix(output); if (result.output != null) output = result.output; fixed = true;
  };
  try {
    if (automatic && config.eslint.enabled && config.eslint.fixOnSave) await applyFixes();
  } catch (error) { warnings.push(error.message); }
  if (shouldFormat && (!automatic || trusted)) {
    try {
      if (config.defaultFormatter === ESLINT_FORMATTER) {
        if (!config.eslint.format) throw Error('Enable eslint.format.enable to use ESLint as the document formatter.');
        if (!fixed) await applyFixes();
      } else {
        if (config.defaultFormatter && config.defaultFormatter !== 'esbenp.prettier-vscode') throw Error(`The selected formatter (${config.defaultFormatter}) is not available here. Choose an available formatter in project settings.`);
        if (supportsProjectFormat(rel)) {
          const result = await formatProjectResult(root, rel, output, trusted);
          if (result.status === 'error' || result.status === 'unsupported') { if (!automatic || result.status === 'error') throw Error(result.message || 'No formatter available.'); }
          else if (result.status !== 'ignored') { output = result.text ?? output; formatted = true; }
        } else if (!automatic) throw Error('No formatter is available for this file.');
      }
    } catch (error) { if (!automatic) throw error; warnings.push(error.message); }
  }
  // A formatter owns its requested EOL. Plain saves and ESLint-only fixes keep
  // the file's existing EOL, even though CodeMirror stores normalized LF text.
  return { text: formatted ? output : await preserveEol(root, rel, output), warnings };
}
module.exports = { editorAction, preserveEol };
