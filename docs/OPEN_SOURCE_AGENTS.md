# Open-source coding agent research

Verified 3 November 2026 against official GitHub metadata and README files. This is a curated survey, not every repository on GitHub. Repository freshness is not a runtime compatibility certificate. No upstream source code was copied.

| Official source | License reported by GitHub | Current evidence | Useful pattern | Tributary outcome |
| --- | --- | --- | --- | --- |
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | MIT | Maintained repository | General subagents and persistent session workflow | Use the existing ACP adapter; durable inbox remains planned. |
| [openai/codex](https://github.com/openai/codex) | Apache-2.0 | Maintained repository | Native app-server events, thread continuation and host approvals | Implemented local app-server adapter; provider inference remains untested. |
| [earendil-works/pi](https://github.com/earendil-works/pi) | MIT | Maintained repository | Small extensible core, skills and packages | Keep optional features lazy; avoid imposing an all-purpose agent framework. |
| [cline/cline](https://github.com/cline/cline) | Apache-2.0 | Maintained repository | Terminal feedback, checkpoints and coordinated changes | Existing checkpoints/review; common approval and question controls improved. |
| [aaif-goose/goose](https://github.com/aaif-goose/goose) | Apache-2.0 | Maintained repository; moved from block/goose | Provider choice and MCP extensions | Use the existing Goose ACP path and provider settings. |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | Apache-2.0 | Maintained repository | Ranked repository context and local-model choice | Bounded memory and handoff implemented; semantic symbol map remains planned. |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | MIT | Maintained repository; current README calls it Agent Canvas | Local/remote agent backends and sandbox choices | Retain explicit execution boundaries; no new container backend added. |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | Apache-2.0 | Maintained repository | Context files, MCP and native ACP | Implemented native ACP launch with model selection and image capabilities. |
| [continuedev/continue](https://github.com/continuedev/continue) | Apache-2.0 | README says read-only / no longer actively maintained | Editor-integrated agent workflow | Historical reference only; do not recommend as a maintained dependency. |
| [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) | Apache-2.0 | Archived; README reports extension shutdown | Mode-based agent tools and MCP | Historical reference only. |
| [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | Apache-2.0 | Maintained repository | Provider protocols, agent teams, memory and skills | Existing Qwen ACP path; shared team/delegation controls retained. |
| [MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli) | Apache-2.0 | Archived; README directs users to MoonshotAI/kimi-code | Session migration and MCP configuration | Old CLI is not a maintained recommendation; evaluate successor separately. |

The implemented adapters and limits are recorded in [Native agent behavior](NATIVE_AGENT_BEHAVIOR.md). Remaining product work is in [Next feature plan](NEXT_FEATURE_PLAN.md): durable inbox/recovery, change-review summaries, context attribution, budgets and project maps.

Source metadata and README statements were checked together: Continue is unmaintained even though its archived flag was false. Kimi CLI is archived and its successor was not fully audited in this pass. License labels describe repository metadata; individual distributions and vendored files may have additional terms.

VS Code language extensions require an extension host. Tributary links detected languages to their extensions in VS Code; it does not claim to execute VSIX packages inside CodeMirror. [VS Code extension-host documentation](https://code.visualstudio.com/api/advanced-topics/extension-host).
