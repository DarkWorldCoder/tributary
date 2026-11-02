# Multi-agent coding apps and coordination: research notes (November 2026)

Produced by a deep-research run: 5 search angles, 24 sources fetched, 120 claims extracted, 25 checked by three independent verifiers each. 17 claims survived and 8 were refuted. Confidence labels come from that vote.

## Summary

Tools that host several coding agents are converging on the Agent Client Protocol (ACP), a JSON-RPC protocol over stdio from Zed and JetBrains. Coordination in shipping tools is mostly isolation plus human review: separate git worktrees or containers, a diff or proposed-change review, and IDE diagnostics before merge. No verified tool lets agents genuinely collaborate with each other.

The research on whether multi-agent coordination helps is mixed:

- **A manager with isolated workers and test-gated merges helps.** CAID beat a single agent by 6 to 25 points.
- **Parallel candidates plus a selection step help.** CodeMonkeys resolved 57.4% of SWE-bench Verified this way.
- **Splitting one feature between peer agents hurts.** On CooperBench, success drops about 30%, and a messaging channel between the agents did not help.

## Verified findings

| Finding | Confidence |
|---|---|
| The ACP Registry (launched 28 Jan 2026) lets an agent register once and appear in clients that read it. Zed and JetBrains IDEs install from it. Launch agents included Claude Code, Codex CLI, Copilot CLI, OpenCode and Gemini CLI. | High |
| JetBrains Air hosts third-party agents over ACP. Its July 2026 release added Copilot, OpenCode, Pi and Cline. Custom agents go in `~/.jetbrains/acp.json`. | High |
| Claude Code on a Claude subscription must run in Air's terminal surface, because the ACP chat surface cannot authorize a subscription. ACP-first hosts still need a terminal fallback. | High |
| Air has no local model gateway. Local models only arrive through an agent that supports them, and Air's own bring-your-own-key option covers only OpenAI, Vertex AI, Anthropic and Bedrock. | High |
| Air coordinates through isolation (worktree, Docker or cloud) and a Proposed Change review, not agent-to-agent work. Docker isolation needs Docker Desktop. | Medium |
| AionUi (Apache-2.0) runs 20+ agent CLIs in one window through ACP or an adapter, not by wrapping terminals. Its per-agent MCP and model handling is unverified. | Medium |
| Goose can drive Claude Code over ACP and pass its MCP servers along. That is the only verified cross-agent tool sharing. ACP's `session/new` carries only `mcpServers`, not skills or secrets. | High |
| CAID (manager builds a task graph, one worktree per engineer agent, test-gated merge) beat a single agent by +6 to +25.6 points. Shared-workspace isolation scored below the single agent. | Medium |
| CooperBench: two peer agents each building one feature, then merging, succeed about 30% less often than one agent building both. GPT-5 and Sonnet 4.5 drop to about 25%. | High |
| Free-form agent-to-agent messaging gave no net benefit (about -0.5 points on average), and agents spent up to 20% of their steps chatting. | High |
| Parallel candidates plus selection: 10 trajectories per issue reached 57.4% on SWE-bench Verified, while at least one candidate was right 69.8% of the time. Better selection is the open win. | Medium |
| A shared task board with claims and leases removed duplicated work, but only in a synthetic simulation with scripted bots. | Low |

## Refuted (do not cite)

- Pooling candidates from different vendors' agents beats the best single agent (the "Barrel of Monkeys" 66.2% claim).
- Success falls from 68.6% with 2 agents to 30.0% with 4 in a scaling experiment.
- Markdown task files lose concurrent writes, and a task board tripled throughput.
- Goose plans to remove its CLI providers in favor of ACP.

## Not answered

Nothing verifiable surfaced for Conductor, Vibe Kanban, Superset, Baton, Braid, Canopy, Termic, CrewCode, Daintree, Zed's agent panel UX, VS Code multi-agent support or Claude Squad. Pricing and Linux support were not verified for any tool. There is no controlled evidence yet on AGENTS.md-style shared memory, planner, builder and reviewer loops, or agent calls over MCP.

## What this means for Tributary

1. **Keep headless JSON for subscription agents and add ACP-first hosting for the rest.** Tributary already runs Claude Code headless, which works on a Claude subscription where ACP chat surfaces do not.
2. **The shared model gateway is a real gap.** Air and the IDEs leave local models to each agent. Tributary's gateway profiles already cover Ollama, LM Studio, LiteLLM, DeepSeek and OpenAI-compatible endpoints for every agent.
3. **One MCP and skills layer is a real gap.** ACP passes only MCP servers, so Tributary's per-agent CLI approach for MCP and symlinked skills fills what the protocol cannot.
4. **Read the ACP Registry.** Discovering and installing agents from `registry.json`, merging the client-specific indexes, would work outside Zed and JetBrains.
5. **Change the team defaults to match the evidence.** Add "Race": N agents in separate git worktrees, run the tests, pick or review the best. Add "Manager": a task graph, one worktree per worker and test-gated merge. Keep the review loop as an option, since it has no controlled evidence either way. Avoid splitting one feature between peer agents, and avoid free-form agent chat.
6. **Ship Linux packages and container isolation that does not need Docker Desktop.**

