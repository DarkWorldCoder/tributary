'use strict';
// Synthetic archive, actual Electron runtime and Git. This verifies module
// inclusion/resolution, not a complete installer or native-platform release.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const { createPackageWithOptions } = require('@electron/asar');
const repo = path.resolve(__dirname, '../..');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-path-asar-'));
  try {
    const source = path.join(root, 'source'), project = path.join(root, 'project');
    fs.mkdirSync(path.join(source, 'core'), { recursive: true }); fs.mkdirSync(project);
    const modules = ['git.js', 'host.js', 'ssh.js', 'proc.js', 'change-stats.js', 'path-command.js', 'path-prefix.js'];
    for (const name of modules) fs.copyFileSync(path.join(repo, 'core', name), path.join(source, 'core', name));
    const archive = path.join(root, 'app.asar'); await createPackageWithOptions(source, archive, {});
    execFileSync('git', ['init', '-q'], { cwd: project });
    const names = ['a.txt', 'नयाँ.ts', process.platform === 'win32' ? 'two lines.ts' : 'two\nlines.ts'];
    for (const name of names) fs.writeFileSync(path.join(project, name), '');
    const raw = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: project, encoding: 'utf8' });
    const expected = [...new Set(raw.split('\0').filter(Boolean))].slice(0, 2);
    const code = `const assert=require('node:assert/strict');require(process.argv[1]+'/core/git').listFiles(process.argv[2],2).then(result=>{assert.deepEqual(result,JSON.parse(process.argv[3]));console.log('PATH_ASAR_OK '+process.versions.node);}).catch(e=>{console.error(e);process.exitCode=1;});`;
    const binary = require('electron');
    const result = spawnSync(binary, ['-e', code, archive, project, JSON.stringify(expected)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    assert.match(result.stdout, /PATH_ASAR_OK/);
    const report = { date: new Date().toISOString(), passed: true, modules, stdout: result.stdout.trim(), scope: 'Actual Electron runtime, synthetic ASAR containing streamed Git dependencies, external temporary real Git repository. No installer, live remote host or native Windows/macOS release claim.' };
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
