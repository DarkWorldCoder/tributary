#!/usr/bin/env node
// Plain-text fake agent for CLI tests: echoes the request's last line and can write a file.
// usage: fake-text-agent.js <name> <prompt>   ("WRITE:<file>=<content>" in the prompt writes a file)
const fs = require('fs');
const [name, prompt] = process.argv.slice(2);
const last = String(prompt || '').trim().split('\n').pop();
const m = /WRITE:([\w./-]+)=(\S+)/.exec(prompt || '');
if (m) fs.writeFileSync(m[1], `${m[2]} by ${name}\n`);
process.stdout.write(`${name} says: ${last}\n`);
