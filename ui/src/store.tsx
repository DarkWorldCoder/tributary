import * as React from 'react';
import { toast } from 'sonner';
import { createMockHub } from './mock';
import { applyPatch } from '@/lib/message-patch.mjs';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWorkspaceView } from '@/hooks/use-workspace-view';
import { followedFile } from '@/lib/workbench-navigation.mjs';
import { draftWriter } from '@/lib/drafts.mjs';
import type { Agent, AgentMessage, GitInfo, HubBridge, HubState, Message, Mode, Thread, ThreadSummary, TaskInput, SavedDocument } from './types';

export type PanelTab = 'review' | 'changes' | 'files' | 'memory' | 'preview' | 'tests';

export const hub: HubBridge = window.hub ?? createMockHub();

// The message being typed lives outside the store's React state: a keystroke re-renders only the composer
// (through useDraft), not every component that reads the store. s.draft and s.setDraft still work.
const draftSubscribers = new Set<() => void>();
let draftValue = '';
const getDraft = () => draftValue;
const setDraft = (next: string | ((current: string) => string)) => {
  draftValue = typeof next === 'function' ? next(draftValue) : next;
  for (const fn of draftSubscribers) fn();
};
const subscribeDraft = (fn: () => void) => { draftSubscribers.add(fn); return () => { draftSubscribers.delete(fn); }; };
export function useDraft() { return React.useSyncExternalStore(subscribeDraft, getDraft); }
// It also survives a crash or restart (core/drafts.js), once the saved one has been read back.
const composerDraft = draftWriter(hub, 'composer');
let composerRestored = false;
subscribeDraft(() => { if (composerRestored) composerDraft.set(draftValue || null); });
function restoreComposerDraft() {
  hub.call<string | null>('draft', 'composer')
    .then((saved) => { if (typeof saved === 'string' && saved && !draftValue) setDraft(saved); })
    .catch(() => { /* nothing saved, or an older host */ })
    .finally(() => { composerRestored = true; if (draftValue) composerDraft.set(draftValue); });
}

