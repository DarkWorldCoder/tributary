---
name: tributary-ui-review
description: Review a requested UI flow for readability, responsive behavior, keyboard access and accurate feedback using observable evidence.
---

# Review usability

Follow the user’s requested flow with realistic local data. Inspect the actual route or application surface; a build alone does not prove the UI works.

Check reading order, visible labels, useful empty states, errors beside actions, preserved drafts and clear loading feedback. Try a long title, a narrow window and increased text size. Check that the primary action remains reachable and the page has no unintended horizontal scrolling.

Use the keyboard to reach and activate the relevant controls. Check visible focus, dialog focus entry and return, Escape behavior and meaningful names for icon buttons. Use the project’s accessible primitives rather than reimplementing keyboard behavior. Check contrast in the changed theme and do not use color as the only status signal.

If an accessibility checker is available, run it on the changed states. Automated passes do not replace keyboard and visual checks. If browser access is unavailable, state that limitation and complete source/build checks without claiming a visual pass.

Fix issues within the requested scope. Report the screen, action and evidence for remaining findings. Keep a clear distinction between checks performed, unresolved issues and suggestions. Never submit messages, purchases or production changes just to test a UI without the user’s authorization.

References:
- https://www.radix-ui.com/primitives/docs/overview/accessibility
- https://github.com/vercel-labs/web-interface-guidelines
