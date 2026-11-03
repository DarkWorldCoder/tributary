// Only known interactive setup commands; never run an arbitrary metadata string through a shell.
const ARGS = { claude: [], codex: ['login'], gemini: [], antigravity: [], opencode: ['auth', 'login'], goose: ['configure'], qwen: [] };
export function setupCommand(agent, platform = '') {
  if (!agent.available || !agent.path || !Object.hasOwn(ARGS, agent.id) || /[\x00-\x1f]/.test(agent.path)) return null;
  // Windows shells differ (cmd/PowerShell). Keep setup in the install guide rather than guessing quoting.
  if (/Win/i.test(platform)) return null;
  return `'${agent.path.replaceAll("'", "'\\''")}'${ARGS[agent.id].length ? ' ' + ARGS[agent.id].join(' ') : ''}`;
}
