export interface MessagePatch {
  text?: { from: number; add: string }; thinking?: { from: number; add: string };
  tools?: { length: number; set: Record<string, unknown> }; set?: Record<string, unknown>; unset?: string[];
}
export function applyPatch<T extends object>(message: T, patch: MessagePatch): T | null;
