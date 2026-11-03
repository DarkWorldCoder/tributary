# Project rooms: first working implementation

Implemented and locally validated on 2 November 2026. This is a self-hosted collaboration preview for a small trusted team. It shares task coordination; coding agents and source files stay on each person's computer.

## Start the service

Use **Node.js 24** from the repository root:

```sh
npm run build:ui
npm run server
```

Open **http://127.0.0.1:4318/room**. On first startup the service saves an owner access key in `~/.tributary-server/owner-access-key.txt` with private file permissions. It prints that file's location, never the key itself. Open the file locally and paste the key into the sign-in form. Keep it private. The database stores hashes of access keys; it does not store the invitation secrets in its command or event history.

Alternatively, open **Project room** in the Tributary desktop app or VS Code extension, enter the service address, and paste your key. Keys remain in the current process/session, and disconnect clears them. The desktop and extension route service requests through their host; the renderer has no arbitrary filesystem or process access.

Configuration:

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `TRIBUTARY_SERVER_DATA` | `~/.tributary-server` | Local directory for the database and initial owner key |
| `TRIBUTARY_SERVER_PORT` | `4318` | HTTP listening port |
| `TRIBUTARY_SERVER_HOST` | `127.0.0.1` | Listening interface |
| `TRIBUTARY_OWNER_NAME` | `Project owner` | Initial owner's display name |
| `TRIBUTARY_PUBLIC_ORIGIN` | Unset | Exact HTTPS origin used by a reverse proxy for a shared deployment |
| `TRIBUTARY_TLS_CERT` | Unset | PEM certificate/chain file for direct HTTPS hosting |
| `TRIBUTARY_TLS_KEY` | Unset | PEM private-key file for direct HTTPS hosting; set with the certificate |

Run one service process per database. This version uses Node's built-in SQLite driver, WAL, full synchronous durability and short transactions. It does not need a separate database installation. The larger [architecture plan](COLLABORATION_ARCHITECTURE.md) proposes PostgreSQL and project sharding for a later service; those are not part of this preview.

## Coordinate a team

1. The owner creates a shared project.
2. The owner selects **Invite a teammate**, enters their name, and creates an invitation. Copy and share it privately through your own preferred channel. The app does not send invitations on your behalf. A key is returned once; if its delivery fails, create a replacement invitation and remove the unused member.
3. Each teammate joins with their own key. A member can access only the project attached to their invitation.
4. Add a task with details, acceptance checks and, optionally, a dependency. The interface currently offers one dependency; the service accepts up to twenty.
5. Enter or select the agent you plan to use, then select **Claim task**. The server accepts one owner atomically. A dependency must be reported done before its dependent task can be claimed.
6. Open the task, save progress or a blocker, and attach a result or evidence link before marking it **Reported done**. This status is a human/agent owner's report, not a verified test result or an accepted merge.
7. In the desktop or extension, **Prepare in local conversation** copies an owned task into a new conversation in an already-open local project. It selects the named installed agent when possible. You review the prompt and send it yourself; it does not launch automatically, create a worktree, share files or publish the agent's output.
8. Release a task when another teammate should take it over. Release does not terminate a local process. The owner can remove a member's project access; active project streams are closed and subsequent project requests are denied.

The connection dot means a person is viewing that project room, not that their coding agent is running. Task ownership persists when a laptop disconnects. There are no execution leases or automatic reassignments in this first version.

## Live updates and recovery

Commands use HTTP; live updates use an authenticated server-sent event stream. This is deliberately a small first transport implementation, rather than the WebSocket service proposed for the broader system. The browser and desktop use the same client and event protocol.

State changes, project cursor increments, events and command receipts commit in the same database transaction. Events publish after commit. Repeated command IDs with identical payloads return the recorded result; a different payload using the same ID is rejected. A lost command response is treated as uncertain. Retrying the same action reuses its unresolved command ID, preventing a duplicate task. Invitation keys are excluded from stored receipts and are not returned again on replay.

Every task has a revision. A progress save based on an older revision fails, leaving the local note available. The UI offers **Load latest note** to replace that draft explicitly. A reconnect replays missing events by project cursor; gaps or a replay exceeding 500 events cause a snapshot refresh. Presence is ephemeral. Slow subscribers have bounded output buffers and can reconnect instead of holding unlimited queued data.

These mechanisms cover coordination records. They do not make arbitrary agent commands or external side effects exactly-once. No agent execution API is exposed by the service.

