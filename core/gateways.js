'use strict';
// Model gateway profiles: point an agent at a local or third-party model endpoint.
// protocol: 'anthropic' (Messages API), 'openai' (Chat Completions / Responses),
//           'gemini' (Gemini API), 'ollama' / 'lmstudio' (Codex's built-in local providers).

const PRESETS = [
  { name: 'LiteLLM proxy (OpenAI style)', protocol: 'openai', baseUrl: 'http://localhost:4000/v1', model: '', wireApi: 'chat' },
  { name: 'LiteLLM proxy (Anthropic style)', protocol: 'anthropic', baseUrl: 'http://localhost:4000', model: '' },
  { name: 'Ollama (OpenAI style)', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen3-coder', wireApi: 'chat' },
  { name: 'Ollama via Codex local mode', protocol: 'ollama', baseUrl: '', model: 'gpt-oss:20b' },
  { name: 'LM Studio via Codex local mode', protocol: 'lmstudio', baseUrl: '', model: '' },
  { name: 'DeepSeek (Anthropic style)', protocol: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat' },
  { name: 'DeepSeek (OpenAI style)', protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', wireApi: 'chat' },
  { name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', wireApi: 'chat' },
  { name: 'Gemini API key', protocol: 'gemini', baseUrl: '', model: '' },
];

// Which gateway protocols each agent can use.
function supports(agent, g) {
  if (!g) return true;
  return (agent.gateways || []).includes(g.protocol);
}

const toml = (s) => JSON.stringify(String(s)); // TOML basic strings accept JSON-escaped text

// Returns { env: {NAME: value|null(=unset)}, args: [], model } for launching agent with gateway g.
function gatewayLaunch(agent, g) {
  if (!supports(agent, g)) throw new Error(`${agent.name} can't use a ${g.protocol}-style gateway. It supports: ${(agent.gateways || []).join(', ') || 'none'}.`);
  const env = {}; const args = []; const model = g.model || null; const key = g.apiKey || '';
  const id = agent.id;
  if (g.protocol === 'anthropic') {
    env.ANTHROPIC_BASE_URL = g.baseUrl;
    if (id === 'claude') {
      env.ANTHROPIC_AUTH_TOKEN = key || 'tributary-local';
      env.ANTHROPIC_API_KEY = null; // avoid a stored key overriding the gateway token
      if (model) for (const v of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']) env[v] = model;
    } else if (key) env.ANTHROPIC_API_KEY = key;
  } else if (g.protocol === 'openai') {
    if (id === 'codex') {
      const p = 'model_providers.tributary';
      args.push('-c', `${p}.name=${toml('Tributary gateway')}`, '-c', `${p}.base_url=${toml(g.baseUrl)}`,
        '-c', `${p}.wire_api=${toml(g.wireApi || 'chat')}`);
      if (key) { args.push('-c', `${p}.env_key=${toml('TRIBUTARY_API_KEY')}`); env.TRIBUTARY_API_KEY = key; }
      args.push('-c', `model_provider=${toml('tributary')}`);
    } else { env.OPENAI_BASE_URL = g.baseUrl; env.OPENAI_API_BASE = g.baseUrl; if (key) env.OPENAI_API_KEY = key; }
  } else if (g.protocol === 'ollama' || g.protocol === 'lmstudio') {
    if (id === 'codex') args.push('--oss', '--local-provider', g.protocol);
    if (g.baseUrl && g.protocol === 'ollama') env.OLLAMA_HOST = g.baseUrl;
  } else if (g.protocol === 'gemini') {
    if (g.baseUrl) env.GOOGLE_GEMINI_BASE_URL = g.baseUrl;
    if (key) { env.GEMINI_API_KEY = key; env.GOOGLE_API_KEY = key; }
  }
  for (const [k, v] of Object.entries(g.env || {})) env[k] = v;
  return { env, args, model };
}

module.exports = { PRESETS, supports, gatewayLaunch };
