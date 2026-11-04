# Tributary for QA engineers

Researched 3 November 2026. Status: proposed product and engineering plan.
Audience: manual QA engineers, automation QA/SDETs, QA leads and developers collaborating on the same product.
Scope: web application and API testing first; native/mobile, load and advanced security testing are later adapters.

## Recommendation

Make **Test** a first-class task beside Build and Research.
A QA engineer should be able to start with a staging URL, requirements or an existing failing test, without opening code or configuring a team.
Keep cases, actual runs, bug evidence, proposed fixes and retest results connected.
Use existing test engines; make their output understandable and their results traceable.
The advantage to validate is the shared developer–QA loop, not merely generating more tests.

## What already exists elsewhere

| Primary source | Verified capability | Implication |
| --- | --- | --- |
| [Playwright Test Agents](https://playwright.dev/docs/test-agents) | Planner, generator and healer agents can create plans, produce test files and repair failures | Reuse this ecosystem behind a reviewed workflow; test generation alone is not differentiation |
| [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) | Inspect recorded runs, including actions and page state | Link failures to native traces rather than recreate a shallow terminal summary |
| [Playwright API testing](https://playwright.dev/docs/api-testing) | API requests can test services, prepare state and verify postconditions | UI and API checks can share fixtures and a run record |
| [Playwright retries](https://playwright.dev/docs/test-retries) | Distinguishes first-pass success, flaky retry success and persistent failure | Preserve every attempt; a retry pass must not erase the first failure |
| [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) | Screenshot comparisons use stored baselines; rendering varies by environment | Store environment identity; baseline updates require review |
| [Cypress Studio](https://docs.cypress.io/app/guides/cypress-studio) | Records interactions and supports assertions; AI suggestions are an additional layer | Recording plus reviewed, ordinary test code is a familiar authoring model |
| [Cypress AI overview](https://docs.cypress.io/app/ai/overview) | Documents AI authoring and context/tools for agents using Cypress | Keep existing Cypress users on their runner; avoid forced migration |
| [Qase AI Test Designer](https://docs.qase.io/en/articles/9653096-ai-test-designer) | Produces manual cases from requirements for user review | Manual case design belongs alongside automation |
| [Qase requirements](https://docs.qase.io/en/articles/5563700-requirements) | Links requirements to cases | Traceability is expected; prioritize a usable implementation over claiming novelty |
| [Postman AI, current v12 docs](https://learning.postman.com/docs/getting-started/basics/about-ai/) | Agent Mode works across API requests/tests; CLI/skills support repository workflows | Integrate existing collections/specs instead of building a second Postman |
| [Allure reporting model](https://allurereport.org/docs/how-it-works/) | Results, attachments, environment and reporting integrations form a structured evidence system | Import evidence through adapters; keep an internal common run schema |
| [Playwright accessibility](https://playwright.dev/docs/accessibility-testing) | Integrates axe; automated checks cover only part of accessibility | Keep manual keyboard, screen-reader and inclusive testing tasks visible |
| [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/) | User-defined metric thresholds determine pass/fail | Later performance gates should use measured thresholds, not AI opinions |

Documentation establishes capability, not independent quality, usability superiority, license compatibility or demand for Tributary. Check adapter version and licensing before implementation. Current Postman v12 documentation is used; legacy Postbot plan limits are not treated as current facts.

## QA jobs and proposed screens

| Job | What the user supplies | What Tributary should produce | Human decision |
| --- | --- | --- | --- |
| Design tests | Requirement, story or acceptance criteria | Draft happy-path, negative, boundary, role and recovery cases with links to the source | Approve expected behavior and remove unsupported assumptions |
| Explore the app | Approved URL/environment and a time-boxed charter | Notes, observed failures, screenshots and session timeline | Confirm findings and coverage gaps |
| Record a regression | Actions in the test browser plus explicit assertions | Editable Playwright test and ordered readable steps | Approve selectors and the test oracle |
| Run a suite | Existing project/configuration or imported results | Actual pass/fail/flaky/blocked/skipped counts, duration and attempts | Triage failures and accept remaining risk |
| Reproduce a bug | Steps, expected result, environment | Evidence bundle and a replayable test where possible | Confirm reproducibility before assignment |
| Test an API | Existing collection or OpenAPI specification | Auth-aware positive/negative/schema scenarios and actual responses | Approve environment, test data and writes |
| Review appearance | Approved baseline and fixed browser/OS settings | Before, after and diff views with changed regions | Accept a deliberate design change |
| Check accessibility | Pages and flows | Automated findings plus a manual assessment checklist | Validate impact with keyboard/screen-reader testing |
| Collaborate on a fix | Confirmed bug with linked evidence | Isolated developer fix, original failing test and new retest | QA accepts the fix; lead chooses release |
| Assess a release | Build/commit, agreed suite and exclusions | Evidence-backed readiness checklist and unresolved risks | Human release decision |

## Simple UI, progressively more detail

- Task entry: **Build · Test · Research**. These are workflows in the same project, not separate competing apps.
- Test entry: **Test a website · Run existing tests · Reproduce a bug · Create a test plan**.
- Setup asks for environment, target URL/project, allowed actions and an optional requirement. An AI connection is unnecessary for running existing tests or recording manual results.
- Main layout: cases/runs on the left, browser or trace in the center, compact chat/evidence on the right. The editor opens when a case links to code.
- Top context: project, environment, branch/commit when available and run status. Never mix staging evidence with a local build silently.
- Result detail: expected vs actual, exact failed assertion, screenshot/trace, network/console evidence, retries, related requirement and owner.
- Mobile/narrow view: switch Cases / Browser / Evidence; no three compressed columns.
- Primary actions: **Run**, **Record**, **Report bug**, **Retest**. Advanced engine/model/worker configuration stays in a menu.

The new local Preview browser is a foundation, not a QA recorder: it currently embeds local pages and controls explicitly launched dev/start scripts. It does not inspect DOM across origins, capture browser network traffic, run multi-browser suites or grant staging access. Those require a dedicated isolated browser adapter.

## Prioritized backlog

| Priority | Slice | Acceptance criteria |
| --- | --- | --- |
| P0 | Requirements and manual cases | Stable IDs, steps, expected outcomes, source links, priority, owner; generated cases visibly draft |
| P0 | Run and attempt records | Immutable execution facts tied to build/environment; passed/failed/flaky/skipped/blocked/not-run stay distinct |
| P0 | Playwright result + trace import | Read actual structured results, failures and artifact paths; no fake run from generated prose |
| P0 | Reproducible bug bundle | Expected/actual, steps, build, browser, time, screenshot and source run; export Markdown/JSON before tracker sync |
| P0 | Existing test execution | Explicit project command selection, cancellation, timeout, retained output and artifacts; no automatic dependency installation |
| P1 | Isolated test browser and recorder | Approved target origins; distinct test profile; captures actions and lets QA approve assertions; ordinary tests saved to Git |
| P1 | Requirement-to-result links | Show uncovered requirements and unexecuted cases; do not call this code coverage |
| P1 | Reviewed automation authoring | Plan → approved cases → test diff → actual run; preserved original expected behavior |
| P1 | Fix/retest handoff | QA evidence reaches a named developer worker in an isolated branch; QA verifies the original failure on the fix |
| P1 | Cypress/JUnit adapters + CI import | Reuse current runner; identify commit/environment and deduplicate run imports |
| P1 | Visual and accessibility review | Approved baselines and environment; manual assessment remains available |
| P2 | API collection/spec adapters | Existing Playwright API first, then Postman/OpenAPI based on pilot demand; fixture lifecycle and secret-safe environments |
| P2 | Flakiness and impact suggestions | Show actual attempt history; suggested impacted tests cite files/requirements and never silently exclude the full regression suite |
| P2 | Release review | Clear tested scope, failed/blocked/not-run counts and linked evidence; explicit human acceptance |
| Later | Performance/native/mobile/security | k6/Appium/security adapters after separate feasibility work and user validation; no universal support claim |

## Agent collaboration: bounded and reviewable

Example request: “Test checkout on staging. Cover guest checkout, invalid card and lost network. Do not place a real order.”

1. QA planner drafts acceptance criteria and scenarios; asks about missing business rules instead of inventing them.
2. QA approves the cases and environment actions.
3. Browser/API workers execute independent cases with separate users/data and a fixed concurrency limit.
4. Triage worker groups observed failures and proposes causes, each linked to actual evidence.
5. Developer worker may propose an isolated fix only after assignment; test-only permissions are the default for QA agents.
6. Retest runs the original failing case against the new build; QA reviews the evidence and closes the bug.

Single-worker execution remains the default for small tasks. Provider switching must preserve artifact links, expected behavior, action limits and pending work. A missing runtime/tool capability is a visible blocker, not an invented tool result.

## Prevent false confidence

| Risk | Required behavior |
| --- | --- |
| AI changes assertions to make tests pass | Treat oracle changes as separate review; show original and proposed assertions; never auto-accept |
| Healer hides a product defect | Reproduce first; distinguish product failure, test failure and environment failure; preserve evidence |
| Retry produces a green result | Retain first failure and report flaky status |
| Visual baseline is rewritten | Show baseline diff; require a reviewer; no bulk baseline overwrite to satisfy a gate |
| Untested requirement appears covered | Separate designed, automated and actually executed cases; show missing evidence |
| Parallel workers corrupt fixtures | Per-run users/data namespaces, isolated browser contexts and cleanup records; serialize shared resources |
| Credentials/PII enter screenshots or traces | Scoped secrets and redaction before sharing; local artifacts first; explicit destination and retention controls |
| Agent runs against production | Visible environment and origin allowlist; destructive actions separately gated; no load or destructive test by default |
| Browser content gives agent instructions | Treat page content as untrusted evidence, with no access to Tributary's host bridge |
| “All tests passed” implies release readiness | Report exact scope, build, exclusions and open bugs; human release decision |

## Architecture and implementation boundaries

Existing foundation, source reviewed in this checkout:

| Existing source | Useful foundation | Still missing for QA product |
| --- | --- | --- |
| `core/project-checks.js` | Explicit discovered checks, process cancellation and diagnostics | Per-test results, retries and test-artifact indexing |
| `core/checkpoint.js`, `core/git.js` | Snapshots and exact change review | Case/run/build links and defect lifecycle |
| `core/delegation.js`, `core/manager.js`, `core/activity.js` | Background workers, orchestration and live activity | QA-specific ownership/fixtures, reviewed oracle contracts |
| `ui/src/components/project-preview.tsx`, `core/preview-server.js` | Local browser-style preview and owned process control | Isolated multi-browser automation, recorder and staging policies |
| `core/research.js` | Source-linked research flow | Validated requirements extraction and traceability |
| `core/collaboration/`, project room | Shared task coordination | Test case/evidence sync, durable attachments and run permissions |

Proposed records:

- `Requirement`: ID, source revision, acceptance criteria, owner.
- `TestCase`: ID, requirement IDs, steps/assertions, automation path, priority, owner, review state, version.
- `TestRun`: ID, requested scope, case versions, build/commit, environment, runner/version, start/end, cancellation status.
- `TestAttempt`: run/case ID, attempt number, actual status, assertion error, timestamps, artifact references.
- `Artifact`: local path/content hash, type, size, run/attempt ID, redaction/share state and expiry.
- `Bug`: case/run references, expected/actual, reproduction steps, evidence, severity, assigned owner, retest and resolution.

Use additive storage migrations and shared typed contracts for desktop/VS Code/room clients when this is implemented. Do not stuff authoritative execution facts into chat text. Keep local artifacts on disk with bounded retention; sync metadata first. Add narrow runner adapters with versioned result schemas. Preserve native traces/reports and open their maintained viewers rather than writing a new browser engine or test runner.

First vertical slice: existing Playwright project → explicit run → structured report import → failure view → local trace → bug export → rerun → comparison. Then add manual case authoring and requirement links. This produces a useful QA tool before ambitious autonomous testing.

## Validation and opportunity map

| Window | Validate / deliver | Proof |
| --- | --- | --- |
| This week | Interview manual QA, SDETs and a lead; observe current test/repro/handoff workflow; collect anonymized sample result formats with permission | Evidence of the largest actual time sinks, rather than feature voting |
| First month | First vertical slice + manual cases + bug export | A QA user reproduces seeded failures and hands off a complete bug without authoring a prompt |
| This quarter | Recorder, reviewed generation, retest collaboration, CI/result adapters and release review | Fixed bugs retain their original regression test; failed/skipped/flaky cases never become false passes |
| Deeper research | Enterprise auth, test-data lifecycle, native/mobile, load/security scope, offline model quality | Separate feasibility and permission model per environment/engine |

Study 5–6 manual QA users and 5–6 SDETs initially, plus QA leads for release decisions. Use realistic seeded product, test and environment failures, not only broken selectors. Compare against the participants' current tools with counterbalanced tasks. Measure time to reproduce, bug completeness, manual corrections, false-green rate, first-run vs retry behavior, unassisted completion and cost per accepted test where available. Small qualitative samples guide design; they do not estimate market frequency.

Hard gates: no silently weakened assertions, no fabricated execution evidence, no lost original failure on retry, reproducible build/environment IDs, accessible manual workflow, cancellation without orphaned managed processes and no required AI account to view results.

## Evidence limitations

This scan uses official product/engine documentation and local source review. No QA interviews, production-team observations, paid platform trials or independent head-to-head tests have been completed. Vendor features are not evidence that users want every one in Tributary. Market prevalence of individual QA problems remains unmeasured. The Stack Overflow survey in the companion plan is developer-wide, not a QA-only survey. All additions above remain proposed until implemented and validated.

## QA problem ranking to validate

| Rank | User goal and friction | Severity | Frequency evidence | Confidence and response |
| --- | --- | --- | --- | --- |
| 1 | Reproduce a failure on the same build/environment | High | Native traces/results are established in Playwright and Allure; local customer frequency not measured | High workflow relevance; prioritize run identity and evidence bundle |
| 2 | Define the right expected behavior before automating | High | Qase provides reviewed requirement-to-case generation; demand intensity unmeasured | High correctness importance; require reviewed cases and assertions |
| 3 | Separate product bugs from flaky tests and environment errors | High | Playwright explicitly distinguishes retries/flaky outcomes | High engine evidence; preserve attempts and original failures |
| 4 | Hand off a bug without repeating discovery | High | Inference from separate code/task/report surfaces in local source; no QA interviews yet | Medium; validate linked QA→developer→retest handoff |
| 5 | Make progress without writing automation code | Medium–high | Cypress recording and Qase manual cases show viable interaction patterns | Medium demand confidence; manual flow and URL-first entry |
| 6 | Know what was actually tested before release | High | Requirements linking and structured reports establish useful primitives | High integrity importance; readiness gaps, not a universal quality score |
| 7 | Maintain regression tests without hiding defects | High | Test-healing capabilities exist; correctness of each repair still needs project-specific evaluation | High risk relevance; review oracle changes and seed counterexamples in validation |

This is a prioritization hypothesis, not a measured ranking of all QA teams' complaints.

## QA for AI applications: a later, distinctive extension

The same run/evidence model can support testing AI features, not only ordinary UI/API behavior. [Promptfoo](https://www.promptfoo.dev/docs/intro/) already provides open-source evaluations and red-team workflows; integrate a reviewed adapter rather than inventing a second evaluation engine.

Proposed checks: fixed datasets and expected tool calls; citation/source correctness; forbidden file/network actions; approval boundaries; cross-project memory leakage; provider/model regressions; latency and known usage limits. Deterministic assertions should be preferred where behavior is exact. Model-graded judgments need a visible rubric, scorer/version and human review of disagreements. Preserve sampled outputs and traces; do not turn an average score into a blanket safety claim. Run adversarial evaluations only against authorized test environments. This is P2 research/prototyping, after the basic QA workflow works.

Additional public documentation for BrowserStack and mabl could not be retrieved in this scan; no feature comparison or absence claim about those products is made here.

## Implemented first slice — 3 November 2026

The Tests workspace now imports genuine Playwright JSON execution reports, retains retry attempts and outcomes, opens supported screenshot evidence, launches an installed trusted-project trace viewer, and exports a human-editable Markdown bug report. Records and evidence snapshots persist per project. See [QA_RESULTS.md](QA_RESULTS.md) for usage, trust boundaries and limits.

Validation used a real local Playwright 1.64.1 run with deliberately seeded failure, retry/flaky, pass, skipped and expected-failure cases. The application's importer and UI preserved these separate outcomes, original assertion details, screenshots and source locations. A failed fixture test is intentional input, not a passing product test. Unit checks cover persistence, project isolation, artifact containment/hash checks, retry evidence and trusted trace launching. UI checks cover import errors, screenshot zoom, bug-report copying, tool switching and widths 320/390/768/900/1280/1920. Native export save dialogs and authenticated CI integrations were not exercised.

The wider capabilities proposed above remain a roadmap; this first slice does not implement an autonomous QA runner or certify application correctness.
