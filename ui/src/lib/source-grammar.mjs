import { sourceLanguage } from "./source-language.mjs";
import { codeGrammar, codeGrammarSupported } from "./code-grammar.mjs";
import { validateSourceWithGrammar } from "./syntax-validation.mjs";
const cache = new Map();
export async function sourceGrammar(path, text = "") {
  const { id } = sourceLanguage(path, text);
  if (codeGrammarSupported(id)) return codeGrammar(path, text);
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
  if (id === "vue") return (await import("@codemirror/lang-vue")).vue();
  if (id === "html") return (await import("@codemirror/lang-html")).html();
  if (id === "xml") return (await import("@codemirror/lang-xml")).xml();
  if (id === "json") return (await import("@codemirror/lang-json")).json();
  if (["css", "scss", "less"].includes(id))
    return (await import("@codemirror/lang-css")).css();
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
export function validateSourceSyntax(path, text) {
  return validateSourceWithGrammar(path, text, sourceGrammar);
}
