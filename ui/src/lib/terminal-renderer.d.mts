import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";
export interface RendererResource {
  dispose(): void;
}
export interface VisibleRenderer {
  setVisible(visible: boolean): void;
  dispose(): void;
  state(): {
    visible: boolean;
    closed: boolean;
    ready: boolean;
    retrying: boolean;
    attempts: number;
  };
}
export function visibleRenderer(options: {
  create: (lost: () => void) => RendererResource;
  retryMs?: number;
  maxAttempts?: number;
}): VisibleRenderer;
export function webglResource(
  terminal: Pick<Terminal, "element" | "loadAddon">,
  createAddon: () => WebglAddon,
  lost: () => void,
): RendererResource;
