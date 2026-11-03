'use strict';
// Pull requests from a conversation's separate copy, through the GitHub CLI (gh). Tributary never sees a token: gh and
// git push use the sign-in you already have. Create commits the copy's work, checks it with the secret guard, pushes
// the branch and opens a pull request whose title and description an agent drafts in a read-only turn. Checks come
// from `gh pr checks`; the failed jobs' logs can go to the agent; once the pull request is merged, the copy can go.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { which, pathDirs } = require('./agents');
const { localHost } = require('./host');
const { commitWork } = require('./worktrees');

const MISSING = 'The GitHub CLI (gh) is not installed. Install it from https://cli.github.com, run "gh auth login" in a terminal, then try again.';
const SIGNED_OUT = 'The GitHub CLI is not signed in. Run "gh auth login" in a terminal, then try again.';
const NO_REMOTE = 'This repository has no GitHub remote. Add one with "git remote add origin <url>", then try again.';
const DRAFT_PROMPT = `Write the title and description of a pull request for the changes in the diff below, made in this conversation. Do not change any files.
Reply in exactly this form, with nothing before TITLE:
TITLE: <one line under 70 characters that says what the change does>
BODY:
<Markdown: a short paragraph on what changed and why, a list of the main changes, and how it was tested if this conversation shows that>`;
const MAX_DIFF = 60000;
const LOG_LINES = 200;

// gh with the PATH agents get (an app started from the desktop menu has no Homebrew on PATH), and never a prompt.
function gh(args, { cwd, input } = {}) {
  const bin = process.env.TRIBUTARY_GH || which('gh', process.env);
  if (!bin) return Promise.reject(new Error(MISSING));
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: pathDirs().join(path.delimiter), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' };
    const c = execFile(bin, args, { cwd, env, timeout: 120000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return reject(new Error(MISSING));
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
    c.stdin.on('error', () => {}); c.stdin.end(input);
  });
}
function ghError(r, what) {
  const out = `${r.stderr}\n${r.stdout}`.trim();
  if (/none of the git remotes|no git remotes/i.test(out)) return new Error(NO_REMOTE);
  if (/not logged in|gh auth login|HTTP 401|bad credentials/i.test(out)) return new Error(SIGNED_OUT);
  return new Error(`${what}: ${out.split('\n').filter(Boolean).slice(-3).join(' ') || `gh exited with code ${r.code}`}`);
}
async function ghOut(args, opts, what) { const r = await gh(args, opts); if (r.code) throw ghError(r, what); return r.stdout; }
// Installed, signed in, and the folder's remotes point at a GitHub repository.
async function ready(cwd) {
  const auth = await gh(['auth', 'status'], { cwd });
  if (auth.code) throw /not logged in|gh auth login|no accounts/i.test(`${auth.stderr}${auth.stdout}`) ? new Error(SIGNED_OUT) : ghError(auth, 'Checking your GitHub sign-in failed');
  await ghOut(['repo', 'view', '--json', 'nameWithOwner'], { cwd }, 'gh could not find this repository on GitHub');
}

const git = async (cwd, args) => {
  const r = await localHost.exec('git', args, { cwd, env: { GIT_TERMINAL_PROMPT: '0' }, timeout: 300000 });
  if (r.code) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout;
};
const gitOk = async (cwd, args) => !(await localHost.exec('git', args, { cwd })).code;
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function thread(hub, threadId) {
  const t = hub.thread(threadId); if (!t) throw new Error('Thread not found');
  if (!t.worktree) throw new Error('This conversation is not working in a separate copy.');
  return t;
}
// The pull request's base: the branch the copy was made from.
const baseOf = (copy) => copy.pr?.base || (copy.from && copy.from !== 'HEAD' ? copy.from : null);
async function remoteFor(root, base) {
  const remotes = lines(await git(root, ['remote']));
  const tracked = base ? (await localHost.exec('git', ['config', `branch.${base}.remote`], { cwd: root })).stdout.trim() : '';
  const name = remotes.includes(tracked) ? tracked : remotes.includes('origin') ? 'origin' : remotes[0];
  if (!name) throw new Error(NO_REMOTE);
  return name;
}
// Where the branch left the base branch on the remote (or locally, or the commit the copy was made from).
async function forkPoint(dir, remote, base, fallback) {
  for (const ref of base ? [`refs/remotes/${remote}/${base}`, `refs/heads/${base}`] : []) {
    const r = await localHost.exec('git', ['merge-base', 'HEAD', ref], { cwd: dir });
    if (!r.code && r.stdout.trim()) return r.stdout.trim();
  }
  return fallback;
}

