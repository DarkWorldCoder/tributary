export interface AppUpdateState {
  currentVersion: string;
  platform: string;
  arch: string;
  packaged: boolean;
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  latestVersion: string | null;
  releaseUrl: string;
  notes: string;
  fileName: string;
  percent: number;
  transferred: number;
  total: number;
  checkedAt: number | null;
  error: string;
  autoCheck: boolean;
  hasToken: boolean;
  storage: 'encrypted' | 'weak' | 'session';
  appImage: boolean;
  installerOpened: boolean;
}
