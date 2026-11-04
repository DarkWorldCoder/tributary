'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const identity = import('../ui/src/lib/source-language.mjs'); const grammars = import('../ui/src/lib/source-grammar.mjs');
test('source identity handles TypeScript variants, config names, containers and executable shebangs', async () => {
 const { sourceLanguage } = await identity;
 for (const [path, text, id] of [['src/view.tsx', '', 'tsx'], ['src/app.mts', '', 'typescript'], ['C:\\project\\Dockerfile.dev', '', 'dockerfile'], ['Containerfile', '', 'dockerfile'], ['CMakeLists.txt', '', 'cmake'], ['tsconfig.build.json', '', 'jsonc'], ['.env.local', '', 'properties'], ['.prettierrc', 'semi: true', 'yaml'], ['script', '#!/usr/bin/env -S python3 -u\nprint(1)', 'python'], ['cli', '#!/usr/bin/env node\nconsole.log(1)', 'javascript'], ['unrecognized', 'some text', 'text']]) assert.equal(sourceLanguage(path, text).id, id, path);
});
test('all advertised source languages load a real bounded editor grammar', async () => {
 const { SOURCE_LANGUAGES } = await identity; const { sourceGrammar } = await grammars;
 for (const item of SOURCE_LANGUAGES) { const grammar = await sourceGrammar('source.' + item.extensions[0]); assert.ok(grammar, item.id); assert.ok((grammar.language || grammar).parser.parse('example').length >= 0, item.id); }
 assert.equal(await sourceGrammar('unknown.file'), null);
});
test('Vue grammar parses embedded TypeScript and template interpolation', async () => {
 const { sourceGrammar } = await grammars;
 const grammar = await sourceGrammar('Component.vue'); const tree = grammar.language.parser.parse('<script setup lang="ts">const count: number = 1;</script><template>{{ count }}</template>').toString();
 assert.match(tree, /TypeAnnotation/); assert.match(tree, /Interpolation/); assert.doesNotMatch(tree, /⚠/);
});
test('source syntax diagnostics handle unsaved TypeScript and keep grammar checks separate from compiler checks', async () => {
 const { validateSourceSyntax } = await grammars;
 for (const [file, text] of [['main.ts', 'const value: number = 1;'], ['view.tsx', 'export const App = () => <div />;'], ['main.go', 'package main\nfunc main() {}'], ['main.rs', 'fn main() { let value = 1; }']]) assert.deepEqual(await validateSourceSyntax(file, text), [], file);
 const errors = await validateSourceSyntax('main.ts', 'const value = ;'); assert.equal(errors.length, 1); assert.equal(errors[0].source, 'Syntax'); assert.equal(errors[0].line, 1); assert.ok(errors[0].column > 1);
 assert.deepEqual(await validateSourceSyntax('huge.ts', ' '.repeat(512 * 1024 + 1)), []);
 assert.deepEqual(await validateSourceSyntax('unknown.file', 'bad {'), []);
});

test('formatting expands compact JavaScript and TypeScript blocks without splitting strings', async () => {
 const { formatDocument, formattingHint } = await import('../ui/src/lib/format-document.mjs');
 const compact = "try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = {}; }";
 assert.equal(formattingHint('secrets.js', compact), 'Compact code');
 const formatted = await formatDocument('secrets.js', compact);
 assert.match(formatted, /^try \{\n  this\.data =/);
 assert.match(formatted, /\n\} catch \{\n  this\.data = \{\};\n\}/);
 assert.equal(formattingHint('secrets.js', formatted), null);
 assert.equal(await formatDocument('secrets.js', formatted), formatted);
 const typed = await formatDocument('sample.ts', 'const identity=(value:string):string=>{const message="do; not; split";return value+message;}');
 assert.match(typed, /value: string/); assert.match(typed, /\n  const message = "do; not; split";\n/);
 assert.equal(formattingHint('notes.txt', compact), null);
 await assert.rejects(formatDocument('bad.ts', 'const value = ;'));
});
