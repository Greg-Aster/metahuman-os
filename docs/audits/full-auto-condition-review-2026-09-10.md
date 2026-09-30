# Full Auto condition review — 2026-09-10

## Status: NEEDS CORRECTION

The inspected execution path remains integrated with editable workflows and one
durable graph scheduler. This review did not find a second active Full Auto graph
runtime. The installed system is nevertheless not a verified, coherent release:
the Site executes an older bundle while finite specialist jobs load newer source.
Actual specialist failures and misleading chat failures occurred in that release.
Source regression results are substantially better than the deployed evidence.

This is a focused condition review, not a final whole-repository, model-quality,
or physical-safety certification. No implementation, service configuration,
runtime state, dependencies, or hardware were changed. Only this review record
and an isolated read-only diagnostic under `/tmp` were added by the reviewer.

## Revision and evidence boundary

- Review started 2026-09-10 09:58 PDT; evidence collected through approximately
  10:12 PDT. Branch `main`, HEAD
  `b57d205895d785d96194b9b9893f7c0b07838447`; branch status reported `main...origin/main`.
- Before adding this report, the later inventory contained 221 dirty paths:
  184 modified, 21 deleted, 16 untracked. These changes predate this report or
  were made concurrently by other work. Git does not identify their individual
  authors. Do not attribute this mixed worktree entirely to Full Auto.
- Full Auto changes overlap graph runtime, editable graph JSON, intent/context,
  result contracts, persistence, and chat delivery. Other extensive changes concern
  training, Curator, model/adaptor approval, and profile reset. The Core manifest
  diff changes public exports, not dependencies; the lockfile is unchanged.
- Source continued changing: intent routing and its workflow test at 10:04:19;
  reset/checkpointer/UI work at 10:04:41; reset tests at 10:05:36. The initial
  workflow run preceded these edits. The affected intent/context and compatibility
  scenarios were rerun afterward, as were Core types and the architecture check.
  This is not a claim that every test passed against a frozen final worktree.
- The latest phase visible in code and process evidence is correction/regression
  verification, not a new isolated spike. Another full durable test process was
  running during the review; its eventual results are not included below.
- Root `AGENTS.md` and its maintained-surface, refactor, audit, and progress
  authorities govern this review. Excluded mobile/Code OSS implementations were
  not audited. Earlier spike-only approval restrictions are not reapplied.
- Runtime inspection used existing server logs, the Coordinator snapshot saved at
  09:54:02 PDT, host process identity, and a read-only SQLite connection at the
  canonical profile-resolved execution path. No live model or robot request ran.

## Confirmed findings

### F1 — High: source workers and the installed Site are different releases

- Owners/locations: `packages/core/src/queue/execution-engine.ts:737` and `:744`
  launch finite agents through `tsx` against current source;
  `packages/core/src/durable-execution/executable-version.ts:9`, `:26`, `:35`
  distinguish embedded build identity from source identity;
  `scripts/check-site-runtime.ts:17` verifies parity at startup;
  `packages/core/src/durable-execution/store.ts:246` rejects incompatible state.
- Installed evidence: the Site entry was built at 09:22:22 and its process started
  at 09:24:40. Its executable identity is
  `c4f3ae35423377af7363a6b3b9a3d972fb4e7137bf1b49ce7fb3b01ea4e816a5`.
  The same identity is saved in the affected parent execution. Source identity
  during review was initially `995313cc08445ba823581cdd935d9264975f04b9bff32e3cf5c9f14570180c64`,
  then `47818c60ca050106c446fb6cd196098a4d1e37a8a5788ce3af579ed28c511d5e`.
- Daydreamer failed at 09:49:53 and Curiosity Researcher at 09:53:22, both with
  `Saved execution does not match the executable graph/schema/node versions`.
  Both receipts identify the same durable parent. Curiosity's stack enters the
  source `resolveExecutionGraph`/`assertDefinition`, not the Site bundle.
- Consequence: the Controller can choose a legitimate specialist that cannot
  participate in its parent execution. More tests or a restart without matching
  deployment do not resolve that boundary. The version rejection protects state;
  disabling it would be the wrong repair.
- Smallest correction: finish the current repair snapshot and use the existing
  build/launcher to deploy matching Site and source-worker versions. Do not keep
  editing worker-visible production source during that verification session.
  Within existing launch/admission owners, ensure subsequent source drift is
  caught before admitting an incompatible specialist; no second launcher/runtime.