// Commit the copy's work, check what the push would publish for secrets, and push the branch.
// -> { remote, base, since } (since: where the branch left its base)
async function publish(hub, t, root, { allowSecrets = false, needChanges = false } = {}) {
  const copy = t.worktree; const dir = copy.path;
  if (!fs.existsSync(dir)) throw new Error(`The separate copy at ${dir} is gone. Discard it to work in the project folder again.`);
  if (await gitOk(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) throw new Error('The copy is in the middle of taking in the project\'s changes. Finish or undo that merge first.');
  await commitWork(localHost, dir, t.title, copy.copied);
  const base = baseOf(copy); const remote = await remoteFor(root, base);
  const since = await forkPoint(dir, remote, base, copy.base);
  if (needChanges && !Number((await git(dir, ['rev-list', '--count', `${since}..HEAD`])).trim())) throw new Error(`Nothing to put in a pull request yet: ${copy.branch} has no changes compared with ${base || 'its base'}.`);
  if (!allowSecrets) {
    await hub.learnSecrets(root); await hub.learnSecrets(dir);
    // What the remote doesn't have yet: everything since the last push, or since the branch left its base.
    const from = await gitOk(dir, ['rev-parse', '-q', '--verify', '@{upstream}']) ? '@{upstream}' : since;
    const refused = await hub.checkSecrets(await git(dir, ['diff', '--no-color', '--no-ext-diff', from, 'HEAD']));
    if (refused) throw refused;
  }
  await git(dir, ['push', '--quiet', '--set-upstream', remote, copy.branch]);
  return { remote, base, since };
}

/** "TITLE: …" and the text after "BODY:" from a drafting turn. -> { title, body } */
function parseDraft(text, fallbackTitle) {
  const s = String(text || '').replace(/\r/g, '');
  const title = /^\s*\**TITLE:?\**[ \t]*(.+?)\s*$/im.exec(s)?.[1].replace(/^["'`]+|["'`]+$/g, '').trim();
  const at = /^\s*\**BODY:?\**[ \t]*/im.exec(s);
  let body = at ? s.slice(at.index + at[0].length) : s.replace(/^\s*\**TITLE:?\**.*$/im, '');
  body = body.trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/, '$1').trim();
  return { title: (title || fallbackTitle || 'Changes from a Tributary conversation').slice(0, 200), body };
}
const prUrl = (text) => [...String(text).matchAll(/https?:\/\/\S+?\/pull\/(\d+)/g)].pop();

/**
 * Commit, check for secrets and push the copy's branch, have agentId draft the title and description in a read-only
 * turn, and open the pull request into the branch the copy was made from. allowSecrets pushes even though the
 * changes hold what looks like a secret. -> the pull request { number, url, title, base, state, createdAt }
 */
async function createPullRequest(hub, threadId, agentId, { allowSecrets = false } = {}) {
  const t = thread(hub, threadId);
  if (t.worktree.pr?.state === 'OPEN') return t.worktree.pr;
  if (!hub.agent(agentId)) throw new Error('Choose an agent to draft the pull request.');
  await ready(fs.existsSync(t.worktree.path) ? t.worktree.path : t.project);
  const { base, since } = await hub.changeCopy(threadId, {}, (t, root) => publish(hub, t, root, { allowSecrets, needChanges: true }));
  const dir = t.worktree.path; const branch = t.worktree.branch;
  const diff = await git(dir, ['diff', '--no-color', '--no-ext-diff', '--stat', '--patch', since, 'HEAD']);
  const cut = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n[The diff is longer; the rest was left out.]` : diff;
  const reply = await hub.send({ threadId, agentId, mode: 'read', team: { recipe: 'pull-request', role: 'writer' }, displayText: 'Draft a pull request for this branch',
    text: `${DRAFT_PROMPT}\n\n\`\`\`diff\n${cut}\n\`\`\`` });
  if (!reply.ok) throw new Error(`The pull request was not drafted${reply.error ? `: ${reply.error}` : ''}. ${branch} is pushed; try again.`);
  const { title, body } = parseDraft(reply.text, hub.thread(threadId)?.title);
  const r = await gh(['pr', 'create', '--head', branch, ...(base ? ['--base', base] : []), '--title', title, '--body-file', '-'], { cwd: dir, input: body });
  // Already open (made on GitHub, or by an earlier try): adopt it.
  const found = prUrl(r.code ? (/already exists/i.test(r.stderr) ? r.stderr : '') : r.stdout);
  if (!found) throw r.code ? ghError(r, 'gh could not create the pull request') : new Error(`gh created no pull request: ${r.stdout.trim()}`);
  const now = hub.thread(threadId);
  if (!now?.worktree) throw new Error('The separate copy was discarded meanwhile.');
  now.worktree.pr = { number: Number(found[1]), url: found[0], title, base, state: 'OPEN', createdAt: Date.now() };
  hub.store.save(true); hub.emit('threads', now.project);
  return now.worktree.pr;
}

/** Commit, check and push the copy's newer work to its open pull request. -> pullRequestStatus */
async function pushPullRequest(hub, threadId, { allowSecrets = false } = {}) {
  const t = thread(hub, threadId);
  if (!t.worktree.pr) throw new Error('This copy has no pull request yet.');
  await hub.changeCopy(threadId, {}, (t, root) => publish(hub, t, root, { allowSecrets }));
  return pullRequestStatus(hub, threadId);
}

