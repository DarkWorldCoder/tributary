import { ShortcutLabel, ShortcutKeys } from "@/components/shortcut-settings";
import * as React from "react";
import { useShortcutPreferences } from "@/hooks/use-shortcut-preferences";
import { Tabs } from "radix-ui";
import "@vscode/codicons/dist/codicon.css";
import { PanelBottom, PanelLeft, PanelRight, PanelTop } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { XtermView, wire } from "@/components/terminal-view";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hub, useStore } from "@/store";
import { takePendingTerminalCommand } from "@/hooks/use-run-in-terminal";

type Term = {
  id: string;
  title: string;
  project: string | null;
  done?: boolean;
  named?: boolean;
  shellTitle?: string;
  group?: string;
};

/** Terminal tabs per project. Hidden, not unmounted, when the panel is closed, so shells and scrollback survive. */
export function TerminalPanel({ hidden = false }: { hidden?: boolean } = {}) {
  const s = useStore();
  const { platform } = useShortcutPreferences();
  const [terms, setTerms] = React.useState<Term[]>([]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [maximized, setMaximized] = React.useState(false);
  const [active, setActive] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(() => {
    try {
      return Number(localStorage.getItem("tributary.termHeight")) || 260;
    } catch {
      return 260;
    }
  });
  const [width, setWidth] = React.useState(() => {
    try {
      return Number(localStorage.getItem("tributary.termWidth")) || 420;
    } catch {
      return 420;
    }
  });
  const section = React.useRef<HTMLElement>(null);
  const cleanupDrag = React.useRef<() => void>(() => {});
  const side = s.terminalDock === "left" || s.terminalDock === "right";
  const leading = s.terminalDock === "left" || s.terminalDock === "top";
  const [maxSize, setMaxSize] = React.useState(800);
  const minSize = side ? Math.min(240, maxSize) : Math.min(120, maxSize);
  const size = Math.min(maxSize, Math.max(minSize, side ? width : height));
  const desktop = s.hub.platform === "desktop";
  const creating = React.useRef(new Set<string | null>());
  const lifetime = React.useRef({ active: true });
  const termsRef = React.useRef(terms); termsRef.current = terms;
  const create = React.useCallback(
    async (command?: string, cwd = s.workdir, group?: string) => {
      wire();
      const owner = lifetime.current;
      creating.current.add(s.workdir);
      try {
        const id = await s.hub.call<string>("createTerminal", { cwd, project: s.workdir, command });
        if (!owner.active) { void s.hub.call('termKill', id).catch(() => {}); return; }
        setTerms((t) => [
          ...t,
          {
            id,
            group,
            project: s.workdir,
            title: command
              ? command.split(" ")[0]
              : `Shell ${t.filter((x) => x.project === s.workdir).length + 1}`,
          },
        ]);
        setActive(id);
      } catch (error) {
        toast.error((error as Error).message || "Could not open terminal");
      } finally {
        creating.current.delete(s.workdir);
      }
    },
    [s.hub, s.workdir],
  );
  const createRef = React.useRef(create); createRef.current = create;
  // The first terminal opens with the panel, running a pending setup command if there is one.
  React.useEffect(() => {
    if (!desktop) return;
    let current = true; wire();
    void s.hub.call<Array<{ id: string; title: string; cwd?: string; project?: string | null }>>('termList').catch(() => []).then((list) => {
      if (!current) return;
      const recovered = list.map((term) => ({ id: term.id, title: term.title, project: term.project !== undefined ? term.project : term.cwd ?? null }));
      setTerms((current) => [...new Map([...recovered, ...current].map((term) => [term.id, term])).values()]);
      const pending = takePendingTerminalCommand();
      if (pending || !recovered.length && !termsRef.current.length && !creating.current.size) void createRef.current(pending?.command, pending?.cwd);
      else if (recovered.length) setActive((current) => current ?? recovered.at(-1)!.id);
    });
    return () => { current = false; };
  }, [desktop]);
  React.useEffect(() => {
    const h = () => {
      const pending = takePendingTerminalCommand();
      if (pending) void create(pending.command, pending.cwd);
    };
    window.addEventListener("tributary:run-in-terminal", h);
    return () => window.removeEventListener("tributary:run-in-terminal", h);
  }, [create]);
  const kill = (id: string) => {
    s.hub.call("termKill", id).catch(() => {});
    setTerms((t) => {
      const rest = t.filter((x) => x.id !== id);
      const mine = rest.filter((x) => x.project === s.workdir);
      if (active === id) setActive(mine[mine.length - 1]?.id ?? null);
      return rest;
    });
  };
  const visible = terms.filter((t) => t.project === s.workdir);
  const activeTerm = visible.find((term) => term.id === active);
  const activeGroup = activeTerm?.group || activeTerm?.id;
  const panes = visible.filter((term) => (term.group || term.id) === activeGroup);
  const split = React.useCallback(() => { const current = termsRef.current.find((term) => term.id === active); if (current && termsRef.current.filter((term) => term.project === s.workdir && (term.group || term.id) === (current.group || current.id)).length < 4) void create(undefined, s.workdir, current.group || current.id); }, [active, create, s.workdir]);
  React.useEffect(() => {
    if (!desktop || hidden) return;
    const onSplit = () => split(); const onNew = () => { void create(); };
    window.addEventListener('tributary:split-terminal', onSplit); window.addEventListener('tributary:new-terminal', onNew);
    return () => { window.removeEventListener('tributary:split-terminal', onSplit); window.removeEventListener('tributary:new-terminal', onNew); };
  }, [desktop, hidden, split, create]);
  // Each project keeps its own terminals: switching projects shows that project's, starting one if needed.
  React.useEffect(() => {
    if (!desktop || hidden || !terms.length || creating.current.has(s.workdir))
      return;
    if (!visible.length) create();
    else if (!visible.some((t) => t.id === active))
      setActive(visible[visible.length - 1].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.workdir, hidden, terms.length]);
  // Shells end with the panel (closing the window or removing the project), not when it is only hidden.
  React.useEffect(
    () => {
      const owner = { active: true }; lifetime.current = owner;
      return () => { owner.active = false;
        for (const t of termsRef.current) hub.call("termKill", t.id).catch(() => {});
      };
    },
    [],
  );
  React.useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem("tributary.termHeight", String(height));
      } catch {
        /* storage unavailable */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [height]);
  React.useEffect(() => {
    try {
      localStorage.setItem("tributary.termWidth", String(width));
    } catch {
      /* optional preference */
    }
  }, [width]);
  React.useEffect(() => {
    const parent = section.current?.parentElement;
    if (!parent) return;
    const resize = () => {
      const r = parent.getBoundingClientRect();
      setMaxSize(Math.max(80, Math.floor((side ? r.width : r.height) * 0.65)));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [side]);
  React.useEffect(() => () => cleanupDrag.current(), [s.terminalDock]);
  const setSize = (value: number) =>
    (side ? setWidth : setHeight)(Math.min(maxSize, Math.max(minSize, value)));
  const rename = (id: string, value: string) => {
    const v = value.trim();
    if (v)
      setTerms((x) =>
        x.map((y) =>
          y.id === id ? { ...y, title: v.slice(0, 40), named: true } : y,
        ),
      );
    setEditing(null);
  };
  const command = (action: "find" | "clear") => {
    if (active)
      window.dispatchEvent(
        new CustomEvent("tributary:terminal-command", {
          detail: { id: active, action },
        }),
      );
  };
  React.useEffect(() => {
    if (hidden) setMaximized(false);
  }, [hidden]);
  React.useEffect(() => {
    const list = section.current?.querySelector(".terminal-tabs");
    if (!active || hidden || !list) return;
    const reveal = () =>
      list
        .querySelector('[role="tab"][data-state="active"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, hidden]);
  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    cleanupDrag.current();
    const start = side ? e.clientX : e.clientY;
    const initial = size;
    const move = (ev: PointerEvent) =>
      setSize(
        initial +
          ((side ? ev.clientX : ev.clientY) - start) * (leading ? 1 : -1),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    cleanupDrag.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <Tabs.Root asChild value={active ?? ""} onValueChange={setActive}>
      <section
        ref={section}
        aria-label="Terminal"
        data-position={s.terminalDock}
        className={cn(
          "terminal-panel relative flex min-h-0 min-w-0 shrink-0 flex-col bg-card",
          leading && "-order-1",
          s.terminalDock === "bottom"
            ? "border-t"
            : s.terminalDock === "top"
              ? "border-b"
              : s.terminalDock === "left"
                ? "border-r"
                : "border-l",
          hidden && "hidden",
          maximized && "terminal-maximized",
        )}
        style={
          maximized ? undefined : side ? { width: size } : { height: size }
        }
      >
        <div
          hidden={maximized}
          role="separator"
          aria-orientation={side ? "vertical" : "horizontal"}
          aria-label="Resize terminal"
          tabIndex={0}
          aria-valuenow={size}
          aria-valuemin={minSize}
          aria-valuemax={maxSize}
          onKeyDown={(e) => {
            const keys = side
              ? ["ArrowLeft", "ArrowRight"]
              : ["ArrowUp", "ArrowDown"];
            if (keys.includes(e.key)) {
              e.preventDefault();
              setSize(
                size + (e.key === keys[1] ? 24 : -24) * (leading ? 1 : -1),
              );
            } else if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              setSize(e.key === "Home" ? minSize : maxSize);
            }
          }}
          onPointerDown={drag}
          className={cn(
            "absolute z-10 touch-none outline-none hover:bg-brand/30 focus-visible:bg-brand/40",
            side
              ? `inset-y-0 w-2 cursor-col-resize ${leading ? "-right-1" : "-left-1"}`
              : `inset-x-0 h-2 cursor-row-resize ${leading ? "-bottom-1" : "-top-1"}`,
          )}
        />
        <header className="terminal-header">
          <span className="terminal-heading">Terminal</span>
          {desktop && (
            <Tabs.List aria-label="Terminals" className="terminal-tabs">
              {visible.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "terminal-tab group",
                    active === t.id && "terminal-tab-active",
                  )}
                >
                  {editing === t.id ? (
                    <input
                      autoFocus
                      defaultValue={t.title}
                      aria-label="Terminal name"
                      className="terminal-rename"
                      onBlur={(e) => rename(t.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.currentTarget.value = t.title;
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <Tabs.Trigger
                      value={t.id}
                      title={[
                        t.title,
                        t.shellTitle,
                        t.project,
                        t.done ? "Process ended" : "Double-click to rename",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      onDoubleClick={() => setEditing(t.id)}
                      className="terminal-tab-trigger"
                    >
                      <TerminalIcon
                        name={t.done ? "circle-slash" : "terminal"}
                      />
                      <span className="truncate">{t.title}</span>
                      {t.done && (
                        <span className="text-[11px] text-muted-foreground">
                          Ended
                        </span>
                      )}
                    </Tabs.Trigger>
                  )}
                  <button
                    onClick={() => kill(t.id)}
                    aria-label={`Close ${t.title}`}
                    className="terminal-tab-close"
                  >
                    <TerminalIcon name="close" />
                  </button>
                </div>
              ))}
            </Tabs.List>
          )}
          <div className="terminal-actions">
            {desktop && (
              <>
                <TerminalAction
                  label="New terminal"
                  icon="add"
                  onClick={() => void create()}
                  tooltip={<>New terminal <ShortcutLabel action="new-terminal" /></>}
                />
                <TerminalAction label="Split terminal" icon="split-horizontal" disabled={!active || panes.length >= 4} onClick={split} tooltip={<>Split terminal <ShortcutLabel action="split-terminal" /></>} />
                <TerminalAction
                  label="Find in terminal"
                  icon="search"
                  disabled={!active}
                  onClick={() => command("find")}
                  tooltip={
                    <>
                      Find in terminal{" "}
                      <ShortcutKeys keys={['Mod', 'F']} platform={platform} />
                    </>
                  }
                />
              </>
            )}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="terminal-action"
                      aria-label="Terminal actions"
                    >
                      <TerminalIcon name="ellipsis" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Terminal actions</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                {desktop && (
                  <>
                    <DropdownMenuItem
                      disabled={!active}
                      onSelect={() => setEditing(active)}
                    >
                      Rename terminal
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!active}
                      onSelect={() => command("clear")}
                    >
                      Clear terminal
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuLabel>Move terminal</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={s.terminalPosition}
                  onValueChange={(value) => {
                    setMaximized(false);
                    s.setTerminalPosition(value as typeof s.terminalPosition);
                  }}
                >
                  {(
                    [
                      ["left", "Left", PanelLeft],
                      ["right", "Right", PanelRight],
                      ["top", "Top", PanelTop],
                      ["bottom", "Bottom", PanelBottom],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <Icon className="size-4" />
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {desktop && visible.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Open terminals</DropdownMenuLabel>
                    {visible.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onSelect={() => setActive(t.id)}
                      >
                        <TerminalIcon
                          name={t.done ? "circle-slash" : "terminal"}
                        />
                        <span className="truncate">{t.title}</span>
                        {t.id === active && <TerminalIcon name="check" />}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <TerminalAction
              label={maximized ? "Restore terminal" : "Maximize terminal"}
              icon={maximized ? "chevron-down" : "chevron-up"}
              onClick={() => setMaximized((v) => !v)}
            />
            <TerminalAction
              label="Hide terminal"
              icon="close"
              onClick={() => s.setTerminalOpen(false)}
              tooltip={
                <>
                  Hide terminal <ShortcutLabel action="terminal" />
                </>
              }
            />
          </div>
        </header>
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `repeat(${Math.min(2, Math.max(1, panes.length))}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${panes.length > 2 ? 2 : 1}, minmax(0, 1fr))` }}>
          {desktop && !visible.length && (
            <div className="grid h-full place-items-center">
              <Button variant="outline" size="sm" onClick={() => void create()}>
                New terminal
              </Button>
            </div>
          )}
          {desktop ? (
            terms.map((t) => (
              <div
                key={t.id}
                aria-label={t.title}
                onFocusCapture={() => setActive(t.id)}
                className={cn(
                  "h-full min-h-0 min-w-0 border-r border-b border-border outline-none",
                  (hidden || !panes.some((pane) => pane.id === t.id) || t.project !== s.workdir) &&
                    "hidden",
                )}
              >
                <XtermView
                  id={t.id}
                  project={t.project}
                  active={!hidden && panes.some((pane) => pane.id === t.id) && t.project === s.workdir}
                  onExit={() =>
                    setTerms((x) =>
                      x.map((y) => (y.id === t.id ? { ...y, done: true } : y)),
                    )
                  }
                  onTitle={(title) =>
                    setTerms((x) =>
                      x.map((y) =>
                        y.id === t.id ? { ...y, shellTitle: title } : y,
                      ),
                    )
                  }
                  onKill={() => kill(t.id)}
                  onOpenFile={(rel, line) => s.openFile(rel, line)}
                />
              </div>
            ))
          ) : (
            <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
              {s.hub.platform === "vscode" ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    s.hub.call("createTerminal", { cwd: s.workdir })
                  }
                >
                  Open a VS Code terminal in this project
                </Button>
              ) : (
                "The terminal runs in the desktop app."
              )}
            </div>
          )}
        </div>
      </section>
    </Tabs.Root>
  );
}

function TerminalIcon({ name }: { name: string }) {
  return <span aria-hidden="true" className={`codicon codicon-${name}`} />;
}
function TerminalAction({
  label,
  icon,
  tooltip,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: string;
  tooltip?: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="terminal-action"
          aria-label={label}
          {...props}
        >
          <TerminalIcon name={icon} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
