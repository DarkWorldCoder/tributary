#!/usr/bin/env node
// Stand-in for the GitHub CLI, so the pull request tests stay offline. Pull requests, checks and run logs live in
// the JSON file FAKE_GH_STATE: { prs: [{ number, url, head, base, title, body, state }], checks: { <number>: [...] },
// logs: { <runId>: "text" } }. `pr create` refuses a head branch that is not on the remote yet, like GitHub does.
// FAKE_GH_AUTH=none acts signed out. Every invocation is appended to FAKE_GH_LOG as one JSON line.
const fs = require('fs');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const stdin = argv.includes('--body-file') ? fs.readFileSync(0, 'utf8') : '';
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify({ argv, cwd: process.cwd(), stdin })}\n`);
const file = process.env.FAKE_GH_STATE;
const state = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } })();
const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2));
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const fail = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };
const [cmd, sub, ref] = argv;

if (process.env.FAKE_GH_AUTH === 'none') fail('You are not logged into any GitHub hosts. To log in, run: gh auth login');
if (cmd === 'auth' && sub === 'status') { process.stdout.write('github.com\n  ✓ Logged in to github.com account dev (keyring)\n'); process.exit(0); }
if (cmd === 'repo' && sub === 'view') {
  let remote = ''; try { remote = execFileSync('git', ['remote'], { encoding: 'utf8' }).trim(); } catch { /* not a repository */ }
  if (!remote) fail('none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`');
  process.stdout.write(JSON.stringify({ nameWithOwner: 'acme/shop' }));
  process.exit(0);
}

const prs = state.prs || (state.prs = []);
const find = (r) => prs.find((p) => String(p.number) === String(r) || p.url === r || p.head === r);
const pick = (obj, fields) => Object.fromEntries(fields.split(',').map((f) => [f, obj[f] ?? null]));

if (cmd === 'pr' && sub === 'create') {
  const head = flag('--head'); const base = flag('--base') || 'main';
  const open = prs.find((p) => p.head === head && p.state === 'OPEN');
  if (open) fail(`a pull request for branch "${head}" into branch "${base}" already exists:\n${open.url}`);
  let pushed = '';
  try { pushed = execFileSync('git', ['ls-remote', 'origin', `refs/heads/${head}`], { encoding: 'utf8' }).trim(); } catch { /* no remote */ }
  if (!pushed) fail(`pull request create failed: GraphQL: Head sha can't be blank, Base sha can't be blank, No commits between ${base} and ${head}, Head ref must be a branch (createPullRequest)`);
  const number = (state.next || 7) + prs.length;
  const pr = { number, url: `https://github.com/acme/shop/pull/${number}`, head, base, title: flag('--title'), body: stdin, state: 'OPEN', isDraft: false, mergedAt: null };
  prs.push(pr); save();
  process.stdout.write(`\nCreating pull request for ${head} into ${base} in acme/shop\n\n${pr.url}\n`);
  process.exit(0);
}
if (cmd === 'pr' && sub === 'view') {
  const pr = find(ref); if (!pr) fail(`no pull requests found for branch "${ref}"`);
  process.stdout.write(JSON.stringify(pick({ ...pr, headRefName: pr.head, baseRefName: pr.base }, flag('--json'))));
  process.exit(0);
}
if (cmd === 'pr' && sub === 'checks') {
  const pr = find(ref); if (!pr) fail(`no pull requests found for branch "${ref}"`);
  const checks = (state.checks || {})[pr.number];
  if (!checks || !checks.length) fail(`no checks reported on the '${pr.head}' branch`);
  process.stdout.write(JSON.stringify(checks.map((c) => pick(c, flag('--json')))));
  // Like gh: 8 while any check is pending, 1 when one failed.
  process.exit(checks.some((c) => c.bucket === 'fail') ? 1 : checks.some((c) => c.bucket === 'pending') ? 8 : 0);
}
if (cmd === 'run' && sub === 'view') {
  if (!argv.includes('--log-failed')) fail('only --log-failed is faked');
  const log = (state.logs || {})[ref]; if (log == null) fail(`could not find any workflow run with ID ${ref}`);
  process.stdout.write(log);
  process.exit(0);
}
fail(`fake gh: unsupported command: ${argv.join(' ')}`);
