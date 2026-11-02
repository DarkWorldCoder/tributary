'use strict';
// The Agent Client Protocol registry (agentclientprotocol.com): a public, curated list of ACP agents.
// Agents distributed through npx or uvx can run straight away; binary-only agents need a download,
// which Tributary leaves to the user (it links to the agent's site).
const fs = require('fs');
const path = require('path');

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const COLORS = ['#0ea5e9', '#a855f7', '#f97316', '#14b8a6', '#e11d48', '#84cc16', '#6366f1', '#f59e0b'];

function install(dist = {}) {
  if (dist.npx && dist.npx.package) return { kind: 'npx', runnable: true, command: 'npx', args: ['-y', dist.npx.package, ...(dist.npx.args || [])], env: dist.npx.env || {} };
  if (dist.uvx && dist.uvx.package) return { kind: 'uvx', runnable: true, command: 'uvx', args: [dist.uvx.package, ...(dist.uvx.args || [])], env: dist.uvx.env || {} };
  if (dist.binary) return { kind: 'binary', runnable: false, platforms: Object.keys(dist.binary) };
  return { kind: 'unknown', runnable: false };
}

function parseRegistry(json) {
  return ((json && json.agents) || []).filter((a) => a && a.id && a.name).map((a) => ({
    id: a.id, name: a.name, version: a.version || '', description: a.description || '', license: a.license || '',
    website: a.website || a.repository || '', repository: a.repository || '', authors: a.authors || [], install: install(a.distribution),
  }));
}

// A custom agent entry (agents.json) that runs the registry agent over ACP.
function registryEntry(a) {
  if (!a.install.runnable) throw new Error(`${a.name} is distributed as a download. Install it from ${a.website || 'its website'}, then add it as a custom agent.`);
  const hash = [...a.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return {
    id: `acp:${a.id}`, name: a.name, vendor: (a.authors && a.authors[0]) || 'ACP registry', command: a.install.command, acpArgs: a.install.args,
    env: a.install.env, protocol: 'acp', color: COLORS[hash % COLORS.length], glyph: a.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || 'Ag',
    docs: a.website, note: `From the ACP registry (version ${a.version || 'latest'}). Runs through ${a.install.kind}, which downloads it on first use.`, registry: a.id,
  };
}

function addRegistryAgent(file, a) {
  const entry = registryEntry(a);
  let data = {}; try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  const list = Array.isArray(data) ? data : (data.agents || []);
  const next = [...list.filter((x) => x && x.id !== entry.id), entry];
  const out = Array.isArray(data) ? next : { ...data, agents: next };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return entry;
}

function removeRegistryAgent(file, id) {
  let data = {}; try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  const list = Array.isArray(data) ? data : (data.agents || []);
  const next = list.filter((x) => x && x.id !== id);
  fs.writeFileSync(file, JSON.stringify(Array.isArray(data) ? next : { ...data, agents: next }, null, 2));
  return next.length !== list.length;
}

// Fetch the registry, falling back to the last cached copy when offline.
async function loadRegistry({ cacheFile, fetchImpl = globalThis.fetch, url = REGISTRY_URL } = {}) {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
    if (!r.ok) throw new Error(`Registry returned ${r.status}`);
    const json = await r.json();
    if (cacheFile) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(json)); }
    return { source: 'network', agents: parseRegistry(json) };
  } catch (e) {
    if (cacheFile && fs.existsSync(cacheFile)) return { source: 'cache', agents: parseRegistry(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))) };
    throw e;
  }
}

module.exports = { REGISTRY_URL, parseRegistry, registryEntry, addRegistryAgent, removeRegistryAgent, loadRegistry };
