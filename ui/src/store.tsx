import * as React from 'react';
import { toast } from 'sonner';
import { createMockHub } from './mock';
import type { Agent, AgentMessage, GitInfo, HubBridge, HubState, Message, Mode, Thread, ThreadSummary, TaskInput, SavedDocument } from './types';

export type PanelTab = 'review' | 'changes' | 'files' | 'memory' | 'preview';

export const hub: HubBridge = window.hub ?? createMockHub();

const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(`tributary.${k}`); return v == null ? d : (JSON.parse(v) as T); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(`tributary.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export type Theme = 'system' | 'light' | 'dark';
export type InterfaceFont = 'geist' | 'plex' | 'system';
export type SettingsTab = 'connections' | 'agents' | 'gateways' | 'mcp' | 'skills' | 'appearance' | 'about';

function useStored<T>(key: string, initial: T) {
  const [v, setV] = React.useState<T>(() => ls.get(key, initial));
  const set = React.useCallback((n: T) => { setV(n); ls.set(key, n); }, [key]);
  return [v, set] as const;
}

function useStoreValue() {
  const [st, setSt] = React.useState<HubState | null>(null);
  const [threadsBy, setThreadsBy] = React.useState<Record<string, ThreadSummary[]>>({});
  const [project, setProjectRaw] = useStored<string | null>('project', null);
  const [threadId, setThreadIdRaw] = useStored<string | null>('thread', null);
  const [thread, setThread] = React.useState<Thread | null>(null);
  const [git, setGit] = React.useState<GitInfo | null>(null);
  const [agentId, setAgentId] = useStored<string | null>('agent', null);
  const [mode, setMode] = useStored<Mode>('mode', 'edit');
  const [gatewayId, setGatewayId] = useStored<string>('gateway', '');
  const [theme, setTheme] = useStored<Theme>('theme', 'system');
  const [interfaceFont, setInterfaceFont] = useStored<InterfaceFont>('interfaceFont', 'geist');
  const [readingSize, setReadingSize] = useStored<number>('readingSize', 15);
  const [roomOpen, setRoomOpen] = React.useState(false);
  const [review, setReview] = React.useState<{ open: boolean; rel: string | null; diff: string }>({ open: false, rel: null, diff: '' });
  const [panel, setPanelRaw] = React.useState<{ open: boolean; tab: PanelTab }>(() => ({ open: false, tab: ls.get<PanelTab>('panelTab', 'review') }));
  const [fileToOpen, setFileToOpen] = React.useState<{ rel: string; line?: number; n: number } | null>(null);
  const [terminalOpen, setTerminalOpenRaw] = useStored<boolean>('terminal', false);
  const [teamOpen, setTeamOpen] = React.useState(false);
  const [queue, setQueue] = React.useState<Record<string, { text: string; plan?: boolean; mode?: Mode; agentId: string }[]>>({});
  const [settings, setSettings] = React.useState<{ open: boolean; tab: SettingsTab }>({ open: false, tab: 'agents' });
  const [palette, setPalette] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [loaded, setLoaded] = React.useState(false);
  const [home, setHome] = React.useState(false);
  const [activeDocument, setDocument] = React.useState<{ threadId: string; id: string } | null>(null);
  const threadRef = React.useRef<Thread | null>(null); threadRef.current = thread;
  const projectRef = React.useRef<string | null>(null); projectRef.current = project;

  const ready = React.useMemo(() => (st ? st.agents.filter((a) => a.available && a.headless) : []), [st]);
  const agentOf = React.useCallback((id?: string | null): Agent => (st?.agents.find((a) => a.id === id)) ?? { id: id || '?', name: id || 'Agent', color: '#8a8f98', available: false, headless: false, protocol: '' }, [st]);
  const agent = agentOf(agentId);
  const running = !!(thread && st?.running.includes(thread.id));

  const refreshState = React.useCallback(async () => { const s = await hub.call<HubState>('state'); setSt(s); return s; }, []);
  const loadThreads = React.useCallback(async (p: string) => { const list = await hub.call<ThreadSummary[]>('threads', p); setThreadsBy((m) => ({ ...m, [p]: list })); return list; }, []);
  const refreshGit = React.useCallback(async (p = projectRef.current) => { setGit(p ? await hub.call<GitInfo | null>('gitInfo', p) : null); }, []);

  const openThread = React.useCallback(async (id: string) => {
    const t = await hub.call<Thread | null>('thread', id);
    if (!t) return;
    threadRef.current = t; projectRef.current = t.project;
    setHome(false); setThread(t); setThreadIdRaw(t.id); setProjectRaw(t.project); refreshGit(t.project);
  }, [refreshGit, setProjectRaw, setThreadIdRaw]);

  const newThread = React.useCallback((p?: string | null) => {
    const target = p ?? projectRef.current; if (!target) return;
    threadRef.current = null; projectRef.current = target;
    setHome(false); setThread(null); setThreadIdRaw(null); setProjectRaw(target); refreshGit(target);
  }, [refreshGit, setProjectRaw, setThreadIdRaw]);

  // First load
  React.useEffect(() => {
    (async () => {
      const s = await refreshState();
      await Promise.all(s.projects.map((p) => loadThreads(p.path)));
      let p = projectRef.current && s.projects.find((x) => x.path === projectRef.current) ? projectRef.current : s.projects[0]?.path ?? null;
      let t: Thread | null = null;
      if (threadId) { t = await hub.call<Thread | null>('thread', threadId); if (t) p = t.project; }
      if (!t && p) { const first = (await hub.call<ThreadSummary[]>('threads', p))[0]; if (first) t = await hub.call<Thread | null>('thread', first.id); }
      setProjectRaw(p); setThread(t); setThreadIdRaw(t?.id ?? null);
      setLoaded(true);
      // Repository status may be slow on large projects; the conversation is already usable.
      refreshGit(p).catch((e) => toast.error(`Could not load repository status: ${e.message || e}`));
    })().catch((e) => toast.error(`Could not load: ${e.message || e}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick a usable default agent
  React.useEffect(() => { if (st && (!agentId || !ready.find((a) => a.id === agentId)) && ready[0]) setAgentId(ready[0].id); }, [st, ready, agentId, setAgentId]);

  // Host events
  React.useEffect(() => {
    hub.on('state', () => { refreshState(); });
    hub.on('threads', (p) => { loadThreads(p); });
    hub.on('message', ({ threadId: tid, message }) => {
      setThread((t) => {
        if (!t || t.id !== tid) return t;
        const i = t.messages.findIndex((m) => m.id === message.id);
        const messages = i >= 0 ? t.messages.map((m, j) => (j === i ? message : m)) : [...t.messages, message];
        return { ...t, messages, title: t.messages.length === 0 && message.role === 'user' ? message.text.split('\n')[0].slice(0, 60) : t.title };
      });
    });
    hub.on('running', async ({ threadId: tid, running: r }) => {
      await refreshState();
      if (!r && threadRef.current?.id === tid) {
        refreshGit();
        const last = threadRef.current.messages[threadRef.current.messages.length - 1] as AgentMessage | undefined;
        if (last && last.role === 'assistant' && last.ok === false && last.error) toast.error(last.error.split('\n')[0].slice(0, 140));
      }
    });
    hub.on('insert', (text) => setDraft((d) => (d ? `${d}\n${text}` : text)));
    hub.on('open-thread', (id) => { if (id) openThread(id); });
    hub.on('notification', (n) => { (n.kind === 'failed' ? toast.error : toast.success)(n.title, { description: n.body }); });
    hub.on('focus-project', async (p) => { await refreshState(); await loadThreads(p); if (projectRef.current !== p) newThread(p); });
  }, [loadThreads, newThread, refreshGit, refreshState, openThread]);

  // Theme
  React.useEffect(() => {
    const fonts = { geist: "'Geist Variable', ui-sans-serif, system-ui, sans-serif", plex: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif", system: 'ui-sans-serif, system-ui, sans-serif' };
    document.documentElement.style.setProperty('--app-font', fonts[interfaceFont] || fonts.geist);
    document.documentElement.style.setProperty('--reading-size', `${[14, 15, 16, 18, 20].includes(readingSize) ? readingSize : 15}px`);
  }, [interfaceFont, readingSize]);
  React.useEffect(() => {
    const root = document.documentElement;
    if (hub.platform === 'vscode') {
      root.classList.add('vscode');
      const sync = () => root.classList.toggle('dark', document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast'));
      sync(); const mo = new MutationObserver(sync); mo.observe(document.body, { attributes: true, attributeFilter: ['class'] }); return () => mo.disconnect();
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
    apply(); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const send = React.useCallback(async (text: string, opts: { plan?: boolean; mode?: Mode; agentId?: string } = {}) => {
    const who = opts.agentId ?? agentId;
    if (!text.trim() || !who || !projectRef.current) return false;
    let t = threadRef.current;
    // While an agent is working in this thread, hold the message and send it when the turn ends.
    if (t && st?.running.includes(t.id)) {
      const id = t.id;
      setQueue((q) => ({ ...q, [id]: [...(q[id] || []), { text: text.trim(), plan: opts.plan, mode: opts.mode, agentId: who }] }));
      return true;
    }
    if (!t) {
      t = await hub.call<Thread>('createThread', projectRef.current);
      setThread(t); setThreadIdRaw(t.id);
    }
    hub.call('send', { threadId: t.id, agentId: who, text: text.trim(), mode: opts.mode ?? mode, gatewayId: who.startsWith('direct:') ? null : gatewayId || null, plan: !!opts.plan })
      .catch((e: Error) => { toast.error(e.message || String(e)); setDraft(text); });
    return true;
  }, [agentId, mode, gatewayId, setThreadIdRaw, st]);

  // Send the next queued message once the thread is free.
  React.useEffect(() => {
    const t = thread; if (!t || st?.running.includes(t.id)) return;
    const q = queue[t.id]; if (!q || !q.length) return;
    const [next, ...rest] = q;
    setQueue((all) => ({ ...all, [t.id]: rest }));
    hub.call('send', { threadId: t.id, agentId: next.agentId, text: next.text, mode: next.mode ?? mode, gatewayId: next.agentId.startsWith('direct:') ? null : gatewayId || null, plan: !!next.plan })
      .catch((e: Error) => toast.error(e.message || String(e)));
  }, [st, thread, queue, mode, gatewayId]);

  const setPanel = React.useCallback((p: { open: boolean; tab: PanelTab }) => { setPanelRaw(p); ls.set('panelTab', p.tab); }, []);
  const openPanel = React.useCallback((tab: PanelTab) => setPanel({ open: true, tab }), [setPanel]);
  const openFile = React.useCallback((rel: string, line?: number) => { setFileToOpen({ rel, line, n: Date.now() }); setPanel({ open: true, tab: 'files' }); }, [setPanel]);

  const openReview = React.useCallback(async (rel?: string | null) => {
    const p = projectRef.current; if (!p) return;
    await refreshGit(p);
    if (rel && hub.platform === 'vscode') hub.call('openDiff', p, rel);
    setPanel({ open: true, tab: 'review' });
    setReview({ open: true, rel: rel ?? null, diff: rel ? await hub.call<string>('fileDiff', p, rel) : '' });
  }, [refreshGit, setPanel]);

  const startTask = React.useCallback(async (input: TaskInput) => {
    const who = ready.find((a) => a.id === agentId)?.id || ready[0]?.id;
    if (!who) throw new Error('Connect an assistant before starting this task.');
    const result = await hub.call<{ thread: Thread; prompt: string; displayText: string }>('createTask', input);
    threadRef.current = result.thread; projectRef.current = result.thread.project;
    setProjectRaw(result.thread.project); setThreadIdRaw(result.thread.id); setThread(result.thread); setHome(false); setDraft('');
    await refreshState(); await loadThreads(result.thread.project);
    hub.call('send', { threadId: result.thread.id, agentId: who, text: result.prompt, displayText: result.displayText, mode: 'read', gatewayId: who.startsWith('direct:') ? null : gatewayId || null })
      .catch((e: Error) => toast.error(e.message || String(e)));
  }, [agentId, ready, gatewayId, refreshState, loadThreads, setProjectRaw, setThreadIdRaw]);

  const makeDocument = React.useCallback(async (messageId: string) => {
    const t = threadRef.current; if (!t) return;
    const doc = await hub.call<SavedDocument>('createDocument', t.id, messageId);
    setThread((current) => current?.id === t.id ? { ...current, documents: [...(current.documents || []).filter((d) => d.id !== doc.id), doc] } : current);
    setDocument({ threadId: t.id, id: doc.id });
  }, []);

  return {
    hub, loaded, st, threadsBy, project, thread, git, agentId, agent, mode, gatewayId, theme, review, settings, palette, draft, ready, running,
    home, goHome: () => setHome(true), startTask, document: activeDocument, setDocument, makeDocument,
    panel, setPanel, openPanel, fileToOpen, openFile, terminalOpen, teamOpen, setTeamOpen, roomOpen, setRoomOpen,
    interfaceFont, setInterfaceFont, readingSize, setReadingSize,
    queued: (thread && queue[thread.id]) || [], clearQueue: () => { if (thread) setQueue((q) => ({ ...q, [thread.id]: [] })); },
    setTerminalOpen: setTerminalOpenRaw,
    agentOf, refreshState, loadThreads, refreshGit, openThread, newThread, send, openReview,
    setAgentId, setMode, setGatewayId, setTheme, setReview, setSettings, setPalette, setDraft, setThread,
    stop: () => { if (threadRef.current) hub.call('stop', threadRef.current.id); },
    openSettings: (tab: SettingsTab = 'agents') => setSettings({ open: true, tab }),
  };
}

type Store = ReturnType<typeof useStoreValue>;
const Ctx = React.createContext<Store | null>(null);
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const v = useStoreValue();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export function useStore() { const v = React.useContext(Ctx); if (!v) throw new Error('StoreProvider missing'); return v; }
export type { Message };
