export function subscribeHighlighter<T>(load: () => T | PromiseLike<T>, receive: (value: T) => void): () => void;
