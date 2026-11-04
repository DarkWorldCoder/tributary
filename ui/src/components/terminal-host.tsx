import * as React from 'react';
import { Button } from '@/components/ui/button';
class TerminalBoundary extends React.Component<{ children: React.ReactNode; hidden: boolean; retry: () => void; close: () => void }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.hidden) return null;
    return <section aria-label="Terminal error" role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-card px-4 py-3 text-sm"><span className="min-w-0 flex-1">Terminal couldn’t load. Your workspace is still open.</span><Button size="sm" variant="outline" onClick={this.props.retry}>Retry terminal</Button><Button size="sm" variant="ghost" onClick={this.props.close}>Close terminal</Button></section>;
  }
}
/** A failed lazy chunk or terminal renderer must never unmount the conversation. */
export function TerminalHost({ hidden, close }: { hidden: boolean; close: () => void }) {
  const [attempt, setAttempt] = React.useState(0);
  const Terminal = React.useMemo(() => React.lazy(() => import('@/components/terminal-panel').then((m) => ({ default: m.TerminalPanel }))), [attempt]);
  return <TerminalBoundary key={attempt} hidden={hidden} close={close} retry={() => setAttempt((n) => n + 1)}><React.Suspense fallback={hidden ? null : <p role="status" className="shrink-0 border-t p-3 text-sm text-muted-foreground">Opening terminal…</p>}><Terminal hidden={hidden} /></React.Suspense></TerminalBoundary>;
}
