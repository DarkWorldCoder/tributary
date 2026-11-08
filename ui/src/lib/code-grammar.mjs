import { sourceLanguage } from "./source-language.mjs";

// Shared by the editor and analysis worker. Editor-only stream/SQL grammars
// stay outside this module so a single-file worker does not bundle them.
const supported = new Set(["javascript", "jsx", "typescript", "tsx", "python", "rust", "go", "java", "c", "cpp", "php", "markdown"]);
const cache = new Map();
export const codeGrammarSupported = (id) => supported.has(id);
export async function codeGrammar(path, text = "") {
  const { id } = sourceLanguage(path, text);
  if (!supported.has(id)) return null;
  if (!cache.has(id)) cache.set(id, load(id).catch((error) => { cache.delete(id); throw error; }));
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
  if (id === "markdown")
    return (await import("@codemirror/lang-markdown")).markdown({
      codeLanguages: [],
    });
  return null;
}
