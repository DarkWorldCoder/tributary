const { test } = require('node:test');
const assert = require('node:assert/strict');
const classifier = import('../ui/src/lib/file-kind.mjs');

test('file icons distinguish code, structured data and media across path formats', async () => {
  const { fileKind } = await classifier;
  assert.equal(fileKind('src/Component.TSX'), 'react');
  assert.equal(fileKind('C:\\project\\scripts\\start.mjs'), 'javascript');
  assert.equal(fileKind('data/report.json'), 'json');
  assert.equal(fileKind('photos/cover.SVG'), 'image');
  assert.equal(fileKind('docs/guide.pdf'), 'document');
  assert.equal(fileKind('exports/report.xlsx'), 'sheet');
  assert.equal(fileKind('recording.webm'), 'video');
  assert.equal(fileKind('assets/voice.flac'), 'audio');
  assert.equal(fileKind('release.tar.gz'), 'archive');
});

test('language and framework icons distinguish common development stacks', async () => {
  const { fileKind } = await classifier;
  for (const [path, kind] of Object.entries({
    'app.ts': 'typescript', 'app.jsx': 'react', 'app.vue': 'vue', 'app.svelte': 'svelte',
    'main.py': 'python', 'main.rs': 'rust', 'main.go': 'go', 'Main.java': 'java',
    'Main.kt': 'kotlin', 'main.c': 'c', 'main.hpp': 'cpp', 'Main.cs': 'csharp',
    'App.swift': 'swift', 'app.rb': 'ruby', 'index.php': 'php', 'query.graphql': 'graph',
    'message.proto': 'graph', 'shader.wgsl': 'code', 'shell.nix': 'code',
  })) assert.equal(fileKind(path), kind, path);
});

test('project manifests, configuration and non-code assets have dedicated families', async () => {
  const { fileKind } = await classifier;
  for (const [path, kind] of Object.entries({
    'package.json': 'package', 'Cargo.toml': 'package', 'pyproject.toml': 'package', 'go.mod': 'package',
    'go.sum': 'lock', 'Pipfile.lock': 'lock', 'vite.config.ts': 'config', 'tsconfig.app.json': 'config',
    '.prettierrc': 'config', '.env.production': 'config', '.nvmrc': 'config',
    'events.jsonl': 'json', 'slides.pptx': 'presentation', 'report.ods': 'sheet',
    'scene.glb': 'model', 'weights.gguf': 'data', 'data.arrow': 'data', 'schema.prisma': 'database',
    'cert.pem': 'certificate', 'id_ed25519.pub': 'certificate', 'font.woff2': 'font',
    'photo.heif': 'image', 'sound.opus': 'audio', 'movie.mpeg': 'video', 'bundle.vsix': 'archive',
    'engine.wasm': 'binary', 'arbitrary.unknown': 'file',
  })) assert.equal(fileKind(path), kind, path);
});

test('special filenames get meaningful icons instead of relying only on extensions', async () => {
  const { fileKind } = await classifier;
  assert.equal(fileKind('package-lock.json'), 'lock');
  assert.equal(fileKind('pnpm-lock.yaml'), 'lock');
  assert.equal(fileKind('docker/Dockerfile.production'), 'container');
  assert.equal(fileKind('.env.local'), 'config');
  assert.equal(fileKind('.gitignore'), 'git');
  assert.equal(fileKind('Makefile'), 'terminal');
  assert.equal(fileKind('LICENSE'), 'document');
  assert.equal(fileKind('unknown.custom-extension'), 'file');
  assert.equal(fileKind('extensionless'), 'file');
});
