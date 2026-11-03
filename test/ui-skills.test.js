'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listUiSkills, readUiSkill } = require('../core/ui-skills');

test('bundled UI guidance is complete, isolated from catalog mutations and packaged for both hosts', () => {
  const catalog = listUiSkills();
  assert.equal(catalog.length, 4);
  assert.equal(new Set(catalog.map((s) => s.id)).size, 4);
  const packaged = require('../vscode/dist/core/ui-skills');
  for (const skill of catalog) {
    const loaded = readUiSkill(skill.id);
    assert.ok(loaded.instructions.startsWith('# '));
    assert.ok(loaded.instructions.length > 400 && loaded.instructions.length < 16000);
    assert.ok(!loaded.instructions.startsWith('---'), 'frontmatter is not injected into the prompt');
    const source = fs.readFileSync(path.join(__dirname, '..', 'core', 'bundled-skills', skill.id, 'SKILL.md'), 'utf8');
    assert.match(source, new RegExp(`^---\nname: ${skill.id}\ndescription: [^\n]+\n---\n`));
    assert.deepEqual(packaged.readUiSkill(skill.id), loaded, 'packaged extension includes the actual guide');
  }
  catalog[0].title = 'changed'; catalog.push({ id: 'injected' });
  assert.notEqual(listUiSkills()[0].title, 'changed');
  for (const id of ['../hub', '/etc/passwd', '__proto__', null, {}, 'missing']) assert.throws(() => readUiSkill(id), /Unknown UI skill/);
});
