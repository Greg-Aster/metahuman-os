# Durable execution implementation progress review

## Snapshot and milestone

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
