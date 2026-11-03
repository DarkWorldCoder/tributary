'use strict';
// Invoked by a coding agent's shell tool. Credentials stay in the turn's environment.
async function main() {
  const [action, ...args] = process.argv.slice(2); const input = { action };
  if (!['agents', 'sources', 'start', 'list', 'status', 'stop'].includes(action)) throw new Error('Use agents, sources, start --agent ID --task TASK, list, status --id ID, or stop --id ID.');
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--agent': 'agentId', '--task': 'task', '--id': 'id', '--source': 'gatewayId', '--model': 'model' }[args[i]];
    if (!key || args[i + 1] == null || input[key] !== undefined) throw new Error('Invalid delegation arguments.');
    input[key] = args[i + 1];
  }
  const url = new URL(process.env.TRIBUTARY_DELEGATE_URL || 'http://invalid');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/delegate' || !process.env.TRIBUTARY_DELEGATE_TOKEN) throw new Error('Delegation is available only inside an enabled Tributary coding turn.');
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${process.env.TRIBUTARY_DELEGATE_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(120000), redirect: 'error' });
  const data = await res.json(); if (!res.ok || data.error) throw new Error(data.error || 'Delegation failed');
  console.log(JSON.stringify(data.result));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
