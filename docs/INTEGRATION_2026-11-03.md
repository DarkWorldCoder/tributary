# Main integration — 3 November 2026

Both Claude pull requests were already merged into remote main when this integration began:

- [#1: ACP tool approval](https://github.com/DarkWorldCoder/tributary/pull/1)
- [#2: Separate working copies](https://github.com/DarkWorldCoder/tributary/pull/2)

The original local main was 18 commits behind and contained the uncommitted workspace/UI, connector, memory and review work. That work was captured on an isolated integration branch before merging remote main. Both feature sets are preserved; the original checkout was left untouched throughout validation.

## Resolved overlaps

- Keep Claude's separate-copy lifecycle and ACP permission prompts alongside the new composer, tabs, file icons, preview tools and context panel.
- Resolve file-opening intents, retained document panes, Markdown images, file watches, review actions, hunk undo and terminal sessions against the current conversation working directory. Memory remains project-scoped.
- Preserve worktree-aware attribution while retaining individual-hunk undo history.
- Keep remote worktree/permission tests and restore the extension regression tests removed by the local work-in-progress snapshot. The test command includes both sets of added tests.
- Allow one or more Manager workers, matching the existing Manager implementation, and keep the UI validation and label consistent. Council still requires two distinct members. Direct text connections cannot serve as coding workers.
- Keep separate-copy branch actions accessible in compact headers and within phone widths.

## Validation

- Full regression suite: **179 passed, zero failed**, including ACP approvals, parallel separate working copies, Manager integration, attribution and hunk undo.
- TypeScript, production UI build and extension packaging passed.
- Actual isolated Electron app: **30 UI checks passed**. These cover separate-copy vs project file reads/writes, retained unsaved project drafts, live disk updates, distinct Markdown/direct images and independent terminals whose real `pwd` output identifies their working directory.
- Header and branch controls checked at 320, 390, 768, 900, 1280 and 1920 px, with no page overflow or title overlap.
- No real model request or paid-agent run was made by the UI checks. Backend tests use fixture agents and temporary repositories.

Evidence: [native UI checks](performance/integration-ui-validation.json), [desktop](performance/integration-chat-1280.png), [phone](performance/integration-chat-320.png).
