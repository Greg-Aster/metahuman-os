# Durable execution implementation progress review

Latest: the integrated software suite passes 163/163, host-adapter tests 70/70,
all applicable type/source/contract checks and the isolated production build pass.
The final independent receipt/restart review also passes. The disconnect and late
cancellation conflict is corrected; final source was not deployed by this agent.
Physical behavior and restoration of the earlier overwritten runtime snapshots
remain unverified/unresolved respectively. Earlier snapshots below are historical.

## Historical snapshot and milestone — 2026-09-07 02:27 UTC

- Status: NEEDS CORRECTION; this is not a final-completion audit.
- Reviewed main at c57a56ff3fb59f534a20c5773a316f13fccae0e5.
- Snapshot: 2026-09-07T02:27:41.887Z; 45 modified tracked files and 17
  untracked implementation files, before adding this audit note.
- Existing dirty edits to durable-execution-independent-review.md predate this
  review. The history regression was committed before implementation; its current
  repair is part of the implementation. The other owner/workflow/dependency
  changes are consistent with the ongoing implementation, not reviewer edits.
- Observed milestone: integrated durable owner, Coordinator recovery and saved
  workflow migration. No current final-completion claim was established.
- Source hashes/status and isolated probes are retained in the temporary reviewer
  directory named metahuman-progress-review-gqSOAY (checkout-snapshot.json).
- Runtime/delegation, recovery, queue cancellation and workflow tests changed
  during review. Findings below were checked against the latest read of their
  affected code; newer edits require confirmation, especially integration tests.

## Independently verified progress

runGraph now routes through the durable facade; the existing graph executor uses
one LangGraph-backed scheduling program, including direct invocations. Saved
workflows use execution context, action-result waits and child workflow calls.
Direct action enqueue and feedbackGraph configuration are being removed from
the migrated nodes. This is integrated implementation, not another prototype.

Direct focused runs passed 9 store tests, 7 Coordinator admission tests and 10
executor tests. These cover immutable receipt identity, persistence failures,
ordered events, stale writers, version checks, referenced evidence, retention
guards, saved outputs, same-thread child resumption, conditional paths and loops.
They do not establish deployed transport safety or a full process-crash matrix.
An initial combined test runner was interrupted after slow filesystem work; its
empty aggregate output is not counted as evidence. The direct reruns are counted.

The actual History-to-Controller path retains the user instruction after 7, 8
and 12 assistant replies while keeping the configured eight-entry window.
Root Core and graph-runtime imports succeed. No implementation file, dependency,
service, firmware, commit or remote branch was changed by this reviewer.

## packages/core/src/queue/execution-engine.ts:36 and environment public imports

- Owner: Core execution and Environment Bridge public module boundary.
- Confirmed defect, high: importing environment-interface/index.ts alone throws
  ReferenceError at nodes/environment/movement-generator.node.ts:16 because
  ENVIRONMENT_MOTION_PLAN_JOINTS is not initialized. Importing all Core first
  masks it. The new eager runtime dependency creates a queue/runtime/node-registry
  cycle; the Bridge worker uses the public environment-interface subpath.
- Consequence: maintained direct import/worker paths can fail before startup.
- Smallest correction: break the eager cycle at the execution dependency boundary
  (resolve the runtime when executing work); consume pure motion contracts from
  their leaf module where necessary. Do not require callers to prime all Core.
- Verify: fresh processes import core, graph-runtime, environment-interface and
  the Bridge handler independently; then rerun graph and Bridge tests.
- Reproduction from repository: node --import tsx --input-type=module -e
  'await import("./packages/core/src/environment-interface/index.ts")'. Reviewer
  runs also used an isolated path root and disconnected their own event client.

## packages/core/src/durable-execution/runtime.ts:48 and :86

- Owner: durable facade settlement, coordinated with finite-work retry policy.
- Confirmed defect, high: a transient node exception settles the execution as
  terminal failed. Retrying the same admitted request throws "Execution has a
  terminal failure" before reaching that node. Isolated facade-retry.mts produced
  firstStatus=failed, plans=1, reviews=1 after the attempted retry.
- Consequence: Coordinator retry cannot resume the saved failed node. The passing
  executor test bypasses this settlement by calling executeGraph directly.
- Smallest correction: distinguish recoverable attempt failure from terminal
  execution failure and let Coordinator policy settle exhausted work; preserve
  the guard against reviving genuinely terminal or cancelled executions.
- Verify: fail once after a checkpointed plan through runGraph plus Coordinator
  retry; same execution succeeds with plan count 1, failed-node count 2. Also test
  exhausted attempts, cancellation and restart. Evidence: facade-retry-results.json.

