---
name: tributary-ui-writing
description: Rewrite interface labels, help text, errors and empty states using plain language grounded in the product’s actual behavior.
---

# Clear interface writing

Work on the requested flow. Read the code or verified behavior before changing claims about what an action does.

- Lead headings with the user’s task or outcome. Use familiar words; explain technical terms only where they help a decision.
- Give actions specific verbs: “Save progress”, “Open folder”, “Copy invitation”. Avoid vague labels such as “Proceed” when the outcome can be named.
- Keep labels visible after typing. Place examples in placeholders and requirements in help text. Distinguish optional fields from required ones.
- Tell an empty state why it is empty and give one useful next action. Distinguish no data from no search results and a failed load.
- Put errors near the action, preserve entered text and give an actionable recovery. Do not expose raw stacks, credentials or internal identifiers in user-facing errors.
- Match status text to evidence. “Reported done” does not mean tests passed. “Saved” requires a successful save. Do not promise universal undo, file isolation, synchronization or background execution without implementation evidence.

Check the complete flow for consistent naming, singular/plural wording and button text during loading. Keep explanations concise enough to scan and long enough to avoid a misleading promise.

Reference: https://github.com/vercel-labs/web-interface-guidelines
