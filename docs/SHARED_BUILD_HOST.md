# One build machine for the team: research notes (November 2026)

Question: a team of 3 to 6 developers runs 2 to 3 Node.js, Next.js and React codebases at once, and their laptops slow down or freeze. Can one strong machine do the heavy work (installs, builds, dev servers, file watching) while each developer works on their own branch from a light laptop? Should Tributary do this, or should the team use an existing tool?

Method: a deep-research run with 5 search angles, about 25 sources, and three independent verifiers per claim. Most surviving claims rest on vendor documentation, and there are no independent latency or sizing benchmarks.

## Answer

Yes, by moving the work to one machine. Splitting a single build across several laptops is not possible with today's tools. No tool found splits one Next.js, Turbopack, webpack or TypeScript build across machines. Nx spreads whole tasks across CI machines only, through paid Nx Cloud. Turborepo's remote cache replays outputs that were already built. Turbopack's build cache stays on the machine that made it.

The setup that works today: one host holds every developer's code, node_modules, git worktrees and dev servers. Each developer gets their own container with CPU and memory limits, and laptops connect with a remote editor over SSH.

## The four options compared

| Option | How it works | Verdict |
|---|---|---|
| (a) Code lives on the host, laptop runs only the editor | Zed remote development, VS Code Remote-SSH, Orca SSH worktrees, Coder workspaces | **Recommended.** Proven, and every heavy process runs on the host, including the TypeScript language server |
| (b) Code on the laptop, synced to the host | Mutagen or Docker Compose Watch | Works, but on Linux laptops Mutagen polls every 10 seconds and natively watches only about 50 recently changed paths, so some edits lag |
| (c) Shared build cache only | Self-hosted Turborepo remote cache | Worth adding beside (a). It skips rebuilds of unchanged packages but does nothing for dev servers or hot reload |
| (d) Peer-to-peer distributed compilation | Nothing found | Not available for JavaScript and TypeScript builds |

## Recommended design

1. **Host.** One Linux machine, either an office desktop or a cloud VM, reached over SSH. Tailscale is optional; if used, run v1.104.4 or later, which fixed the October 2026 "Tailworm" port-forwarding issue.
2. **Workspaces.** Coder Community is free, self-hosted and AGPL-3.0. Its Docker template gives each developer their own container with a persistent home folder. Set CPU and memory limits on the container yourself, since the free tier has no per-developer caps. A container per developer also isolates networking. On a plain shared host, any user can reach every other user's dev servers on 127.0.0.1.
3. **Editors.** Zed remote, VS Code Remote-SSH or Orca, which detects and forwards dev-server ports automatically. Forward ports 3000 and 5173 with `ssh -L` or the editor's port forwarding.
4. **Build cache.** Run a self-hosted Turborepo remote cache. Open-source servers include ducktors/turborepo-remote-cache and brunojppb/turbo-cache-server. Keep each worktree's `.next/cache`, because Next.js 16.3 and later turn the persistent Turbopack build cache on by default.
5. **Size the host by measuring.** No verified per-developer RAM or CPU figures exist. Next.js 16.3 added memory eviction for dev servers, but the savings vary by app.

## Cost

GitHub Codespaces costs $0.36 per hour for a 4-core machine. Full time, that is about $63 per developer per month for compute, or about $317 a month for five developers. Self-hosted Coder has no licence fee, so the cost is only the machine.

## What this means for Tributary

Build an **SSH remote-host mode**, not a new distributed build system. Worktrees, terminals, agents and dev servers would run on the SSH host, with ports forwarded back. Orca (MIT) and crystl already ship this pattern for a single user. Leave host setup and isolation to Coder or Docker. Tributary's addition would be the team layer: several developers' agent threads, races and checkpoints running against one shared host.

## Still open

- Real memory and CPU per developer for this team's codebases.
- Hot-reload latency over `ssh -L` or Tailscale compared with running locally.
- Whether one pnpm store can be shared safely across per-developer containers.
- Whether Docker Compose Watch works reliably against a remote Docker engine.

## Sources

