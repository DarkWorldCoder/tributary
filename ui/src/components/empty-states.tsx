import * as React from 'react';
import { toast } from 'sonner';
import { BookOpen, Check, ExternalLink, FolderPlus, KeyRound, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AgentAvatar } from '@/components/agent-avatar';
import { useRunInTerminal } from '@/hooks/use-run-in-terminal';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { Agent } from '@/types';

const q = (p: string) => (/^[\w./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);
/** The sign-in command with the agent's detected path, so it works even when the CLI is not on PATH. */
export const loginCommand = (a: Agent) => (a.login && a.path ? [q(a.path), ...a.login.split(' ').slice(1)].join(' ') : null);

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      <span className={cn('relative z-10 grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold', done ? 'border-success bg-success text-white' : 'bg-card')}>{done ? <Check className="size-4" /> : n}</span>
      <div className="min-w-0 flex-1 pt-1"><h3 className="font-semibold">{title}</h3><div className="mt-2">{children}</div></div>
    </li>
  );
}

/** First-run home: find agents, sign in, pick a folder, share memory. Written for people who do not code. */
export function NoProject() {
  const s = useStore(); const run = useRunInTerminal();
  const agents = s.st?.agents ?? [];
  const installed = agents.filter((a) => a.available && a.headless);
  const missing = agents.filter((a) => !a.available && a.docs);
  const [scanning, setScanning] = React.useState(false);
  const add = async () => { const p = await s.hub.call<string | null>('pickProject'); if (p) { await s.refreshState(); await s.loadThreads(p); s.newThread(p); } };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <img src="./logo.svg" alt="" className="mb-5 size-12 rounded-2xl shadow-sm" />
        <h1 className="text-3xl font-semibold tracking-tight text-balance">Every coding agent, one stream of work</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground text-pretty">Ask Claude Code, Codex, Gemini and other assistants to build things in a folder on your computer. They share the same files and memory, so you can switch between them without starting over.</p>
        <ol className="relative mt-10 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
          <Step n={1} done={installed.length > 0} title={installed.length ? `${installed.length} assistant${installed.length > 1 ? 's' : ''} found on this computer` : 'Install at least one coding assistant'}>
            <div className="flex flex-col gap-2">
              {installed.map((a) => {
                const cmd = loginCommand(a);
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
                    <AgentAvatar agent={a} size="md" />
                    <div className="min-w-0 flex-1"><div className="font-medium">{a.name}</div><div className="truncate text-xs text-muted-foreground">{a.note ?? 'Ready. Sign in once if you have not used it before.'}</div></div>
                    {cmd && s.hub.platform !== 'mock' && <Button size="sm" variant="outline" onClick={() => run(cmd)}><KeyRound /> Sign in</Button>}
                  </div>
                );
              })}
              {missing.length > 0 && (
                <details className="rounded-xl border px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">More assistants you can install ({missing.length})</summary>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {missing.map((a) => (
                      <li key={a.id} className="flex items-center gap-2"><AgentAvatar agent={a} size="sm" muted /><span className="flex-1">{a.name}</span>
                        <Button size="xs" variant="ghost" onClick={() => s.hub.call('openExternal', a.docs)}>How to install <ExternalLink /></Button></li>
                    ))}
                  </ul>
                </details>
              )}
              <Button size="sm" variant="ghost" className="self-start" disabled={scanning} onClick={async () => { setScanning(true); await s.hub.call('rescan'); await s.refreshState(); setScanning(false); toast.success('Checked again'); }}>
                {scanning ? <Spinner /> : <RefreshCw />} I installed one, check again
              </Button>
            </div>
          </Step>
          <Step n={2} title="Choose the folder to work in">
            <p className="mb-3 text-sm text-pretty text-muted-foreground">Pick an existing project, or make an empty folder for something new. Review your assistant’s access mode before asking it to change files.</p>
            {s.hub.platform === 'vscode' ? <p className="text-sm text-muted-foreground">Open a folder in VS Code to continue.</p> : <Button onClick={add}><FolderPlus /> Choose a folder</Button>}
          </Step>
          <Step n={3} title="Ask for something">
            <p className="text-sm text-muted-foreground">Describe what you want in plain words, like “add a contact form to my site” or “why does the app crash on login?”. Turn on shared memory in the Memory tab so every assistant remembers your decisions.</p>
          </Step>
        </ol>
      </div>
    </div>
  );
}

const STARTERS = [
  { label: 'Explain project', text: 'Explain what this project does, how it is organized, and how to run it. Keep it short and plain.', mode: 'read' as const },
  { label: 'Fix a bug', text: 'Find the most likely bug in this project, explain it in plain words, then fix it and tell me how you checked.' },
  { label: 'Add tests', text: 'Add tests for the most important code that has none yet, and run them.' },
  { label: 'Review changes', text: '/review' },
];

/** Starter prompts for a new thread. */
export function Starters() {
  const s = useStore();
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Suggested tasks">
      {STARTERS.map((x) => (
        <button key={x.label} onClick={() => { s.setDraft(x.text); if (x.mode) s.setMode(x.mode); }} className="min-h-8 rounded-lg border bg-card px-2.5 py-1.5 text-xs max-sm:min-h-11 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          {x.label}
        </button>
      ))}
      <button onClick={() => s.openPanel('memory')} className="inline-flex items-center gap-1.5 min-h-8 rounded-lg border bg-card px-2.5 py-1.5 text-xs max-sm:min-h-11 text-muted-foreground hover:bg-muted hover:text-foreground"><BookOpen className="size-3.5" /> Shared memory</button>
    </div>
  );
}
