'use strict';
// One view of the skills every agent can see, and sharing a skill with all agents via symlinks.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Where each agent looks for skills. ~/.agents/skills is the shared open-standard folder.
function skillDirs({ home = os.homedir(), project } = {}) {
  const dirs = [
    { dir: path.join(home, '.claude', 'skills'), agents: ['claude'], scope: 'user' },
    { dir: path.join(home, '.codex', 'skills'), agents: ['codex'], scope: 'user' },
    { dir: path.join(home, '.agents', 'skills'), agents: ['codex', 'antigravity'], scope: 'user' },
    { dir: path.join(home, '.gemini', 'skills'), agents: ['gemini'], scope: 'user' },
    { dir: path.join(home, '.gemini', 'antigravity-cli', 'skills'), agents: ['antigravity'], scope: 'user' },
  ];
  if (project) dirs.push(
    { dir: path.join(project, '.claude', 'skills'), agents: ['claude'], scope: 'project' },
    { dir: path.join(project, '.agents', 'skills'), agents: ['codex', 'antigravity'], scope: 'project' },
    { dir: path.join(project, '.gemini', 'skills'), agents: ['gemini'], scope: 'project' },
  );
  return dirs;
}
// Folders "Share with all agents" links into: together they reach Claude, Codex, Gemini and Antigravity.
const shareTargets = (home = os.homedir()) => [path.join(home, '.claude', 'skills'), path.join(home, '.agents', 'skills'), path.join(home, '.gemini', 'skills')];

function frontmatter(file) {
  try {
    const t = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const m = t.match(/^---\s*\n([\s\S]*?)\n---/); if (!m) return {};
    const get = (k) => { const r = m[1].match(new RegExp(`^${k}:\\s*(.*(?:\\n[ \\t]+.*)*)`, 'm')); return r ? r[1].replace(/\n[ \t]+/g, ' ').replace(/^["'>|]\s*|["']$/g, '').trim() : ''; };
    return { name: get('name'), description: get('description') };
  } catch { return {}; }
}

function listSkills(opts = {}) {
  const by = new Map();
  for (const loc of skillDirs(opts)) {
    let entries = []; try { entries = fs.readdirSync(loc.dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(loc.dir, e.name);
      const md = path.join(p, 'SKILL.md'); if (!fs.existsSync(md)) continue;
      const fm = frontmatter(md); const name = e.name;
      let real = p; try { real = fs.realpathSync(p); } catch {}
      const s = by.get(name) || { name, title: fm.name || name, description: fm.description || '', agents: new Set(), locations: [] };
      if (!s.description && fm.description) s.description = fm.description;
      loc.agents.forEach((a) => s.agents.add(a));
      s.locations.push({ dir: loc.dir, scope: loc.scope, path: p, real, symlink: e.isSymbolicLink() });
      by.set(name, s);
    }
  }
  return [...by.values()].map((s) => ({ ...s, agents: [...s.agents].sort() })).sort((a, b) => a.name.localeCompare(b.name));
}

// Link a skill into every share target that does not have it yet. Never overwrites.
function shareSkill(name, { home = os.homedir(), project } = {}) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid skill name');
  const skill = listSkills({ home, project }).find((s) => s.name === name);
  if (!skill) throw new Error(`Skill ${name} not found`);
  const source = skill.locations.find((l) => !l.symlink) || skill.locations[0];
  const created = [];
  for (const dir of shareTargets(home)) {
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) || (() => { try { fs.lstatSync(dest); return true; } catch { return false; } })()) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(source.real, dest, 'dir');
    created.push(dest);
  }
  return created;
}

module.exports = { listSkills, shareSkill, skillDirs, shareTargets };
