import { sourceSyntaxSupported } from "./source-language.mjs";

export async function validateSourceWithGrammar(path, text, loadGrammar) {
  if (text.length > 512 * 1024 || !sourceSyntaxSupported(path, text)) return [];
  const support = await loadGrammar(path, text);
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