## packages/core/src/nodes/environment/result-wait.node.ts:26-39

- Owner: correlated physical-result and observation handoff to the child graph.
- Confirmed defect, high: observation-before-completion returns actionContext
  status dispatched with observation feedback empty although a completed event
  was consumed. The saved result workflow feeds observation.feedback into its
  terminal-feedback node, so the received terminal report is not exposed there.
- A rejected, expired or cancelled action without another observation continues
  waiting: every action requires both report and observation unconditionally.
- Consequence: result interpretation sees stale/incomplete facts, or a definitive
  non-execution outcome waits indefinitely for evidence it need not produce.
- Smallest correction: combine correlated receipt/observation facts independent
  of arrival order and deliver the terminal action context explicitly; do not
  require a new frame for rejection/expiry/cancellation. Keep outcome_unknown
  uncertain until correlated reconciliation, without resending the action.
- Verify: both event orders, duplicates, terminal non-execution without a frame,
  and unknown-then-reconciled outcomes through the saved result workflow.
- Evidence: node-probes.mts and node-probe-results.json in reviewer evidence.

## Pending integration, not final-audit defects

Complete the above corrections, then continue the current migration. Body fencing
is tested in the store but acquireBody has no production caller yet; the send
node currently stages intents without body ownership fields. Wire and test that
boundary before treating physical integration as complete. Finish ordered user
correction/cancellation admission, startup/receipt recovery and removal of Robot
Operator's status-driven fresh-workflow continuation as those callers migrate.

The newly appearing workflows.spec.ts exercises saved graphs with controlled
provider transport. It was still being written and was not counted as passing
integration evidence. Extend that fixture with the failure/order/retry cases
above, rather than adding another harness or runtime owner.

No owner authorization blocker was found. Continue implementation within the
already authorized goal; no live robot action was attempted. git diff --check
passed for the inspected worktree. Full build, deployment and physical validation
remain outside this progress check.

## Progress refresh — 2026-09-07 17:56 UTC

Read-only implementation check on main at c57a56ff3fb59f534a20c5773a316f13fccae0e5,
with ongoing uncommitted integration changes (86 tracked files modified, plus
untracked runtime/test/workflow files). The earlier reviewer documents are not
implementation-agent changes. Observed stage: workflow integration and regression
hardening; no final-completion claim was established.

Independent checks in isolated temporary runtime roots:

- `node --experimental-test-module-mocks --import tsx packages/core/src/durable-execution/workflows.spec.ts`: 10/10 pass. Actual saved graphs and node/router/store/Coordinator implementations run with controlled provider transport. Includes shared Controller/Executor/Observer execution, result ordering, rejected action without image, retry and a fresh-process resumption. This is not live-model or physical proof.
- `node --experimental-test-module-mocks --import tsx packages/core/src/api/handlers/environment-bridge-cancellation.spec.ts`: 1/1 pass.
- Fresh-process public Environment interface import: passes; the earlier import-cycle reproduction no longer fails.
- `node --import tsx packages/core/src/queue/durable-admission.spec.ts`: 7/8 pass. The new stop test fails at line 155.

### packages/core/src/queue/durable-admission.spec.ts:155

- Owner: Coordinator stop/body admission regression test.
- Evidence: the test expects the pre-stop queued `next` action to become claimable after stop completion. `unified-queue-manager.ts:282` explicitly cancels that queued action when stop is admitted, so `claim(next.id)` correctly remains null.
- Consequence: the focused suite is not green; its final assertion would require reviving cancelled work. This failure alone does not establish a production body-lock defect.
- Smallest correction: assert that the pre-stop action remains cancelled; admit a distinct new action after stop admission, prove it stays blocked while stop is active, then becomes claimable after confirmed stop completion. Do not weaken cancellation or fencing to satisfy the old assertion.
- Re-review: rerun this suite and the Bridge cancellation test. Inspected test SHA-256: dd3c5f606de6c2b15158bc306daf615efbbab42745d265df8a695ad5abbef4d0; manager: 7caaab69df9fd4f193120d4be3ce89ecfbdf6c883aa8deab8246affd4dca9b85.

The saved-workflow retry and result-order/rejection regressions now pass, addressing
the earlier findings for those tested paths. Robot Operator's status-driven fresh
continuation has been removed in source, and body ownership is now wired into the
Coordinator. Neither change is blanket end-to-end safety approval. Full migration
coverage, broader validation, deployment and physical evidence remain unverified
by this refresh. Runtime/workflow/result-wait/engine hashes were unchanged across
these checks; later edits need confirmation. No owner-input blocker was found.

