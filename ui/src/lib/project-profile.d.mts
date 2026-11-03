export interface ProjectProfile { stacks: { name: string; extension: string }[]; commands: { label: string; command: string }[]; entry: string | null }
export function projectProfile(files: string[], packageText?: string): ProjectProfile;
export function localPreviewUrl(value: string): string | null;