- Acceptance evidence: compiled-runtime parity, an actual source-worker child
  returning to its bundled parent using isolated data/effects, and same-build
  restart/result resumption. A negative drift test must preserve the checkpoint
  and block incompatible work, not rekey state or retry physical effects.

### F2 — High in the installed build; correction present in source: input handoff reported as chat failure

- Owner/location: `packages/core/src/api/handlers/persona-chat.ts:465`–`:486`;
  installed `apps/site/dist/server/chunks/persona-chat_B9z8bFvC.mjs:367`–`:374`.
- Both failed chat receipts in the inspected boot window report
  `Graph executed but produced no response`. Their saved Environment graphs
  completed `execution-input-out` with `sent: true`, selecting `user_steering`.
  The parent identity was retained. This is a committed handoff, not proof that
  the user message was lost or that a conversational answer was generated.
- Installed code accepts a silent waiting/action turn but has no handoff case.
  Current source emits `input_forwarded` and accepts the completed handoff without
  inventing speech. Its file was edited after the installed build.
- One earlier handoff also targeted an old incompatible execution, whose resume
  then failed. Current source checks compatibility during discovery and delivery;
  that correction is also not in the inspected running release.
- Consequence: the interface and Coordinator call a valid handoff a failure,
  inviting duplicate user retries and obscuring the separate resumption failure.
- Smallest correction: deploy and verify the existing source correction; do not
  add forced responses, another conversation buffer, or a fallback executor.
- Verification: `graph-outcome.spec.ts` passed all 13 tests, including the real
  handler boundary with committed/skipped/failed handoffs. Workflow compatibility
  and late-input scenarios passed with real saved graphs and controlled provider
  answers. Browser/stream delivery on the matching installed release is pending.

## Owner condition and limits

| Owner group | Independently inspected condition | Disposition / remaining evidence |
| --- | --- | --- |
| Robot Operator admission (`brain/services/robot-operator.ts:289`) | Signals an eligible saved wait; does not start another Controller while an execution remains active. Uses the Coordinator. Real service admission fixture passed. | Keep. Deployment parity and real session verification remain necessary. |
| Editable graph entry (`graph-runtime.ts:99`, `api/handlers/execute-graph.ts:55`) | Editor/API and Brain callers converge on `runGraph`; one LangGraph-backed scheduler executes the saved SvelteFlow graph. Named `executeGraph` dependency seams in finite agents delegate to `runGraph`, not another scheduler. | No duplicate execution owner found in inspected paths. This is not an exhaustive orphan inventory. |
| Durable store/checkpointer/outbox/recovery | Tests exercise real SQLite, ordered events, stale ownership, immutable outputs, terminal idempotency, recovery, and referenced blobs. SQLite and Coordinator commits remain explicitly separate. | Keep. Core and host boundary evidence must not be replaced by mocked model success. |
| User input, context, objectives | Full supplied dialogue reaches the selected model path; late input, taskless work, same-parent handoff, cancellation, and unfinished objectives have actual graph regressions. The latest intent edit was retested. | Repairs are in existing owners. No blanket history removal or deterministic movement selection was found in these changes. |
| Robot Status / Desire | Status projects the persisted execution; optional Desire remains a separate motivation lifecycle with bounded work and correlated review. | No evidence here that either reconstructs the parent execution or replaces graph decisions. |
| Bridge / direct stop | Bridge Out prepares/stages work rather than performing transport in the replayable node. `active-operator/mode-controller.ts:95` retains direct stop through `enqueueConnectedEnvironmentStops`, independent of LLM interpretation. Isolated Bridge/cancellation tests pass. | No live emergency stop, hardware fencing, or physical result was tested by this reviewer. |
| Model routing | Real graph integration tests use the configured router and exercise more than one configured provider; transport answers are controlled. | Preserves the existing router, but does not prove current trained/base model quality or every live provider. Concurrent training/provider changes require their own acceptance evidence. |

The current evidence does **not** support calling the tree generally free of
orphan code, hacks, or bugs. Conversely, 221 dirty paths do not establish bloat:
they include unrelated consolidation and 21 deletions. No new permanent parallel
graph runtime was found, and the architecture guardrail reports zero violations.

## Reproduced validation

