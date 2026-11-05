const COLOR_KEYS = {
  '--background': ['editor.background'],
  '--foreground': ['editor.foreground'],
  '--popover': ['editorWidget.background', 'editor.background'],
  '--popover-foreground': ['editorWidget.foreground', 'editor.foreground'],
  '--muted-foreground': ['descriptionForeground', 'editorLineNumber.foreground'],
  '--accent': ['list.activeSelectionBackground'],
  '--accent-foreground': ['list.activeSelectionForeground', 'editor.foreground'],
  '--brand': ['button.background', 'focusBorder'],
  '--primary': ['button.background'],
  '--primary-foreground': ['button.foreground'],
  '--success': ['gitDecoration.addedResourceForeground'],
  '--destructive': ['gitDecoration.deletedResourceForeground', 'errorForeground'],
  '--sidebar': ['sideBar.background', 'editor.background'],
  '--sidebar-foreground': ['sideBar.foreground', 'editor.foreground'],
  '--ring': ['focusBorder'],
  '--sidebar-ring': ['focusBorder'],
};
const SCOPE_KEYS = {
  '--syn-keyword': ['keyword', 'storage'],
  '--syn-string': ['string'],
  '--syn-number': ['constant.numeric', 'constant.language'],
  '--syn-comment': ['comment'],
  '--syn-function': ['entity.name.function', 'support.function'],
  '--syn-type': ['entity.name.type', 'support.type', 'entity.name.class'],
  '--syn-property': ['variable.other.property', 'support.type.property-name'],
};

export function extensionThemeVariables(theme) {
  const variables = {};
  for (const [key, candidates] of Object.entries(COLOR_KEYS)) {
    const color = candidates.map((name) => theme.colors[name]).find(Boolean);
    if (color) variables[key] = color;
  }
  const background = theme.colors['editor.background'] || (theme.dark ? '#181818' : '#ffffff');
  const foreground = theme.colors['editor.foreground'] || (theme.dark ? '#eeeeee' : '#222222');
  const surface = `color-mix(in srgb, ${foreground} 6%, ${background})`;
  // VS Code's panel.border separates a few panels. Applying an accent-colored
  // panel border to every Tributary control makes the entire app look focused.
  const border = `color-mix(in srgb, ${foreground} 18%, ${background})`;
  const input = theme.colors['input.background'];
  variables['--card'] = input && input.toLowerCase() !== background.toLowerCase()
    ? `color-mix(in srgb, ${input} 100%, ${background})` : surface;
  variables['--card-foreground'] = theme.colors['input.foreground'] || foreground;
  variables['--muted'] = surface;
  variables['--secondary'] = theme.colors['button.secondaryBackground'] || surface;
  variables['--secondary-foreground'] = theme.colors['button.secondaryForeground'] || foreground;
  variables['--border'] = border;
  variables['--sidebar-border'] = border;
  // --input is a border token in shadcn; input.background belongs to the surface.
  variables['--input'] = border;
  for (const [key, scopes] of Object.entries(SCOPE_KEYS)) {
    const rule = [...theme.tokenColors].reverse().find((rule) =>
      (Array.isArray(rule.scope) ? rule.scope : typeof rule.scope === 'string' ? rule.scope.split(',') : [])
        .some((scope) => scopes.some((prefix) => scope.trim().startsWith(prefix))));
    if (rule) variables[key] = rule.foreground;
  }
  return variables;
}