const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(`tributary.${k}`); return v == null ? d : (JSON.parse(v) as T); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(`tributary.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export type Theme = 'system' | 'light' | 'dark';
export type InterfaceFont = 'geist' | 'plex' | 'system';
export type SettingsTab = 'connections' | 'agents' | 'gateways' | 'mcp' | 'skills' | 'secrets' | 'appearance' | 'extensions' | 'language-tools' | 'shortcuts' | 'about';

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
  const [models, setModels] = useStored<Record<string, string>>('models', {});
  const modelKey = (who: string, source?: string | null) => `${who}@${who.startsWith('direct:') ? who.slice(7) : source || 'default'}`;
  const modelFor = (who: string, source?: string | null) => models[modelKey(who, source)] || '';
  const selectedModel = agentId ? modelFor(agentId, gatewayId) : '';
  const setSelectedModel = (model: string) => { if (agentId) setModels({ ...models, [modelKey(agentId, gatewayId)]: model }); };
  const [theme, setTheme] = useStored<Theme>('theme', 'system');
  const [workbenchPalette, setWorkbenchPalette] = useStored<'ocean' | 'graphite'>('workbenchPalette', 'ocean');
  const [interfaceFont, setInterfaceFont] = useStored<InterfaceFont>('interfaceFont', 'geist');
  const [readingSize, setReadingSize] = useStored<number>('readingSize', 15);
  const [codingReadingSize, setCodingReadingSize] = useStored<number>('codingReadingSize', 13);
  const [uiDensity, setUiDensity] = useStored<'compact' | 'comfortable'>('uiDensity', 'compact');
  const [compactFolders, setCompactFolders] = useStored<boolean>('compactFolders', true);
  const [stickyFolders, setStickyFolders] = useStored<boolean>('stickyFolders', true);
  const [roomOpen, setRoomOpen] = React.useState(false);
  const [contextOpen, setContextOpen] = useStored<boolean>('contextOpen', true);
  const [contextSheetOpen, setContextSheetOpen] = React.useState(false);
  const { view, update: updateView, saved: workspaceViewSaved } = useWorkspaceView(thread?.worktree?.cwd ?? project);
  const workspaceLayout = view.layout; const workspaceExpanded = view.expanded; const panel = view.panel;
  const setWorkspaceLayout = React.useCallback((layout: 'editor' | 'chat') => updateView({ layout }), [updateView]);
  const setWorkspaceExpanded = React.useCallback((expanded: boolean) => updateView({ expanded }), [updateView]);
  const [review, setReview] = React.useState<{ open: boolean; rel: string | null; diff: string }>({ open: false, rel: null, diff: '' });
  const [fileToOpen, setFileToOpen] = React.useState<{ rel: string; line?: number; column?: number; editor?: boolean; following?: boolean; intent: 'preview' | 'pinned'; project: string | null; n: number } | null>(null);
  const [followThread, setFollowThread] = React.useState<string | null>(null);
  const pauseFollowing = React.useCallback(() => setFollowThread(null), []);
  const [checksIntent, setChecksIntent] = React.useState<{ project: string; n: number } | null>(null);
  const [debugOpen, setDebugOpen] = React.useState(false);
  const [debugLaunch, setDebugLaunch] = React.useState<{ project: string | null; rel: string } | null>(null);
  const [terminalOpen, setTerminalOpenRaw] = useStored<boolean>('terminal', false);
  const [terminalPositionRaw, setTerminalPosition] = useStored<'left' | 'right' | 'top' | 'bottom'>('terminalPosition', 'bottom');
  const terminalPosition = ['left', 'right', 'top', 'bottom'].includes(terminalPositionRaw) ? terminalPositionRaw : 'bottom';
  const mobile = useIsMobile();
  const terminalDock = mobile ? 'bottom' : terminalPosition;
  const [teamOpen, setTeamOpen] = React.useState(false);
  const [queue, setQueue] = React.useState<Record<string, { id: string; text: string; attachments?: string[]; plan?: boolean; research?: boolean; mode?: Mode; agentId: string; model?: string; gatewayId?: string | null }[]>>({});
  const [settings, setSettings] = React.useState<{ open: boolean; tab: SettingsTab }>({ open: false, tab: 'agents' });
  const [palette, setPalette] = React.useState(false);
  const [recentOpen, setRecentOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [home, setHome] = React.useState(false);
  const [activeDocument, setDocument] = React.useState<{ threadId: string; id: string } | null>(null);
  const threadRef = React.useRef<Thread | null>(null); threadRef.current = thread;
  const projectRef = React.useRef<string | null>(null); projectRef.current = project;
  // Where this conversation's files are: its separate working copy, or the project folder.
  const workdir = thread?.worktree?.cwd ?? project;
  const workdirRef = React.useRef<string | null>(null); workdirRef.current = workdir;

  const ready = React.useMemo(() => (st ? st.agents.filter((a) => a.available && a.headless) : []), [st]);
  const agentOf = React.useCallback((id?: string | null): Agent => (st?.agents.find((a) => a.id === id)) ?? { id: id || '?', name: id || 'Agent', color: '#8a8f98', available: false, headless: false, protocol: '' }, [st]);
  const agent = agentOf(agentId);
  const running = !!(thread && st?.running.includes(thread.id));

  const refreshState = React.useCallback(async () => { const s = await hub.call<HubState>('state'); setSt(s); return s; }, []);
  const loadThreads = React.useCallback(async (p: string) => { const list = await hub.call<ThreadSummary[]>('threads', p); setThreadsBy((m) => ({ ...m, [p]: list })); return list; }, []);
  const refreshGit = React.useCallback(async (p = workdirRef.current) => { const result = p ? await hub.call<GitInfo | null>('gitInfo', p) : null; if (p === workdirRef.current) setGit(result); }, []);

  // Opening a thread (or watching it finish) clears its "needs review" badge.
  const markSeen = React.useCallback((id: string) => { hub.call('markThreadSeen', id).catch(() => { /* older host */ }); }, []);

  const openThread = React.useCallback(async (id: string) => {
    const t = await hub.call<Thread | null>('thread', id);
    if (!t) return;
    markSeen(t.id);
    threadRef.current = t; projectRef.current = t.project; workdirRef.current = t.worktree?.cwd ?? t.project;
    pauseFollowing(); setHome(false); setThread(t); setThreadIdRaw(t.id); setProjectRaw(t.project); refreshGit(workdirRef.current);
  }, [refreshGit, setProjectRaw, setThreadIdRaw, markSeen, pauseFollowing]);

  const newThread = React.useCallback((p?: string | null) => {
    const target = p ?? projectRef.current; if (!target) return;
    threadRef.current = null; projectRef.current = target; workdirRef.current = target;
    pauseFollowing(); setHome(false); setThread(null); setThreadIdRaw(null); setProjectRaw(target); refreshGit(target);
  }, [refreshGit, setProjectRaw, setThreadIdRaw, pauseFollowing]);

  // First load
  React.useEffect(() => {
    if (!composerRestored) restoreComposerDraft();
    (async () => {
      const s = await refreshState();
      await Promise.all(s.projects.map((p) => loadThreads(p.path)));
      let p = projectRef.current && s.projects.find((x) => x.path === projectRef.current) ? projectRef.current : s.projects[0]?.path ?? null;
      let t: Thread | null = null;
      if (threadId) { t = await hub.call<Thread | null>('thread', threadId); if (t) p = t.project; }
      if (!t && p) { const first = (await hub.call<ThreadSummary[]>('threads', p))[0]; if (first) t = await hub.call<Thread | null>('thread', first.id); }
      projectRef.current = p; threadRef.current = t; workdirRef.current = t?.worktree?.cwd ?? p;
      setProjectRaw(p); setThread(t); setThreadIdRaw(t?.id ?? null);
      if (t) markSeen(t.id);
      setLoaded(true);
      // Repository status may be slow on large projects; the conversation is already usable.
      refreshGit(t?.worktree?.cwd ?? p).catch((e) => toast.error(`Could not load repository status: ${e.message || e}`));
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
    // While a reply streams, only what changed arrives (core/message-patch.js).
    hub.on('message-patch', ({ threadId: tid, id, patch }) => {
      setThread((t) => {
        if (!t || t.id !== tid) return t;
        const i = t.messages.findIndex((m) => m.id === id); if (i < 0) return t;
        const next = applyPatch(t.messages[i], patch); if (!next) return t;
        return { ...t, messages: t.messages.map((m, j) => (j === i ? next : m)) };
      });
    });
    hub.on('running', async ({ threadId: tid, running: r }) => {
      await refreshState();
      if (!r && threadRef.current?.id === tid) {
        refreshGit(); markSeen(tid);
        const last = threadRef.current.messages[threadRef.current.messages.length - 1] as AgentMessage | undefined;
        if (last && last.role === 'assistant' && last.ok === false && last.error) toast.error(last.error.split('\n')[0].slice(0, 140));
      }
    });
    hub.on('insert', (text) => setDraft((d) => (d ? `${d}\n${text}` : text)));
    hub.on('open-thread', (id) => { if (id) openThread(id); });
    hub.on('notification', (n) => { (n.kind === 'failed' ? toast.error : n.kind === 'permission' ? toast.warning : toast.success)(n.title, { description: n.body }); });
    hub.on('focus-project', async (p) => { await refreshState(); await loadThreads(p); if (projectRef.current !== p) newThread(p); });
  }, [loadThreads, newThread, refreshGit, refreshState, openThread, markSeen]);

  // Theme
  React.useEffect(() => { document.documentElement.dataset.workbenchPalette = workbenchPalette === 'graphite' ? 'graphite' : 'ocean'; }, [workbenchPalette]);
  React.useEffect(() => { document.documentElement.dataset.uiDensity = uiDensity === 'comfortable' ? 'comfortable' : 'compact'; }, [uiDensity]);
  React.useEffect(() => {
    const fonts = { geist: "'Geist Variable', ui-sans-serif, system-ui, sans-serif", plex: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif", system: 'ui-sans-serif, system-ui, sans-serif' };
    document.documentElement.style.setProperty('--app-font', fonts[interfaceFont] || fonts.geist);
    document.documentElement.style.setProperty('--reading-size', `${[14, 15, 16, 18, 20].includes(readingSize) ? readingSize : 15}px`);
    document.documentElement.style.setProperty('--coding-reading-size', `${[12, 13, 14, 15, 16, 18, 20].includes(codingReadingSize) ? codingReadingSize : 13}px`);
  }, [interfaceFont, readingSize, codingReadingSize]);
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

  const send = React.useCallback(async (text: string, opts: { plan?: boolean; research?: boolean; mode?: Mode; agentId?: string; attachments?: string[] } = {}) => {
    const who = opts.agentId ?? agentId;
    if (!text.trim() || !who || !projectRef.current) return false;
    const source = who.startsWith('direct:') ? null : gatewayId || null;
    const model = modelFor(who, source);
    let t = threadRef.current;
    // While an agent is working in this thread, hold the message and send it when the turn ends.
    if (t && st?.running.includes(t.id)) {
      const id = t.id;
      setQueue((q) => ({ ...q, [id]: [...(q[id] || []), { id: crypto.randomUUID(), text: text.trim(), attachments: opts.attachments, plan: opts.plan, research: opts.research, mode: opts.mode ?? mode, agentId: who, model, gatewayId: source }] }));
      return true;
    }
    if (!t) {
      t = await hub.call<Thread>('createThread', projectRef.current);
      setThread(t); setThreadIdRaw(t.id);
    }
    hub.call('send', { threadId: t.id, agentId: who, text: text.trim(), attachments: opts.attachments, mode: opts.mode ?? mode, gatewayId: source, model: model || null, plan: !!opts.plan, research: !!opts.research })
      .catch((e: Error) => { toast.error(e.message || String(e)); setDraft(text); if (opts.attachments?.length) window.dispatchEvent(new CustomEvent('tributary:restore-attachments', { detail: { project: t!.project, threadId: t!.id, ids: opts.attachments } })); });
    return true;
  }, [agentId, mode, gatewayId, models, setThreadIdRaw, st]);

  // Send the next queued message once the thread is free.
  React.useEffect(() => {
    const t = thread; if (!t || st?.running.includes(t.id)) return;
    const q = queue[t.id]; if (!q || !q.length) return;
    const [next, ...rest] = q;
    setQueue((all) => ({ ...all, [t.id]: rest }));
    hub.call('send', { threadId: t.id, agentId: next.agentId, text: next.text, attachments: next.attachments, mode: next.mode ?? mode, gatewayId: next.gatewayId ?? null, model: next.model || null, plan: !!next.plan, research: !!next.research })
      .catch((e: Error) => toast.error(e.message || String(e)));
  }, [st, thread, queue, mode, gatewayId]);

  const setPanel = React.useCallback((p: { open: boolean; tab: PanelTab }) => { if (!p.open || p.tab !== 'files') pauseFollowing(); if (!p.open) setTerminalOpenRaw(false); updateView({ panel: p }); }, [updateView, pauseFollowing, setTerminalOpenRaw]);
  const setTerminalOpen = React.useCallback((open: boolean) => {
    setTerminalOpenRaw(open);
    if (open) { setHome(false); setDocument(null); setPanel({ open: true, tab: panel.tab }); }
  }, [setTerminalOpenRaw, setPanel, panel.tab]);
  React.useEffect(() => { if (home || activeDocument) setTerminalOpenRaw(false); }, [home, activeDocument, setTerminalOpenRaw]);
  const openPanel = React.useCallback((tab: PanelTab) => { setPanel({ open: true, tab }); }, [setPanel]);
  const fileIntentId = React.useRef(0);
  const openChecks = React.useCallback(() => { const project = workdirRef.current; if (!project) return; setChecksIntent({ project, n: ++fileIntentId.current }); setPanel({ open: true, tab: 'files' }); }, [setPanel]);
  const openFile = React.useCallback((rel: string, line?: number, intent: 'preview' | 'pinned' = 'preview', column?: number, editor = false, project = workdirRef.current) => { pauseFollowing(); setFileToOpen({ rel, line, column, editor, intent, project, n: ++fileIntentId.current }); setPanel({ open: true, tab: 'files' }); }, [setPanel, pauseFollowing]);
  const following = !!thread && followThread === thread.id;
  const followed = React.useRef('');
  const followTarget = following ? followedFile(thread, workdir) : null;
  React.useEffect(() => {
    if (!following || !followTarget || !panel.open || panel.tab !== 'files') return;
    const key = `${thread?.id}:${followTarget.key}`; if (followed.current === key) return; followed.current = key;
    setFileToOpen({ rel: followTarget.rel, following: true, editor: true, intent: 'preview', project: workdirRef.current, n: ++fileIntentId.current });
  }, [following, followTarget?.key, panel.open, panel.tab, thread?.id]);
  const toggleFollowing = () => { if (following) pauseFollowing(); else if (thread) { followed.current = ''; openPanel('files'); setFollowThread(thread.id); } };

  const openReview = React.useCallback(async (rel?: string | null) => {
    const p = workdirRef.current; if (!p) return;
    await refreshGit(p);
    if (rel && hub.platform === 'vscode') hub.call('openDiff', p, rel);
    setPanel({ open: true, tab: 'review' });
    setReview({ open: true, rel: rel ?? null, diff: rel ? await hub.call<string>('fileDiff', p, rel) : '' });
  }, [refreshGit, setPanel]);

  const startTask = React.useCallback(async (input: TaskInput) => {
    const who = ready.find((a) => a.id === agentId)?.id || ready[0]?.id;
    if (!who) throw new Error('Connect an assistant before starting this task.');
    const result = await hub.call<{ thread: Thread; prompt: string; displayText: string }>('createTask', input);
    threadRef.current = result.thread; projectRef.current = result.thread.project; workdirRef.current = result.thread.worktree?.cwd ?? result.thread.project;
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
    hub, loaded, st, threadsBy, project, workdir, thread, git, agentId, agent, mode, gatewayId, theme, review, settings, palette, ready, running,
    get draft() { return getDraft(); },
    home, goHome: () => { setHome(true); pauseFollowing(); }, startTask, document: activeDocument, setDocument, makeDocument,
    shortcutsOpen, setShortcutsOpen, panel, setPanel, openPanel, fileToOpen, openFile, editFile: (rel: string, line?: number, column?: number, project?: string) => openFile(rel, line, 'pinned', column, true, project), checksIntent, openChecks, debugOpen, setDebugOpen, debugLaunch, openDebugger: (rel?: string) => { if (rel) setDebugLaunch({ project: workdir, rel }); setDebugOpen(true); }, terminalOpen, teamOpen, setTeamOpen, roomOpen, setRoomOpen, recentOpen, setRecentOpen,
    selectedModel, setSelectedModel, modelFor,
    interfaceFont, setInterfaceFont, readingSize, setReadingSize, codingReadingSize, setCodingReadingSize, workbenchPalette, setWorkbenchPalette,
    uiDensity, setUiDensity, compactFolders, setCompactFolders, stickyFolders, setStickyFolders,
    following, toggleFollowing, pauseFollowing,
    workspaceExpanded, setWorkspaceExpanded, workspaceLayout, setWorkspaceLayout, workspaceViewSaved,
    contextOpen, setContextOpen, contextSheetOpen, setContextSheetOpen,
    codeLayout: workspaceLayout === 'editor' && !home && loaded && !!project && st?.projects.find((p) => p.path === project)?.kind !== 'personal',
    queued: (thread && queue[thread.id]) || [], clearQueue: () => { if (thread) setQueue((q) => ({ ...q, [thread.id]: [] })); },
    editQueued: (id: string, text: string) => { if (thread && text.trim()) setQueue((q) => ({ ...q, [thread.id]: (q[thread.id] || []).map((m) => m.id === id ? { ...m, text: text.trim() } : m) })); },
    removeQueued: (id: string) => { if (thread) setQueue((q) => ({ ...q, [thread.id]: (q[thread.id] || []).filter((m) => m.id !== id) })); },
    setTerminalOpen, terminalPosition, setTerminalPosition, terminalDock,
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
