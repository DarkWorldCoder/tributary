---
name: tributary-ui-layout
description: Improve an existing interface’s text placement, typography, spacing and responsive layout while preserving its identity.
---

# Layout & typography

Apply this guidance to the interface requested by the user.

Start from the actual screen and its code. Identify the primary action, the reading order and the space available with sidebars or panels open. Keep useful brand choices and existing design tokens. Make specific changes that help the task; avoid a decorative redesign unrelated to it.

- Align headings, supporting text, fields and primary actions on a consistent content edge. Use centered text for short standalone messages when appropriate, not long forms or instructions.
- Set a readable maximum width for paragraphs. Let names and headings wrap; truncate only dense lists where the full value is available elsewhere.
- Group a field’s label, control, help and error. Place optional labels beside the field label. Keep related controls together and separate unrelated groups with spacing.
- Give flexible children `min-width: 0`, allow toolbars to wrap and stack secondary panels at narrow widths. Test with realistic long names and empty, loading and error states.
- Reuse bundled fonts and type scales. Keep code in a monospaced font, numbers aligned where compared, and body text readable at the user’s chosen size.

Verify the changed screen at a narrow and a wide viewport. Check horizontal overflow, clipped actions, panel scrolling and enlarged text. Report exactly which screens were checked and any unavailable checks.

Reference: https://github.com/vercel-labs/web-interface-guidelines
