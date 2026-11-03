import App from './App';
import { StoreProvider } from './store';
export default function WorkspaceApp() { return <StoreProvider><App /></StoreProvider>; }
