export type DirectorySession = { counts: Map<string, number>; focusPath: string; lastActive: string | null | undefined };
export function createDirectorySession(): DirectorySession;
export function directoryTarget(session: DirectorySession, folder: string, hidden: boolean, previousCount: number, offset: number, pageSize?: number): number;
export function rememberDirectoryCount(session: DirectorySession, folder: string, hidden: boolean, count: number): void;
export function shouldRevealDirectorySelection(session: DirectorySession, active: string | null): boolean;
