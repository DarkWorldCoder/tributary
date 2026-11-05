export type ExplorerNode = { name: string; path: string; dir: boolean; children: ExplorerNode[] };
type Token = { epoch: number; sequence: number };
export function createExplorerIndex(): {
  readonly files: string[] | null; readonly shown: string[]; readonly tree: ExplorerNode[]; readonly chains: Map<string, string[]>;
  beginList(): Token; acceptFiles(token: Token, files: string[]): boolean;
  beginSearch(): { token: Token; changed: boolean }; acceptMatches(token: Token, files: string[]): boolean;
  derive(filter: string, hidden: boolean, compact: boolean, warm: boolean): void;
  release(): void;
};
