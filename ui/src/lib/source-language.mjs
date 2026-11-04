// One file identity drives syntax loading, outlines and the editor status label.
const profiles = [
  ["javascript", "JavaScript", "js mjs cjs"],
  ["jsx", "JavaScript React", "jsx"],
  ["typescript", "TypeScript", "ts mts cts"],
  ["tsx", "TypeScript React", "tsx"],
  ["python", "Python", "py pyi pyw"],
  ["rust", "Rust", "rs"],
  ["go", "Go", "go"],
  ["java", "Java", "java"],
  ["kotlin", "Kotlin", "kt kts"],
  ["c", "C", "c h"],
  ["cpp", "C++", "cc cpp cxx c++ hh hpp hxx ipp"],
  ["csharp", "C#", "cs csx"],
  ["swift", "Swift", "swift"],
  ["ruby", "Ruby", "rb rake gemspec"],
  ["php", "PHP", "php phtml"],
  ["vue", "Vue", "vue"],
  ["html", "HTML", "html htm xhtml"],
  ["xml", "XML", "xml xsl xslt xsd svg plist csproj vbproj"],
  ["json", "JSON", "json geojson webmanifest ipynb"],
  ["jsonc", "JSON with Comments", "jsonc json5"],
  ["css", "CSS", "css"],
  ["scss", "SCSS", "scss"],
  ["less", "Less", "less"],
  ["markdown", "Markdown", "md mdx markdown"],
  ["yaml", "YAML", "yaml yml"],
  ["toml", "TOML", "toml"],
  ["shell", "Shell Script", "sh bash zsh ksh"],
  ["powershell", "PowerShell", "ps1 psm1 psd1"],
  ["dockerfile", "Dockerfile", "dockerfile"],
  ["sql", "SQL", "sql"],
  ["lua", "Lua", "lua"],
  ["perl", "Perl", "pl pm"],
  ["cmake", "CMake", "cmake"],
  ["properties", "Properties", "ini cfg properties conf env"],
  ["diff", "Diff", "diff patch"],
  ["scala", "Scala", "scala sc"],
  ["dart", "Dart", "dart"],
  ["groovy", "Groovy", "groovy gradle"],
  ["haskell", "Haskell", "hs lhs"],
  ["erlang", "Erlang", "erl hrl"],
  ["elm", "Elm", "elm"],
  ["shader", "GLSL", "glsl vert frag"],
  ["tex", "LaTeX", "tex sty cls"],
];
export const SOURCE_LANGUAGES = profiles.map(([id, label, extensions]) => ({
  id,
  label,
  extensions: extensions.split(" "),
}));
const byId = new Map(SOURCE_LANGUAGES.map((item) => [item.id, item]));
const byExtension = new Map(
  SOURCE_LANGUAGES.flatMap((item) => item.extensions.map((ext) => [ext, item])),
);
const TEXT = { id: "text", label: "Plain Text", extensions: [] };
export function sourceLanguage(path, text = "") {
  const name = String(path)
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    .toLowerCase();
  if (/^(dockerfile|containerfile)(\.|$)/.test(name))
    return byId.get("dockerfile");
  if (name === "cmakelists.txt") return byId.get("cmake");
  if (/^(gemfile|rakefile|guardfile|brewfile)$/.test(name))
    return byId.get("ruby");
  if (
    /^(\.bashrc|\.bash_profile|\.profile|\.zshrc|\.zprofile|\.bash_aliases)$/.test(
      name,
    )
  )
    return byId.get("shell");
  if (/^\.env(?:\.|$)/.test(name)) return byId.get("properties");
  if (
    /^(?:tsconfig|jsconfig)(?:\..+)?\.json$/.test(name) ||
    /^\.(?:eslintrc|babelrc|jshintrc)$/.test(name)
  )
    return byId.get("jsonc");
  if (/^\.prettierrc$/.test(name))
    return byId.get(/^\s*(?:---|[\w-]+:)/.test(text) ? "yaml" : "jsonc");
  const known = byExtension.get(
    name.includes(".") ? name.split(".").pop() : "",
  );
  if (known) return known;
  const firstLine = text.slice(0, 256).split("\n")[0];
  if (firstLine.startsWith("#!")) {
    if (/\b(?:python[\d.]*)\b/.test(firstLine)) return byId.get("python");
    if (/\b(?:node|nodejs|deno|bun)\b/.test(firstLine))
      return byId.get("javascript");
    if (/\b(?:bash|zsh|ksh|sh)\b/.test(firstLine)) return byId.get("shell");
    if (/\bruby\b/.test(firstLine)) return byId.get("ruby");
    if (/\bperl\b/.test(firstLine)) return byId.get("perl");
  }
  return TEXT;
}
const structural = new Set([
  "javascript",
  "jsx",
  "typescript",
  "tsx",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "php",
  "vue",
  "html",
  "xml",
  "css",
  "scss",
  "less",
  "markdown",
  "json",
  "yaml",
]);
export const sourceSyntaxSupported = (path, text = "") =>
  structural.has(sourceLanguage(path, text).id) &&
  !["markdown", "yaml", "html", "vue", "xml"].includes(
    sourceLanguage(path, text).id,
  );
