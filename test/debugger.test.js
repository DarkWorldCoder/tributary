'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const { DebuggerManager } = require('../core/debugger'); const { mkdtemp } = require('./helpers/tmp');
async function until(fn, details = () => '') { const limit = Date.now() + 15000; while (!fn()) { if (Date.now() > limit) throw new Error('Debugger fixture timed out: ' + details()); await new Promise((r) => setTimeout(r, 20)); } }
function fixture(t, text, file = 'main.js') { const root = mkdtemp('debug'); fs.writeFileSync(path.join(root, file), text); const manager = new DebuggerManager(() => {}); t.after(() => { manager.stopAll(); fs.rmSync(root, { recursive: true, force: true }); }); return { root, session: manager.session(root) }; }
test('Node debugger binds source breakpoints, inspects variables, steps and stops cleanly', async (t) => {
 const { session } = fixture(t, 'function add(a,b) {\n  const result = a+b;\n  return result;\n}\nconst total = add(2,3);\nconsole.log(total);\n');
 await session.breakpoint('main.js', 3, true); await session.launch({ entry: 'main.js' });
 await until(() => session.state().status === 'paused' && session.state().selectedFrame);
 assert.equal(session.state().frames[0].rel, 'main.js'); await session.action('resume');
 await until(() => session.state().status === 'paused' && session.state().frames[0]?.line === 3 && session.state().variables.some((v) => v.name === 'result'));
 assert.equal(session.state().variables.find((v) => v.name === 'result').value, '5');
 assert.equal((await session.evaluate('result + 1')).value, '6');
 await assert.rejects(session.evaluate('missingVariable'), /ReferenceError/);
 assert.equal(session.state().breakpoints[0].verified, true);
 await session.action('over'); await until(() => session.state().status === 'paused' && session.state().frames[0]?.line !== 3);
 await session.action('resume'); await until(() => session.state().status === 'stopped', () => JSON.stringify({ ...session.state(), childExit: session.child?.exitCode })); assert.match(session.state().output, /5\n/); assert.equal(session.child, null);
});
test('TypeScript native execution pauses at source lines and rejects outside paths and unsupported JSX', async (t) => {
 const { root, session } = fixture(t, 'const value: number = 2;\ndebugger;\nconsole.log(value);\n', 'main.ts');
 await assert.rejects(session.launch({ entry: '../other.js' }), /outside/);
 fs.writeFileSync(path.join(root, 'view.tsx'), ''); await assert.rejects(session.launch({ entry: 'view.tsx' }), /TSX/);
 await session.launch({ entry: 'main.ts' }); await until(() => session.state().status === 'paused' && session.state().selectedFrame);
 await session.action('resume'); await until(() => session.state().status === 'paused' && session.state().frames[0]?.line === 2 && session.state().selectedFrame);
 assert.equal((await session.evaluate('value')).value, '2'); session.stop(); assert.equal(session.state().status, 'stopped');
 await assert.rejects(session.attach(0), /port/); await assert.rejects(session.action('arbitrary'), /action/);
});

test('attaching stays on loopback and detaching resumes but never kills the external Node process', async (t) => {
 const { root, session } = fixture(t, 'console.log("external finished");\n');
 const { start, killTree } = require('../core/proc');
 const child = start(process.execPath, ['--inspect-brk=127.0.0.1:0', path.join(root, 'main.js')], { cwd: root, env: process.env });
 t.after(() => killTree(child)); let stderr = ''; let stdout = ''; let port = 0;
 child.stderr.on('data', (x) => { stderr += x; const match = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(stderr); if (match) port = Number(match[1]); });
 child.stdout.on('data', (x) => stdout += x);
 await until(() => port); await session.attach(port); await until(() => session.state().status === 'paused' && session.state().selectedFrame);
 assert.equal(session.state().owned, false); session.stop();
 await until(() => stdout.includes('external finished') && child.exitCode === 0);
 assert.equal(child.killed, false); assert.equal(session.state().status, 'stopped');
});

test('breakpoint installation is shared when source setup and a gutter click overlap', async (t) => {
 const { session } = fixture(t, 'console.log(1);\n'); let calls = 0; let release;
 session.ready = true; session.client = { call: async () => { calls++; await new Promise((resolve) => { release = resolve; }); return { breakpointId: 'one', locations: [] }; }, close() {} };
 const first = session.breakpoint('main.js', 1, true); await until(() => calls === 1);
 const second = session.install([...session.breakpoints.values()][0]); release(); await Promise.all([first, second]);
 assert.equal(calls, 1); assert.equal(session.state().breakpoints.length, 1); session.client = null;
});
