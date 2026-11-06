'use strict';
// Explicit, read-only discovery on loopback. Never installs a runtime, loads a model,
// sends a prompt, or shares a key with other services while detecting them.
const os = require('node:os');
const { normalize } = require('./models');
const SERVICES = [
  { id: 'unsloth', name: 'Unsloth', baseUrl: 'http://127.0.0.1:8888/v1', download: 'https://unsloth.ai/download', docs: 'https://unsloth.ai/docs/basics/api', setup: 'Open Unsloth, load a chat model, then create a key in Settings → API.' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', download: 'https://ollama.com/download', docs: 'https://docs.ollama.com/openai', setup: 'Start Ollama and download a chat model, then refresh models here.' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', download: 'https://lmstudio.ai/download', docs: 'https://lmstudio.ai/docs/developer/openai-compat', setup: 'Load a chat model in LM Studio and start its local API server.' },
  { id: 'llamacpp', name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1', download: 'https://github.com/ggml-org/llama.cpp/releases', docs: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server#sleeping-on-idle', setup: 'Connect to an existing llama.cpp server, or start a CPU engine here with a local executable and GGUF model.' },
];
function localAddress(input) {
  let url; try { url = new URL(input); } catch { throw new Error('Enter a valid local model server address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Local model setup accepts only localhost addresses without credentials or query parameters. Use Add connection for a remote provider.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
  if (!url.pathname.endsWith('/v1')) throw new Error('Use the service’s local API base address ending in /v1.');
  return url.href.replace(/\/$/, '');
}
function serviceInput(input = {}) {
  const service = SERVICES.find((service) => service.id === input.service);
  if (!service) throw new Error('Choose Unsloth, Ollama, LM Studio or llama.cpp.');
  const baseUrl = localAddress(input.baseUrl || service.baseUrl);
  if (input.apiKey != null && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(input.apiKey))) throw new Error('Use a valid local service API key.');
  return { service, baseUrl, apiKey: input.apiKey || '' };
}
async function readCatalog(response) {
  let bytes = 0; const chunks = [];
  if (!response.body) throw new Error('empty');
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 2 * 1024 ** 2) throw new Error('large'); chunks.push(Buffer.from(chunk)); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8')).data;
  if (!Array.isArray(data)) throw new Error('invalid');
  const rows = normalize(data);
  return rows.map((row) => {
    const metadata = data.find((item) => item?.id === row.id);
    return { id: row.id, name: row.name, ...(typeof metadata?.loaded === 'boolean' ? { loaded: metadata.loaded } : {}) };
  });
}
async function inspect(input, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  const { service, baseUrl, apiKey } = serviceInput(input);
  const base = { ...service, baseUrl, models: [], status: 'offline', message: 'Not responding. Start the service or check its address.' };
  let response;
  // The native /models route is exempt from llama.cpp's idle timer and must
  // not wake a sleeping model merely to list its metadata.
  const catalog = service.id === 'llamacpp' ? baseUrl.slice(0, -3) + '/models' : `${baseUrl}/models`;
  try { response = await fetchImpl(catalog, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} }); }
  catch { return base; }
  if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return { ...base, status: 'needs-key', message: 'Service found. Enter its API key, then refresh models.' }; }
  if (!response.ok) { await response.body?.cancel(); return { ...base, status: 'error', message: `Local API returned HTTP ${response.status}. Check the address and that its API server is enabled.` }; }
  try {
    const models = await readCatalog(response);
    return { ...base, models, status: models.length ? 'ready' : 'empty', message: models.length ? `${models.length} model${models.length === 1 ? '' : 's'} reported by this service.` : 'Service found. Load or download a chat model there, then refresh.' };
  } catch { return { ...base, status: 'error', message: 'This address did not return a compatible model list. Check the local API address.' }; }
}
function hardware() {
  const gb = (bytes) => Math.round(bytes / 1024 ** 3 * 10) / 10;
  return { platform: process.platform, arch: process.arch, memoryGB: gb(os.totalmem()), availableMemoryGB: gb(os.freemem()) };
}
async function discover(options) { return { hardware: hardware(), services: await Promise.all(SERVICES.map((service) => inspect({ service: service.id }, options))) }; }
module.exports = { SERVICES, localAddress, serviceInput, inspect, discover, hardware };