const repoOf = (url) => { const u = new URL(url); return `${u.host}/${u.pathname.split('/').slice(1, 3).join('/')}`; };
async function checks(url, cwd) {
  const r = await gh(['pr', 'checks', url, '--json', 'name,state,bucket,link,workflow,description'], { cwd });
  let list = null; try { list = JSON.parse(r.stdout); } catch { /* not JSON */ } // exits 8 while pending, 1 with a failure
  if (!Array.isArray(list)) { if (/no checks reported/i.test(r.stderr)) return []; throw ghError(r, 'gh could not read the checks'); }
  return list.map((c) => ({ name: c.name, workflow: c.workflow || '', state: c.state, bucket: c.bucket || 'pending', link: c.link || '', description: c.description || '',
    runId: /\/actions\/runs\/(\d+)/.exec(c.link || '')?.[1] }));
}

/**
 * The pull request as GitHub has it, with its checks. A merged or closed one is recorded on the copy.
 * -> null without one, else { number, url, title, base, state, isDraft, checks: [{ name, state, bucket, link, runId }], unpushed }
 */
async function pullRequestStatus(hub, threadId) {
  const t = thread(hub, threadId); const pr = t.worktree.pr; if (!pr) return null;
  const here = fs.existsSync(t.worktree.path); const cwd = here ? t.worktree.path : t.project;
  const [view, list] = await Promise.all([
    ghOut(['pr', 'view', pr.url, '--json', 'number,url,state,title,isDraft,mergedAt'], { cwd }, 'gh could not read the pull request').then(JSON.parse),
    checks(pr.url, cwd),
  ]);
  const before = pr.state;
  Object.assign(pr, { state: view.state, title: view.title, url: view.url }, view.mergedAt ? { mergedAt: Date.parse(view.mergedAt) || Date.now() } : {});
  if (before !== pr.state) { hub.store.save(true); hub.emit('threads', t.project); }
  const ahead = here ? await localHost.exec('git', ['rev-list', '--count', '@{upstream}..HEAD'], { cwd: t.worktree.path }) : null;
  return { ...pr, isDraft: !!view.isDraft, checks: list, unpushed: ahead && !ahead.code ? Number(ahead.stdout.trim()) : 0 };
}

const tail = (text, n) => { const all = String(text).replace(/\s+$/, '').split('\n'); return all.length > n ? all.slice(-n).join('\n') : all.join('\n'); };
/**
 * Send the failing checks, with the last 200 lines of each failed GitHub Actions run's failed steps, to agentId in
 * an edit turn in the copy. -> { messageId, ok, checks: names }
 */
async function fixFailingChecks(hub, threadId, agentId) {
  const t = thread(hub, threadId); const pr = t.worktree.pr;
  if (!pr) throw new Error('This copy has no pull request yet.');
  const cwd = fs.existsSync(t.worktree.path) ? t.worktree.path : t.project;
  const failing = (await checks(pr.url, cwd)).filter((c) => c.bucket === 'fail');
  if (!failing.length) throw new Error(`No checks are failing on pull request #${pr.number}.`);
  await hub.learnSecrets(t.worktree.root); await hub.learnSecrets(t.worktree.path);
  const sections = [];
  for (const runId of [...new Set(failing.map((c) => c.runId).filter(Boolean))].slice(0, 3)) {
    const r = await gh(['run', 'view', runId, '--log-failed', '-R', repoOf(pr.url)], { cwd });
    const log = r.code ? `(gh could not fetch this run's log: ${r.stderr.trim()})` : tail(r.stdout, LOG_LINES);
    sections.push(`## ${failing.filter((c) => c.runId === runId).map((c) => c.name).join(', ')}: the failed steps' log (last ${LOG_LINES} lines)\n\`\`\`\n${hub.secretGuard.redact(log)}\n\`\`\``);
  }
  for (const c of failing.filter((x) => !x.runId)) sections.push(`## ${c.name}\n${[c.description, c.link].filter(Boolean).join('\n')}`);
  const names = failing.map((c) => c.name).join(', ');
  const reply = await hub.send({ threadId, agentId, mode: 'edit', team: { recipe: 'ci', role: 'fixer' }, displayText: `Fix the failing checks on pull request #${pr.number}: ${names}`,
    text: `These checks failed on pull request #${pr.number} (${pr.url}): ${names}. Find the cause and fix it in this branch, then run the failing command here if you can. Do not commit or push; Tributary pushes your fix to the pull request.\n\n${sections.join('\n\n')}` });
  return { messageId: reply.id, ok: reply.ok, checks: failing.map((c) => c.name) };
}

module.exports = { createPullRequest, pushPullRequest, pullRequestStatus, fixFailingChecks, parseDraft, DRAFT_PROMPT };