- Zed remote development: https://zed.dev/docs/remote-development
- Orca: https://github.com/stablyai/orca and https://www.onorca.dev/docs/ssh
- crystl remote SSH: https://crystl.dev/docs/remote-ssh/
- Coder: https://coder.com/pricing, https://github.com/coder/coder, https://coder.com/docs/admin/templates
- Shared-host loopback exposure report: https://security.alwaysdata.com/task/430?pagenum=1
- Tailscale reverse port forwarding: https://github.com/tailscale/tailscale/issues/6575
- Mutagen file watching: https://mutagen.io/documentation/synchronization/watching/
- Docker Compose Watch with Next.js: https://docs.docker.com/guides/nextjs/develop
- Turborepo remote caching: https://turborepo.dev/docs/core-concepts/remote-caching
- Nx distributed task execution: https://nx.dev/docs/features/ci-features/distribute-task-execution
- Next.js 16.3 Turbopack: https://nextjs.org/blog/next-16-3-turbopack
- GitHub Codespaces billing: https://docs.github.com/en/billing/concepts/product-billing/github-codespaces

## SSH remote-host mode (core in place, not wired into the app yet)

The core modules now run a project on an SSH host. Only the system `ssh` binary is used, and there are no new dependencies.

| Piece | Where | What it does |
|---|---|---|
| Connection | `core/ssh.js`, `core/host.js` | One OpenSSH ControlMaster connection per target (`ControlPersist=10m`, sockets in `~/.ssh/tributary/`). `connect(remote)` opens it and reports ssh's error. Arguments are single-quoted for the host's shell. Environment variables, including gateway keys, travel on stdin, so they never appear in a command line that other users of the host could read with `ps`. |
| Host interface | `core/host.js` | `localHost` and `sshHost(remote)` expose the same interface: `exec`, `spawn`, `kill`, and file reads and writes. Git helpers, checkpoints, race and the runner take `{ host }`, so local and remote share one code path. |
| Agent turns | `runTurn({ host })` | Runs the agent's own binary (`claude`, `codex`, ...) from the host's PATH and streams its output through the usual parsers. ACP agents run there too, and their file reads, file writes and `.mcp.json` go to the host. Stop kills the agent's whole process group on the host. |
| Git and checkpoints | `core/git.js`, `core/checkpoint.js` | Status, diffs, commit and touched-file fingerprints run on the host. Checkpoint objects go to `~/.local/share/tributary/checkpoints` on the host. |
| Race | `race(hub, { host })`, `applyDiff(root, diff, { host })` | Worktrees, agent turns, the test command and the merge all run on the host. |
| Terminal | `TerminalManager.create({ remote })` | node-pty running `ssh -tt` into the project folder with the user's login shell. Password and host-key prompts work here. |
| Ports | `core/ports.js` | `listPorts(host)` reads `ss -ltnp` for the user's own processes and adds each process's command line. `PortForwards.forward(remote, port)` runs `ssh -N -L` on a free local port and returns `http://localhost:<port>` for the Preview tab. |

A remote is `{ target: 'user@host' or an ~/.ssh/config alias, port?, identityFile?, path: '/abs/folder/on/host' }`.

Before using a host, check it from a terminal:

```bash
ssh buildbox 'command -v git node claude codex'
```

```bash
node test/e2e/real-remote.js buildbox /home/dev/app
```

**Requirements:** key or agent authentication (calls use `BatchMode`, except terminals). The host should run Linux (the code uses GNU `find -printf`, `ss` and `mktemp`). The login shell should be bash, zsh or sh. Agents must be on the PATH for non-interactive SSH; the wrapper also adds `~/.local/bin`, `~/bin`, `/usr/local/bin`, `~/.cargo/bin` and nvm's bin folders. Each developer signs in to their agents on the host.

**Tests:** `test/remote.test.js` (14 tests, part of `npm test`) uses a stand-in `ssh` (`test/fake-ssh.js`). It runs the remote command on this machine the way sshd would: through the login shell, in a fresh environment and in its own session. Quoting was also checked under bash, zsh and dash. Nothing has run against a real sshd yet; `test/e2e/real-remote.js` is the first check to run against a real host.

**What is left:**
- Hub and app wiring: a remote project record, an "Add remote project" dialog, `{ host }` passed at each hub call site, remote terminals, a port list with Forward buttons in Preview, and closing forwards on quit. This touches shared files (`core/hub.js`, `desktop/main.js`, `ui/src/*`), so it is waiting for approval.
- Memory (`.tributary/memory.md`, the worklog) and the Files browser (`core/files.js`) still use local `fs`, so they need host versions.
- Gemini CLI and Antigravity take the prompt as an argument. On a shared host without per-developer containers, other users can see the prompt in `ps`.
- Restoring a checkpoint costs two round trips per file. A batched restore would help when many files change.
- Windows laptops: Windows OpenSSH has no ControlMaster, so each call makes a new connection, and the hub still joins project paths with the native `path`.
- Per-developer isolation stays with Coder or Docker, as recommended above. On a plain shared host, other users can reach each developer's dev-server ports on 127.0.0.1.
