#!/usr/bin/env node
// Plain-text fake agent for CLI tests: echoes the request's last line and can write a file.
// usage: fake-text-agent.js <name> <prompt>   ("WRITE:<file>=<content>" in the prompt writes a file; the last one
// wins, since a thread's earlier requests come first in a handoff prompt)
const fs = require('fs');
const [name, prompt] = process.argv.slice(2);
const last = String(prompt || '').trim().split('\n').pop();
const m = [...String(prompt || '').matchAll(/WRITE:([\w./-]+)=(\S+)/g)].pop();
if (m) fs.writeFileSync(m[1], `${m[2]} by ${name}\n`);
process.stdout.write(`${name} says: ${last}\n`);
