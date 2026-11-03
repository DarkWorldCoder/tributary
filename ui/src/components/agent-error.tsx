import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';

/** Keep recovery actions visible while retaining the complete provider diagnostics. */
export function AgentError({ text, agent }: { text: string; agent: string }) {
  const s = useStore();
  const retired = /IneligibleTierError|no longer supported for Gemini Code Assist/i.test(text);
  const routing = /workspace routing discovery failed/i.test(text);
  const flags = /unexpected argument.*'-s'/i.test(text);
  const title = retired ? 'Gemini sign-in needs a different model source.' : routing ? 'Codex could not reach its workspace service.' : flags ? 'Codex could not resume this session.' : text.length > 260 ? 'The agent could not finish this request.' : text;
  return <Alert variant="destructive"><AlertCircle /><AlertDescription className="space-y-2 text-[13px]">
    <p className="whitespace-pre-wrap">{title}</p>
    {(retired || routing || flags) && <Button size="xs" variant="outline" onClick={() => { s.setAgentId(agent); s.openSettings(retired ? 'gateways' : 'agents'); }}>{retired ? 'Choose model source' : 'Agent setup'}</Button>}
    {title !== text && <details className="text-xs"><summary className="cursor-pointer">Error details</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</pre></details>}
  </AlertDescription></Alert>;
}
