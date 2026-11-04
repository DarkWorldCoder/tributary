export const isWorkerBusy = (worker) => !worker.attention && ['working', 'testing', 'merging'].includes(worker.state);
export function activityCounts(entries) {
  const workers = entries.flatMap((entry) => entry.workers);
  return { running: workers.filter(isWorkerBusy).length, waiting: workers.filter((worker) => worker.state === 'waiting' && !worker.attention).length, attention: workers.filter((worker) => worker.attention).length, done: workers.filter((worker) => worker.state === 'done').length, total: workers.length, files: new Set(entries.flatMap((entry) => entry.workers.flatMap((worker) => worker.files.map((file) => `${entry.workdir || entry.project}:${file.rel}`)))).size };
}
const files = (items = []) => items.filter((item) => !item.external).map((item) => typeof item === 'string' ? { rel: item } : { ...item, rel: item.rel });
// Ended live entries are only a last observation. Use saved outcomes to preserve
// mixed successes, failed checks and skipped dependencies instead of painting all green.
export function finishedActivity(entry, thread) {
  if (!thread) return { ...entry, workers: entry.workers.map((worker) => ({ ...worker, state: ['done', 'failed', 'skipped'].includes(worker.state) ? worker.state : 'stopped', attention: false, doing: '' })) };
  return { ...entry, workers: entry.workers.map((worker) => {
    const message = thread.messages.find((item) => item.id === worker.messageId);
    const task = worker.taskId && message?.manager?.tasks.find((item) => item.id === worker.taskId);
    const candidate = worker.role === 'candidate' && message?.race?.candidates.find((item) => item.agent === worker.agent);
    const final = task || candidate;
    const state = task ? ['done', 'failed', 'skipped'].includes(task.state) ? task.state : 'stopped' : candidate ? candidate.ok === false || candidate.error ? 'failed' : candidate.ok === true ? 'done' : 'stopped' : worker.taskId || worker.role === 'candidate' ? 'stopped' : message?.ok === true ? 'done' : message?.ok === false ? 'failed' : ['done', 'failed', 'skipped'].includes(worker.state) ? worker.state : 'stopped';
    return { ...worker, state, attention: false, doing: '', files: files(final?.files || message?.files || worker.files), tests: final?.tests || worker.tests, branch: final?.branch || worker.branch, note: task?.note || candidate?.error || message?.error || worker.note || '' };
  }) };
}
