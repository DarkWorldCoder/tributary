// Detection is based on file names, not execution of project configuration.
const STACKS = [
  { name: 'Rust', match: (f) => f === 'Cargo.toml', entry: ['src/main.rs', 'src/lib.rs', 'Cargo.toml'], commands: [{ label: 'Test Rust', command: 'cargo test' }, { label: 'Check Rust', command: 'cargo check' }], extension: 'rust-lang.rust-analyzer' },
  { name: 'Go', match: (f) => f === 'go.mod' || f === 'go.work', entry: ['main.go', 'go.mod', 'go.work'], commands: [{ label: 'Test Go', command: 'go test ./...' }, { label: 'Build Go', command: 'go build ./...' }], extension: 'golang.go' },
  { name: 'JavaScript / TypeScript', match: (f) => f === 'package.json', entry: ['src/main.tsx', 'src/App.tsx', 'src/main.ts', 'src/index.ts', 'src/index.js', 'package.json'], commands: [], extension: 'dbaeumer.vscode-eslint' },
  { name: 'Python', match: (f) => ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].includes(f), entry: ['main.py', 'app.py', 'pyproject.toml'], commands: [{ label: 'Test Python', command: 'python -m pytest' }], extension: 'ms-python.python' },
  { name: 'C / C++', match: (f) => f === 'CMakeLists.txt' || f === 'meson.build', entry: ['src/main.cpp', 'main.cpp', 'src/main.c', 'main.c', 'CMakeLists.txt'], commands: [], extension: 'ms-vscode.cpptools' },
  { name: 'Java', match: (f) => ['pom.xml', 'build.gradle', 'build.gradle.kts'].includes(f), entry: ['pom.xml', 'build.gradle', 'build.gradle.kts'], commands: [], extension: 'vscjava.vscode-java-pack' },
  { name: '.NET', match: (f) => /\.(sln|csproj|fsproj)$/.test(f), entry: ['Program.cs'], commands: [{ label: 'Test .NET', command: 'dotnet test' }], extension: 'ms-dotnettools.csdevkit' },
  { name: 'PHP', match: (f) => f === 'composer.json', entry: ['index.php', 'public/index.php', 'composer.json'], commands: [], extension: 'bmewburn.vscode-intelephense-client' },
  { name: 'Ruby', match: (f) => f === 'Gemfile', entry: ['Gemfile', 'config.ru'], commands: [], extension: 'Shopify.ruby-lsp' },
  { name: 'Zig', match: (f) => f === 'build.zig', entry: ['src/main.zig', 'build.zig'], commands: [{ label: 'Build Zig', command: 'zig build' }], extension: 'ziglang.vscode-zig' },
];
export function projectProfile(input, packageText = '') {
  const files = [...new Set(input.filter((f) => typeof f === 'string').map((f) => f.replaceAll('\\', '/')))];
  const stacks = STACKS.filter((stack) => files.some(stack.match));
  const commands = stacks.flatMap((stack) => stack.commands);
  if (files.includes('Cargo.toml') && files.includes('src/main.rs')) commands.unshift({ label: 'Run Rust', command: 'cargo run' });
  if (files.includes('go.mod') && files.includes('main.go')) commands.unshift({ label: 'Run Go', command: 'go run .' });
  if (files.includes('package.json')) {
    try {
      const scripts = JSON.parse(packageText).scripts || {};
      const manager = files.includes('pnpm-lock.yaml') ? 'pnpm' : files.includes('yarn.lock') ? 'yarn' : files.includes('bun.lock') || files.includes('bun.lockb') ? 'bun' : 'npm';
      for (const name of ['dev', 'start', 'build', 'test']) if (typeof scripts[name] === 'string' && scripts[name].trim()) commands.push({ label: `${name[0].toUpperCase()}${name.slice(1)} JavaScript`, command: `${manager} run ${name}` });
    } catch { /* Invalid manifests still open as text. Do not invent scripts. */ }
  }
  const entries = stacks.flatMap((stack) => stack.entry).filter((f) => files.includes(f));
  const entry = entries[0] || files.find((f) => /^cmd\/[^/]+\/main\.go$/.test(f)) || files.find((f) => /^README(?:\.md)?$/i.test(f)) || null;
  return { stacks: stacks.map(({ name, extension }) => ({ name, extension })), commands, entry };
}
export function localPreviewUrl(value) {
  try { const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`); return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
