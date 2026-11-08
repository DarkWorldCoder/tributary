// Diagnostic builds only: render counters deliberately are not timing/RAM data.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from '../../ui/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url)), output = process.argv[2];
if (!output || !path.isAbsolute(output) || !output.startsWith('/tmp/tributary-file-intent-')) throw Error('Use an absolute /tmp/tributary-file-intent-* build directory.');
const files = ['ui/src/store.tsx', 'ui/src/components/workspace-files.tsx', 'scripts/performance/file-intent-probe.mjs', 'scripts/performance/native-file-intent.cjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
files.push(...['ui/src/lib/file-request.mjs', 'ui/src/hooks/use-file-request.ts', 'ui/src/lib/file-watch-session.mjs'].filter(file => fs.existsSync(path.join(root, file))));
const before = hashes(), helper = `function countFileIntentRender(name: string) { const p = ((globalThis as any).__fileIntentProbe ??= { counts: {} }); p.counts[name] = (p.counts[name] || 0) + 1; }\n`;
const components = { 'composer.tsx': 'Composer', 'conversation.tsx': 'Conversation', 'thread-header.tsx': 'ThreadHeader', 'developer-rail.tsx': 'DeveloperRail' };
const instrumented = [];
await build({ root: path.join(root, 'ui'), configFile: path.join(root, 'ui/vite.config.ts'), logLevel: 'warn', build: { outDir: output, emptyOutDir: true }, plugins: [{
  name: 'diagnostic-file-intent-counts', enforce: 'pre', transform(source, id) {
    if (id.endsWith('/ui/src/store.tsx')) {
      const provider = 'const v = useStoreValue();', reader = 'export function useStore() {';
      if (!source.includes(provider) || !source.includes(reader)) throw Error('Store probe anchors changed.');
      instrumented.push('StoreProvider', 'useStore');
      return helper + source.replace(provider, `${provider} countFileIntentRender('StoreProvider'); (globalThis as any).__fileIntentProbe.openFile = v.openFile;`)
        .replace(reader, `${reader} countFileIntentRender('useStore');`);
    }
    const name = components[path.basename(id)];
    if (!id.includes('/ui/src/components/') || !name) return;
    const pattern = new RegExp(`^(export function ${name}[^\\n]*\\{)\\n`, 'm');
    if (!pattern.test(source)) throw Error('Component probe anchor changed: ' + name);
    instrumented.push(name);
    return helper + source.replace(pattern, `$1\n  countFileIntentRender('${name}');\n`);
  },
}] });
if (JSON.stringify(hashes()) !== JSON.stringify(before)) throw Error('Sources changed during diagnostic build.');
fs.writeFileSync(path.join(output, 'probe-sources.json'), JSON.stringify({ sourceHashes: before, instrumented, scope: 'Counter-instrumented diagnostic build; not timing or memory evidence.' }, null, 2) + '\n');
console.log(JSON.stringify({ output, instrumented }));
