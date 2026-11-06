'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process'), { createPackageWithOptions } = require('@electron/asar');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-engine-asar-')), source = path.join(root, 'source'), work = path.join(root, 'work'); fs.mkdirSync(path.join(source, 'core'), { recursive: true }); fs.mkdirSync(work);
  try {
    for (const file of ['local-engine-process.js', 'local-engine-worker.cjs']) fs.copyFileSync(path.resolve(__dirname, '../../core', file), path.join(source, 'core', file));
    const archive = path.join(root, 'app.asar'); await createPackageWithOptions(source, archive, { unpack: '**/local-engine-worker.cjs' });
    assert.ok(fs.existsSync(archive + '.unpacked/core/local-engine-worker.cjs'));
    const code = `const assert=require('node:assert/strict');const {spawnOwnedRuntime}=require(process.argv[1]+'/core/local-engine-process');const owner=spawnOwnedRuntime(process.execPath,['-e','console.log("runtime-ready");setInterval(()=>{},1000)'],{cwd:process.argv[2]});let ready=false;const timer=setTimeout(()=>{owner.kill('SIGKILL');console.error('Timeout');process.exit(1)},10000);owner.stdout.on('data',b=>{if(String(b).includes('runtime-ready')){ready=true;owner.kill('SIGTERM')}});owner.on('error',e=>{console.error(e);process.exit(1)});owner.on('close',code=>{clearTimeout(timer);assert.equal(code,0);assert.ok(ready&&owner.runtimePid);assert.throws(()=>process.kill(owner.runtimePid,0));console.log('ENGINE_ASAR_OK '+process.versions.electron)});`;
    const result = spawnSync(require('electron'), ['-e', code, archive, work], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 15000 }); assert.equal(result.status, 0, result.stderr || result.error?.message); assert.match(result.stdout, /ENGINE_ASAR_OK/);
    const report = { date: new Date().toISOString(), passed: true, output: result.stdout.trim(), scope: 'Actual Electron Node mode; helper loaded from a synthetic ASAR, unpacked guardian executes and reaps an owned child. No complete installer or native Windows/macOS claim.' };
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
