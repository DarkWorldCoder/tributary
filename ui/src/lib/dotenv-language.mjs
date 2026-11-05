import { tags } from "@lezer/highlight";

// Highlight configuration as text; never evaluate or expand its values.
export const dotenv = {
  name: "dotenv",
  startState: () => ({ quote: null, value: false }),
  tokenTable: { environmentReference: tags.special(tags.variableName) },
  token(stream, state) {
    if (stream.sol() && !state.quote) state.value = false;
    if (!state.quote && stream.eatSpace()) return null;
    if (!state.quote && stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (!state.value && !state.quote) {
      if (stream.match(/export\b(?=\s)/)) return "keyword";
      if (stream.match(/[\w.-]+(?=\s*=)/)) return "propertyName";
      if (stream.eat("=")) {
        state.value = true;
        return "operator";
      }
      stream.next();
      return null;
    }
    if (state.quote !== "'" && stream.match(/\$\{[^}\r\n]*\}|\$[A-Za-z_][A-Za-z0-9_]*/))
      return "environmentReference";
    const ch = stream.next();
    if (ch === "\\" && state.quote !== "'") {
      stream.next();
      return "string";
    }
    if (state.quote) {
      if (ch === state.quote) state.quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      state.quote = ch;
    }
    return "string";
  },
  languageData: { commentTokens: { line: "#" } },
};
