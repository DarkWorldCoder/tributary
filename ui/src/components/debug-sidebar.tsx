import { debugMessage } from "@/lib/debug-types";
import "@vscode/codicons/dist/codicon.css";
import * as React from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Circle,
  FileCode2,
  ListFilter,
  Pause,
  Play,
  Plus,
  Plug,
  RotateCcw,
  Search,
  Settings2,
  Square,
  StepForward,
  TerminalSquare,
  X,
} from "lucide-react";
import { useStore } from "@/store";
import { useDebugWorkbench } from "@/components/debug-workbench";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ShortcutKeys, ShortcutLabel } from "@/components/shortcut-settings";
import { useShortcutPreferences } from "@/hooks/use-shortcut-preferences";
import type { DebugVariable } from "@/lib/debug-types";
import { cn } from "@/lib/utils";

function DebugIcon({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(`codicon codicon-${name}`, className)}
    />
  );
}
export function DebugAction({
  label,
  icon,
  onClick,
  disabled,
  keys,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  keys?: string[];
}) {
  const { platform } = useShortcutPreferences();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="debug-action"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keys && (
          <>
            {" "}
            <ShortcutKeys keys={keys} platform={platform} />
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
function Section({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen className="debug-section">
      <div className="debug-section-heading">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1 text-left">
          <ChevronRight className="size-3.5 shrink-0 group-data-[state=open]:rotate-90" />
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="ml-auto pr-1 font-normal text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
function Variable({
  item,
  depth = 0,
}: {
  item: DebugVariable;
  depth?: number;
}) {
  const s = useStore();
  const { project, paused } = useDebugWorkbench();
  const [children, setChildren] = React.useState<DebugVariable[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const expand = async () => {
    if (!item.objectId || !paused) return;
    setOpen(!open);
    if (children) return;
    try {
      setChildren(
        await s.hub.call<DebugVariable[]>(
          "debugProperties",
          project,
          item.objectId,
        ),
      );
    } catch (error) {
      setError(debugMessage(error));
    }
  };
  const expandable = !!item.objectId && depth < 3;
  return (
    <>
      <div
        className="debug-variable debug-tree-row"
        style={{ paddingLeft: 8 + depth * 12 }}
        title={`${item.name}: ${item.value}`}
      >
        <button
          type="button"
          className={cn("debug-tree-toggle", !expandable && "invisible")}
          disabled={!expandable}
          aria-label={`Inspect ${item.name}`}
          aria-expanded={expandable ? open : undefined}
          onClick={() => void expand()}
        >
          <ChevronRight className={cn("size-3", open && "rotate-90")} />
        </button>
        <span className="shrink-0 text-[var(--syn-property)]">
          {item.name}
          <span className="text-muted-foreground">:</span>
        </span>
        <span
          className={cn(
            "min-w-0 truncate",
            /^['"]/.test(item.value)
              ? "text-[var(--syn-string)]"
              : /^(?:-?\d|true|false|null)/.test(item.value)
                ? "text-[var(--syn-number)]"
                : "text-muted-foreground",
          )}
        >
          {item.value}
        </span>
      </div>
      {open &&
        (error ? (
          <p className="px-5 py-1 text-xs text-destructive">{error}</p>
        ) : (
          children?.map((child, index) => (
            <Variable
              key={`${child.name}:${index}`}
              item={child}
              depth={depth + 1}
            />
          ))
        ))}
    </>
  );
}

export function DebugControls() {
  const s = useStore();
  const d = useDebugWorkbench();
  if (!d.live) return null;
  const action = (name: string) =>
    void d.perform(() => s.hub.call("debugAction", d.project, name));
  return (
    <div role="toolbar" aria-label="Debug controls" className="debug-controls">
      <DebugAction
        label={d.paused ? "Continue debugging" : "Pause debugging"}
        icon={
          d.paused ? (
            <DebugIcon name="debug-continue" className="text-success" />
          ) : (
            <DebugIcon name="debug-pause" />
          )
        }
        keys={["F5"]}
        disabled={d.busy || d.state.status === "starting"}
        onClick={() => action(d.paused ? "resume" : "pause")}
      />
      <DebugAction
        label="Step over"
        icon={<DebugIcon name="debug-step-over" className="" />}
        keys={["F10"]}
        disabled={!d.paused || d.busy}
        onClick={() => action("over")}
      />
      <DebugAction
        label="Step into"
        icon={<DebugIcon name="debug-step-into" className="" />}
        keys={["F11"]}
        disabled={!d.paused || d.busy}
        onClick={() => action("into")}
      />
      <DebugAction
        label="Step out"
        icon={<DebugIcon name="debug-step-out" className="" />}
        keys={["Shift", "F11"]}
        disabled={!d.paused || d.busy}
        onClick={() => action("out")}
      />
      <span className="mx-0.5 h-4 w-px bg-border" />
      {d.state.owned && (
        <DebugAction
          label="Restart debugging"
          icon={<DebugIcon name="debug-restart" className="text-success" />}
          keys={["Mod", "Shift", "F5"]}
          disabled={d.busy}
          onClick={() => void d.launch()}
        />
      )}
      <DebugAction
        label={d.state.owned ? "Stop debugging" : "Detach debugger"}
        icon={<DebugIcon name="debug-stop" className="text-destructive" />}
        keys={["Shift", "F5"]}
        disabled={d.busy}
        onClick={() => void d.perform(() => s.hub.call("debugStop", d.project))}
      />
    </div>
  );
}

export function DebugSidebar({
  onShowConsole,
  compact = false,
}: { onShowConsole?: () => void; compact?: boolean } = {}) {
  const s = useStore();
  const d = useDebugWorkbench();
  const [settings, setSettings] = React.useState(false);
  const [attach, setAttach] = React.useState(false);
  const [port, setPort] = React.useState("9229");
  const [expression, setExpression] = React.useState("");
  const [addingWatch, setAddingWatch] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [filtering, setFiltering] = React.useState(false);
  const [internals, setInternals] = React.useState(false);
  const entryId = React.useId();
  const groups = [
    ...new Set(d.state.variables.map((item) => item.scope || "local")),
  ];
  const projectFrames = d.state.frames.filter((item) => !!item.rel);
  const internalCount = d.state.frames.length - projectFrames.length;
  const frames =
    internals || !projectFrames.length ? d.state.frames : projectFrames;
  React.useEffect(() => {
    setInternals(false);
    setFilter("");
    setExpression("");
  }, [d.project]);
  const addWatch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = expression.trim();
    if (
      value &&
      d.config.watches.length < 8 &&
      !d.config.watches.includes(value)
    ) {
      d.configure({ watches: [...d.config.watches, value] });
      setExpression("");
      setAddingWatch(false);
    }
  };
  return (
    <aside
      aria-label="Run and Debug"
      className="debug-sidebar flex h-full min-h-0 flex-col bg-sidebar/50"
    >
      <header className="debug-sidebar-heading">
        <h2 className="min-w-0 flex-1 truncate">RUN AND DEBUG</h2>
        <DebugAction
          label="Show debug console"
          icon={<TerminalSquare />}
          onClick={() => {
            d.setConsoleOpen(true);
            onShowConsole?.();
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="debug-action"
              aria-label="Hide debugger"
              onClick={() => s.setDebugOpen(false)}
            >
              <X />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Hide debugger <ShortcutLabel action="debug" />
          </TooltipContent>
        </Tooltip>
      </header>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <DebugAction
          label="Start debugging"
          icon={<Play className="fill-current text-success" />}
          keys={["F5"]}
          disabled={
            d.live || d.busy || !d.config.entry || s.hub.platform === "mock"
          }
          onClick={() => void d.launch()}
        />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Debug entry file</span>
          <input
            list={entryId}
            aria-label="Debug entry file"
            className="debug-entry"
            placeholder="Select entry file"
            value={d.config.entry}
            disabled={d.live}
            onChange={(event) => d.configure({ entry: event.target.value })}
          />
          <datalist id={entryId}>
            {d.files.map((file) => (
              <option key={file} value={file} />
            ))}
          </datalist>
        </label>
        <Popover open={settings} onOpenChange={setSettings}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="debug-action"
                  aria-label="Debug launch settings"
                >
                  <Settings2 />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Launch settings</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-72 space-y-3">
            <h3 className="text-sm font-medium">Launch configuration</h3>
            <label className="block space-y-1 text-xs">
              <span>Arguments</span>
              <Textarea
                aria-label="Debug program arguments"
                placeholder="One argument per line"
                value={d.config.args}
                disabled={d.live}
                onChange={(event) => d.configure({ args: event.target.value })}
                rows={3}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Node.js · Saved JavaScript or TypeScript
            </p>
          </PopoverContent>
        </Popover>
        <Popover open={attach} onOpenChange={setAttach}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="debug-action"
                  aria-label="Attach to Node"
                  disabled={d.live}
                >
                  <Plug />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Attach to Node</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-64">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void d.perform(async () => {
                  await s.hub.call("debugAttach", d.project, Number(port));
                  setAttach(false);
                });
              }}
            >
              <label className="block space-y-1 text-xs">
                <span>Local debug port</span>
                <Input
                  aria-label="Local debug port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
              <Button size="sm" disabled={d.busy}>
                Attach
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      {d.live && (
        <div className={cn("border-b", !compact && "hidden")}>
          <DebugControls />
        </div>
      )}
      <div
        role="status"
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-b px-3 py-1 text-xs",
          d.paused ? "text-warning" : "text-muted-foreground",
        )}
      >
        <Circle
          className={cn(
            "size-1.5 shrink-0 fill-current",
            !d.live && "opacity-50",
          )}
        />
        <span className="truncate">
          {d.paused
            ? d.state.reason === "exception"
              ? "Paused on exception"
              : "Paused"
            : d.state.status === "starting"
              ? "Connecting…"
              : d.live
                ? "Running"
                : "Ready"}
        </span>
        {d.paused && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            Node.js
          </span>
        )}
      </div>
      {(d.error || d.state.error) && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {d.error || d.state.error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <Section
          title="VARIABLES"
          actions={
            <DebugAction
              label="Filter variables"
              icon={<ListFilter />}
              onClick={() => {
                setFiltering(!filtering);
                setFilter("");
              }}
            />
          }
        >
          {filtering && (
            <label className="mx-2 my-1 flex items-center gap-1 rounded-sm border px-1.5">
              <Search className="size-3 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                aria-label="Filter variables"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Name or value…"
                className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
            </label>
          )}
          {groups.length ? (
            groups.map((scope) => (
              <Collapsible
                defaultOpen
                key={`${d.state.pauseId}:${d.state.selectedFrame}:${scope}`}
              >
                <CollapsibleTrigger className="debug-tree-row group flex w-full items-center gap-1 px-2 text-left">
                  <ChevronRight className="size-3 group-data-[state=open]:rotate-90" />
                  <span className="capitalize">{scope}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {d.state.variables
                    .filter(
                      (item) =>
                        (item.scope || "local") === scope &&
                        `${item.name} ${item.value}`
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                    )
                    .slice(0, 100)
                    .map((item, index) => (
                      <Variable key={`${item.name}:${index}`} item={item} />
                    ))}
                </CollapsibleContent>
              </Collapsible>
            ))
          ) : (
            <p className="debug-empty">
              {d.paused ? "No local variables." : "Pause to inspect variables."}
            </p>
          )}
        </Section>
        <Section
          title="WATCH"
          actions={
            <DebugAction
              label="Add watch expression"
              icon={<Plus />}
              disabled={d.config.watches.length >= 8}
              onClick={() => setAddingWatch(!addingWatch)}
            />
          }
        >
          {addingWatch && (
            <form onSubmit={addWatch} className="flex gap-1 p-2">
              <input
                autoFocus
                aria-label="Watch expression"
                placeholder="Expression…"
                value={expression}
                onChange={(event) => setExpression(event.target.value)}
                maxLength={2000}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setAddingWatch(false);
                }}
                className="debug-entry min-w-0 flex-1 font-mono"
              />
              <button
                className="debug-action"
                type="submit"
                aria-label="Add watch"
                disabled={!expression.trim()}
              >
                <Plus />
              </button>
            </form>
          )}
          {d.config.watches.length
            ? d.config.watches.map((item) => (
                <div
                  key={item}
                  className="debug-tree-row group flex min-w-0 items-start gap-1 px-3"
                  title={`${item}: ${d.values[item] || ""}`}
                >
                  <div className="min-w-0 flex-1 truncate font-mono text-xs">
                    <span>{item}: </span>
                    <span className="text-[var(--syn-number)]">
                      {d.values[item] || (d.paused ? "…" : "not available")}
                    </span>
                  </div>
                  <button
                    className="debug-action opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove watch ${item}`}
                    onClick={() =>
                      d.configure({
                        watches: d.config.watches.filter(
                          (value) => value !== item,
                        ),
                      })
                    }
                  >
                    <X />
                  </button>
                </div>
              ))
            : !addingWatch && (
                <p className="debug-empty">Add an expression to watch.</p>
              )}
        </Section>
        <Section title="CALL STACK" count={d.state.frames.length}>
          {frames.length ? (
            frames.map((item) => (
              <button
                key={item.id}
                title={`${item.name} · ${item.rel || item.url}:${item.line}`}
                className={cn(
                  "debug-tree-row flex w-full min-w-0 items-center gap-2 px-3 text-left",
                  item.id === d.state.selectedFrame && "bg-accent",
                )}
                onClick={() =>
                  void d.perform(async () => {
                    await s.hub.call("debugFrame", d.project, item.id);
                    if (item.rel) s.editFile(item.rel, item.line, item.column);
                  })
                }
              >
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="max-w-[55%] shrink-0 truncate text-xs text-muted-foreground">
                  {item.rel?.split("/").pop() || "Node.js"}
                  <span className="ml-1 font-mono text-[11px] tabular-nums">
                    {item.line}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="debug-empty">
              {d.live ? "Not paused." : "No active session."}
            </p>
          )}
          {internalCount > 0 && projectFrames.length > 0 && (
            <button
              className="debug-tree-row flex w-full items-center gap-1 px-3 text-left text-xs text-muted-foreground"
              onClick={() => setInternals(!internals)}
            >
              <ChevronDown
                className={cn("size-3", internals && "rotate-180")}
              />
              {internals ? "Hide" : "Show"} {internalCount} internal frames
            </button>
          )}
        </Section>
        <Section title="BREAKPOINTS" count={d.state.breakpoints.length}>
          {d.state.breakpoints.length ? (
            d.state.breakpoints.map((bp) => (
              <div
                key={`${bp.rel}:${bp.line}`}
                className="debug-tree-row group flex items-center gap-1 px-2"
              >
                <Circle
                  className={cn(
                    "size-2.5 shrink-0 text-destructive",
                    bp.verified && "fill-current",
                  )}
                />
                <button
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  title={`${bp.rel}:${bp.line} · ${bp.verified ? "Verified" : "Pending"}`}
                  onClick={() => s.editFile(bp.rel, bp.line)}
                >
                  <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {bp.rel.split("/").pop()}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {bp.line}
                  </span>
                </button>
                <button
                  className="debug-action opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Remove breakpoint ${bp.rel}:${bp.line}`}
                  onClick={() =>
                    void d.perform(() =>
                      s.hub.call(
                        "debugBreakpoint",
                        d.project,
                        bp.rel,
                        bp.line,
                        false,
                      ),
                    )
                  }
                >
                  <X />
                </button>
              </div>
            ))
          ) : (
            <p className="debug-empty">Click the editor gutter or press F9.</p>
          )}
        </Section>
      </div>
    </aside>
  );
}
