import { sourceLanguage, sourceSyntaxSupported } from "./source-language.mjs";
const cache = new Map();
export async function sourceGrammar(path, text = "") {
  const { id } = sourceLanguage(path, text);
  if (!cache.has(id))
    cache.set(
      id,
      load(id).catch((error) => {
        cache.delete(id);
        throw error;
      }),
    );
  return cache.get(id);
}
async function load(id) {
  if (["javascript", "jsx", "typescript", "tsx"].includes(id))
    return (await import("@codemirror/lang-javascript")).javascript({
      jsx: ["jsx", "tsx"].includes(id),
      typescript: ["typescript", "tsx"].includes(id),
    });
  if (id === "python")
    return (await import("@codemirror/lang-python")).python();
  if (id === "rust") return (await import("@codemirror/lang-rust")).rust();
  if (id === "go") return (await import("@codemirror/lang-go")).go();
  if (id === "java") return (await import("@codemirror/lang-java")).java();
  if (["c", "cpp"].includes(id))
    return (await import("@codemirror/lang-cpp")).cpp();
  if (id === "php") return (await import("@codemirror/lang-php")).php();
  if (id === "vue") return (await import("@codemirror/lang-vue")).vue();
  if (id === "html") return (await import("@codemirror/lang-html")).html();
  if (id === "xml") return (await import("@codemirror/lang-xml")).xml();
  if (id === "json") return (await import("@codemirror/lang-json")).json();
  if (["css", "scss", "less"].includes(id))
    return (await import("@codemirror/lang-css")).css();
  if (id === "markdown")
    return (await import("@codemirror/lang-markdown")).markdown({
      codeLanguages: [],
    });
  if (id === "sql") return (await import("@codemirror/lang-sql")).sql();
  if (id === "yaml") return (await import("@codemirror/lang-yaml")).yaml();
  const { StreamLanguage } = await import("@codemirror/language");
  if (id === "dotenv")
    return StreamLanguage.define((await import("./dotenv-language.mjs")).dotenv);
  let parser;
  if (id === "jsonc")
    parser = (await import("@codemirror/legacy-modes/mode/javascript")).json;
  else if (["kotlin", "csharp", "scala", "dart", "shader"].includes(id))
    parser = (await import("@codemirror/legacy-modes/mode/clike"))[id];
  else if (id === "shell")
    parser = (await import("@codemirror/legacy-modes/mode/shell")).shell;
  else if (id === "powershell")
    parser = (await import("@codemirror/legacy-modes/mode/powershell"))
      .powerShell;
  else if (id === "dockerfile")
    parser = (await import("@codemirror/legacy-modes/mode/dockerfile"))
      .dockerFile;
  else if (id === "toml")
    parser = (await import("@codemirror/legacy-modes/mode/toml")).toml;
  else if (id === "properties")
    parser = (await import("@codemirror/legacy-modes/mode/properties"))
      .properties;
  else if (id === "swift")
    parser = (await import("@codemirror/legacy-modes/mode/swift")).swift;
  else if (id === "ruby")
    parser = (await import("@codemirror/legacy-modes/mode/ruby")).ruby;
  else if (id === "lua")
    parser = (await import("@codemirror/legacy-modes/mode/lua")).lua;
  else if (id === "perl")
    parser = (await import("@codemirror/legacy-modes/mode/perl")).perl;
  else if (id === "cmake")
    parser = (await import("@codemirror/legacy-modes/mode/cmake")).cmake;
  else if (id === "diff")
    parser = (await import("@codemirror/legacy-modes/mode/diff")).diff;
  else if (id === "groovy")
    parser = (await import("@codemirror/legacy-modes/mode/groovy")).groovy;
  else if (id === "haskell")
    parser = (await import("@codemirror/legacy-modes/mode/haskell")).haskell;
  else if (id === "erlang")
    parser = (await import("@codemirror/legacy-modes/mode/erlang")).erlang;
  else if (id === "elm")
    parser = (await import("@codemirror/legacy-modes/mode/elm")).elm;
  else if (id === "tex")
    parser = (await import("@codemirror/legacy-modes/mode/stex")).stex;
  return parser ? StreamLanguage.define(parser) : null;
}
export async function validateSourceSyntax(path, text) {
  if (text.length > 512 * 1024 || !sourceSyntaxSupported(path, text)) return [];
  const support = await sourceGrammar(path, text);
  if (!support) return [];
  const language = support.language || support;
  const tree = language.parser.parse(text);
  const result = [];
  const seen = new Set();
  const lines = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === "\n") lines.push(index + 1);
  tree.iterate({
    enter(node) {
      if (result.length >= 30) return false;
      if (!node.type.isError || seen.has(node.from)) return;
      seen.add(node.from);
      let low = 0,
        high = lines.length;
      while (low + 1 < high) {
        const mid = (low + high) >> 1;
        if (lines[mid] <= node.from) low = mid;
        else high = mid;
      }
      const token = text
        .slice(node.from, Math.min(node.to, node.from + 24))
        .trim();
      result.push({
        rel: path,
        line: low + 1,
        column: node.from - lines[low] + 1,
        severity: "error",
        source: "Syntax",
        message: token
          ? `Unexpected syntax: ${token}`
          : "Incomplete syntax at this position.",
      });
    },
  });
  return result;
}
