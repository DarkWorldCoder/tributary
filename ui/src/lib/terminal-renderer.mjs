// The shell, parser and scrollback outlive the replaceable graphics renderer.
// Hidden panes use xterm's DOM renderer; GPU resources belong only to visible panes.
export function visibleRenderer({
  create,
  clock = globalThis,
  retryMs = 1000,
  maxAttempts = 3,
}) {
  let visible = false;
  let closed = false;
  let resource = null;
  let timer;
  let attempts = 0;
  let generation = 0;
  const cancelRetry = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };
  const release = () => {
    const old = resource;
    resource = null;
    try {
      old?.dispose();
    } catch {
      /* A lost graphics device must not end the shell. */
    }
  };
  const start = () => {
    if (closed || !visible || resource || attempts >= maxAttempts) return;
    const epoch = ++generation;
    attempts++;
    try {
      const next = create(() => {
        if (closed || epoch !== generation) return;
        generation++;
        release();
        if (visible && attempts < maxAttempts) {
          cancelRetry();
          const retryGeneration = generation;
          timer = clock.setTimeout(() => {
            if (retryGeneration !== generation) return;
            timer = undefined;
            start();
          }, retryMs);
        }
      });
      // Also handles a loss reported synchronously while the addon activates.
      if (closed || !visible || epoch !== generation) {
        try {
          next.dispose();
        } catch {}
      } else resource = next;
    } catch {
      /* Unsupported graphics/failed activation: retain the DOM fallback. */
    }
  };
  return {
    setVisible(value) {
      if (closed || visible === !!value) return;
      visible = !!value;
      generation++;
      cancelRetry();
      if (visible) {
        attempts = 0;
        start();
      } else release();
    },
    dispose() {
      if (closed) return;
      closed = true;
      visible = false;
      generation++;
      cancelRetry();
      release();
    },
    state: () => ({
      visible,
      closed,
      ready: !!resource,
      retrying: timer !== undefined,
      attempts,
    }),
  };
}

// Use public xterm addon APIs and public canvas/WebGL APIs, not private _core fields.
// Disposing the addon restores xterm's DOM renderer and deletes its GL handles.
// Losing its detached context then releases the native context without awaiting GC.
export function webglResource(terminal, createAddon, lost) {
  if (!terminal.element)
    throw new Error("Open the terminal before activating graphics.");
  const before = new Set(terminal.element.querySelectorAll("canvas"));
  let addon;
  let subscription;
  let contexts = [];
  let disposed = false;
  const capture = () => {
    for (const canvas of terminal.element?.querySelectorAll("canvas") || []) {
      if (before.has(canvas)) continue;
      // xterm's other canvas layers already own a 2D context, so this returns null
      // for those canvases. Only the newly installed WebGL renderer is collected.
      try {
        const context = canvas.getContext("webgl2");
        if (context) contexts.push(context);
      } catch {
        /* unavailable context */
      }
    }
    before.clear();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const oldAddon = addon;
    const oldSubscription = subscription;
    addon = null;
    subscription = null;
    try {
      oldSubscription?.dispose();
    } finally {
      try {
        oldAddon?.dispose();
      } finally {
        for (const context of contexts) {
          try {
            if (!context.isContextLost()) context.getExtension("WEBGL_lose_context")?.loseContext();
          } catch {
            /* already lost or unsupported */
          }
        }
        contexts = [];
      }
    }
  };
  try {
    addon = createAddon();
    subscription = addon.onContextLoss(lost);
    terminal.loadAddon(addon);
    capture();
    return { dispose };
  } catch (error) {
    capture();
    try {
      dispose();
    } catch {}
    throw error;
  }
}
