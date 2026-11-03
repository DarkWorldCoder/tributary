---
name: tributary-ui-components
description: Choose and implement controls using a project’s existing UI primitives, with suitable semantics, focus behavior and states.
---

# Choose UI components

Inspect the project’s component folder, dependencies and theme before selecting a library. Prefer components already in use. For Tributary, use the local shadcn components in `ui/src/components/ui` and their Radix primitives. Other projects may use different libraries; preserve their established system.

Choose controls by behavior:

- Use Field with a visible label, help and adjacent validation for forms. A placeholder is an example, not a label.
- Use a Button for an action and a link for navigation. Give icon-only controls accessible names. Use a native select for a short list unless search or rich options justify a combobox.
- Use Dialog for a focused task, AlertDialog for a destructive confirmation, and the established menu or popover for contextual choices. Keep keyboard and focus behavior in the primitive.
- Use Tabs for switching related panels, not unrelated navigation. Keep selection state distinguishable without color alone.
- Use the existing Empty and Skeleton components for meaningful empty and loading states. A load failure needs recovery, not an empty-data message.

Keep interaction states and component styles consistent with the theme. Before adding a dependency, check that it supplies a needed behavior the existing primitives cannot cover. Check official documentation for the installed version when an API is uncertain. Verify keyboard operation and focus return in the actual interaction.

References:
- https://ui.shadcn.com/docs/components/radix/field
- https://ui.shadcn.com/docs/components/radix/empty
- https://www.radix-ui.com/primitives/docs/overview/accessibility
