'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('keyboard commands match Ctrl and Command, keep legacy aliases, and reject typing and repeated events', async () => {
  const { SHORTCUTS, shortcutAction } = await import('../core/shortcuts.mjs');
  const event = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, repeat: false, ...extra });
  for (const shortcut of SHORTCUTS) {
    for (const keys of [shortcut.keys, ...(shortcut.aliases || [])]) {
      for (const modifier of ['ctrlKey', 'metaKey']) {
        const input = event(keys.at(-1), { [modifier]: keys.includes('Mod'), shiftKey: keys.includes('Shift'), altKey: keys.includes('Alt') });
        assert.equal(shortcutAction(input), shortcut.id, `${shortcut.id}: ${modifier}`);
        assert.equal(shortcutAction({ ...input, repeat: true }), null);
        assert.equal(shortcutAction({ ...input, isComposing: true }), null);
        assert.equal(shortcutAction({ ...input, altKey: !input.altKey }), null);
      }
    }
  }
  assert.equal(shortcutAction(event('k')), null);
  assert.equal(shortcutAction(event('O', { ctrlKey: true })), null);
  assert.equal(shortcutAction(event('O', { ctrlKey: true, shiftKey: true })), 'new');
  assert.equal(shortcutAction(event('e', { ctrlKey: true, shiftKey: true })), 'files');
});

test('custom shortcuts use the selected platform, detect conflicts and support unassignment', async () => {
  const { keyboardDevice, keyboardPlatform, validBinding, bindingFromEvent, bindingConflict, shortcutAction, readShortcutPreferences } = await import('../core/shortcuts.mjs');
  assert.equal(keyboardPlatform('MacIntel'), 'mac'); assert.equal(keyboardPlatform('Win32'), 'pc'); assert.equal(keyboardPlatform('Linux x86_64'), 'pc');
  assert.equal(keyboardPlatform('darwin'), 'mac'); assert.equal(keyboardPlatform('win32'), 'pc'); assert.equal(keyboardPlatform('iPad'), 'mac');
  assert.equal(keyboardDevice('darwin'), 'Mac'); assert.equal(keyboardDevice('win32'), 'Windows'); assert.equal(keyboardDevice('linux'), 'Linux'); assert.equal(keyboardDevice('Linux Android'), 'Android');
  const event = { key: 'k', code: 'KeyK', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(shortcutAction(event, { platform: 'mac' }), null);
  assert.equal(shortcutAction(event, { platform: 'pc' }), 'search');
  const overrides = { search: ['Mod', 'Alt', 'F'], new: [] };
  assert.equal(shortcutAction(event, { platform: 'pc', overrides }), null);
  assert.equal(shortcutAction({ ...event, key: 'f', code: 'KeyF', altKey: true }, { platform: 'pc', overrides }), 'search');
  assert.equal(shortcutAction({ ...event, key: 'n' }, { platform: 'pc', overrides }), null);
  assert.equal(bindingConflict('new', ['Mod', 'K']).id, 'search');
  assert.equal(bindingConflict('search', ['Mod', 'K']), null);
  assert.deepEqual(bindingFromEvent({ ...event, metaKey: true, ctrlKey: false }, 'mac'), ['Mod', 'K']);
  assert.equal(bindingFromEvent({ ...event, ctrlKey: false }, 'pc'), null);
  assert.equal(validBinding(['Mod', 'Mod', 'K']), false); assert.equal(validBinding(['K']), false);
  assert.equal(validBinding(['Mod', '<script>']), false);
  const saved = readShortcutPreferences({ getItem: () => JSON.stringify({ platform: 'mac', send: 'mod-enter', profiles: { mac: overrides, pc: { search: ['text'] } } }) });
  assert.deepEqual(saved.profiles.mac, overrides); assert.deepEqual(saved.profiles.pc, {}); assert.equal(saved.send, 'mod-enter');
  assert.equal(saved.platform, 'auto', 'old Mac overrides cannot force Command shortcuts on a Windows or Linux device');
  assert.equal(readShortcutPreferences({ getItem: () => '{broken' }).platform, 'auto');
});

test('Option letter shortcuts use their physical letter and never intercept AltGr typing', async () => {
  const { shortcutAction, bindingFromEvent } = await import('../core/shortcuts.mjs');
  const event = { key: '†', code: 'KeyT', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false };
  assert.equal(shortcutAction(event, { platform: 'mac' }), 'team');
  assert.deepEqual(bindingFromEvent(event, 'mac'), ['Mod', 'Alt', 'T']);
  const altgr = { ...event, ctrlKey: true, metaKey: false, getModifierState: (key) => key === 'AltGraph' };
  assert.equal(shortcutAction(altgr, { platform: 'pc' }), null); assert.equal(bindingFromEvent(altgr, 'pc'), null);
});

test('terminal shortcuts recognize shifted digit and backquote keys', async () => {
  const { shortcutAction } = await import('../core/shortcuts.mjs');
  const event = { ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };
  assert.equal(shortcutAction({ ...event, key: '%', code: 'Digit5' }, { platform: 'pc' }), 'split-terminal');
  assert.equal(shortcutAction({ ...event, key: '~', code: 'Backquote' }, { platform: 'pc' }), 'new-terminal');
  assert.equal(shortcutAction({ ...event, shiftKey: false, key: 'p', code: 'KeyP' }, { platform: 'pc' }), 'find-file');
});
