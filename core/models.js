'use strict';
// Model metadata only. Discovery never starts a conversation or runs a model turn.
const { start, killTree } = require('./proc');
const { pathDirs } = require('./agents');
const path = require('node:path');

function validateModel(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@\[\]+-]*$/.test(value)) throw new Error('Use a model ID of up to 200 characters, without spaces or control characters.');
  return value;
}
const selectable = (agent) => !agent.custom && ['claude', 'codex', 'gemini', 'antigravity', 'aider'].includes(agent.id) || ['direct-chat', 'local-agent'].includes(agent.protocol);
function normalize(rows) {
  const unique = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = row.model || row.id || (typeof row.name === 'string' ? row.name.replace(/^models\//, '') : '');
    try { if (!validateModel(id)) continue; } catch { continue; }
    unique.set(id, { id, name: String(row.displayName || row.display_name || id).slice(0, 120), hidden: !!row.hidden, ...(typeof row.resolvedModel === 'string' ? { resolvedModel: row.resolvedModel.slice(0, 200) } : {}) });
    if (unique.size >= 500) break;
  }
  return [...unique.values()];
}

function codexModels(agent, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = start(agent.path, ['app-server', '--listen', 'stdio://'], { cwd: require('node:os').tmpdir(), env: { ...process.env, PATH: pathDirs(process.env).join(path.delimiter) }, keepOpen: true });
    let finished = false; let buffer = ''; let bytes = 0; let pages = 0; const models = []; const cursors = new Set();
    const finish = (error) => { if (finished) return; finished = true; clearTimeout(timer); child.stdin.end(); killTree(child); error ? reject(error) : resolve(normalize(models)); };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const request = (cursor) => send({ id: ++pages + 1, method: 'model/list', params: { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) } });
    const timer = setTimeout(() => finish(new Error('Model discovery timed out. Use Automatic or enter a model ID.')), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.resume(); // Native logs may contain private paths; never send them to the UI.
    child.stdout.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) return finish(new Error('The model catalog exceeded its size limit.'));
      buffer += chunk; let end;
      while (!finished && (end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.error && message.id != null) return finish(new Error('Codex could not list models. Check its sign-in or enter a model ID.'));
        if (message.id === 1 && message.result) { send({ method: 'initialized' }); request(); }
        else if (message.id === pages + 1 && Array.isArray(message.result?.data)) {
          models.push(...message.result.data);
          const cursor = message.result.nextCursor;
          if (cursor && pages < 10 && models.length < 500 && !cursors.has(cursor)) { cursors.add(cursor); request(cursor); }
          else finish();
        } else if (message.id != null && message.method) send({ id: message.id, error: { code: -32601, message: 'This client only lists models.' } });
      }
    });
    child.on('error', () => finish(new Error('Cannot start Codex model discovery. Check its installation.')));
    child.on('close', () => { if (!finished) finish(new Error('Codex closed before returning a model catalog.')); });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'tributary_model_picker', title: 'Tributary model picker', version: '0.1.0' } } });
  });
}

