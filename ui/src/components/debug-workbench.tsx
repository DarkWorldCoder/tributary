import { debugMessage } from "@/lib/debug-types";
import * as React from "react";
import { useDebugger } from "@/hooks/use-debugger";
import { useStore } from "@/store";
import type { DebugState } from "@/lib/debug-types";
import { useShortcutPreferences } from "@/hooks/use-shortcut-preferences";

type Configuration = { entry: string; args: string; watches: string[] };
const EMPTY: Configuration = { entry: "", args: "", watches: [] };
type DebugWorkbench = {
  state: DebugState;
  project: string | null;
  config: Configuration;
  files: string[];
  configure: (patch: Partial<Configuration>) => void;
  busy: boolean;
  error: string;
  live: boolean;
  paused: boolean;
  values: Record<string, string>;
  consoleOpen: boolean;
  setConsoleOpen: (open: boolean) => void;
  launch: () => Promise<boolean>;
  perform: (work: () => Promise<unknown>) => Promise<boolean>;
};
const Context = React.createContext<DebugWorkbench | null>(null);
export const useDebugWorkbench = () => {
  const value = React.useContext(Context);
  if (!value) throw new Error("Debugger provider missing");
  return value;
};

export function DebugWorkbenchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = useStore();
  const project = s.workdir;
  const state = useDebugger(project);
  const { platform } = useShortcutPreferences();
  const [configs, setConfigs] = React.useState<Record<string, Configuration>>(
    {},
  );
  const config = configs[project || ""] || EMPTY;
  const configure = React.useCallback(
    (patch: Partial<Configuration>) => {
      if (project)
        setConfigs((all) => ({
          ...all,
          [project]: { ...(all[project] || EMPTY), ...patch },
        }));
    },
    [project],
  );
  const [files, setFiles] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const working = React.useRef(false);
  const [error, setError] = React.useState("");
  const [consoleOpen, setConsoleOpen] = React.useState(true);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const live = ["starting", "running", "paused"].includes(state.status);
  const paused = state.status === "paused";
  React.useEffect(() => {
    if (!s.debugOpen || !project) return;
    s.openPanel("files");
    setConsoleOpen(true);
    setError("");
  }, [s.debugOpen, project]);
  React.useEffect(() => {
    setFiles([]);
    if (!project || !s.debugOpen) return;
    let alive = true;
    s.hub
      .call<string[]>("listFiles", project)
      .then((all) => {
        if (!alive) return;
        const list = all.filter((file) => /\.(?:[cm]?js|[cm]?ts)$/i.test(file));
        setFiles(list);
        setConfigs((configs) =>
          configs[project]?.entry
            ? configs
            : {
                ...configs,
                [project]: {
                  ...(configs[project] || EMPTY),
                  entry:
                    list.find((file) =>
                      /(?:^|\/)(?:main|index|server)\.(?:[cm]?js|[cm]?ts)$/.test(
                        file,
                      ),
                    ) ||
                    list[0] ||
                    "",
                },
              },
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project, s.hub, s.debugOpen]);
  React.useEffect(() => {
    if (s.debugLaunch?.project === project)
      configure({ entry: s.debugLaunch.rel });
  }, [s.debugLaunch, project, configure]);
  const perform = React.useCallback(async (work: () => Promise<unknown>) => {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      return true;
    } catch (error) {
      setError(debugMessage(error));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);
  const launch = React.useCallback(
    () =>
      perform(() =>
        s.hub.call("debugStart", project, {
          entry: config.entry,
          args: config.args.split("\n").filter(Boolean),
        }),
      ),
    [perform, project, config.entry, config.args, s.hub],
  );
  const frame =
    state.frames.find((item) => item.id === state.selectedFrame) ||
    state.frames[0];
  React.useEffect(() => {
    if (s.debugOpen && paused && frame?.rel)
      s.editFile(frame.rel, frame.line, frame.column);
  }, [state.pauseId, project, s.debugOpen]);
  React.useEffect(() => {
    if (!paused) {
      setValues({});
      return;
    }
    let alive = true;
    Promise.all(
      config.watches.map(async (expression) => {
        try {
          const result = await s.hub.call<{ value: string }>(
            "debugEvaluate",
            project,
            expression,
          );
          return [expression, result.value];
        } catch (error) {
          return [expression, debugMessage(error)];
        }
      }),
    ).then((values) => {
      if (alive) setValues(Object.fromEntries(values));
    });
    return () => {
      alive = false;
    };
  }, [
    paused,
    state.pauseId,
    state.selectedFrame,
    config.watches,
    project,
    s.hub,
  ]);
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !s.debugOpen ||
        event.isComposing ||
        event.repeat ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return;
      const mod = platform === "mac" ? event.metaKey : event.ctrlKey;
      let action: (() => Promise<unknown>) | undefined;
      if (event.altKey || (platform === "mac" ? event.ctrlKey : event.metaKey))
        return;
      if (event.key === "F5") {
        if (event.shiftKey && mod && live && state.owned) action = launch;
        else if (event.shiftKey && !mod && live)
          action = () => perform(() => s.hub.call("debugStop", project));
        else if (!event.shiftKey && !mod && state.status !== "starting")
          action = live
            ? () =>
                perform(() =>
                  s.hub.call(
                    "debugAction",
                    project,
                    paused ? "resume" : "pause",
                  ),
                )
            : config.entry
              ? launch
              : undefined;
      } else if (
        !mod &&
        paused &&
        ["F10", "F11"].includes(event.key) &&
        !(event.shiftKey && event.key === "F10")
      )
        action = () =>
          perform(() =>
            s.hub.call(
              "debugAction",
              project,
              event.key === "F10" ? "over" : event.shiftKey ? "out" : "into",
            ),
          );
      const reserved =
        (event.key === "F5" && (!mod || event.shiftKey)) ||
        (!mod && ["F10", "F11"].includes(event.key));
      if (reserved) {
        event.preventDefault();
        event.stopPropagation();
        if (action) void action();
        else if (event.key === "F5" && !live && !config.entry) {
          setError("Choose an entry file first.");
          document
            .querySelector<HTMLInputElement>('[aria-label="Debug entry file"]')
            ?.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [
    s.debugOpen,
    s.hub,
    platform,
    live,
    paused,
    state.owned,
    state.status,
    config.entry,
    launch,
    perform,
    project,
  ]);
  return (
    <Context.Provider
      value={{
        state,
        project,
        config,
        configure,
        files,
        busy,
        error,
        live,
        paused,
        values,
        consoleOpen,
        setConsoleOpen,
        perform,
        launch,
      }}
    >
      {children}
    </Context.Provider>
  );
}
