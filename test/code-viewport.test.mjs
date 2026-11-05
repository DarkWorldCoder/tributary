import test from 'node:test';
import assert from 'node:assert/strict';
import { codeLanguageFile, shouldWindowCode, supportsCodeViewport, detachedCodeText, codeHasInteraction } from '../ui/src/lib/code-viewport.mjs';
import { sourceLanguage, SOURCE_LANGUAGES } from '../ui/src/lib/source-language.mjs';

test('code viewport grammar names use the existing source language registry and aliases', () => {
  for (const profile of SOURCE_LANGUAGES) assert.equal(sourceLanguage(codeLanguageFile(profile.id)).id, profile.id);
  for (const [name, id] of [['TS', 'typescript'], ['js', 'javascript'], ['sh', 'shell'], ['bash', 'shell'], ['c++', 'cpp'], ['c#', 'csharp'], ['env', 'dotenv'], ['rs', 'rust']]) assert.equal(sourceLanguage(codeLanguageFile(name)).id, id);
  assert.equal(codeLanguageFile('unrecognized-language'), 'snippet.txt');
});
test('small code keeps its renderer; large source and multiline text window without changing ANSI or diff semantics', () => {
  assert.equal(shouldWindowCode('const x = 1;', 'typescript'), false);
  assert.equal(shouldWindowCode('x\n'.repeat(999), 'text'), false);
  assert.equal(shouldWindowCode('x\n'.repeat(1000), 'text'), true);
  assert.equal(shouldWindowCode('x'.repeat(100001), 'typescript'), true);
  assert.equal(shouldWindowCode('x'.repeat(100001), 'unknown'), true);
  for (const language of ['ansi', 'diff', 'patch', 'ANSI']) { assert.equal(supportsCodeViewport(language), false); assert.equal(shouldWindowCode('x\n'.repeat(1001), language), false); }
});
test('detaching append payloads preserves all UTF-16 code units across chunk boundaries', () => {
  const edge = '\r\n\0\ufeff😀\ud800lone\udfff';
  for (const text of ['', edge, 'x'.repeat(16383) + edge, Array.from({ length: 70000 }, (_, n) => String.fromCharCode((n * 47) % 65536)).join('')]) assert.equal(detachedCodeText(text), text);
});
test('focus and native selections pin a viewer, including selections crossing its boundary', () => {
  let focused = false, collapsed = false, intersects = false, detached = false;
  const element = { contains: () => focused, ownerDocument: { activeElement: {}, getSelection: () => ({ isCollapsed: collapsed, rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => { if (detached) throw Error('detached'); return intersects; } }) }) } };
  assert.equal(codeHasInteraction(element), false); focused = true; assert.equal(codeHasInteraction(element), true);
  focused = false; intersects = true; assert.equal(codeHasInteraction(element), true);
  collapsed = true; assert.equal(codeHasInteraction(element), false);
  collapsed = false; detached = true; assert.equal(codeHasInteraction(element), false);
});