## Closeout progress check — 2026-09-07 19:20 UTC

Inspected main at c57a56ff3fb59f534a20c5773a316f13fccae0e5, now with 100
tracked modified files plus untracked implementation/artifact/test files. Existing
reviewer documents remain separately authored. No production code was edited.
The observed milestone is integrated workflow/caller regression hardening, not
a new prototype. Editor/API changes distinguish saved waits from completion and
preserve global output-delivery failures; the root test command now includes the
durable regression suite. These are relevant migration changes, not evidence by
themselves that migration is complete.

Independent direct runs, using `node --experimental-test-module-mocks --import tsx`
for each isolated spec (the queue spec needs only `--import tsx`):

- `packages/core/src/queue/durable-admission.spec.ts`: 9/9 pass; previous stop-test failure corrected without reviving cancelled motion.
- `packages/core/src/durable-execution/recovery.spec.ts`: 4/4 pass.
- `packages/core/src/api/handlers/graph-outcome.spec.ts`: 11/11 pass; actual delivery-failure state is replayed at mocked runtime consumer boundaries, not a live UI test.
- `packages/core/src/durable-execution/workflows.spec.ts`: 18/18 pass, including finite specialist return, user steering/cancellation, continued Goal Review and fresh-process resumption. Providers remain controlled fixtures; no physical actions occurred.

Runtime/store/recovery/workflow/queue hashes were stable throughout this check.
Workflow spec SHA-256: 2c4adb0c475a4fcf320b526424fa39a5be4635ddd36cc709d1a6609c207d490f.
`git diff --check` passes. The complete root suite, full build, deployed runtime,
performance and physical boundary were not verified by this progress check.

Medium reporting issue: `llm-agent-vs-metahuman-autonomy-analysis.md:1910-1912`
still presents production migration as not begun and awaiting separate approval,
contrary to current owner authorization and the actual diff. Mark that passage
historical and publish one finite closeout list tied to existing acceptance
requirements. Do not add new approval phases or broaden implementation scope.
Finish the listed integration/deletion/validation items, fixing only demonstrated
acceptance failures, and hand off remaining external evidence gaps explicitly.

## Live user-test failure — 2026-09-07 19:42 UTC

Status: NEEDS CORRECTION; isolated regression passes did not establish deployed
robot readiness. Inspected committed revision d7dbb7bababd524f595051eff5bd24bdad4cfeb5;
only this reviewer document was dirty. The production Site process started after
its current build, and its error stacks execute the LangGraph-backed bundle.
No commands, restarts, queue mutations or production source edits were performed.
The profile execution database was opened with SQLite readonly/fileMustExist,
using the canonical profile path resolver; no runtime-store constructor was used.

### High: replayed observation disconnects the Bridge

- Locations: `packages/core/src/environment-interface/store.ts:471-474`, `packages/core/src/durable-execution/store.ts:294-299`, and observation delivery in `brain/agents/environment-bridge/core.ts:748-787`.
- Live evidence: the Bridge error log repeatedly reports HTTP 500 `Event ID reused with different content`, interleaved with repeated ready/reconnect messages. The same camera observation ID remains the latest snapshot while receipt timing changes. Its first persisted execution event includes Bridge/queue timing enrichment absent from the later replay snapshot. Source hashes the entire event, including observation metadata, under the stable observation ID.
- Consequence: a duplicate observation cannot be acknowledged successfully; reconnection replays it into the same conflict. A later camera command failed because the adapter disconnected before acceptance. This is an event-ingestion/replay failure, not proof of missing robot movement capability.
- Smallest correction: make the immutable observation event independent of per-delivery timing/enrichment while retaining meaningful content-conflict detection. Reconcile the already persisted affected event through the same owner; do not discard the database or mint new IDs for retries.
- Verification: replay one observation through the actual API/Bridge boundary after reconnect, with first-delivery timing enrichment and later missing/changed receipt timing; assert one admitted event, acknowledgment on both deliveries, no connection failure and no repeated physical dispatch. Preserve rejection of genuinely different camera/action content under the same ID.

### High: result resumption violates its event cursor

