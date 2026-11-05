export const MARKDOWN_GROUP_SIZE: number;
export function createMarkdownStream(): {
  split(text: string, min?: number): readonly string[];
  groups(text: string, min?: number): readonly (readonly string[])[];
  reset(): void;
};
