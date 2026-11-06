# Complete, cancellable filename discovery

Quick Open and the Explorer filename filter now own their directory work. Changing the query, hiding the Explorer, closing the picker, removing a workspace root, reloading/crashing the desktop renderer, and disposing a VS Code webview release its search leases. VS Code views cannot cancel one another's searches. A late lease acquisition is immediately closed instead of starting an obsolete scan.

## What changed

The historical walker first materialized every entry in a directory with `readdir`, then stopped after 20,000 visited entries or 2,000 results. A rare filename beyond that boundary was invisible. UI cleanup only ignored the obsolete reply, so older walks still consumed CPU and directory memory.

`core/filename-search.js` uses `opendir` with 256-entry native buffers, callback reads, and a yield at least every 256 entries. It walks the full searchable tree and retains a bounded max heap of the lexically smallest matching paths. Quick Open requests 100 paths; Explorer and compatibility callers request up to 2,000. Result totals remain exact for readable searchable directories. Broad queries explicitly show the returned prefix and total. Hidden-file and dependency-folder rules remain; ignored/generated directory names are excluded, symbolic links are not traversed, and file contents are never read.

The service admits at most two active walks and 128 owners; there is at most one queued task per owner. A newer task removes the older queued request or aborts its active producer. Directory handles close on success, cancellation, read failure, and excessive depth. Every retained callback/frame belongs to a live walk rather than an unbounded pending-directory list. Root errors propagate, unavailable nested folders are counted in the UI, and depth beyond 128 levels produces an explicit error rather than silently dropping files. Cancellation is cooperative: a native I/O operation already in flight must return before its handle can be closed. This is not an OS-level interruption guarantee for a stalled network mount.

Expected cancellation is carried as a typed host result and rejected locally by the UI helper, avoiding Electron's misleading IPC-error log. Replies are still guarded by the existing UI generation checks. Opening files, editor drafts/undo, and focus behavior remain independently owned.

## Measurement

Run `npm run bench:filenames -- /tmp/filename-search.json`. The [raw report](filename-search-benchmark.json) records three alternating fresh-process pairs per fixture, source hashes checked before and after each child, Node/V8 versions, timings, observed heap high water, native process peak RSS, and a 2 ms timer probe. Diagnostic GC occurs only before/after measured work. It is never enabled in production.

The baseline is source commit `7b3c95fa2bda87d33bc592ada0e3ed190b175f1f`. The 16,000-file fixture compares equal complete output and traversal. In the 60,000-file fixture the historical walker misses the target, whereas the new scanner visits all entries and returns it; its timing is **not equal work**. Timer sampling can miss short heap peaks, RSS includes the runtime, native buffers and allocator behavior, and these are isolated Linux Node measurements—not whole-app PSS, model memory, cross-editor rankings or hardware cache-miss measurements.

| Fixture / variant | Search time (ms) | Sampled heap high water (MiB) | Process peak RSS (MiB) | Longest observed timer gap (ms) |
| --- | ---: | ---: | ---: | ---: |
| 16,000 (equal work) / baseline | 22.57 | 7.06 | 61.79 | 11.18 |
| 16,000 (equal work) / stream | 70.99 | 6.41 | 61.89 | 4.97 |
| 60,000 (different coverage) / baseline | 79.23 | 11.57 | 72.25 | 29.26 |
| 60,000 (different coverage) / stream | 107.08 | 6.64 | 62.32 | 4.33 |

All twelve subprocess observations remain in the raw report. The small equal-work fixture does not show a process-RSS reduction; its sampled heap is lower but its single-query completion time is higher. The larger fixture has lower observed heap/RSS while doing more complete work, which is evidence for bounded intermediate storage rather than an equal-work speed claim. Timer gaps are probes of host responsiveness, not measured input-to-paint latency. Streaming deliberately trades single-query throughput for bounded intermediate storage, cancellation, complete discovery, and shorter observed event-loop stalls. Do not describe slower complete scans as a speedup or reuse the old cross-editor chart as a measurement of this implementation.

## Verification and reading

[Verification record](filename-search-verification.json): 656 full regressions, 27 follow-up focused checks, typecheck/build, 18 native Quick Open reopen cycles, and seven native large-project/cancellation checks.

`test/filename-search.test.cjs` covers complete lexical prefix selection after 20,000 entries, real deep/hidden files, symlink exclusion, cancellation and handle closure, read errors, unavailable directories, explicit depth limits, bounded admission/queue replacement, owner isolation, late completion, late acquisition and workspace removal. The VS Code bridge test exercises two independent webview owners and verifies disposal isolation.

`test/e2e/filename-search.cjs` uses real local files, real CodeMirror and desktop IPC; an injected cancellable wait exercises replacement, picker close and renderer reload. It verifies the exact opened source, 100 visible results from 21,001 matching files, no source modification, and zero surviving search leases/work after cleanup. [Native verification](filename-search-ui.json), [screenshot](filename-search-ui.png). The separate Quick Open focus test repeats 18 immediate reopen/select cycles.

The complete captured prose and C++ listings of Robert Nystrom's author-hosted [Event Queue chapter](https://gameprogrammingpatterns.com/event-queue.html) were read for this pass; [reading record](filename-search-reading.json). The relevant ideas are decoupling request submission from processing, bounding queued storage, aggregating obsolete requests, and making object lifetime explicit. This JavaScript service keeps request/response promises and explicit cancellation; it does not transplant the C++ audio queue or assert C++ cache-layout properties for V8 arrays. Images were not visually inspected and C++ examples were not compiled; this is one chapter, not a claim to have read the entire book or every linked resource.

## Remaining work

Measure rapid typing and root switching in the full native app against the same large-project fixture before claiming end-to-end speed improvements. Repeated scans still re-enumerate directories; a bounded, invalidated cache or shared index needs a measured ownership design. The separate `listFiles` API still has its documented prefix limits and a bulk-reading local non-Git fallback. Very deep directory frames retain buffers proportional to depth. None of these limitations is a reason to hide files or discard unsaved editor state to reduce memory numbers.

A later [hot-loop follow-up](FILENAME_SEARCH_HOT_LOOP.md) reduces temporary scanner allocation and measures native query response, while retaining the buffer policy. The historical measurements above remain unchanged.