- Location: `packages/core/src/graph-executor.ts:801-806`, with Coordinator `graph.resume` delivery.
- Live evidence: `logs/server.log` contains repeated `Resume event is not the next admitted execution event` from `environment_result_wait`; the persisted Coordinator history records failed resume work with that error. A separate resume job reports `Dispatch ... is not eligible (admitted)`.
- Consequence: correlated results do not reliably advance the saved workflow. Exact internal cause requires an isolated replay of the observed sequence; a passing manual-resume fixture is insufficient.
- Correction/test: reproduce through the actual Coordinator engine with separately admitted result/observation resume jobs, retries and already-consumed events. Repair ordered consumption/stale wakeup handling at the execution owner, preserving monotonic sequence and duplicate idempotency rather than removing the assertion.

### Additional observed failures and evidence limits

The first completed camera action's result-review execution failed with `Robot
action result requires one current execution objective`; readonly SQL confirms
that execution has no objective row. Standalone actions may legitimately have no
objective, so this is not proof that an existing objective was lost. Verify the
standalone-action model/review contract without fabricating an objective or
weakening validation. Full-mode history also contains invalid model JSON and
missing high-level instruction failures. The user's reported hallucination was
not independently evaluated from its exact utterance/evidence.

The recorded real session advertises movement and an authenticated body. Recent
real-session work shows camera requests, not successful movement. An older
synthetic `fake`/`body` session and uncertain test command also remain in runtime
state; those are not physical evidence and their author is not established here.
Keep Full Auto paused pending repair and controlled verification. These findings
are bounded corrections to the existing runtime, not a new architecture phase.

## Software verification before live follow-up — 2026-09-07

The canonical graph path now executes through one LangGraph scheduler and a
profile-resolved SQLite checkpoint/event/outbox owner. The existing Coordinator
still owns finite work and body admission. The real Controller, Executor,
Observer, Movement, Reflection, Action Result and Goal Review graphs share their
parent execution; model selection still goes through the existing router.
Robot Status projects decisions from that execution, rather than reconstructing
the objective. The editor keeps its saved JSON, properties and conditional paths.

Removed or consolidated: the previous graph execution loop, feedback-triggered
fresh-graph re-entry, Robot Status objective reconstruction, independent Full-mode
Goal Review polling, and direct body dispatch from graph nodes. There is no
parallel durable runtime or round-robin task chooser. Memory and optional Desire
ownership remain unchanged.

Independent review exposed and verified corrections for checkpoint recovery,
ordered/idempotent events, executable version admission, nested and finite-child
namespaces, physical result/observation ordering, cancellation/fencing, retained
evidence, duplicate buffer receipts, and false-success reporting at graph callers.
The final late-feedback correction accepts the historical result of an already
claimed action after parent failure/cancellation without reviving that parent or
permitting new dispatch. Cancelled work proven never started can be retired;
possibly executed work remains unresolved until its correlated result arrives.

Final commands and full logs are in
`/tmp/metahuman-durable-final-verification-CwhSyc/README.md`:

| Verification | Result |
| --- | --- |
| `pnpm test:durable-execution` | 152 passed; 0 failed, skipped or cancelled |
| Actual saved workflows, independently rerun | 18/18 passed, including fresh-process continuation and current-router provider substitution with mocked transport |
| Graph outcome/API callers, independently rerun | 11/11 passed |
| Ainekio host adapter/emulator owner tests | 70/70 passed; no physical robot |
| Core, Brain, CLI, shared agent runtime, local-model service, scripts, tests and Site typechecks | Passed; Site: 364 files, 0 errors/warnings/hints |
| Saved graphs, executors, node defaults, architecture | 38 valid graphs, 369 nodes with executors, 0 architecture violations |
| Model defaults, Dual/Environment graph contracts, TTS ownership/client tests | Passed |
| Isolated Site build and built-runtime SQLite/restart smoke | Passed; bundled executable hash matches source |
| Both repositories' `git diff --check` | Passed |

The implementation was committed by another actor during final validation as
`d7dbb7bababd524f595051eff5bd24bdad4cfeb5`; this implementation agent did not commit
or push. Reviewed source hashes remained unchanged. Host-adapter changes remain
in the Ainekio worktree; unrelated `12servo/` content was not changed.

Independent reproduction evidence remains at
`/tmp/metahuman-workflow-milestone-review-4w6dm4/README.md`,
`/tmp/metahuman-late-feedback-review-ujXPCv/README.md`,
`/tmp/metahuman-adapter-corrected-4ziFS7/README.md`, and
`/tmp/metahuman-finite-child-review-NFPYvC/README.md`.
The original spike and review were preserved, not regenerated, under ignored
`out/autonomy-spike-review-2ehVR5/`.

Storage measurement on the same mocked multi-attempt visual workload reduced
SQLite allocation from 52,195,328 to 9,863,168 bytes through referenced structured
checkpoint data. It did not demonstrate an overall latency improvement. No live
model task-completion rate or comparison with the old production runtime is
claimed. An isolated build is not a deployed-service or browser-interaction test.
The root build chain was not run because it includes mobile validation and writes
the installed Site build; applicable checks and a separate `/tmp` build were run.

### Deployment boundary and outstanding installation recovery

An earlier reviewer fixture used a nonexistent test root; the old root resolver
fell through to this installation and overwrote `logs/run/environment-bridge-state.json`
and `logs/run/queue/work-items.json` with synthetic data. The resolver now rejects
that invalid configuration, and the regression passes. Their original snapshots
were not found. During final verification another actor restarted Site and the
host adapter; normal services have since updated both files. Their current live
contents must not be quarantined using the earlier synthetic hashes. This agent
has not deleted or reconstructed them. Recovery of the original snapshots would
require supplied backups. Earlier synthetic trace/event publication was disclosed;
no installation logs were deleted.

This agent did not restart installed services, change firmware or send live robot
commands. Read-only inspection after the external restart found Environment
resumption failing with `Resume event is not the next admitted execution event`
and mode cancellation failing when LangGraph received a plain string reason.
These are concrete additional failures under correction within the same goal,
not covered by the earlier passing matrix. Malformed model outputs were also
reported truthfully; no fabricated successful actions were substituted.

## Preserved 160-test software snapshot — 2026-09-07

The additional failures above are corrected at their existing owners:

- **Bridge observation replay:** the immutable event excludes delivery timing,
  while the live snapshot retains those diagnostics. Older timing-enriched events
  reuse their original bytes and receipt after comparison; changed camera/action
  evidence still rejects before replacing the valid snapshot. No live database
  migration or discarded evidence was needed.
- **Result waits:** every wait keeps its interrupt position on replay. Queued
  events feed the saved wait in order, including separately arriving results and
  images. A definitive failed capture can reach review without a nonexistent
  image. Obsolete already-admitted wakeups retire after consumption or parent
  termination; they do not retry or relax physical-action admission.
- **Cancellation/admission:** arbitrary abort reasons become typed errors.
  Already-waiting and pre-aborted executions honor interruption without admitting
  pending actions. Invalid or unpaired wake metadata rejects before changing a
  saved objective or creating an orphan execution. Worker interruption parks the
  objective; semantic cancellation remains distinct.
- **Action Result context:** current action identity comes from its correlated
  action ID, not an autonomy-only cycle ID. Standalone user actions therefore
  reach review as current evidence. Without an objective, the result contract
  permits response but no nonexistent-objective update; no goal is fabricated.
- **Controller result reporting:** a selected branch lacking a required Bridge
  input reports its actual skipped result/reason. The LLM's choice is retained;
  failures and missing nodes are not turned into success or another chosen task.

An aggregate-only fixture failure was also reproduced: its fake adapter waited
until the parent graph returned before claiming a command, exceeding the existing
two-second admission deadline under load. The fixture now claims on the real
subscriber notification. Production expiry and exact effect assertions remain
unchanged. The original failing run is preserved.

Final evidence and exact commands:
`/tmp/metahuman-durable-post-live-verification-XS55Iz/README.md`.

| Check | Final result |
| --- | --- |
| Integrated durable suite, 21 test files | 160/160 passed; no failures, skips or cancellations |
| Actual saved workflow cases within that suite | 18/18, using existing nodes/router with mocked external transport |
| Host adapter/emulator tests | 70/70; no physical robot |
| Eight applicable package typechecks | Passed; Site 364 files, zero errors/warnings/hints |
| Graph/executor/default/architecture checks | 38 valid graphs, 369 nodes, zero missing executors or architecture violations |
| Model, Dual/Environment and TTS contracts | Passed |
| Isolated Site production build | Passed, 21.63 seconds; installed build untouched by this agent |
| Compiled runtime/native SQLite/fresh-process replay | Passed; configured output and execution/checkpoint identity preserved; executable hash matches source |
| Both repositories' whitespace checks | Passed |

Independent probes additionally cover timing-only and legacy image replays,
11 meaningful-content conflicts, event-commit/snapshot-write failure recovery,
multiple successive action waits, unrelated events, stale wakeups, cancellation
at later waits, and unchanged physical-admission controls. Reproduction scripts,
original failures, corrected results and stable source hashes are indexed in
`/tmp/metahuman-observation-independent-6ZlRxH/README.md`,
`/tmp/metahuman-wait-order-independent-myBhzV/README.md`, and
`/tmp/metahuman-stale-wake-independent-3bY6gP/README.md`.

The source archive and dependency lockfile are in the final evidence directory.
Earlier spike/review archives remain preserved unchanged. No additional runtime,
scheduler, objective store, command-specific behavior or forced conversational
response was introduced by these corrections. The superseded paths listed above
remain removed. Concurrent sidebar, model-registry, Desire-generator and unrelated
Ainekio work was preserved, not included as this goal's implementation.

The final source corrections were not deployed by this agent. There is no claim
of measured live speedup, real-model success rate, browser behavior or physical
safety certification. The earlier overwritten installation snapshots remain
unrecovered; normal services have since changed the live files, which were left
intact. No installed services were restarted, firmware edited, or physical
commands sent by this agent during verification.

## Final receipt/restart correction and integrated verification — 2026-09-07

The externally restarted installation exposed a real conflict beyond the preceding
matrix: Bridge reported a lost acknowledgement as definite failure, then rejected
the adapter's later cancellation. Bridge now distinguishes known preparation
failure from uncertain delivery. Core records historical feedback separately from
permission to execute; denied acceptance returns no action payload, including to
an older Brain client. Terminal parents remain terminal and cannot dispatch anew.

One bounded legacy reader recognizes old untyped Bridge delivery-event IDs only
with the exact Coordinator claim. It appends a linked authoritative adapter result
without rewriting the original event; genuine terminal conflicts still reject.
Remove that recognition after the last pre-provenance delivery failure has been
reconciled or retired. Late transport diagnostics cannot overwrite a verified
physical result or trigger another review.

Restart testing also showed that Coordinator import discarded the start timestamp
proving a body action was claimed. Recovery now preserves that historical timestamp
while parking the action as uncertain. It neither redispatches nor weakens claim
validation. Non-body retry/recovery behavior is unchanged.

Final combined evidence and exact commands:
`/tmp/metahuman-durable-integrated-verification-QRxqAh/README.md`.

- 163/163 integrated tests across 22 files, including 18 actual saved-workflow
  cases and the maintained Bridge producer; no failed/skipped/cancelled tests.
- 70/70 host-adapter/emulator tests; no physical robot invoked.
- Eight applicable typechecks, 38 valid graphs/369 registered nodes, defaults,
  architecture/remote safety, model/graph/TTS contracts and whitespace checks pass.
- Isolated Site build passes. Its compiled runtime loads native SQLite and
  preserves the same configured output, execution and checkpoint after restart;
  its executable hash matches source. Installed build untouched by this agent.
- Independent final review passes nine API cases, the original restart probe,
  six non-body recovery controls, 15 Store and nine Coordinator tests. Reproductions
  and final source hashes: `/tmp/metahuman-late-result-independent-15mjdw/README.md`.

The evidence bundle preserves exact sanitized source, lockfiles, baseline patch,
commands and full results. The original spike/review artifacts remain unchanged.
No competing scheduler, graph runtime, objective owner or command-specific choice
was added. Superseded execution paths listed earlier remain removed. Unrelated
concurrent work is preserved. No commit, push, service restart, firmware edit or
live robot command was performed by this implementation agent. Final deployment,
browser/physical behavior and real-model performance are not claimed; the earlier
overwritten installation snapshots still require backups to recover.

## Independent user-incident review: repeated speech (2026-09-07 20:58 UTC)

**Confirmed high: durable TTS IDs cannot be acknowledged by the existing API.**
Inspected `main` at `d7dbb7bababd524f595051eff5bd24bdad4cfeb5` with concurrent
uncommitted implementation changes; this review changed no production files.
`packages/core/src/durable-execution/coordinator-outbox.ts:50` admits local TTS
using the durable effect ID. `packages/core/src/api/handlers/tts-queue-stream.ts:24`
still accepts only `^tts-[a-zA-Z0-9-]{1,160}$`; line 228 rejects the new IDs before
either lease renewal or completion. The installed 13:51:57 PDT Site build contains
the same validator. `TTSQueueConsumer.svelte:103` renews during playback and line
126 submits completion, but the server cannot accept either request.

Live evidence: a recent 61-character utterance had one matching persisted chat
entry and one speech delivery retried three times, ending in `retry-limit`.
Additional recent deliveries show the same retry pattern. Profile speech routing
was `kokoro` / `local`, not a Bridge `speak` action. The chat insertion path in
`useMessages.ts:77` does not remove repeated text; buffer idempotency prevents
duplicate admission of the same durable entry, not new distinct messages.

Isolated reproduction: with `METAHUMAN_ROOT` set to a fresh temporary directory
and network forbidden, invoke `handleTtsQueueDelivery` with an authenticated test
profile, a UUID lease token, and an actual admitted durable ID shaped as
`<execution-uuid>::tts-out:1:effect:0`. Both `renew` and `complete` return 400,
`A valid TTS itemId is required`, before touching a queue. No live API calls,
speech requests, robot commands, or service changes were made by this reviewer.

Smallest correction: reconcile durable queue admission and delivery API identity
contracts, including already-persisted pending items, without clearing user data,
weakening lease ownership, or adding a second TTS path. Add an isolated integration
test exercising actual durable local-TTS admission, claim, API renew, API complete,
and repeated outbox delivery; assert one queue item, one chat entry, successful
acknowledgement, and no later re-lease. Include nested child-workflow IDs and
existing legacy IDs. Browser audible-once proof remains a separate final check.

## Independent completion review — 2026-09-07 21:16 UTC

**Status: NEEDS CORRECTION.** The integrated architecture is substantially
implemented; the owner-facing end-to-end goal is not yet demonstrated complete.
This supersedes the earlier software-only completion wording for owner sign-off,
not the historical test results. No production source, dependencies, services,
firmware, commits or robot actions were changed by this reviewer.

### Revision, attribution and scope

- MetaHuman: `main`, `d7dbb7bababd524f595051eff5bd24bdad4cfeb5`, compared with
  implementation baseline `c57a56ff3fb59f534a20c5773a316f13fccae0e5` and the dirty
  working tree. Review ran from 21:00 UTC; the final inventory has 34 modified
  tracked paths and one untracked TTS API test. Nothing was discarded.
- Ainekio adapter: `0592ca4d0cd008dbec2c4f0495e86b96effb8dd0`, with existing dirty
  adapter/service/tests and untracked receipt owner/test. `12servo/` was excluded.
- The implementation's 20:53:50 UTC manifest has 140 source entries. Current
  hashes match all listed entries except this shared progress record and root
  `package.json`. The subsequently added TTS API fix/test are outside that older
  verification snapshot. Sidebar/style, model-registry, Desire and installation
  setting changes predate this review and were preserved, not attributed to the
  durable implementation merely because they are dirty.
- This reviewer appended findings here and created an isolated diagnostic under
  `/tmp/metahuman-completion-review-bBGoUT/`; implementation files changed during
  review by other actors. The initial TTS test lacked a scheduler property and
  caused a typecheck failure; that draft was corrected and the final typecheck
  was rerun successfully.

### Independently rerun acceptance evidence

From the repository root, use `node --import tsx FILE` for Store, Coordinator and
cancellation, and `node --experimental-test-module-mocks --import tsx FILE` for
the other JavaScript owner fixtures below. Fixtures resolve temporary runtime
roots; physical/provider transport is controlled. These are current reruns, not
copied totals from the implementation report.

| Owner file | Result and covered behavior |
| --- | --- |
| `packages/core/src/durable-execution/store.spec.ts` | 15 passed: checkpoints/intents, event/CAS identity, competing writers, versions, terminal receipt safety, referenced data and retention |
| `packages/core/src/queue/durable-admission.spec.ts` | 9 passed: separate-store durable admission, persistence failures, restart, terminal deduplication, cancellation and stop preemption |
| `packages/core/src/durable-execution/recovery.spec.ts` | 5 passed: receipt recovery, isolated failure handling, uncertain work and stale wakeup retirement |
| `packages/core/src/graph-executor.spec.ts` | 14 passed: configured-node resumption, same-parent children, ordered result/image delivery, conditional/control/loop/skipped semantics and cancellation |
| `packages/core/src/durable-execution/workflows.spec.ts` | 18 passed: actual saved graphs, finite specialist, process restart, original-input steering/cancellation, provider substitution and failure propagation |
| `packages/core/src/api/handlers/graph-outcome.spec.ts` | 12 passed: API/editor/chat callers distinguish waiting and global failure from completion |
| `brain/agents/environment-bridge/core-lifecycle.spec.ts` | 2 passed: actual Bridge producer with mocked transport, ambiguous delivery and explicit pre-wire permission |
| `packages/core/src/api/handlers/environment-bridge-cancellation.spec.ts` | 1 passed: persisted cancellation stream and replay until terminal feedback |
| `packages/core/src/api/handlers/tts-queue-stream.spec.ts` | 1 passed: actual graph/outbox/queue/API renewal and completion, reconnect, old IDs and ownership controls |
| `packages/core/src/environment-interface/compatibility.spec.ts` | Standalone owner fixture passed, including immutable observation replay and late receipt reconciliation |

Total: **77 named JavaScript tests**, plus the standalone compatibility fixture.
`pnpm typecheck:core`, `pnpm check:architecture`, `pnpm validate:graphs` (38 valid)
and both repositories' `git diff --check` passed. The older eight-package/build
results were inspected as evidence but were not all rerun in this review.

Host command, from Ainekio, with `PYTHONDONTWRITEBYTECODE=1` and the documented
Slave/software, Master, Emulator and Emulator/tests `PYTHONPATH`:
`python3 -m unittest -v test_action_receipts test_environment_adapter test_environment_speech`.
**42 passed in 2.012 seconds**, covering real adapter receipt/fencing logic with
fake robot connections. The restricted run stalled and was interrupted; the
successful rerun used the approved unrestricted test environment. No firmware or
physical robot was exercised.

### Confirmed remaining defects and completion gaps

1. **High — live Full Controller decisions repeatedly fail validation.**
   `nodes/robot-operator/autonomy-controller-parser.node.ts:123` is the rejecting
   boundary, not an established root cause. Read-only Coordinator history from
   21:00–21:08 UTC contained 37 Controller jobs: 34 failed and three completed
   finite invocations. Failures included non-JSON output, missing executor
   instruction and backend unavailability. A correlated SQLite checkpoint had a
   completed LLM node whose 524-character response ended inside a JSON string;
   independent `JSON.parse` reported an unterminated string. The saved graph
   requests JSON (`etc/cognitive-graphs/robot-autonomy-controller-mode.json:252`)
   through the current router. The truncation/transport/configuration cause is
   not yet established. This is an observed integration failure, not evidence
   that the strict parser should be loosened. Reproduction/filtered evidence:
   `node --import tsx /tmp/metahuman-completion-review-bBGoUT/live-summary.mts`
   (reads the current window, so later totals may differ).
2. **High — verified TTS source correction is not in the installed build.**
   The correction at `api/handlers/tts-queue-stream.ts:227` was independently
   verified during this review. At 21:15 UTC the installed Site entry still had
   mtime 20:51:57 UTC and `astro_BWNW0kj9.mjs:25765` still required the obsolete
   `tts-...` ID regex. Thus source-level success cannot establish audible-once
   behavior for the user's current browser. The previous section's source defect
   is corrected; its deployment/physical-delivery conclusion remains pending.
3. **Pending evidence — end-to-end physical and performance acceptance.**
   Recent receipts include both a completed robot command and a camera request
   expiring before dispatch. A terminal transport receipt does not establish
   semantic objective completion or physical safety. Current-source browser
   round-trip, controlled Reactive/Full completion, direct stop, restart and
   reconnect require correlated deployed evidence. The implementation explicitly
   disclaims those checks. Existing synthetic storage measurements are not a
   before/after real-model completion-rate or latency study; no speedup is accepted.

### Architecture and bounded correction directives

The canonical path remains editor/API/agents → `runGraph` → durable owner → one
LangGraph-backed SvelteFlow scheduler. SQLite owns continuity/events/intents;
Coordinator owns finite admission/receipts/body leases; Bridge and the host
adapter own transport and final fencing. Robot Status is projected. Model routing,
memory and optional Desire remain in their existing owners. The removed graph
loop, fresh feedback-graph entry, status-derived objective reconstruction and
independent Full Goal Review polling are not new parallel active paths. The
direct `ModeController.emergencyStop` still bypasses model interpretation and
graph resumption. These source findings are not firmware/physical proof.

- **Controller correction:** replay a sanitized real failing provider response
  through the existing router and saved Controller graph; establish whether
  output limits, stop handling, JSON-mode transport or configuration caused the
  invalid result. Repair only that demonstrated owner/contract. Do not fabricate
  JSON, silently select another task, weaken strict validation or add a second
  runtime. Verify valid, truncated and unavailable-provider cases, then provide
  correlated real-model end-to-end results for re-review.
- **Release closeout:** include the now-passing TTS fix/test, build the exact
  reviewed source and deploy through existing lifecycle owners with affected
  executions handled under the existing version policy. Do not reset live
  checkpoints/receipts or firmware. Verify old pending IDs and nested IDs through
  the actual completion API, browser audible-once playback, and matching running
  build identity. Then provide controlled Reactive/Full, restart/reconnect and
  direct-stop evidence. Reuse the existing test/owner paths; no broad rewrite.
- No additional coding authority is needed. Historical overwritten installation
  snapshots remain a separate disclosed data-recovery issue; recovering their
  exact prior contents needs backups, not guessed reconstruction.
