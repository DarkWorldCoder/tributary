'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { runTurn } = require('../core/runner'); const { acpPool } = require('../core/acp'); const { describe, BUILTIN } = require('../core/agents');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
test('Gemini uses native ACP with its selected model and restores compact context when sessions cannot reload', { skip: process.platform === 'win32' ? 'Unix executable fixture' : false }, async (t) => {
 const root = mkTmp('gemini-acp'); const wrapper = path.join(root, 'gemini');
 fs.writeFileSync(wrapper, `#!/usr/bin/env node\nconst rl=require('node:readline').createInterface({input:process.stdin});const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:false,promptCapabilities:{image:true}}}});else if(m.method==='session/new')send({id:m.id,result:{sessionId:'gemini-native-fixture'}});else if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify({args:process.argv.slice(2),prompt:m.params.prompt})}}}});send({id:m.id,result:{stopReason:'end_turn'}})}});`, { mode: 0o755 });
 t.after(() => { acpPool.closeAll(); fs.rmSync(root, { recursive: true, force: true }); });
 const events = []; const result = await runTurn({ agent: { id: 'gemini', available: true, protocol: 'gemini-stream', controlProtocol: 'gemini-acp', path: wrapper }, cwd: root, prompt: 'Continue', fallbackPrompt: 'Original goal and recent context', resumeId: 'previous-session', model: 'selected-model', images: [{ mime: 'image/png', base64: 'aW1hZ2U=' }], extraDirs: [path.join(root, 'src')], onEvent: (e) => events.push(e) });
 assert.equal(result.ok, true); const data = JSON.parse(result.text); assert.ok(data.args.includes('--experimental-acp')); assert.ok(data.args.includes('selected-model')); assert.equal(data.prompt[0].text, 'Original goal and recent context'); assert.equal(data.prompt[1].type, 'image');
});
test('agent capability labels distinguish native approvals from plain streaming and text connections', () => {
 for (const id of ['claude', 'codex', 'gemini', 'opencode']) { const agent = BUILTIN.find((a) => a.id === id); assert.equal(describe(agent).capabilities.approvals, true, id); }
 assert.equal(describe({ protocol: 'direct-chat' }).capabilities.tools, false);
 assert.equal(describe({ protocol: 'agy-stream' }).capabilities.approvals, false);
});
