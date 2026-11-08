import { codeGrammar } from './code-grammar.mjs';
import { sourceLanguage } from './source-language.mjs';
const LIMIT = 512 * 1024;
export function outlineSupported(path) { return /\.(?:[cm]?[jt]sx?|pyi?|rs|go|mdx?|markdown|jsonc?|css|scss|less|html?)$/i.test(path); }
const definitions = {
  FunctionDeclaration: 'function', ClassDeclaration: 'class', MethodDeclaration: 'method', InterfaceDeclaration: 'interface', TypeAliasDeclaration: 'type', EnumDeclaration: 'enum',
  FunctionDefinition: 'function', ClassDefinition: 'class', FunctionItem: 'function', StructItem: 'struct', EnumItem: 'enum', TraitItem: 'trait', ImplItem: 'impl', ModItem: 'module',
  FunctionDecl: 'function', MethodDecl: 'method', TypeSpec: 'type',
};
export async function outlineCode(path, text) {
  if (text.length > LIMIT) return [];
  if (!['javascript', 'jsx', 'typescript', 'tsx', 'python', 'rust', 'go', 'markdown'].includes(sourceLanguage(path, text).id)) return null;
  const support = await codeGrammar(path, text); const language = support?.language || support; if (!language) return null;
  const lines = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') lines.push(i + 1);
  const position = (offset) => { let low = 0, high = lines.length; while (low + 1 < high) { const mid = (low + high) >> 1; if (lines[mid] <= offset) low = mid; else high = mid; } return { line: low + 1, column: offset - lines[low] + 1 }; };
  const items = [];
  language.parser.parse(text).iterate({ enter(ref) {
    if (items.length >= 300) return false;
    const node = ref.node;
    if (/^ATXHeading[1-6]$/.test(node.name)) {
      items.push({ name: text.slice(node.firstChild.to, node.to).trim().replace(/\s+#+$/, ''), kind: 'heading', depth: Number(node.name.at(-1)) - 1, ...position(node.from) }); return false;
    }
    let kind = definitions[node.name];
    if (node.name === 'VariableDeclaration' && node.getChild('ArrowFunction')) kind = 'function';
    if (!kind) return;
    let nameNode = node.firstChild;
    while (nameNode && !/^(VariableDefinition|PropertyDefinition|VariableName|BoundIdentifier|TypeIdentifier|DefName|TypeDefinition)$/.test(nameNode.name)) nameNode = nameNode.nextSibling;
    if (!nameNode) return;
    let depth = 0; for (let parent = node.parent; parent; parent = parent.parent) if (definitions[parent.name]) depth++;
    items.push({ name: `${kind === 'impl' ? 'impl ' : ''}${text.slice(nameNode.from, nameNode.to)}`, kind, depth: Math.min(4, depth), ...position(nameNode.from) });
  } });
  return items;
}
