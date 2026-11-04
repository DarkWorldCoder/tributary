import type { ActivityEntry, ActivityWorker, Thread } from '@/types';
export function isWorkerBusy(worker: ActivityWorker): boolean;
export function activityCounts(entries: ActivityEntry[]): { running: number; waiting: number; attention: number; done: number; total: number; files: number };
export function finishedActivity<T extends ActivityEntry>(entry: T, thread: Thread | null): T;
