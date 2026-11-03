'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('project tools detect Rust, Go and mixed stacks without executing manifests', async () => {
  const { projectProfile } = await import('../ui/src/lib/project-profile.mjs');
  const rust = projectProfile(['Cargo.toml', 'src/main.rs', 'README.md']);
  assert.equal(rust.entry, 'src/main.rs'); assert.ok(rust.commands.some((c) => c.command === 'cargo run'));
  const go = projectProfile(['go.mod', 'main.go']); assert.equal(go.entry, 'main.go'); assert.ok(go.commands.some((c) => c.command === 'go test ./...'));
  const commandProject = projectProfile(['cmd/tool/main.go', 'README.md']); assert.equal(commandProject.entry, 'cmd/tool/main.go');
  const mixed = projectProfile(['Cargo.toml', 'src/lib.rs', 'package.json', 'pnpm-lock.yaml'], '{"scripts":{"dev":"vite","test":"node --test"}}');
  assert.equal(mixed.stacks.length, 2); assert.ok(mixed.commands.some((c) => c.command === 'pnpm run dev'));
  assert.ok(!mixed.commands.some((c) => c.command.endsWith('build'))); assert.ok(!mixed.commands.some((c) => c.command === 'cargo run'));
  assert.equal(projectProfile(['package.json'], '{bad json').commands.length, 0);
  assert.equal(projectProfile(['notes.txt']).entry, null);
});
test('preview addresses allow local services and reject credentials or remote hosts', async () => {
  const { localPreviewUrl } = await import('../ui/src/lib/project-profile.mjs');
  assert.equal(localPreviewUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(localPreviewUrl('https://127.0.0.1:4318/path'), 'https://127.0.0.1:4318/path');
  assert.equal(localPreviewUrl('http://[::1]:8080'), 'http://[::1]:8080/');
  for (const value of ['https://localhost.example.com', 'https://localhost@remote.example', 'http://user:pass@localhost:3000', 'file:///tmp/a.html', 'javascript:alert(1)', '192.168.1.2:8080']) assert.equal(localPreviewUrl(value), null, value);
});
test('recent files deduplicate within the correct project and worktree chat and stay bounded', async () => {
  const { rememberFile, readRecentFiles } = await import('../ui/src/lib/recent-work.mjs');
  let value = null; const storage = { getItem: () => value, setItem: (_key, next) => { value = next; } };
  for (let n = 0; n < 50; n++) rememberFile({ project: '/project', rel: `file-${n}.go`, threadId: 'one' }, storage);
  assert.equal(readRecentFiles(storage).length, 30);
  rememberFile({ project: '/project', rel: 'file-49.go', threadId: 'one' }, storage);
  assert.equal(readRecentFiles(storage).length, 30); assert.equal(readRecentFiles(storage)[0].rel, 'file-49.go');
  rememberFile({ project: '/project', rel: 'file-49.go', threadId: 'two' }, storage);
  assert.equal(readRecentFiles(storage).filter((r) => r.rel === 'file-49.go').length, 2);
  value = JSON.stringify(['../escape', '/absolute', 'C:\\private.txt', '\\server\\file', '', 'a/../b', 'a\0b'].map((rel) => ({ project: '/project', rel })));
  assert.deepEqual(readRecentFiles(storage), []); value = '{invalid'; assert.deepEqual(readRecentFiles(storage), []);
});
