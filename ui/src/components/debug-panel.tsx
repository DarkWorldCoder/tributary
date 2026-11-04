import { debugMessage } from "@/lib/debug-types";
import * as React from "react";
import { ChevronRight, Copy, Eraser, X } from "lucide-react";
import { useStore } from "@/store";
import { useDebugWorkbench } from "@/components/debug-workbench";
import { DebugAction } from "@/components/debug-sidebar";
import { cn } from "@/lib/utils";

type Evaluation = { expression: string; value: string; error?: boolean };
/** The console is separate from the Run and Debug inspector, like the editor's other bottom panels. */
export function DebugPanel() {
  const s = useStore();
  const d = useDebugWorkbench();
  const [height, setHeight] = React.useState(200);
  const [expression, setExpression] = React.useState("");
  const [evaluations, setEvaluations] = React.useState<Evaluation[]>([]);
  const [evaluating, setEvaluating] = React.useState(false);
  const [cleared, setCleared] = React.useState(0);
  const [copyError, setCopyError] = React.useState("");
  const currentProject = React.useRef(d.project);
  currentProject.current = d.project;
  const dragging = React.useRef<() => void>(() => {});
  const output = React.useRef<HTMLDivElement>(null);
  const outputText = d.state.output.slice(
    cleared <= d.state.output.length ? cleared : 0,
  );
  React.useEffect(() => {
    setEvaluations([]);
    setCleared(0);
    setExpression("");
    setEvaluating(false);
  }, [d.project]);
  React.useEffect(() => {
    if (d.state.status === "starting") {
      setCleared(0);
      setEvaluations([]);
    }
  }, [d.state.status]);
  React.useEffect(() => () => dragging.current(), []);
  React.useEffect(() => {
    const element = output.current;
    if (
      element &&
      element.scrollHeight - element.scrollTop - element.clientHeight < 100
    )
      element.scrollTop = element.scrollHeight;
  }, [outputText, evaluations]);
  const maxHeight = Math.max(120, Math.floor(window.innerHeight * 0.5));
  const resize = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging.current();
    const start = height;
    const y = event.clientY;
    const move = (next: PointerEvent) =>
      setHeight(Math.max(120, Math.min(maxHeight, start + y - next.clientY)));
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    dragging.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const evaluate = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = expression.trim();
    if (!text || !d.paused || evaluating) return;
    setEvaluating(true);
    setExpression("");
    const project = d.project;
    try {
      const value = await s.hub.call<{ value: string }>(
        "debugEvaluate",
        project,
        text,
      );
      if (currentProject.current === project)
        setEvaluations((all) => [
          ...all.slice(-99),
          { expression: text, value: value.value },
        ]);
    } catch (error) {
      if (currentProject.current === project)
        setEvaluations((all) => [
          ...all.slice(-99),
          { expression: text, value: debugMessage(error), error: true },
        ]);
    } finally {
      if (currentProject.current === project) setEvaluating(false);
    }
  };
  if (!d.consoleOpen) return null;
  return (
    <section
      aria-label="Debug console"
      className="debug-console relative flex min-h-0 max-h-[50dvh] shrink-0 flex-col border-t bg-card"
      style={{ height }}
    >
      <div
        role="separator"
        aria-label="Resize debug console"
        aria-orientation="horizontal"
        aria-valuenow={height}
        aria-valuemin={120}
        aria-valuemax={maxHeight}
        tabIndex={0}
        onPointerDown={resize}
        onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setHeight(
              event.key === "Home"
                ? 120
                : event.key === "End"
                  ? maxHeight
                  : Math.max(
                      120,
                      Math.min(
                        maxHeight,
                        height + (event.key === "ArrowUp" ? 24 : -24),
                      ),
                    ),
            );
          }
        }}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none hover:bg-brand/30 focus-visible:bg-brand/40"
      />
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="flex h-full items-center border-b border-foreground text-[11px] font-medium">
          DEBUG CONSOLE
        </h2>
        <span
          role="status"
          className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground"
        >
          {d.config.entry || "Node.js"}
        </span>
        <DebugAction
          label="Copy debug output"
          icon={<Copy />}
          onClick={() => {
            void navigator.clipboard
              .writeText(
                outputText +
                  evaluations
                    .map((item) => `\n> ${item.expression}\n${item.value}`)
                    .join(""),
              )
              .then(
                () => setCopyError(""),
                () => setCopyError("Could not copy output."),
              );
          }}
        />
        <DebugAction
          label="Clear debug console"
          icon={<Eraser />}
          onClick={() => {
            setCleared(d.state.output.length);
            setEvaluations([]);
          }}
        />
        <DebugAction
          label="Hide debug console"
          icon={<X />}
          onClick={() => d.setConsoleOpen(false)}
        />
      </header>
      {copyError && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {copyError}
        </p>
      )}
      <div
        ref={output}
        className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-[13px] leading-5"
        tabIndex={0}
        aria-label="Debug console output"
      >
        <pre className="whitespace-pre-wrap break-words text-muted-foreground">
          {outputText ||
            (!evaluations.length ? "Debug output appears here." : "")}
        </pre>
        {evaluations.map((item, index) => (
          <div key={index} className="py-1">
            <div className="flex min-w-0 gap-2">
              <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="whitespace-pre-wrap break-words">
                {item.expression}
              </span>
            </div>
            <p
              className={cn(
                "pl-5 whitespace-pre-wrap break-words",
                item.error ? "text-destructive" : "text-[var(--syn-number)]",
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
      <form
        className="flex shrink-0 items-center gap-1.5 border-t px-3"
        onSubmit={(event) => void evaluate(event)}
      >
        <ChevronRight className="size-3.5 shrink-0 text-brand" />
        <input
          aria-label="Evaluate debug expression"
          aria-describedby="debug-evaluation-mode"
          className="h-8 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
          placeholder={
            d.paused
              ? "Evaluate expression…"
              : "Pause to evaluate an expression"
          }
          value={expression}
          maxLength={2000}
          onChange={(event) => setExpression(event.target.value)}
          disabled={!d.paused || evaluating}
        />
        <span id="debug-evaluation-mode" className="sr-only">
          Read-only expressions in the selected call frame.
        </span>
      </form>
    </section>
  );
}
