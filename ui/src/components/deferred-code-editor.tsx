import * as React from 'react';
import { DeferredSurface } from '@/components/deferred-surface';
const Editor = React.lazy(() => import('@/components/code-editor').then((module) => ({ default: module.CodeEditor })));
export type { EditorHistory } from '@/components/code-editor';

/** Read-only previews never import the editor engine. Draft ownership stays in the caller. */
export function DeferredCodeEditor(props: React.ComponentProps<typeof Editor>) {
  return <DeferredSurface key={props.path} active name="Editor"><Editor {...props} /></DeferredSurface>;
}