## Fonts, settings and folder browsing

See [UI improvements and included skills](UI_IMPROVEMENTS.md) for text/layout changes, the four app-owned UI guides, component research, screenshots and validation.

The interface now defaults to bundled **Geist Variable**, with **IBM Plex Mono** retained for code. In **Settings → Appearance**, select Geist, IBM Plex Sans or the system font and choose the response text size. A live sample previews the result. Preferences persist locally. Inside VS Code, the host's typography and theme remain authoritative. All bundled fonts work offline.

Settings has a section search and a visible sidebar entry; **Ctrl/Cmd+,** opens Appearance. The search finds sections such as fonts, appearance, agents or connections, rather than searching every individual setting value.

The **Files** tab browses directories on expansion, with empty directories, generated directories, pagination and a **Show hidden files** toggle. It works without Git and is no longer limited to the mention index's depth. File search continues to use that bounded index and explains its exclusions. Open files now update from filesystem events, with two-second polling as a fallback. Unsaved drafts are preserved when disk content changes. Deep unopened folders are not recursively monitored. See [coordination and memory](COORDINATION_AND_MEMORY.md) for limits.

Text editing, file tabs, Markdown/SVG/image previews and the existing restricted HTML preview remain available locally. HTML blob previews do not implement a complete folder-relative site server. PDF/DOCX/XLSX viewers, shared remote folder browsing and authenticated live application tunnels remain future work. Symbolic-link escapes are rejected by the file read/save and directory APIs; symlinked directories are displayed as links rather than recursively traversed. This is not an OS-level sandbox against hostile local processes changing files concurrently.

