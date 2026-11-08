import * as React from 'react';
import { Command } from '@/components/ui/command';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  title: string;
  description: string;
  className?: string;
  commandProps?: React.ComponentProps<typeof Command>;
  children: React.ReactNode;
};

/** The browser owns modal inertness and the focus scope, not a second DOM walk. */
export function QuickOpenDialog(props: Props) {
  return props.open ? <PickerModal {...props} /> : null;
}

function PickerModal({ title, description, className, commandProps, children, ...props }: Props) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const callbacks = React.useRef(props); callbacks.current = props;
  const titleId = React.useId(), descriptionId = React.useId();
  React.useLayoutEffect(() => {
    const element = dialog.current!;
    // Quick Open records its return target before mounting. Keep the browser's
    // automatic close restoration on the non-editable body instead: a pending
    // file read must never send typing back into the previous source buffer.
    const previous = document.activeElement;
    if (previous instanceof HTMLElement && !element.contains(previous)) previous.blur();
    element.showModal();
    const opened = new Event('openAutoFocus', { cancelable: true });
    callbacks.current.onOpenAutoFocus?.(opened);
    // A background Radix layer can consume Escape in document capture even
    // though native modal inertness prevents interacting with that layer.
    // Own just this key, only while its target belongs to this modal.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || !(event.target instanceof Node) || !element.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation(); callbacks.current.onOpenChange(false);
    };
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('keydown', escape, true);
      element.close();
      // Layout cleanup precedes React's DOM removal. Wait until the native
      // modal has left the tree before handing focus back to the workbench.
      const closed = callbacks.current.onCloseAutoFocus;
      queueMicrotask(() => closed?.(new Event('closeAutoFocus', { cancelable: true })));
    };
  }, []);
  return <dialog ref={dialog} role="dialog" data-slot="dialog-content" data-state="open" aria-labelledby={titleId} aria-describedby={descriptionId}
    className={`fixed left-1/2 m-0 overflow-hidden border-0 bg-popover p-0 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none backdrop:bg-transparent ${className || ''}`}
    onCancel={(event) => { event.preventDefault(); callbacks.current.onOpenChange(false); }}
    onClose={(event) => {
      // close events are queued; showModal may already have reopened it.
      if (!event.currentTarget.open) callbacks.current.onOpenChange(false);
    }}
    onPointerDown={(event) => {
      if (event.button !== 0 || event.ctrlKey || event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom) {
        event.preventDefault(); callbacks.current.onOpenChange(false);
      }
    }}>
    <div className="sr-only"><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div>
    <Command {...commandProps}>{children}</Command>
  </dialog>;
}
