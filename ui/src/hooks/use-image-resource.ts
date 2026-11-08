import * as React from 'react';
import type { Attachment, FileContent, HubBridge } from '@/types';
import { createImageResources, type ImageRendition, type ImageResourceSource, type ImageSnapshot } from '@/lib/image-resources.mjs';
import { imageMime } from '@/lib/image-preview.mjs';

const resources = new WeakMap<HubBridge, ReturnType<typeof createImageResources>>();
function images(hub: HubBridge) {
  let manager = resources.get(hub);
  if (!manager) {
    manager = createImageResources(async (project, rel, source) => {
      if (source === 'attachment') {
        const value = await hub.call<Attachment & { bytes?: ArrayBuffer; base64?: string }>('readAttachment', project, { preview: 'image', bytesOnly: hub.platform === 'desktop' });
        if (value.mime !== imageMime(rel)) throw Error('Attachment image type changed.');
        return { rel, size: value.size, content: '', binary: true, truncated: false, mtime: 0, bytes: value.bytes, base64: value.base64 };
      }
      return hub.platform === 'desktop' ? hub.call<FileContent>('readFile', project, rel, { bytesOnly: true }) : hub.call<FileContent>('readFile', project, rel);
    }); resources.set(hub, manager);
  }
  return manager;
}
export function useImageResource(hub: HubBridge, project: string | null, rel: string | null, revision: string | number, enabled = true, rendition: ImageRendition = 'original') {
  return useOwnedImage(hub, project, rel, revision, enabled, rendition, 'file');
}
export function useAttachmentImage(hub: HubBridge, file: Attachment, enabled: boolean, rendition: ImageRendition = 'thumbnail', attempt = 0) {
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[file.mime];
  return useOwnedImage(hub, file.id, extension ? 'media.' + extension : null, `${file.size}:${attempt}`, enabled, rendition, 'attachment');
}
function useOwnedImage(hub: HubBridge, project: string | null, rel: string | null, revision: string | number, enabled: boolean, rendition: ImageRendition, source: ImageResourceSource) {
  const scope = React.useMemo(() => ({}), [hub, project, rel, revision, enabled, rendition, source]);
  const [record, setRecord] = React.useState<{ scope: object; value: ImageSnapshot } | null>(null);
  React.useEffect(() => {
    if (!enabled || !project || !rel) return;
    let current = true;
    try {
      const lease = images(hub).acquire(project, rel, revision, rendition, source);
      const update = () => { if (current) setRecord({ scope, value: lease.snapshot() }); };
      const off = lease.subscribe(update); update();
      return () => { current = false; off(); lease.release(); };
    } catch (error) { setRecord({ scope, value: { src: null, loading: false, error: (error as Error).message } }); }
  }, [scope, hub, project, rel, revision, enabled, rendition, source]);
  return record?.scope === scope ? record.value : { src: null, loading: enabled && !!project && !!rel, error: '' };
}

/** Text remains primary editor state; only its derived URL has this lifetime. */
export function useTextBlob(text: string, type: string, enabled = true) {
  const scope = React.useMemo(() => ({}), [text, type, enabled]);
  const [record, setRecord] = React.useState<{ scope: object; src: string } | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    const src = URL.createObjectURL(new Blob([text], { type })); setRecord({ scope, src });
    return () => URL.revokeObjectURL(src);
  }, [scope, text, type, enabled]);
  return record?.scope === scope ? record.src : null;
}