## Sources

- Zed, ACP Registry announcement: https://zed.dev/blog/acp-registry
- Agent Client Protocol registry docs: https://agentclientprotocol.com/get-started/registry
- ACP registry repository: https://github.com/agentclientprotocol/registry
- JetBrains Air, July 2026 release: https://blog.jetbrains.com/air/2026/07/what-s-new-air-gets-more-agents-local-models-and-java-kotlin-code-intelligence/
- JetBrains Air docs, agents: https://www.jetbrains.com/help/air/ai-agents.html
- JetBrains Air docs, Air in IDEs: https://www.jetbrains.com/help/air/air-in-ides-overview.html
- AionUi repository: https://github.com/iOfficeAI/AionUi
- AionUi ACP setup wiki: https://github.com/iOfficeAI/AionUi/wiki/ACP-Setup/FAQ
- Goose, ACP providers guide: https://goose-docs.ai/docs/guides/acp-providers
- Goose, using a subscription: https://goose-docs.ai/blog/2026/03/19/use-goose-with-your-ai-subscription
- CAID (Geng and Neubig, CMU): https://arxiv.org/pdf/2603.21489
- CooperBench (Stanford): https://arxiv.org/html/2601.13295
- CodeMonkeys (Stanford and Oxford): https://arxiv.org/pdf/2501.14723
- grite task-board preprint: https://arxiv.org/abs/2606.19616

## Patterns from open-source apps (read from source, 2 November 2026)

A second pass read the code of AionUi (Apache-2.0), Vibe Kanban (Apache-2.0), Claude Squad (AGPL-3.0), Crystal (MIT), Goose (Apache-2.0), OpenCode (MIT), Zed's agent crates (GPL-3.0, ideas only) and Paradev, formerly Superset (Elastic License 2.0, not open source, ideas only).

| Pattern | Where it comes from | Status in Tributary |
|---|---|---|
| Keep one agent process alive per agent and folder, close it when idle, respawn and reload the session after a crash | Zed `agent_connection_store.rs`, Goose `acp/provider.rs`, AionCore `idle_scanner.rs` | Done in `core/acp.js`, tested in `test/acp-pool.test.js` |
| Pass the project's MCP servers into every ACP session, HTTP only to agents that support it | Zed `agent_servers/src/acp`, Goose `provider.rs`, AionCore `session_injection.rs` | Done: `.mcp.json` servers go into `session/new` and `session/load` |
| Keep each parallel attempt on its own branch after cleanup | Vibe Kanban, Claude Squad | Done: race candidates keep `tributary/race-<id>/<agent>` |
| Check for conflicts with `git merge-tree` before applying | Crystal `worktreeManager.ts` | Done: apply merges against your current files and names conflicting files instead of writing conflict markers |
| Install agents from the ACP registry | ACP registry `README.md`, AionCore `registry_npx_lock.rs` | Backend done in `core/registry.js` (npx and uvx agents). UI and binary downloads pending |
| Approve or deny prompts using Claude's and Codex's own control protocols (`--permission-prompt-tool stdio`, `codex app-server`) | Vibe Kanban `claude.rs`, AionCore `adapter/claude.rs` | Not started. Needs UI changes in shared files |
| Stream deltas over IPC, store history in SQLite, virtualize the transcript | OpenCode, Vibe Kanban, AionCore | Not started. Touches the hub, store and main process |
| Attention states per thread (working, needs permission, needs review, failed) | Paradev `agent-status.ts`, Zed `message_queue.rs` | Partly: notifications and a follow-up queue exist; per-thread badges pending |
| Keep checkpoints outside the user's repository | OpenCode `snapshot.ts` | Done: checkpoints live in Tributary's own object store and read the repo's objects through an alternate; race branches stay in the repo on purpose |

Two findings support choices Tributary already made. Zed gives external agents no rewind, while Tributary's git checkpoints rewind every agent. AionUi's teams coordinate through free-form messaging between agents, which CooperBench found does not help, so Tributary keeps coordination structured.

Corrections to the earlier sections: Goose is not the only tool that shares MCP servers with hosted agents, AionUi's MCP handling is now confirmed from source, and Superset is now Paradev under a license that is not open source.
