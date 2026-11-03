// File references in terminal output: compiler errors (src/a.ts:12:4, a.tsx(7,3)), stack traces, git status.
// Plain JavaScript so node:test can check it without a build step.

const EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'mdx', 'py', 'rs', 'go', 'java', 'kt', 'rb', 'php', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs',
  'swift', 'm', 'css', 'scss', 'less', 'html', 'vue', 'svelte', 'yml', 'yaml', 'toml', 'ini', 'sh', 'bash', 'zsh', 'sql', 'txt', 'xml', 'lock', 'env', 'gradle', 'dart', 'lua', 'ex', 'exs', 'zig']);

// A path (optionally ./, ../, / or ~/ first), then :line:col or (line,col).
const LINK = /(?:~\/|\.{1,2}\/|\/)?[\w@+-][\w.@+-]*(?:\/[\w.@+-]+)*(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))?/g;

export function findFileLinks(text) {
  const out = [];
  for (const m of text.matchAll(LINK)) {
    const start = m.index;
    if (/[\w:/.-]$/.test(text.slice(0, start)) || text.slice(start - 3, start) === '://') continue; // inside a URL or a longer word
    let [match] = m;
    const lineNo = m[1] ?? m[3]; const colNo = m[2] ?? m[4];
    const suffix = m[1] != null ? `:${m[1]}${m[2] != null ? `:${m[2]}` : ''}` : m[3] != null ? `(${m[3]},${m[4]})` : '';
    let file = match.slice(0, match.length - suffix.length).replace(/[.,]+$/, '');
    if (!suffix) match = file;
    const base = file.split('/').pop();
    const ext = /\.([A-Za-z][\w]{0,9})$/.exec(base)?.[1]?.toLowerCase();
    const known = ext && EXTENSIONS.has(ext);
    // A bare word needs a known extension; with a directory it still needs some extension, so prose and versions stay plain.
    if (!known && !(file.includes('/') && ext)) continue;
    if (/^\d/.test(base) && !known) continue;
    out.push({ start, end: start + match.length, path: file, line: lineNo != null ? Number(lineNo) : undefined, col: colNo != null ? Number(colNo) : undefined });
  }
  return out;
}

function normalize(parts) {
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') { if (!out.length) return null; out.pop(); } else out.push(p);
  }
  return out;
}

// The path relative to the project, or null when it points outside it.
export function projectRelative(project, file) {
  if (file.startsWith('~')) return null;
  const root = normalize(project.split('/'));
  if (file.startsWith('/')) {
    const abs = normalize(file.split('/'));
    if (!abs || !root || abs.length <= root.length || root.some((p, i) => abs[i] !== p)) return null;
    return abs.slice(root.length).join('/');
  }
  const rel = normalize(file.split('/'));
  return rel && rel.length ? rel.join('/') : null;
}
