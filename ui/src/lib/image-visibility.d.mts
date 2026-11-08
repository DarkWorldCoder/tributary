export function createImageVisibility(Observer?: typeof IntersectionObserver): {
  observe(element: Element, listener: (near: boolean) => void): () => void;
  state(): { targets: number; observing: boolean };
};
export function imagePlaceholder(width: number, height: number): { width: number; height: number; viewBox: string } | null;
export function observeImage(element: Element, listener: (near: boolean) => void): () => void;
