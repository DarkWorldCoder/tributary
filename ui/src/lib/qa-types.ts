export type QaStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'blocked' | 'not-run' | 'expected-failure';
export interface QaArtifact { id: string; name: string; contentType: string; available: boolean; kind: 'file' | 'image' | 'trace'; note: string; sha256?: string; size?: number }
export interface QaStep { title: string; error: string; durationMs: number; steps: QaStep[] }
export interface QaAttempt { index: number; retry: number; status: string; durationMs: number; startedAt: string; errors: string[]; output: string; steps: QaStep[]; artifacts: QaArtifact[] }
export interface QaTest { id: string; title: string; suite: string; projectName: string; file: string | null; line: number; expectedStatus: string; status: QaStatus; attempts: QaAttempt[]; durationMs: number }
export interface QaSummary { id: string; project: string; source: string; environment: string; build: string; importedAt: number; startedAt: string; durationMs: number; counts: Record<QaStatus, number>; errors: string[]; status: string; total: number; artifactBytes: number }
export interface QaRun extends Omit<QaSummary, 'total' | 'artifactBytes'> { version: number; tests: QaTest[] }
