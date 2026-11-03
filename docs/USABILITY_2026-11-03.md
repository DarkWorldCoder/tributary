# Workspace, attachments and LAN update

Implemented on 3 November 2026. Validation used isolated local projects and profiles.

## Delivered

- One visible set of Files / Changes / Memory / Preview controls. Expanded workspaces offer **Show chat**.
- Shared project menu in the header, project list, explorer and context panel: rename the display name, manage context folders, copy the path and switch projects. Folder paths and conversation identities stay stable.
- Compact desktop File / Edit / View / Help bar on Linux and Windows, with window controls and chat history navigation. macOS retains native window chrome.
- Centered conversation/composer after collapsing the workspace; long errors have short recovery text and expandable diagnostics. Narrow panes wrap errors without a page-wide horizontal scrollbar.
- Settings search and close share one fixed header. Agent rows offer Use agent, Set up and Model source where supported. Installed status does not claim authentication.
- Antigravity models come from the installed `agy models` command. Codex sandbox/cwd/gateway flags precede `resume`, fixing the rejected `-s` argument.
- Lazy, bundled Prettier formatter, executed in a worker. **Shift+Alt+F** or the file menu formats the draft; undo restores it. Concurrent edits, syntax errors and failed formatting preserve the current draft. Uses formatter defaults, not project-executable configuration.
- Terminal requests also work after a kept-mounted terminal has been hidden; file-folder launches preserve the requested working directory.
- File menu: copy relative/full path, reveal in the OS and open a terminal at the containing folder. Explorer starts at 224 px within the existing resize bounds.
- Unified/split diffs use stable rows and internal horizontal scrolling, with explicit Wrap lines.
- Live activity uses a compact searchable panel until a file is selected; running/recent filters and recent worker file diffs are available.
- Composer file picker, paste and drop. Up to 8 files, 16 MB each / 32 MB total. Images show thumbnails and a fit/zoom viewer. Preview blobs are released when cards leave the viewport or unmount.
- Attachments are stored privately in app data, outside the project. Claude receives native image content blocks; Codex receives image arguments; direct compatible vision connections receive image content. Other coding agents receive local reference paths and need their own file/image tooling. Direct connections accept images and text references; PDF/DOCX extraction and OCR are not implemented. Actual model support depends on the selected model.

## LAN setup

On the host, in the Tributary checkout:

```sh
npm run server:lan
```

Requires Node.js 24 and OpenSSL. It chooses a private IPv4 address, creates a private self-signed certificate in the service data folder, starts HTTPS and advertises the room on the local network. It prints the HTTPS address, certificate fingerprint and **location** of the private owner key; it never advertises or prints access keys.

1. In Project room, choose **Find nearby rooms**, or paste the host's HTTPS address.
2. Compare the displayed fingerprint with the host through a trusted channel, then confirm verification.
3. The host joins with its private owner key, creates a room and creates a separate invitation for each teammate under People.
4. Each teammate joins with their invitation key and verified host fingerprint.

`TRIBUTARY_LAN_ADDRESS` selects an address when VPNs or multiple adapters are present. `TRIBUTARY_SERVER_PORT` changes TCP 4318; discovery uses UDP 4319. Guest isolation, multicast filtering and existing firewall rules can block access. Nothing opens firewall rules or changes machine-wide trust. Browser clients require a normally trusted certificate; the fingerprint flow is for desktop/VS Code clients.

This is peer discovery and invitations around one authoritative room service. It does **not** implement decentralized mesh replication, synchronized source files or simultaneous editing. A single coordinator preserves the existing transactional claims, revisions and event ordering. Each developer retains their own agents and working files.

## Validation

Merged the remaining Claude commit `df9040c`: completed turns now record an end checkpoint, so later manual edits are excluded from agent attribution and turn diffs. All local Claude branch tips are included in main.

- Full merged suite: **189 passing tests**, including all 8 new usability tests and Claude’s new attribution/undo checks.
- TypeScript and production renderer build pass; VS Code packaging/bridge tests pass. The formatter worker is one standalone asset and loads on demand.
- Installed Codex parser accepts the revised resume arguments in help-only checks; no model turn was sent. Installed Antigravity listed models and the picker displayed them.
- Native Electron fixture: formatting/undo/no auto-save, actual image pixels, clipboard image paste, zoom viewer, project rename and folders, expanded-workspace return, diff scrolling/wrapping, short menu text and agent setup actions.
- Native room accessibility scan: zero violations, with two items flagged for manual review.
- Settings alignment and chat overflow checked at 320, 390, 768, 900, 1280 and 1920 px. All used disposable projects/profiles, not the user's active chats.
- LAN script launched against temporary data; multicast discovery found its private-network address and the pinned HTTPS room page returned HTTP 200. Separate invited clients shared room state over TLS. A mismatched pin was rejected before any request/access key reached the server.

Limits: no second physical computer, deployed service, real vision-model response, macOS/Windows window behavior or running VS Code webview was tested. Native desktop image transport used a fixture agent; direct vision used a mocked provider. Network and provider failures still require working credentials/connectivity. The active user app was left open; a full restart is required to load new main-process/window behavior.
