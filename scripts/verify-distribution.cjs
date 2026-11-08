'use strict';
// Run with the unpacked application's own Electron/Node runtime on each native runner.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listPackage } = require('@electron/asar');
const [platform, arch] = process.argv.slice(2);
if (!['mac', 'win', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Pass platform and architecture.');
const base = path.resolve('release', platform === 'mac' ? `mac${arch === 'arm64' ? '-arm64' : ''}/Tributary.app/Contents` : `${platform === 'win' ? 'win' : 'linux'}${arch === 'arm64' ? '-arm64' : ''}-unpacked`);
const resources = path.join(base, platform === 'mac' ? 'Resources' : 'resources');
const archive = path.join(resources, 'app.asar');
const entries = new Set(listPackage(archive).map((name) => name.replaceAll('\\', '/')));
for (const file of ['core/index.js', 'core/path-command.js', 'core/path-prefix.js', 'core/native-engine.js', 'core/native-engine/discovery.cjs', 'core/native-engine/transport.cjs', 'server/lan-host.js', 'desktop/main.js', 'ui/dist/index.html', 'node_modules/jsonc-parser/package.json', 'node_modules/prettier/package.json', 'LICENSE']) {
  if (!entries.has('/' + file)) throw new Error(`Package is missing ${file}`);
}
if ([...entries].some((file) => /(?:^|\/)\.env(?:\.|$)/.test(file))) throw new Error('Environment files must never be packaged.');
for (const file of ['core/format-worker.cjs', 'core/eslint-worker.cjs', 'core/search-worker.cjs', 'core/local-engine-worker.cjs', 'core/files.js', 'core/directory-page.js', `node_modules/@lydell/node-pty-${platform === 'mac' ? 'darwin' : platform === 'win' ? 'win32' : 'linux'}-${arch}/package.json`]) {
  if (!fs.existsSync(path.join(archive + '.unpacked', file))) throw new Error(`Unpacked runtime is missing ${file}`);
}
const binary = path.join(base, platform === 'mac' ? 'MacOS/Tributary' : platform === 'win' ? 'Tributary.exe' : 'tributary');
const engine = path.join(resources, 'native-engine', 'tributary-engine' + (platform === 'win' ? '.exe' : ''));
if (!fs.statSync(engine).isFile()) throw new Error('Package is missing the native discovery engine.');
const code = String.raw`
  const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const runtime = require('node:module').createRequire(path.join(process.argv[1], 'package.json'));
  (async () => {
    assert.equal(process.arch, process.argv[2]);
    assert.equal(typeof runtime('./core').Hub, 'function');
    assert.equal(runtime('jsonc-parser').parse('{"valid":true}').valid, true);
    const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:');
    assert.equal(db.prepare('SELECT 42 AS value').get().value, 42); db.close();
    const pty = runtime('@lydell/node-pty');
    await new Promise((resolve, reject) => {
      let output = ''; const windows = process.platform === 'win32';
      const term = pty.spawn(windows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh', windows ? ['/d', '/c', 'echo tributary-pty-ok'] : ['-c', 'printf tributary-pty-ok'], { cols: 80, rows: 24, env: process.env });
      const timer = setTimeout(() => { term.kill(); reject(Error('Packaged terminal timed out')); }, 10000);
      term.onData((data) => { output += data; });
      term.onExit(({ exitCode }) => { clearTimeout(timer); if (exitCode || !output.includes('tributary-pty-ok')) reject(Error('Packaged terminal failed')); else resolve(); });
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-package-'));
    try {
      fs.writeFileSync(path.join(dir, 'sample.js'), 'const sample={ok:true};');
      const engine = process.argv[3];
      assert.equal(runtime('./core/native-engine').engineBinary(), engine);
      const identity = JSON.parse(require('node:child_process').execFileSync(engine, ['--identity'], { encoding: 'utf8', timeout: 10000, windowsHide: true }));
      assert.deepEqual(identity, { protocol: 1, arch: process.arch === 'x64' ? 'x86_64' : 'aarch64', os: { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform] });
      assert.equal(runtime('./core/native-engine').engineBinary({ resourcesPath: path.dirname(path.dirname(engine)) }), engine);
      const nativeFiles = await runtime('./core/native-engine/discovery.cjs').nativeScan(engine, dir, 'sample', { limit: 10 });
      assert.deepEqual(nativeFiles, { files: ['sample.js'], total: 1, visited: 1, unreadable: 0, limited: false });
      assert.deepEqual(await runtime('./core/filename-search').scanFileNames(dir, 'sample', { limit: 10 }), nativeFiles);
      const result = await runtime('./core/project-format').formatProjectSource(dir, 'sample.js', 'const sample={ok:true};', true);
      assert.ok(result.includes('const sample ='));
      const search = await runtime('./core/files').searchProject(dir, 's[a]mple', { regexp: true });
      assert.equal(search.matches.length, 1);
      // Class-API fixture verifies packaged worker transport, not ESLint rules.
      const lib = path.join(dir, 'node_modules/eslint'); fs.mkdirSync(lib, { recursive: true });
      fs.writeFileSync(path.join(lib, 'package.json'), JSON.stringify({ name: 'eslint', version: '9.0.0', main: 'index.cjs' }));
      fs.writeFileSync(path.join(lib, 'index.cjs'), 'exports.ESLint = class { async isPathIgnored() { return false; } async lintText() { return [{ messages: [], output: "const sample = true;" }]; } };');
      const lint = new (runtime('./core/eslint-tools').EslintTools)({ trusted: () => true }); const owner = lint.acquire(dir, 'sample.js');
      try { assert.equal((await lint.fix(dir, 'sample.js', 'var sample = true;')).output, 'const sample = true;'); }
      finally { const child = lint.lanes.get(dir)?.child; const exited = child && child.exitCode === null ? new Promise(resolve => child.once('close', resolve)) : Promise.resolve(); lint.stopAll(); await exited; }
      await new Promise((resolve, reject) => {
        const owned = runtime('./core/local-engine-process').spawnOwnedRuntime(process.execPath, ['-e', 'console.log("owned-runtime-ready");setInterval(()=>{},1000)'], { cwd: dir });
        let ready = false; const timer = setTimeout(() => { owned.kill('SIGKILL'); reject(Error('Packaged engine guardian timed out')); }, 10000);
        owned.stdout.on('data', chunk => { if (String(chunk).includes('owned-runtime-ready')) { ready = true; owned.kill('SIGTERM'); } });
        owned.once('error', reject); owned.once('close', code => { clearTimeout(timer); try { assert.equal(code, 0); assert.ok(ready && owned.runtimePid); assert.throws(() => process.kill(owned.runtimePid, 0)); resolve(); } catch (error) { reject(error); } });
      });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    // ConPTY keeps a native helper thread alive after its shell exits on Windows.
    // This is a bounded test process: exit only after every assertion and cleanup
    // has completed, and flush the success marker before closing the process.
    process.stdout.write('Packaged runtime, SQLite, native discovery, terminal, formatter and lint transport verified for ' + process.platform + '/' + process.arch + '\n', () => process.exit(0));
  })().catch((error) => { process.stderr.write(String(error.stack || error) + '\n', () => process.exit(1)); });
`;
const result = spawnSync(binary, ['-e', code, archive, arch, engine], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 45000, windowsHide: true });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Packaged runtime check exited with ${result.status}`);
