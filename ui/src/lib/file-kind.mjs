const groups = {
  javascript: ['js', 'mjs', 'cjs'], typescript: ['ts', 'mts', 'cts'], react: ['jsx', 'tsx'],
  python: ['py', 'pyi', 'pyw', 'pyx', 'pxd'], rust: ['rs'], go: ['go'], java: ['java', 'jar'], kotlin: ['kt', 'kts'],
  c: ['c', 'h'], cpp: ['cc', 'cpp', 'cxx', 'c++', 'hh', 'hpp', 'hxx', 'ipp'], csharp: ['cs', 'csx'], swift: ['swift'],
  ruby: ['rb', 'erb', 'rake', 'gemspec'], php: ['php', 'phtml'], vue: ['vue'], svelte: ['svelte'],
  code: ['astro', 'dart', 'lua', 'ex', 'exs', 'r', 'scala', 'zig', 'clj', 'cljs', 'cljc', 'edn', 'hs', 'lhs', 'ml', 'mli', 'elm', 'erl', 'hrl', 'jl', 'pl', 'pm', 'nim', 'nix', 'sol', 'v', 'sv', 'vhd', 'vhdl', 'asm', 's', 'groovy', 'gradle', 'f', 'f90', 'pas', 'd', 'fs', 'fsx', 'vb', 'w', 'wgsl', 'glsl', 'vert', 'frag', 'hlsl'],
  json: ['json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'ipynb', 'geojson', 'webmanifest'], markup: ['html', 'htm', 'xml', 'xhtml', 'xsl', 'xslt', 'xsd', 'jsp', 'ejs', 'hbs', 'handlebars', 'liquid', 'twig'],
  style: ['css', 'scss', 'sass', 'less'], markdown: ['md', 'mdx', 'markdown', 'rst'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg', 'tif', 'tiff', 'heic', 'heif', 'jxl', 'psd', 'ai', 'eps', 'raw', 'dng', 'cr2', 'nef'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'aiff', 'aif', 'opus', 'mid', 'midi', 'wma'], video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'mpeg', 'mpg', 'wmv', 'flv', 'ogv'],
  archive: ['zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar', 'zst', 'br', 'lz', 'lzma', 'deb', 'rpm', 'dmg', 'iso', 'apk', 'vsix'],
  document: ['txt', 'log', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'tex'],
  sheet: ['csv', 'tsv', 'xls', 'xlsx', 'ods', 'parquet'], presentation: ['ppt', 'pptx', 'odp', 'key'],
  config: ['yaml', 'yml', 'toml', 'ini', 'conf', 'config', 'properties', 'env', 'cfg', 'prefs', 'plist', 'tf', 'tfvars', 'hcl'],
  terminal: ['sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'csh', 'ksh'], database: ['sql', 'db', 'sqlite', 'sqlite3', 'prisma', 'duckdb', 'mdb', 'rdb'],
  font: ['woff', 'woff2', 'ttf', 'otf', 'eot'], binary: ['bin', 'exe', 'dll', 'so', 'dylib', 'wasm', 'o', 'a', 'class', 'pyc'],
  certificate: ['pem', 'crt', 'cer', 'p12', 'pfx', 'pub', 'key', 'der'], graph: ['graphql', 'gql', 'proto'],
  model: ['glb', 'gltf', 'obj', 'fbx', 'stl', 'blend', 'usd', 'usdz', 'step', 'stp'],
  data: ['arrow', 'feather', 'avro', 'h5', 'hdf5', 'npy', 'npz', 'pkl', 'pickle', 'safetensors', 'onnx', 'pt', 'pth', 'gguf'],
};
const extensions = new Map(Object.entries(groups).flatMap(([kind, list]) => list.map((extension) => [extension, kind])));
export function fileKind(path) {
  const name = path.replaceAll('\\', '/').split('/').pop().toLowerCase();
  if (/^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|poetry\.lock|uv\.lock|composer\.lock|gemfile\.lock|pipfile\.lock|go\.sum)$/.test(name)) return 'lock';
  if (/^(package\.json|composer\.json|cargo\.toml|pyproject\.toml|go\.mod|gemfile|pipfile)$/.test(name)) return 'package';
  if (/^(dockerfile|containerfile)(\.|$)/.test(name)) return 'container';
  if (/^(makefile|gnumakefile|justfile|procfile|rakefile|brewfile)$/.test(name)) return 'terminal';
  if (/^\.(gitignore|gitattributes|gitmodules|gitkeep)$/.test(name)) return 'git';
  if (/^\.env($|\.)/.test(name) || /^\.(editorconfig|npmrc|yarnrc|prettierrc|eslintrc|babelrc|browserslistrc|stylelintrc|nvmrc|node-version|python-version|tool-versions|bashrc|zshrc|dockerignore)(\.|$)/.test(name)) return 'config';
  if (/^(tsconfig|jsconfig)(\.|$)/.test(name) || /^(vite|vitest|webpack|rollup|next|nuxt|svelte|astro|tailwind|postcss|eslint|prettier|babel|jest|playwright|cypress)\.config\./.test(name)) return 'config';
  if (/^(readme|license|licence|notice|changelog|authors|contributing)$/i.test(name)) return 'document';
  return extensions.get(name.split('.').pop()) ?? 'file';
}