From repository root, tests used isolated runtime roots and controlled transports.
No dependency installation or production build was performed.

| Command / file | Reviewer result |
| --- | --- |
| `node --experimental-test-module-mocks --import tsx packages/core/src/graph-executor.spec.ts` | 18/18 |
| Same runner, `packages/core/src/durable-execution/workflows.spec.ts` | 33/33; real saved graphs/router/SQLite/Coordinator, controlled model answers; includes a new-process restart |
| `node --import tsx packages/core/src/durable-execution/store.spec.ts` | 22/22 |
| Mock-enabled runner, `packages/core/src/durable-execution/recovery.spec.ts` | 11/11 outside sandbox; initial sandbox run was 10/11 because localhost bind was denied (`EPERM`), not an implementation assertion failure |
| Mock-enabled runner, `packages/core/src/api/handlers/graph-outcome.spec.ts` | 13/13 |
| Mock-enabled runner, `packages/core/src/api/handlers/environment-bridge-cancellation.spec.ts` | 7/7 |
| Mock-enabled runner, `brain/services/robot-operator.spec.ts` | 1/1 |
| Mock-enabled runner, `packages/core/src/environment-interface/compatibility.spec.ts` | Passed assertion script, including direct stop admission |
| Workflow rerun with `--test-name-pattern='intent and selected context retain supplied dialogue\|execution handoff checks current compatibility'` before the workflow filename | 2/2 after the concurrent intent edit; not counted as additional unique scenarios |
| `pnpm typecheck:core` | Passed twice, including after concurrent edits |
| `pnpm check:architecture` | Passed twice; zero current violations |
| `git diff --check` | Passed at inspection |

Total: 105 named scenarios passed, plus the Bridge assertion script. This is a
focused subset, not a reproduction of another agent's full-suite total. Passing
fixtures prove the specified execution behavior given supplied model choices;
they cannot establish intelligent, efficient goal completion by the live model.

## Installed runtime and efficiency evidence

- In the 09:24:41–09:54:02 boot-window receipt snapshot: 47 resume jobs
  (31 completed, 15 cancelled, one incompatible); two failed specialist jobs;
  three chat jobs (one completed, two failed); 12 completed environment jobs.
  These are finite-work outcomes, not objective-completion or physical-proof rates.
- The 12 environment jobs have distinct action IDs and include left/right turns,
  generated motion, and image capture. This sample is not an identical-action-ID
  replay loop. It does not establish that repeated semantic choices were useful.
- The profile execution DB occupied 430,698,496 bytes (about 411 MiB): 393 retained
  executions, 13,208 checkpoints, approximately 28.1 MB encoded checkpoint/metadata
  payload and 262.0 MB shared blob payload. One current multi-step parent had 712
  checkpoints and 31 graph namespaces, with depth 25. The byte categories do not
  include all SQLite/index/write/free-page overhead.
- These are size observations, not a growth-rate or memory-leak finding. No
  same-release before/after latency, CPU/RSS, tokens per objective, long-run growth,
  task-completion rate, or false-completion rate was established in this review.
  Active-state retention must not be weakened to make storage figures smaller.
- The server also logged a Whisper startup error. A Whisper process was present
  during host inspection; process existence alone is not STT readiness. This
  remains a separate voice-service diagnostic, not evidence of a second graph
  runtime. An `AbortError` explicitly caused by user-message preemption is not,
  by itself, another defect.

## Bounded next steps

1. Finish the current correction set and establish a stable release snapshot.
   Recheck the complete affected validation chain, build and verify through the
   existing deployment owner, then prove Site/source-worker parity. Do not weaken
   compatibility checks or silently migrate incompatible historical executions.
2. Verify the already-written input-handoff fix through the installed chat stream
   and an actual child worker returning to the same parent. Include restart and
   cancellation; leave physical effects isolated until that software path passes.
3. On the matching release, perform an owner-supervised real-model/robot session:
   original instruction, chosen action, correlated result, next assessment,
   correction, and terminal outcome must be traceable. Measure time/model calls
   and checkpoint growth over successive steps. Preserve useful action history;
   do not hide repeated decisions with movement bans or fabricated speech.

No additional product decision or architectural rewrite is justified by the
confirmed findings. The needed work is coherent deployment and bounded end-to-end
verification of the existing system, with remaining failures assigned to their
actual owners.
