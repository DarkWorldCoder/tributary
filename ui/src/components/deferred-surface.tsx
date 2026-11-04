import * as React from 'react';
import { Button } from '@/components/ui/button';

class FeatureBoundary extends React.Component<{ active: boolean; name: string; close?: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    if (!this.props.active) return null;
    return <section role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 text-sm"><span className="min-w-0 flex-1">{this.props.name} couldn’t open. Your work is kept. Reopen the app to try again.</span>{this.props.close && <Button size="sm" variant="outline" onClick={this.props.close}>Close</Button>}</section>;
  }
}

/** Load on first use, then preserve drafts and focus state when the surface closes. */
export function DeferredSurface({ active, name, close, children }: { active: boolean; name: string; close?: () => void; children: React.ReactNode }) {
  const [opened, setOpened] = React.useState(active);
  React.useEffect(() => { if (active) setOpened(true); }, [active]);
  if (!active && !opened) return null;
  return <FeatureBoundary active={active} name={name} close={close}><React.Suspense fallback={active ? <p role="status" className="p-4 text-sm text-muted-foreground">Opening {name.toLowerCase()}…</p> : null}>{children}</React.Suspense></FeatureBoundary>;
}
