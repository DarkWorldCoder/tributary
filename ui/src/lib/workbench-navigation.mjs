// UI-only navigation rules; never execute project code or accept external file paths.
export function recentFiles(paths, history = [], active = null) {
  const open = new Set(paths);
  return [...new Set([active, ...history, ...paths])].filter((path) => path && open.has(path));
}
export function folderChains(files) {
  const children = new Map();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const parent = parts.slice(0, i + 1).join('/'); const child = parts.slice(0, i + 2).join('/');
      if (!children.has(parent)) children.set(parent, new Map());
      children.get(parent).set(child, i + 2 < parts.length);
    }
  }
  const chains = new Map();
  for (const [parent] of children) {
    const chain = [parent]; let current = parent;
    while (chain.length < 8) {
      const entries = children.get(current); if (entries?.size !== 1) break;
      const [[child, directory]] = entries; if (!directory) break;
      chain.push(child); current = child;
    }
    if (chain.length > 1) chains.set(parent, chain);
  }
  return chains;
}
export function followedFile(thread, root) {
  const message = thread?.messages?.findLast((m) => m.role === 'assistant');
  if (!message || message.ok != null || !root) return null;
  const clean = (value) => {
    if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) return null;
    const base = root.replace(/\\/g, '/').replace(/\/$/, ''); let rel = value.replace(/\\/g, '/');
    if (rel.startsWith(`${base}/`)) rel = rel.slice(base.length + 1);
    if (rel.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(rel) || rel.split('/').some((p) => p === '..')) return null;
    return rel.replace(/^\.\//, '') || null;
  };
  const tools = message.tools || [];
  for (let i = tools.length - 1; i >= 0; i--) {
    const tool = tools[i]; if (/directory|list|glob|search/i.test(tool.name)) continue;
    const input = tool.input || {};
    const candidate = /read|edit|write|patch|file|view/i.test(tool.name) ? input.file_path ?? input.filePath ?? input.filepath ?? input.abs_path ?? input.path : null;
    const rel = clean(candidate) || (tool.files || []).map(clean).find(Boolean);
    if (rel) return { rel, key: `${message.id}:${tool.id || i}:${tool.status || ''}:${rel}` };
  }
  const file = [...(message.files || [])].reverse().find((f) => !f.external && clean(f.rel));
  return file ? { rel: clean(file.rel), key: `${message.id}:file:${file.rel}` } : null;
}
