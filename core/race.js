'use strict';
// Race: run the same task with several agents at once, each in its own git worktree that starts
// from the current files (uncommitted work included). Optionally run a test command in each.
// The project is untouched until the user applies one candidate's diff.
const crypto = require('crypto');
const path = require('path');
const { createCheckpoint, snapshotTree } = require('./checkpoint');
const { runTurn } = require('./runner');
const { localHost } = require('./host');

// Like git(), but also resolves on a non-zero exit so the caller can read the output.
const gitRaw = async (host, cwd, args, { env } = {}) => {
  const r = await host.exec('git', args, { cwd, env, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.code, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
};
const git = async (host, cwd, args, opts) => {
  const r = await gitRaw(host, cwd, args, opts);
  if (r.code) throw new Error(r.stderr.trim());
  return r.stdout;
};
const IDENTITY = { GIT_AUTHOR_NAME: 'Tributary', GIT_AUTHOR_EMAIL: 'tributary@localhost', GIT_COMMITTER_NAME: 'Tributary', GIT_COMMITTER_EMAIL: 'tributary@localhost' };
const diffId = (diff) => crypto.createHash('sha1').update(diff).digest('hex');

function runTests(cwd, command, timeoutMs = 10 * 60 * 1000, { host = localHost, signal } = {}) {
  if (signal?.aborted) return Promise.resolve({ passed: false, output: '[stopped]', aborted: true });
  return new Promise((resolve) => {
    const sh = !host.remote && process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', command]] : ['/bin/sh', ['-c', command]];
    const child = host.spawn(sh[0], sh[1], { cwd, env: { CI: '1' } });
    let out = ''; const take = (d) => { out = (out + d).slice(-6000); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    let aborted = false; let timedOut = false;
    const abort = () => { if (aborted) return; aborted = true; take('\n[stopped]'); host.kill(child); };
    const timer = setTimeout(() => { timedOut = true; take('\n[timed out]'); host.kill(child); }, timeoutMs);
    const finish = (result) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(result); };
    child.on('close', (code) => finish({ passed: code === 0 && !aborted && !timedOut, output: out, ...(aborted ? { aborted: true } : {}) }));
    child.on('error', (e) => finish({ passed: false, output: e.message, ...(aborted ? { aborted: true } : {}) }));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/**
 * hub: the Hub. opts: { task, agents: [agentId], testCommand?, mode?, onUpdate(candidate), host? }.
 * With a remote host, root and project are paths on that host and everything runs there.
 * Returns { id, base, candidates: [{ agent, ok, text, files, diff, stat, tests, testOutput, durationMs, error }] }.
 */
async function race(hub, { root, project, prompts, agents, mode = 'edit', testCommand, extraDirs = [], trusted = true, signal, onUpdate, host = localHost }) {
  const id = crypto.randomBytes(5).toString('hex');
  const p = host.path;
  const base = await createCheckpoint(root, `race-${id}`, { external: false, host });
  const relProject = p.relative(root, project);
  const dir = await host.mkdtemp(`tributary-race-${id}-`);
  const candidates = agents.map((a) => ({ agent: a.id, status: 'running', ok: null, text: '', files: [], diff: '', stat: '', tests: testCommand ? 'pending' : 'skipped', testOutput: '', activity: '' }));
  const update = (c) => onUpdate && onUpdate(c);

  await Promise.all(agents.map(async (agent, i) => {
    const c = candidates[i]; const started = Date.now();
    const wt = p.join(dir, agent.id);
    c.branch = `tributary/race-${id}/${agent.id}`;
    try {
      // Each candidate gets its own branch, kept after the race so you can continue from it.
      await git(host, root, ['worktree', 'add', '-b', c.branch, wt, base]);
      const cwd = p.join(wt, relProject);
      const r = await runTurn({ agent, cwd, prompt: prompts[agent.id], mode, trusted, extraDirs, signal, host, onEvent: (e) => {
        if (e.kind === 'text') c.text += e.text;
        else if (e.kind === 'tool') { c.activity = `${e.name} ${e.input && (e.input.command || e.input.file_path || e.input.path) || ''}`.trim().slice(0, 160); update(c); }
        else if (e.kind === 'error') c.error = c.error ? `${c.error}\n${e.message}` : e.message;
      } });
      c.ok = r.ok; c.text = (c.text || r.text || '').slice(0, 8000);
      if (testCommand && !(signal && signal.aborted)) {
        c.tests = 'running'; update(c);
        const t = await runTests(cwd, testCommand, undefined, { host, signal });
        c.tests = t.passed ? 'passed' : 'failed'; c.testOutput = t.output;
      }
      const tree = await snapshotTree(wt, { external: false, host });
      c.diff = (await git(host, wt, ['diff', '--binary', `${base}^{tree}`, tree])).slice(0, 2_000_000);
      c.stat = (await git(host, wt, ['diff', '--stat', `${base}^{tree}`, tree])).trim().split('\n').pop() || '';
      c.files = (await git(host, wt, ['diff', '--name-only', `${base}^{tree}`, tree])).split('\n').filter(Boolean).map((f) => p.relative(relProject || '.', f) || f);
      if (c.files.length) {
        const msg = `Tributary race: ${agent.name || agent.id}\n\n${String(prompts[agent.id] || '').split('\n').pop().slice(0, 200)}\n\nTributary-Diff: ${diffId(c.diff)}`;
        c.commit = (await git(host, wt, ['commit-tree', tree, '-p', base, '-m', msg], { env: IDENTITY })).trim();
        await git(host, root, ['update-ref', `refs/heads/${c.branch}`, c.commit]);
      }
    } catch (e) {
      c.ok = false; c.error = e.message;
    } finally {
      c.status = 'done'; c.durationMs = Date.now() - started;
      await git(host, root, ['worktree', 'remove', '--force', wt]).catch(() => {});
      update(c);
    }
  }));
  await git(host, root, ['worktree', 'prune']).catch(() => {});
  await host.rm(dir).catch(() => {});
  return { id, base, candidates };
}

// Patches go to git on stdin, so nothing is written to a temporary file on either machine.
async function applyPatch(root, patch, host = localHost) {
  const r = await host.exec('git', ['apply', '--whitespace=nowarn'], { cwd: root, input: patch, timeout: 60000 });
  if (r.code) throw new Error(String(r.stderr).trim());
}

// Find the race commit that produced this diff (its message carries the diff's fingerprint).
async function findCandidateCommit(root, diff, host) {
  const id = diffId(diff);
  const refs = (await gitRaw(host, root, ['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads/tributary/'])).stdout.split('\n').filter(Boolean);
  for (const line of refs) {
    const [sha, ref] = line.split(' ');
    const body = (await gitRaw(host, root, ['log', '-1', '--format=%B', sha])).stdout;
    if (body.includes(`Tributary-Diff: ${id}`)) return { commit: sha, branch: ref };
  }
  return null;
}

// Apply a candidate. Merges the candidate with your current files (including uncommitted work)
// using git merge-tree, which never touches the working tree; only a clean result is applied.
async function applyDiff(root, diff, { host = localHost } = {}) {
  if (!diff.trim()) throw new Error('This candidate made no changes');
  const found = await findCandidateCommit(root, diff, host);
  if (!found) {
    // No race branch (an older race): only apply if the patch applies cleanly as is.
    const r = await host.exec('git', ['apply', '--check', '--whitespace=nowarn'], { cwd: root, input: diff, timeout: 60000 });
    if (r.code) throw new Error(`These changes conflict with your current files: ${String(r.stderr).trim().split('\n').slice(0, 3).join(' ')}`);
    return applyPatch(root, diff, host);
  }
  const base = (await git(host, root, ['rev-parse', `${found.commit}^`])).trim();
  const now = await snapshotTree(root, { external: false, host });
  const current = (await git(host, root, ['commit-tree', now, '-m', 'Tributary: files before apply'], { env: IDENTITY })).trim();
  const m = await gitRaw(host, root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', `--merge-base=${base}`, current, found.commit]);
  const out = m.stdout.trim().split('\n');
  if (m.code === 1) {
    const files = [...new Set(out.slice(1).filter(Boolean))];
    throw new Error(`Can't apply cleanly: these files conflict with changes made since the race started: ${files.join(', ')}. The attempt is kept on branch ${found.branch} so you or an agent can merge it.`);
  }
  if (m.code) throw new Error(`Could not merge the changes: ${m.stderr.trim()}`);
  const patch = await git(host, root, ['diff', '--binary', now, out[0]]);
  if (patch.trim()) await applyPatch(root, patch, host);
}

module.exports = { race, applyDiff, runTests };
