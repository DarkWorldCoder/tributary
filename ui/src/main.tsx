import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { StoreProvider } from './store';
import { CollaborationWeb } from './collaboration-web';

createRoot(document.getElementById('root')!).render(!window.hub && location.pathname === '/room' ? <CollaborationWeb /> : <StoreProvider><App /></StoreProvider>);
