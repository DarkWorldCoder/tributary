import * as React from "react";
import { useShortcutPreferences } from "@/hooks/use-shortcut-preferences";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { findFileLinks, projectRelative } from "@/lib/terminal-links.mjs";
import { hub } from "@/store";
import { terminalConsumer } from '@/lib/terminal-consumer.mjs';

// One listener per event type, routed to the terminal that owns the output.
type Output = { data: string; owner?: string; seq?: number };
const sinks = new Map<string, (packet: Output) => void>();
const exits = new Map<string, (code: number) => void>();
let wired = false;
export function wire() {
  if (wired) return;
  wired = true;
  hub.on("term-data", ({ id, ...packet }) => sinks.get(id)?.(packet));
  hub.on("term-exit", ({ id, code }) => exits.get(id)?.(code));
}

// xterm wants hex colors; the theme tokens are oklch, so let the browser convert them.
let probe: CanvasRenderingContext2D | null = null;
function hex(css: string, fallback: string) {
  probe ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!probe || !css) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = fallback;
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const token = (
  name: string,
  fallback: string,
  element: Element = document.documentElement,
) => hex(getComputedStyle(element).getPropertyValue(name).trim(), fallback);

// ANSI colors from VS Code's default terminal themes; xterm raises contrast against the background where needed.
const DARK: ITheme = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};
const LIGHT: ITheme = {
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

function terminalTheme(element: Element = document.documentElement): ITheme {
  const dark = document.documentElement.classList.contains("dark");
  const background = token("--card", dark ? "#1c1b1a" : "#ffffff", element);
  const foreground = token(
    "--foreground",
    dark ? "#e5e5e5" : "#1f1f1f",
    element,
  );
  const brand = token("--brand", "#4f46e5", element);
  return {
    ...(dark ? DARK : LIGHT),
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: `${brand}59`,
    selectionInactiveBackground: `${brand}33`,
  };
}

const FONT_KEY = "tributary.termFontSize";
const fontSize = () => {
  try {
    const n = Number(localStorage.getItem(FONT_KEY));
    return n >= 8 && n <= 32 ? n : 13;
  } catch {
    return 13;
  }
};
function setFontSize(n: number) {
  const next = Math.min(32, Math.max(8, n));
  try {
    localStorage.setItem(FONT_KEY, String(next));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event("tributary:terminal-font"));
}


type Props = {
  id: string;
  project: string | null;
  active: boolean;
  onExit: (code: number) => void;
  onTitle?: (title: string) => void;
  onKill?: () => void;
  onOpenFile?: (rel: string, line?: number) => void;
};

/** One xterm.js terminal on a pseudo-terminal in the main process. */
export function XtermView({
  id,
  project,
  active,
  onExit,
  onTitle,
  onKill,
  onOpenFile,
}: Props) {
  const { platform } = useShortcutPreferences();
  const mac = platform === 'mac';
  const keyboardMac = React.useRef(mac); keyboardMac.current = mac;
  const host = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  const searchRef = React.useRef<SearchAddon | null>(null);
  const callbacks = React.useRef({ onExit, onTitle, onOpenFile, project });
  callbacks.current = { onExit, onTitle, onOpenFile, project };
  const [search, setSearch] = React.useState<{
    open: boolean;
    query: string;
    results: string;
  }>({ open: false, query: "", results: "" });
  const [selection, setSelection] = React.useState(false);
  const openSearch = React.useCallback(
    () => setSearch((s) => ({ ...s, open: true })),
    [],
  );

  React.useEffect(() => {
    const term = new Terminal({
      fontFamily:
        getComputedStyle(document.documentElement)
          .getPropertyValue("--font-mono")
          .trim() || "monospace",
      fontSize: fontSize(),
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 10000,
      minimumContrastRatio: 4.5,
      theme: terminalTheme(host.current ?? document.documentElement),
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    const searchAddon = new SearchAddon();
    searchRef.current = searchAddon;
    term.loadAddon(fit);
    term.loadAddon(searchAddon);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(
      new WebLinksAddon((_e, uri) => hub.call("openExternal", uri)),
    );
    term.open(host.current!);

    // GPU rendering; after a lost context, fall back to the DOM renderer and try the GPU again a little later.
    let webglTries = 0;
    let webglTimer = 0;
    const webgl = () => {
      try {
        const gl = new WebglAddon();
        gl.onContextLoss(() => {
          gl.dispose();
          if (++webglTries < 3) webglTimer = window.setTimeout(webgl, 1000);
        });
        term.loadAddon(gl);
      } catch {
        /* DOM renderer */
      }
    };
    webgl();

    // Paths such as src/app.ts:12:4 in compiler output and stack traces open in the editor.
    const links = term.registerLinkProvider({
      provideLinks(y, done) {
        const { project: root, onOpenFile: open } = callbacks.current;
        const text = term.buffer.active.getLine(y - 1)?.translateToString(true);
        if (!text || !root || !open) return done(undefined);
        const found = findFileLinks(text).flatMap((l) => {
          const rel = projectRelative(root, l.path);
          return rel
            ? [
                {
                  range: { start: { x: l.start + 1, y }, end: { x: l.end, y } },
                  text: text.slice(l.start, l.end),
                  decorations: { underline: true, pointerCursor: true },
                  activate: () => open(rel, l.line),
                },
              ]
            : [];
        });
        done(found.length ? found : undefined);
      },
    });

    const copy = () => {
      const text = term.getSelection();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const key = e.key.toLowerCase();
      const mod = keyboardMac.current ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && key === "c") {
        copy();
        return false;
      }
      if (mod && e.shiftKey && key === "v") {
        e.preventDefault();
        navigator.clipboard
          .readText()
          .then((t) => term.paste(t))
          .catch(() => {});
        return false;
      }
      // Ctrl+C copies when text is selected, and interrupts the program otherwise.
      if (mod && !e.shiftKey && key === "c" && term.hasSelection()) {
        copy();
        term.clearSelection();
        return false;
      }
      if (mod && key === "f") {
        e.preventDefault();
        openSearch();
        return false;
      }
      if (mod && (key === "=" || key === "+")) {
        e.preventDefault();
        setFontSize(term.options.fontSize! + 1);
        return false;
      }
      if (mod && key === "-") {
        e.preventDefault();
        setFontSize(term.options.fontSize! - 1);
        return false;
      }
      if (mod && key === "0") {
        e.preventDefault();
        setFontSize(13);
        return false;
      }
      return true;
    });

    const owner = crypto.randomUUID();
    const consumer = terminalConsumer({ owner, write: (data, done) => term.write(data, done), acknowledge: (lease, seq) => { void hub.call('termAck', id, lease, seq).catch(() => {}); } });
    sinks.set(id, (packet) => { if (packet.owner != null && packet.seq != null) consumer.receive({ data: packet.data, owner: packet.owner, seq: packet.seq }); else term.write(packet.data); });
    exits.set(id, (code) => {
      term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`);
      callbacks.current.onExit(code);
    });
    void hub.call('termAttach', id, owner).catch(() => {});
    const subs = [
      term.onData((d) => hub.call("termWrite", id, d).catch(() => {})),
      term.onTitleChange((t) => callbacks.current.onTitle?.(t)),
      term.onSelectionChange(() => setSelection(term.hasSelection())),
      searchAddon.onDidChangeResults(({ resultIndex, resultCount }) =>
        setSearch((s) => ({
          ...s,
          results: resultCount
            ? `${resultIndex + 1} of ${resultCount}`
            : "No results",
        })),
      ),
    ];

    // Fit at most once a frame, and tell the shell only when the size really changed.
    let frame = 0;
    let size = "";
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!host.current?.offsetParent) return;
        try {
          fit.fit();
        } catch {
          return;
        }
        const next = `${term.cols}x${term.rows}`;
        if (next !== size) {
          size = next;
          hub.call("termResize", id, term.cols, term.rows).catch(() => {});
        }
      });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host.current!);
    resize();

    // Follow the app's light and dark theme, and the shared font size.
    const themeWatch = new MutationObserver(() => {
      term.options.theme = terminalTheme(
        host.current ?? document.documentElement,
      );
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-extension-theme", "data-workbench-palette"],
    });
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; action: string }>)
        .detail;
      if (detail?.id !== id) return;
      if (detail.action === "focus") term.focus();
      else if (detail.action === "find") openSearch();
      else if (detail.action === "clear") {
        term.clear();
        term.focus();
      }
    };
    window.addEventListener("tributary:terminal-command", onCommand);
    const onFont = () => {
      term.options.fontSize = fontSize();
      resize();
    };
    window.addEventListener("tributary:terminal-font", onFont);

    return () => {
      ro.disconnect();
      themeWatch.disconnect();
      window.removeEventListener("tributary:terminal-command", onCommand);
      window.removeEventListener("tributary:terminal-font", onFont);
      cancelAnimationFrame(frame);
      clearTimeout(webglTimer);
      for (const s of subs) s.dispose();
      links.dispose();
      consumer.dispose();
      void hub.call('termDetach', id, owner).catch(() => {});
      sinks.delete(id);
      exits.delete(id);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [id, openSearch]);

  React.useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit();
        if (!document.activeElement?.closest('[role="tablist"]'))
          termRef.current?.focus();
      } catch {
        /* A hidden or disposed renderer will fit when shown again. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [active]);

  const decorations = React.useMemo(() => {
    const brand = token(
      "--brand",
      "#4f46e5",
      host.current ?? document.documentElement,
    );
    return {
      matchBackground: `${brand}40`,
      activeMatchBackground: `${brand}99`,
      matchOverviewRuler: brand,
      activeMatchColorOverviewRuler: brand,
    };
  }, [search.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const find = (query: string, back = false) => {
    const s = searchRef.current;
    if (!s) return;
    if (!query) {
      s.clearDecorations();
      setSearch((x) => ({ ...x, results: "" }));
      return;
    }
    const opts = { decorations, incremental: !back };
    if (back) s.findPrevious(query, opts);
    else s.findNext(query, opts);
  };
  const closeSearch = () => {
    searchRef.current?.clearDecorations();
    setSearch({ open: false, query: "", results: "" });
    termRef.current?.focus();
  };
  const term = termRef.current;
  const run = (fn: (t: Terminal) => void) => () => {
    if (termRef.current) {
      fn(termRef.current);
      termRef.current.focus();
    }
  };

  return (
    <div className={cn("relative h-full w-full", !active && "hidden")}>
      <ContextMenu
        onOpenChange={(open) => {
          if (open) setSelection(!!term?.hasSelection());
        }}
      >
        <ContextMenuTrigger asChild>
          <div ref={host} className="terminal-canvas h-full w-full" />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={!selection}
            onSelect={run((t) => {
              navigator.clipboard.writeText(t.getSelection()).catch(() => {});
            })}
          >
            Copy
            <ContextMenuShortcut>
              {mac ? "⌘C" : "Ctrl+Shift+C"}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={run((t) => {
              navigator.clipboard
                .readText()
                .then((x) => t.paste(x))
                .catch(() => {});
            })}
          >
            Paste
            <ContextMenuShortcut>
              {mac ? "⌘V" : "Ctrl+Shift+V"}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={run((t) => t.selectAll())}>
            Select all
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={openSearch}>
            Find
            <ContextMenuShortcut>{mac ? "⌘F" : "Ctrl+F"}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={run((t) => t.clear())}>
            Clear
          </ContextMenuItem>
          {onKill && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={onKill}>
                Kill terminal
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {search.open && (
        <div
          role="search"
          className="terminal-find absolute top-2 right-3 z-10 flex items-center gap-1 rounded border bg-popover p-1 shadow-md"
        >
          <Input
            autoFocus
            value={search.query}
            placeholder="Find…"
            aria-label="Find in terminal"
            className="h-7 min-w-0 flex-1 text-xs"
            onChange={(e) => {
              setSearch((x) => ({ ...x, query: e.target.value }));
              find(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                find(search.query, e.shiftKey);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
          />
          <span
            aria-live="polite"
            className="terminal-find-results px-1 text-center text-[11px] text-muted-foreground tabular-nums"
          >
            {search.results}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous match"
            onClick={() => find(search.query, true)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Next match"
            onClick={() => find(search.query)}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close find"
            onClick={closeSearch}
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}
