'use strict';
// File references in terminal output (compiler errors, stack traces, git status) become links that open the file.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const load = () => import(path.join(__dirname, '..', 'ui', 'src', 'lib', 'terminal-links.mjs'));

test('terminal links: paths with lines and columns are found, URLs, versions and prose are not', async () => {
  const { findFileLinks } = await load();
  const pick = (s) => findFileLinks(s).map((l) => [s.slice(l.start, l.end), l.path, l.line, l.col]);
  assert.deepStrictEqual(pick('src/app.ts:12:4 - error TS2304'), [['src/app.ts:12:4', 'src/app.ts', 12, 4]]);
  assert.deepStrictEqual(pick('    at Object.<anonymous> (/home/me/p/test/a.test.js:5:11)'), [['/home/me/p/test/a.test.js:5:11', '/home/me/p/test/a.test.js', 5, 11]]);
  assert.deepStrictEqual(pick('src/lib/x.tsx(7,3): error TS1005'), [['src/lib/x.tsx(7,3)', 'src/lib/x.tsx', 7, 3]]);
  assert.deepStrictEqual(pick('\tmodified:   README.md'), [['README.md', 'README.md', undefined, undefined]]);
  assert.deepStrictEqual(pick('./scripts/build.sh'), [['./scripts/build.sh', './scripts/build.sh', undefined, undefined]]);
  assert.deepStrictEqual(pick('File "app/main.py", line 3'), [['app/main.py', 'app/main.py', undefined, undefined]]);
  assert.deepStrictEqual(pick('see https://example.com/a/b.js:3 and v1.2.3, e.g. this'), []);
  assert.deepStrictEqual(pick('a.ts:1 b.ts:2').map((x) => x[0]), ['a.ts:1', 'b.ts:2']);
});

test('terminal links: only files inside the project open', async () => {
  const { projectRelative } = await load();
  assert.strictEqual(projectRelative('/home/me/p', '/home/me/p/src/a.ts'), 'src/a.ts');
  assert.strictEqual(projectRelative('/home/me/p/', './src/../lib/b.ts'), 'lib/b.ts');
  assert.strictEqual(projectRelative('/home/me/p', 'README.md'), 'README.md');
  assert.strictEqual(projectRelative('/home/me/p', '../other/c.ts'), null);
  assert.strictEqual(projectRelative('/home/me/p', '/home/me/project-two/a.ts'), null);
  assert.strictEqual(projectRelative('/home/me/p', '/etc/hosts'), null);
  assert.strictEqual(projectRelative('/home/me/p', '~/notes.md'), null);
});