function claudeModels(agent, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: pathDirs(process.env).join(path.delimiter) }; delete env.CLAUDECODE;
    const child = start(agent.path, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'user'], { cwd: require('node:os').tmpdir(), env, keepOpen: true });
    let finished = false; let buffer = ''; let bytes = 0;
    const finish = (error, models) => { if (finished) return; finished = true; clearTimeout(timer); child.stdin.end(); killTree(child); error ? reject(error) : resolve(models); };
    const timer = setTimeout(() => finish(new Error('Claude model discovery timed out.')), timeoutMs);
    child.stderr.resume(); child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) return finish(new Error('The model catalog exceeded its size limit.'));
      buffer += chunk; let end;
      while (!finished && (end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type !== 'control_response' || message.response?.request_id !== 'tributary-models') continue;
        const rows = message.response.response?.models;
        if (message.response.subtype !== 'success' || !Array.isArray(rows)) return finish(new Error('Claude did not return model metadata.'));
        const models = normalize(rows.map((row) => ({ ...row, id: row.value })));
        finish(models.length ? null : new Error('Claude returned no models.'), models);
      }
    });
    child.once('error', () => finish(new Error('Cannot start Claude model discovery.')));
    child.once('close', () => { if (!finished) finish(new Error('Claude closed before returning its models.')); });
    // Only initialize metadata: never send a user message, prompt, or tool approval.
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'tributary-models', request: { subtype: 'initialize' } })}\n`);
  });
}

function antigravityModels(agent, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = start(agent.path, ['models'], { cwd: require('node:os').tmpdir(), env: { ...process.env, PATH: pathDirs(process.env).join(path.delimiter) } });
    let output = ''; let finished = false;
    const finish = (error) => { if (finished) return; finished = true; clearTimeout(timer); killTree(child); if (error) reject(error); else {
      const rows = output.replace(/\x1b\[[0-9;]*m/g, '').split('\n').flatMap((line) => { const match = /^([A-Za-z0-9][A-Za-z0-9_.:/+-]*)\t+(.+)$/.exec(line.trim()); return match ? [{ id: match[1], displayName: match[2] }] : []; });
      const models = normalize(rows); models.length ? resolve(models) : reject(new Error('Antigravity returned no models. Check its sign-in or use Automatic.'));
    } };
    const timer = setTimeout(() => finish(new Error('Antigravity model discovery timed out. Try Refresh.')), timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.resume();
    child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 2 * 1024 * 1024) finish(new Error('The model catalog exceeded its size limit.')); });
    child.once('error', () => finish(new Error('Cannot start Antigravity model discovery. Check its installation.')));
    child.once('close', (code) => finish(code === 0 ? null : new Error('Antigravity could not list models. Check its sign-in.')));
  });
}

async function boundedJson(response) {
  if (!response.body) throw new Error('The provider returned an empty model catalog.');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw new Error('The model catalog exceeded its size limit.'); chunks.push(Buffer.from(value)); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('The provider returned an invalid model catalog.'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function providerModels(gateway, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const protocol = gateway.protocol;
  const defaultBase = protocol === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : protocol === 'ollama' ? 'http://localhost:11434' : protocol === 'lmstudio' ? 'http://localhost:1234/v1' : '';
  let base;
  try { base = new URL(gateway.baseUrl || defaultBase); } catch { throw new Error('Enter a valid provider address in Settings.'); }
  if (base.username || base.password || base.search || base.hash || !(base.protocol === 'https:' || base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('Model discovery requires HTTPS, or HTTP on localhost, without URL credentials.');
  const key = gateway.apiKey; const headers = {};
  if (protocol === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; if (key) headers['x-api-key'] = key; }
  else if (protocol === 'gemini') { if (key) headers['x-goog-api-key'] = key; }
  else if (key) headers.Authorization = `Bearer ${key}`;
  const prefix = base.href.replace(/\/$/, '');
  const endpoint = protocol === 'ollama' ? `${prefix.replace(/\/v1$/, '')}/api/tags` : protocol === 'anthropic' ? `${prefix.replace(/\/v1$/, '')}/v1/models` : `${prefix}/models`;
  const signal = AbortSignal.timeout(timeoutMs); const rows = []; let cursor; const seen = new Set();
  for (let page = 0; page < 10; page++) {
    const url = new URL(endpoint);
    if (cursor) url.searchParams.set(protocol === 'gemini' ? 'pageToken' : 'after_id', cursor);
    if (protocol === 'gemini') url.searchParams.set('pageSize', '100');
    if (protocol === 'anthropic') url.searchParams.set('limit', '100');
    let response;
    try { response = await fetchImpl(url.href, { headers, redirect: 'error', signal }); }
    catch { throw new Error('Cannot fetch models. Check the provider address, credentials, and connection.'); }
    if (!response.ok) throw new Error(`Model catalog returned HTTP ${response.status}. Check the provider and credentials.`);
    const result = await boundedJson(response);
    const data = protocol === 'gemini' ? result.models?.filter((m) => m.supportedGenerationMethods?.includes('generateContent')) : protocol === 'ollama' ? result.models : result.data;
    if (!Array.isArray(data)) throw new Error('This service did not return a supported model catalog. Enter a model ID instead.');
    rows.push(...data);
    cursor = protocol === 'gemini' ? result.nextPageToken : protocol === 'anthropic' && result.has_more ? result.last_id : null;
    if (!cursor || seen.has(cursor) || rows.length >= 500) break;
    seen.add(cursor);
  }
  return normalize(rows);
}

async function catalog(agent, gateway, options = {}) {
  const result = { supportsSelection: selectable(agent), source: 'agent', note: '', models: [], updatedAt: Date.now() };
  if (!result.supportsSelection) return { ...result, note: 'This integration uses the assistant’s own model settings. Model switching is not supported here yet.' };
  if (gateway) return { ...result, source: 'provider', models: await providerModels(gateway, options), note: 'Reported by this provider. A listed model may need additional access or may not support this assistant.' };
  if (agent.id === 'codex') return { ...result, source: 'codex', models: await codexModels(agent, options), note: 'Reported by installed Codex. Access and usage limits depend on your sign-in and provider.' };
  if (agent.id === 'antigravity') return { ...result, source: 'antigravity', models: await antigravityModels(agent, options), note: 'Reported by installed Antigravity. Account access and limits apply.' };
  if (agent.id === 'claude' && agent.path && !agent.custom) {
    try { return { ...result, source: 'claude', models: await claudeModels(agent, options), note: 'Reported by installed Claude Code. Account access and limits apply.' }; } catch { /* Older CLIs retain explicit alias selection. */ }
  }
  if (agent.id === 'claude') return { ...result, source: 'aliases', models: ['sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'opusplan'].map((id) => ({ id, name: { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku', fable: 'Fable', best: 'Best available', opusplan: 'Opus plan / Sonnet build' }[id] || id })), note: 'Claude model aliases, not an account access check. Version, plan, provider and organization restrictions apply.' };
  return { ...result, source: 'manual', note: 'Use Automatic or enter the model ID from your assistant or provider. Connect a gateway to discover its models.' };
}
module.exports = { validateModel, selectable, normalize, codexModels, claudeModels, antigravityModels, providerModels, catalog };