Navigation takes cues from [VS Code's explorer/editor layout](https://code.visualstudio.com/docs/editing/getting-started/userinterface) and [Zed's persistent collaboration rooms](https://zed.dev/docs/collaboration/channels), while the ordinary task home remains the entry point for nondeveloper work.

## Sharing the service with other computers

In the desktop app:

1. Open **Project room** beside **Start a task**, then **Host a room → Host on this network**. The owner signs in automatically.
2. Create the shared project using your existing local project. Click **Invite teammate**.
3. Share the private invitation. It includes the LAN address, certificate fingerprint and that teammate's key.
4. Teammates choose **Find nearby rooms**, verify the fingerprint with you, and join with their key.

**Join a room** has a separate discovery and invitation form. **Local folder** links each shared project to a folder on your computer; only the local app saves that path. Claimed tasks offer **Work locally** and **Run with agents**.

**Hosting options** lets you choose a private IPv4 interface or a different port. **Stop hosting** disconnects clients and saves the room. Disconnecting your own view keeps the host running; quitting Tributary stops it. Hosting is always an explicit action, never automatic on launch. The initial certificate needs OpenSSL, which is available on this development machine. No firewall or system trust settings are changed.

The host is embedded in Electron's main process: no extra Node process, web framework, Rust/Zig binary, or runtime dependency. The same lifecycle supports `npm run server:lan`. SQLite and TLS use Node's native implementations; live changes use SSE, with heartbeats rather than client polling. Nearby discovery sends a small packet every five seconds. Desktop room data and the private owner key are under the app's `userData/project-room` directory; CLI data remains under `~/.tributary-server` unless configured. Public IPC status never includes the owner key. These are separate stores.

A local standalone measurement is in [LAN_HOST.json](performance/LAN_HOST.json): zero clients, loopback, discovery disabled. It measured 60 MiB total process RSS against a 49.6 MiB baseline, 6.4 MiB JS heap, 0.3 ms CPU over a two-second idle sample, and 4.7 ms warm startup. First certificate creation and startup took 290.9 ms in that sample. These are one-machine observations, not total Electron memory, load capacity or second-device performance. No measured bottleneck currently justifies a separate native-language service.

Validation: 194 tests pass, including host lifecycle, owner persistence, port conflicts, concurrent starts/stops and invited clients. The actual Electron UI started/stopped hosting, created a project/invitation/task, received a separate client's live claim, reconnected without a key, recovered the saved room, and stopped the listener when the app quit. Controls were checked at 320, 390, 768, 900, 1280 and 1920 px. Two physical computers and packaged cross-platform hosting remain unverified.

People on the same LAN can use one service: each opens its reachable HTTPS address and joins with an individual invitation key. The LAN host command now supports nearby discovery in desktop/VS Code. Discovery does not grant access or share a source folder. See [the LAN setup guide](USABILITY_2026-11-03.md#lan-setup).

You can now host HTTPS directly, without a separate reverse proxy. Obtain a certificate valid for the host address and trusted by the participating devices, and keep its private key private. Example for a server whose actual LAN address is `192.168.1.20`:

```sh
TRIBUTARY_SERVER_HOST=0.0.0.0 \
TRIBUTARY_SERVER_PORT=4318 \
TRIBUTARY_PUBLIC_ORIGIN=https://192.168.1.20:4318 \
TRIBUTARY_TLS_CERT=/path/to/server-cert.pem \
TRIBUTARY_TLS_KEY=/path/to/server-key.pem \
npm run server
```

Replace the example address and paths with the server's actual values. The certificate must cover that address, including its IP subject alternative name when an IP is used. Each teammate opens `https://192.168.1.20:4318/room` in this example. Desktop/VS Code can connect to the same HTTPS origin using their Project room screen. Clients normally trust the issuing certificate authority. Desktop/VS Code also support an explicitly verified SHA-256 certificate fingerprint for private LAN certificates; a mismatched pin is rejected before sending the access key. Browser clients still require normal certificate trust. Both certificate and key variables are required together. No certificates, machine trust settings or firewall rules are installed automatically.

The port must be reachable between those devices under the network's existing rules. The owner then creates a project and individual invitations as above. Each person uses their own working copy and installed agents; the room coordinates ownership and reported results. It does not synchronize source files or provide simultaneous same-file editing.

The default server still listens only on this computer. A reverse proxy remains an alternative: configure its exact HTTPS public origin and forward the matching Host header. The service refuses nonloopback listening without a public HTTPS origin. Preserve streaming responses and allow heartbeat traffic; disable proxy buffering for the event endpoint. Keep the data directory private and use a reliable local filesystem.

This turn did not deploy a public server, configure TLS, open a firewall or connect two physical computers. Internet latency, load capacity, backup/restore and a packaged cross-platform release have not been validated. Before relying on a shared deployment, add operational backup/restore, owner-key recovery/rotation, expired invitations, per-user rate limits and retention. The server is single-process and has a 1,000-task limit per project; it is not a horizontally scalable production service.

## Validation and remaining stages

Automated coverage includes membership isolation, secret omission, origin/Host checks, command deduplication, competing claims, dependency enforcement, revision conflicts, persistence across service restart, live updates between independent clients, reconnect, access revocation, and local workspace reservations. Directory tests cover hidden/generated/empty/deep folders, pagination and symlink escapes.

Existing agent, handoff, checkpoint, race, ACP, registry, file-editor and VS Code integration tests remain part of `npm test`. No paid model request is needed for the collaboration tests. Browser/desktop checks use a disposable service, test identities and a separate desktop profile.

The next stages are persistent task worktrees and attributable agent-result sharing, review/integration checks, then intentional same-file editing and authenticated preview sharing. This implementation establishes the shared room and local correctness foundation; it does not complete those later stages or the entire general-user roadmap.

## Background teams and workspace stability

**Agent teams** and **Live activity** are available from the sidebar, workbench rail, View menu and feature search. Agent teams defaults to **Manager → New background chat**. The lead assigns work to selected coding agents with a concurrency limit and dependency handoffs. Background coding teams each get a separate conversation working copy, so multiple teams can run while the current chat and draft stay visible. Review and merge each copy when ready. See [agent delegation](AGENT_DELEGATION.md). Shared-room claims and reported results still require explicit updates; starting a local team does not execute commands on teammates' machines or synchronize their files.

The terminal now spans the bottom of the editor and chat. File-tree updates retain existing rows, expanded folders, pagination and scroll position. New chats keep the chosen workbench layout. Native UI checks covered repeated root and watched-subfolder changes, unsaved edits, empty-chat transitions, Host/Join setup, saved folder links, invitation creation, claimed-task handoff, and six room widths. Two background teams completed concurrently using fake local agents; no paid model requests were sent.

Use **Move terminal** in the terminal toolbar to choose **Left**, **Right**, **Top** or **Bottom**. Drag its edge or focus the resize handle and press arrow keys to resize. Position and dimensions are saved; changing sides keeps the existing shells and scrollback. On narrow screens, it uses the bottom position and restores your preferred side when space returns.
