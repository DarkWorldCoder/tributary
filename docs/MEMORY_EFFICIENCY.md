# Memory efficiency

- **Native storage:** Node/Electron’s built-in SQLite engine stores history on disk. An additional Rust memory bridge is not required for this storage path.
- **Small sidebar cache:** badges retain status flags, not copies of replies, thinking, logs, images or diffs. Native SQLite iteration reads the newest messages without first loading every message ID.
- **Lazy history:** unopened conversations remain on disk; opening a conversation loads its full history. Conversations already opened during this app session still remain resident.
- **Bounded context:** project memory stays below 256 KB. Retrieval selects relevant excerpts within its configured character budget. Search now walks each short memory line once instead of allocating a copy of every query term for every line.
- **Local models:** inference and weights stay in Unsloth/Ollama/LM Studio. Compact local profiles limit previous-chat context to 4,000 characters and enabled project-memory excerpts to 2,000 characters. Original data is preserved. Local coding tool results are bounded, older complete tool groups are evicted from the active request, and each turn has a step/tool limit. These limits reduce context growth; model weight size is controlled by the external runtime.

## Reproduce the sidebar benchmark

Run `npm run bench:memory`. It creates disposable history and compares the previous and optimized sidebar caches in separate processes with explicit garbage collection. No real user conversations or local models are opened.

The recorded [benchmark result](performance/memory-summary-benchmark.json) uses 32 conversations with large replies, tool logs and diffs. The serialized retained cache decreased from **19,973,731 bytes** to **4,717 bytes**. All 32 conversations stayed unloaded, with full messages still available in SQLite.

This measures the **sidebar cache**, not total app RAM, model weights or GPU memory. Heap deltas are noisy and may be slightly negative after garbage collection. Electron/GPU resources and active model inference have separate costs; this result is not a claim of 99.98% lower total RAM.
