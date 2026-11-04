export interface DebugVariable {
  name: string;
  value: string;
  objectId?: string;
  scope?: string;
}
export interface DebugFrame {
  id: string;
  name: string;
  rel: string | null;
  url: string;
  line: number;
  column: number;
}
export interface DebugState {
  project: string;
  status: "idle" | "starting" | "running" | "paused" | "stopped" | "error";
  owned: boolean;
  entry: string;
  error: string;
  output: string;
  reason: string;
  pauseId: number;
  frames: DebugFrame[];
  selectedFrame: string | null;
  variables: DebugVariable[];
  breakpoints: {
    rel: string;
    line: number;
    verified: boolean;
    actualLine?: number;
  }[];
}
export const emptyDebugState = (project: string): DebugState => ({
  project,
  status: "idle",
  owned: false,
  entry: "",
  error: "",
  output: "",
  reason: "",
  pauseId: 0,
  frames: [],
  selectedFrame: null,
  variables: [],
  breakpoints: [],
});

export function debugMessage(error: unknown): string {
  return String((error as Error)?.message || error)
    .replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "")
    .split("\n")[0]
    .slice(0, 300);
}
