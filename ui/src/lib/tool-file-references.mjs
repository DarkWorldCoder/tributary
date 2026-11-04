import { findFileLinks, projectRelative } from './terminal-links.mjs';

// Resolve reference data only; paths never become commands. The host validates
// containment and symlinks again when the user opens a document.
export function toolFileReferences(tool, root) {
  if (!root) return [];
  const base = root.replaceAll('\\', '/').replace(/\/$/, '');
  const refs = []; const seen = new Set();
  const add = (value, line, column) => {
    if (typeof value !== 'string' || !value || /[\0\r\n*?<>]/.test(value)) return;
    let file = value.replaceAll('\\', '/');
    if (file.startsWith('file://')) {
      try { const url = new URL(file); if (url.hostname && url.hostname !== 'localhost') return; file = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, '$1'); } catch { return; }
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(file) && !/^[a-z]:\//i.test(file)) return;
    if (/^[a-z]:\//i.test(file)) {
      if (!file.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return;
      file = file.slice(base.length + 1);
    }
    const rel = projectRelative(base, file); if (!rel || seen.has(rel)) return;
    const positive = (n) => Number.isSafeInteger(Number(n)) && Number(n) > 0 ? Number(n) : undefined;
    seen.add(rel); refs.push({ rel, line: positive(line), column: positive(column) });
  };
  const input = tool.input || {};
  if (!/directory|glob|list/i.test(tool.name)) {
    for (const key of ['file_path', 'filePath', 'filepath', 'abs_path', 'path', 'Path', 'filename', 'fileName', 'file', 'target_file', 'targetFile', 'TargetFile', 'absolute_path', 'uri']) add(input[key], input.line ?? input.offset ?? input.start_line, input.column);
    for (const change of Array.isArray(input.changes) ? input.changes : []) add(change.path ?? change.file_path);
  }
  for (const file of tool.files || []) add(file);
  const rawCommand = input.command ?? input.cmd;
  const command = Array.isArray(rawCommand) ? rawCommand.join(' ') : rawCommand;
  if (/^(shell|bash|run_shell_command|exec|terminal)$/i.test(tool.name) && typeof command === 'string') for (const link of findFileLinks(command)) add(link.path, link.line, link.col);
  return refs.slice(0, 8);
}
