export function extensionThemeVariables(theme: {
  dark: boolean;
  colors: Record<string, string>;
  tokenColors: { scope?: string | string[]; foreground: string }[];
}): Record<string, string>;
