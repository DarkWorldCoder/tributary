import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import './index.css';
const WorkspaceApp = lazy(() => import('./workspace-app'));
const CollaborationWeb = lazy(() => import('./collaboration-web').then((m) => ({ default: m.CollaborationWeb })));

createRoot(document.getElementById('root')!).render(<Suspense fallback={<main role="status" className="grid h-svh place-items-center text-sm text-muted-foreground">Opening your workspace…</main>}>{!window.hub && location.pathname === '/room' ? <CollaborationWeb /> : <WorkspaceApp />}</Suspense>);
