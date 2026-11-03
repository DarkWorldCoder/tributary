export interface LineComment { file: string; line: number; side: 'before' | 'after'; quote: string; note: string; by?: string }
export function commentsMessage(comments: LineComment[]): string;
