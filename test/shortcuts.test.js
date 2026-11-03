'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('keyboard commands match Ctrl and Command, keep legacy aliases, and reject typing and repeated events', async () => {
  const { SHORTCUTS, shortcutAction } = await import('../core/shortcuts.mjs');
  const event = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, repeat: false, ...extra });
  for (const shortcut of SHORTCUTS) {
    for (const keys of [shortcut.keys, ...(shortcut.aliases || [])]) {
      for (const modifier of ['ctrlKey', 'metaKey']) {
        const input = event(keys.at(-1), { [modifier]: keys.includes('Mod'), shiftKey: keys.includes('Shift') });
        assert.equal(shortcutAction(input), shortcut.id, `${shortcut.id}: ${modifier}`);
        assert.equal(shortcutAction({ ...input, repeat: true }), null);
        assert.equal(shortcutAction({ ...input, isComposing: true }), null);
        assert.equal(shortcutAction({ ...input, altKey: true }), null);
      }
    }
  }
  assert.equal(shortcutAction(event('k')), null);
  assert.equal(shortcutAction(event('O', { ctrlKey: true })), null);
  assert.equal(shortcutAction(event('O', { ctrlKey: true, shiftKey: true })), 'new');
  assert.equal(shortcutAction(event('e', { ctrlKey: true, shiftKey: true })), 'files');
});
