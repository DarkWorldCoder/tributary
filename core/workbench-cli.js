'use strict';
// No credentials in arguments or output. Available only for one running turn.
(async () => {
  const [action, ...args] = process.argv.slice(2);
  let input;
  if (action === '--stdin') {
    const chunks = []; let bytes = 0; for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 512000) throw new Error('Request too large.'); chunks.push(chunk); }
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } else if (action?.startsWith('{')) input = JSON.parse(action);
  else {
    input = { action };
    const numeric = new Set(['line', 'column', 'group', 'start_line', 'count']);
    const allowed = new Set(['path', 'revision', 'old_text', 'new_text', 'direction', 'panel', ...numeric]);
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].replace(/^--/, '').replaceAll('-', '_');
      if (!args[i].startsWith('--') || !allowed.has(key) || args[i + 1] === undefined || input[key] !== undefined) throw new Error('Invalid editor arguments.');
      input[key] = numeric.has(key) ? Number(args[i + 1]) : args[i + 1];
    }
  }
  const url = new URL(process.env.TRIBUTARY_EDITOR_URL || 'http://invalid');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/editor' || !process.env.TRIBUTARY_EDITOR_TOKEN) throw new Error('Editor control is available only inside a Tributary turn.');
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${process.env.TRIBUTARY_EDITOR_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(input), redirect: 'error', signal: AbortSignal.timeout(120000) });
  const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || 'Editor command failed.');
  console.log(JSON.stringify(data.result));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
