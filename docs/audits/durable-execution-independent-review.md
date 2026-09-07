# Durable execution independent re-review

Review date: 2026-09-06 (installation timezone).

### Verdict

FAIL — architecture or safety gate failed

### Executive summary

Two different experiments now exist: the original durable checkpoint/outbox/fake-body
runtime, and a separate saved-graph/model-router comparison. The follow-on comparison
is useful evidence, not a correction to the original runtime. All seven original
source/manifest files match the preserved hashes. Independent reruns still reproduce
dispatch after cancellation, failed result-checkpoint recovery, stale checkpoint
updates, event collisions, stale fencing, and false completion from unrelated
reconciliation.

The new comparison passes 11 paired scenarios and runs nine actual child-graph
invocations across five saved workflows in one thread through two same-process
interrupt/resume cycles. Provider transport, Work Coordinator submission, Bridge,
buffers and other external boundaries are mocked. It does not establish a durable
production owner or crash-safe execution of those actual graphs.

No production migration is approved. These findings reject the current spike's
acceptance claim, not LangGraph as a technology.

### Evidence and reproduction

Repository baseline: `8b7809fc485a1d7b2a6da32c16a843b01621e2d7`.
Current HEAD: `464ecf39befb299bd23dfb67257cdfaf752473c0`.
At review start, the only tracked dirty file was the autonomy-analysis report:
50 additions and 35 deletions. No untracked maintained source was present.
Root AGENTS.md was the only applicable repository instruction file found.
The maintained-surface, refactor-blueprint, audit-protocol and consolidation
authorities were checked; they were unchanged.

Evidence aliases:

- S: original `metahuman-langgraph-spike-20260906` temporary directory.
- F: preserved follow-on `out/autonomy-spike-review-2ehVR5/review`.
- E: fresh reviewer directory `metahuman-durable-rereview-FEctCK` under the system temporary directory.
- R: E/`reviewer-rerun-wNPVUT`.
- A: fresh original matrix, S/`runs/run-1788741315373-d7656b2c`.
- C: E/`generated/graph-results.json`, `acceptance.json`, `negative-results.json`.
- P: E/`generated/parent-results.json`.
- H: E/`generated/history-results.json`.

The complete local path/size/SHA256 inventory is E/`artifact-inventory.md`
(679 artifact rows; excludes installed dependency internals, which are represented
by the manifests and lockfile). It distinguishes original, preservation-bundle
and fresh-review artifacts by their root. Generated database/log/ledger files are
local evidence, not proposed maintained source.

Reproduce in a NEW diagnostic directory using copies of F's five .mts modules,
`build-review.mjs`, `run-comparison.mjs`, and `rerun-review.mjs`.
Use existing dependencies; do not install or overwrite preserved evidence.

```sh
METAHUMAN_REPO_ROOT="$REPO" SPIKE_DIR="$SPIKE" node build-review.mjs
node run-comparison.mjs
METAHUMAN_REPO_ROOT="$REPO" SPIKE_DIR="$SPIKE" REVIEWER_EVIDENCE="$PRIOR_REVIEW" node rerun-review.mjs
```

The four independent scripts expose the original private functions by transpiling
source in memory and replacing only its main invocation with exports. The crash
probe kills a child immediately after the original result checkpoint commits.
The version probe additionally changes GRAPH_VERSION in memory. Read their JSON
observations: exit zero means the diagnostic ran, not that the tested invariant passed.

The supplied original matrix was also rerun from S:

```sh
node --import "$REPO/node_modules/tsx/dist/loader.mjs" durable-runtime-spike.mts run-all
```

That run created A; existing source, dependencies and prior run directories were
not overwritten.

Original runtime SHA256:
`0f76e10200c284ef9b6e02286d5ad8bbe13407994cc1fae1c5fa50b27adaec2a`.
Original parity adapter SHA256:
`d3fb52fa21a4fbfdfbb24f50f9179d366e3c49b3f355ead16b23546e574959e7`.
The sealed original archive hash was independently verified as
`605537f63dd9e4f5221cbad33fd9190e8f32ed76ae396b7e4f65fe1ce082b155`.
Reversing the documented path substitutions reproduces all seven original files.

### Changed files

Git alone does not establish agent authorship. Attribution below combines the
pre-spike worktree observations, current diff, commit and preserved byte hashes.

| File | Purpose and classification | Within isolated spike? |
| --- | --- | --- |
| docs/audits/llm-agent-vs-metahuman-autonomy-analysis.md | Implementation report and proposed migration map; current follow-on edits withdraw hard-gate claims | Yes, documentation; one contradictory adoption paragraph remains |
| etc/cognitive-graphs/robot-autonomy-controller-mode.json | Production Controller history limit 0 to 8, committed in 464ecf39 | Pre-existing separate work, not attributable to the spike |
| packages/core/src/nodes/robot-operator/context-builder.node.ts | Production latest-user-preserving window removed in 464ecf39 | Pre-existing separate work, not attributable to the spike |
| packages/core/src/nodes/robot-operator/boredom-autonomy.spec.ts | Production-area tests adjusted for the history change | Pre-existing separate work, not attributable to the spike |
| docs/audits/durable-execution-independent-review.md | This reviewer-authored audit record | Yes; audit-only, not an implementation correction |
| S/durable-runtime-spike.mts | Checkpointer, event table, outbox, relay, Coordinator wrapper, fake body, hardcoded graph and crash tests | Experimental; unchanged in follow-on |
| S/svelte-flow-parity-spike.mts | Original synthetic scheduler comparator | Experimental; unchanged, configuration defect remains |
| S/import-probe.mts | Import feasibility probe | Experimental |
| S/api-probe.mjs | LangGraph/checkpointer API probe | Experimental |
| S/package.json | Isolated dependency manifest | Experimental only |
| S/pnpm-lock.yaml | Isolated dependency resolution | Experimental only |
| S/pnpm-workspace.yaml | Isolated native-build policy | Experimental only |
| F/candidate-adapter.mts | Separate acyclic compiler using actual NodeDefinitions and materialized properties | Experimental comparison, not durable-runtime repair |
| F/comparison.mts | 11 paired cases, history regression, validation and pre-abort probes | Experimental tests |
| F/parent-comparison.mts | Fixed two-attempt parent sequence, child namespaces and measurements | Experimental tests |
| F/graph-fixtures.mts | Scripted observations, model completions and task fixtures | Experimental fixtures |
| F/runtime-mocks.mts | Isolated paths, provider/effect/telemetry boundaries | Experimental mocks |
| F/build-review.mjs | Bundles actual core/node implementations with explicit mocked boundaries; records hashes | Experimental build helper |
| F/run-comparison.mjs | Runs comparison and saves outputs | Experimental helper |
| F/rerun-review.mjs | Copies and reruns independent failure probes in a fresh directory | Experimental helper |
| F/prepare-original.mjs | Restores sanitized source into a new destination | Preservation helper |
| F/run-original.mjs | Runs relocated original matrix | Preservation helper |
| F/package-review.mjs | Packages sanitized sources and raw evidence | Preservation helper |
| F/README.md | Reproduction instructions and limitations | Experimental documentation |
| F/preservation.json | Original/sanitized hashes and provenance | Evidence metadata |
| out/autonomy-spike-review-2ehVR5/preserve.mjs | Reversible source preservation | Evidence helper |

Derivative files are individually enumerated in E/artifact-inventory.md:
`original-source/` copies the seven S source/manifest files;
`reviewer-source/` preserves previous reviewer scripts/results;
`shareable-jkVr6W/` contains path-sanitized copies, six saved graph JSON fixtures
(environment, controller, observer, executor, action-result and goal-review),
hashes and result files. Archive files preserve original, reviewer and follow-on
evidence. Generated .mjs files are comparison bundles; .sqlite/.sqlite-wal/.sqlite-shm
files are checkpoint stores; JSON files contain fixture profiles, IDs, outboxes,
receipts, fake effects and results; .txt/.ndjson files contain diagnostic output
and traces. None is production admission wiring.

The fresh E directory and A run were created by this reviewer. The preserved F
bundle and original spike were supplied evidence. No dependencies were installed
by this reviewer. No repository dependency or lockfile changed. The isolated
lockfile contains LangGraph 1.4.14, checkpoint 1.1.5, checkpoint-sqlite 1.0.4,
better-sqlite3 13.0.3 plus transitive 12.11.1, and zod 4.5.4. Duplicate native
SQLite versions must not be copied into production without resolution.

### Findings

F identifiers retain the prior review's principal defects; F9/F10 describe their
current disposition. F11/F12 are additional independently verified observations.

| ID / severity | Exact location | Concrete evidence, impact and acceptance gate | Smallest appropriate correction |
| --- | --- | --- | --- |
| F1 critical | S/durable-runtime-spike.mts:872; :1058 | R/review-results.json: cancelled execution, one subsequent effect, outbox becomes delivered. relay ignores cancelled eligibility; cancellation and dispatch are not serialized. Gates 1 and 2 fail. | Enforce cancellation and dispatch eligibility through one durable owner; reconcile admitted/claimed work across races and crashes. |
| F2 high | S/durable-runtime-spike.mts:1207; :1219 | SIGKILL after result checkpoint leaves next=review-graph. Original process-result exits 1 because it requires wait-for-result. Committed receipt cannot finish the exact continuation. Gates 1 and 4 fail; duplicate-result recovery is incomplete. | Resume saved pending graph work after a consumed result instead of requiring the old interrupt position or replaying the result. |
| F3 high | S/durable-runtime-spike.mts:188; :217; :611; :987 | Stale write accepted and replaces objective. Duplicate steering moves cursor 6 to 5 and appears twice. Event table and checkpoint contain different events at sequence 5. No checkpointVersion CAS or single sequence allocator. Continuity, gates 1/4/5 fail. | One serialized event admission/commit owner, transactional sequence allocation and CAS; make already-applied deliveries no-ops and reject collisions. |
| F4 critical | S/durable-runtime-spike.mts:750; :760; :806 | A second fake-body owner advances generation to 48; cached generation-47 owner accepts an effect and overwrites durable generation back to 47. No proven exclusive execution body lease. Gate 2/fencing contract fails even at stub level. | Persist and atomically enforce ownership, generation and action receipt at the final fake adapter; add two-owner/multiprocess tests. Do not claim firmware enforcement. |
| F5 high | S/durable-runtime-spike.mts:500; :512 | R/reconciliation-review-results.json: wrong-action reconciliation without objective evidence completes the objective. Cancellation here throws and leaves waiting_for_reconciliation. Gate 4 and semantic completion/cancellation requirements fail. | Validate full correlation; return reconciled action evidence to semantic review; admit cancellation at every wait. |
| F6 high | S/durable-runtime-spike.mts:573; :601; :862 | R/version-review-results.json: changed executable hash is accepted because expected hash is loaded from saved IDs. Required node versions are absent. Gate 4/version-safe resumption fails. | Compare saved state with the current compiled graph and required node/schema versions at every resume/admission boundary. |
| F7 high | S/svelte-flow-parity-spike.mts:157; F/candidate-adapter.mts:33; :73 | Original property probe still returns -1 instead of 7. Separate adapter passes saved properties and the 11 actual cases, but explicitly excludes loops. Pre-abort returns failed in current executor versus rejection in candidate. Gate 7 remains incomplete/failed for original adapter. | Apply the verified node invocation contract to the designated isolated candidate; add loop/output-path, cancellation, child/error and editor parity before claiming compatibility. |
| F8 high | F/candidate-adapter.mts:12; :75; F/parent-comparison.mts:13; :73; :133; S/durable-runtime-spike.mts:1116 | Fresh two-attempt DB is 10,866,688 bytes, 203 checkpoints; 149 checkpoint blobs contain the identical inline image fixture. Full inputs/outputs/context/traces accumulate. Neither experiment has terminal retention; actual profile-resolved store integration is unproven. Storage acceptance fails. | Reference content-addressed images and bounded transcripts; avoid redundant trace copies; implement and test terminal retention without evicting active/waiting state. |
| F9 medium | docs/audits/llm-agent-vs-metahuman-autonomy-analysis.md:321 | Still recommends a production cutover, contradicting corrected opening and final blocked verdict. The migration row at :460 now does require deleting the old executor after full parity, resolving the prior indefinite-coexistence proposal. No new production owner was introduced. | Remove the stale adoption recommendation; keep the single-runtime deletion requirement and failed disposition consistent. |
| F10 medium, historical | docs/audits/llm-agent-vs-metahuman-autonomy-analysis.md:282; original S parity import | Original comparator emitted synthetic events into running production telemetry. Follow-on build/mocks isolate telemetry and fresh tests redirect local traces. Static search finds no production LangGraph import/admission. Gate 10 production-admission isolation passes; original all-side-effects isolation did not. | Retain process-local telemetry isolation for all future probes; do not stop production services or claim the original run was completely isolated. |
| F11 high, pre-existing production defect | etc/cognitive-graphs/robot-autonomy-controller-mode.json:73; packages/core/src/nodes/context/conversation-history.node.ts:121; packages/core/src/nodes/robot-operator/context-builder.node.ts:396 | H shows user request reaches Controller after seven autonomous replies, disappears after eight/nine, while remaining in the buffer. Commit 464ecf39 removed its preservation. Contradicts MAINTAINED_SURFACE.md:112. Not caused by this spike or follow-on. | Separately authorize a bounded repair preserving the latest user turn through History to Controller; add an integration regression test without restoring a competing context owner. |
| F12 high, integration gap | F/parent-comparison.mts:19; :51; :67; :98; F/runtime-mocks.mts:74; :80 | Parent stage order is scripted, external submissions are mocks, existing effectful child nodes execute before the later wait, and Robot Status still supplies objective state. One-thread composition is demonstrated, but not replay-safe actual-graph execution with projection-only status. Gates 2/3/4 are not established by this comparator. | Integrate actual saved graph contracts into a separately corrected isolated durable path: typed action intent before interrupt, dispatch after durable eligibility, ordered correlated results and projection-only status. No production wiring. |

The comparison report is now appropriately explicit about mock and performance
limitations. No claim of real inference, live Bridge safety or physical proof is credited.

### Acceptance matrix

Pass means demonstrated only at the explicitly named layer; Partial does not
satisfy a production adoption gate.

| Required scenario | Status | Evidence |
| --- | --- | --- |
| Editable visual nodes/edges/conditional paths remain authoring source | Pass | C reads six unchanged saved definitions; source hashes |
| One opaque objective instance ID | Pass | A manifest/checkpoint survives selected restarts |
| One resumable parent execution ID | Partial | A hardcoded children; P one actual-graph thread, same process |
| Controller, Executor, specialist, action-result and review retain parent | Partial | P nine invocations/five workflows, same thread namespaces; no process-restart integration |
| Unique event identity for every event occurrence | Fail | F3, fixed event suffixes and content-derived steering IDs |
| Named serialized ordering owner | Fail | F3 competing sequence calculation paths |
| Monotonic execution sequence | Fail | R cursor 6 to 5 and colliding sequence 5 |
| checkpointVersion rejects stale concurrent updates | Fail | R staleWriteRejected=false; no CAS |
| Exact execution and graph position on result | Fail | R resultCheckpointCrash; normal A result passes |
| Restart uses structured state, not prose/Robot Status reconstruction | Partial | A does; F actual graphs still consume Robot Status |
| Successful outputs are not unnecessarily rerun | Partial | A controller/observer/executor/review once, wait twice; F2 blocks intermediate recovery |
| Ordered corrections and cancellation | Fail | R duplicateContext, cancelThenRelay, cancel-reconciliation |
| Unrelated conversation cannot replace objective | Partial | A explicit objective unchanged; stale writer/history regression remain |
| Edited graph/checkpoint/node versions rejected | Fail | R version probe; missing required node versions |
| Cross-store handoff design documented | Pass | Report specifies checkpoint transaction plus relay and terminal admission receipt; no false shared-store transaction |
| Committed work cannot be lost across stores | Fail | Selected A rollback/enqueue/receipt crashes pass, F2 recovery fails; full boundary matrix absent |
| Duplicate delivery versus duplicate execution distinguished | Partial | A one admission/effect and terminal receipt; F1/F3 violate broader transition safety |
| One outbox owner | Partial | S saver owns intent insertion, but relay/cancellation eligibility is unsynchronized |
| Stable idempotency after Coordinator terminal completion | Pass | A terminal redelivery retains one work item/receipt/effect in isolated wrapper |
| Every checkpoint/outbox/relay/enqueue/receipt crash boundary | Fail | F2 reproducible missing boundary; exhaustive deployed-owner proof absent |
| Real Coordinator owns finite admission/leasing/retry/cancel/receipt | Partial | S uses UnifiedQueueManager plus fixture ledger; dispatch mutates raw lease state outside canonical lifecycle |
| Physical send not in replayable pre-interrupt code | Partial | S wait safe; F actual effectful nodes precede interrupt but boundary is mocked |
| Pending action and dispatch intent persist before dispatch | Pass | A atomic rollback 0 rows, recovered commit 1 intent/event; isolated S only |
| Resumed interrupt cannot repeat physical effect | Partial | A selected replay cases one effect; F4 fencing and actual-graph path unproven |
| Stable actionId across retry/reconnection | Partial | A selected fake-body retries; no live reconnection proof |
| Lost acknowledgement becomes outcome_unknown | Pass | A uncertain-action waits for reconciliation, one possible effect |
| Unknown action reconciled, not blindly retried | Fail | Unknown is parked, but F5 accepts unrelated completion |
| One execution holds body lease | Fail | F4; no proven shared execution lease owner |
| Fencing generation increases monotonically | Fail | R persisted generation regresses 48 to 47 |
| Final adapter rejects stale generation | Fail | R stale owner completed; production/firmware untested and report says so |
| Direct emergency-stop path preserved and bypasses model/graph | Pass | Unchanged mode-controller.ts:95 to store.ts:646; no graph/model in stop path |
| Live emergency-stop transport/physical stop | Not tested | No command sent to live Bridge/robot |
| Semantic cancellation distinct from safety stop | Partial | Separate paths exist; F1/F5 break semantic cancellation |
| Data edges including zero values | Pass | Original synthetic parity plus C actual input/output traces |
| Control edges and conditional paths | Pass | C paired node order/status/routes |
| Inactive/skipped branches | Pass | C preset, freestyle, conversation branches |
| Loop scheduling | Not tested | F adapter explicitly rejects loop edges |
| Output-path re-entry scheduling | Not tested | Only acyclic invocation paths compared |
| Node validation | Pass | C invalid maxTokens rejected identically; 38 saved graphs valid |
| Persisted node configuration | Partial | C actual properties pass; original adapter R remains wrong |
| Specialist/child-graph calls | Partial | P inherited namespaces; all dynamic scheduling/error/restart cases absent |
| Cancellation and error propagation | Partial | C malformed/provider failure parity; pre-abort shape differs; waiting cancellation fails |
| Current model router/provider-neutral selection | Partial | Actual router/resolver with mocked local/remote transports; original durable runtime still fake adapters |
| Editor JSON round-trip | Not tested | Reading/copying JSON is not editor save/load proof |
| Robot Status is projection only | Partial | S projection is non-authoritative; F real child graph state still consumes status |
| Buffers/memory provide context, not execution ownership | Partial | S structured state; F is scripted composition of existing owner behavior |
| Agency Desire optional for conversation and commands | Pass | C both routes work with no active desires, at mocked integration layer |
| No second production graph runtime | Pass | No production LangGraph dependency/import/admission found |
| Active/waiting executions cannot be evicted | Partial | No pruning implemented; no retention/admission pressure test |
| Bounded terminal retention | Fail | No policy or collector |
| Structured resumable checkpoints | Partial | S structured manifest/state; F full node state, F2/F6 resume defects |
| Store image once and reference it | Fail | P database: identical inline image in 149/203 checkpoints |
| Avoid indiscriminate transcript/context copies | Fail | F cumulative inputs/outputs/context and child traces in checkpoints |
| Correct profile-resolved storage owner | Not tested | S arbitrary temporary runDir; F profile paths mocked |
| Identify private data | Partial | Reports identify context/images/task state; fixtures synthetic; real data lifecycle unproved |
| Representative multi-step visual database growth | Partial | P two mocked attempts, tiny image marker; real visual payload absent |
| Persist graph version/hash/schema/required node versions | Fail | S partial manifest, F6 ineffective hash admission, no required node pins |
| Migration removes superseded runtime paths | Partial | Corrected deletion end state documented; stale adoption paragraph F9 remains; migration unapproved |
| Experimental production-admission isolation | Pass | No production runtime/dependency changes; F boundaries mocked; historical telemetry exception F10 |

Mandatory gate disposition: 1 Fail; 2 Fail; 3 Partial; 4 Fail; 5 Partial
(normal duplicate results pass, interrupted-result recovery and general event
idempotency fail); 6 Pass for unchanged source, physical test not run;
7 Partial for follow-on, original configuration probe Fail; 8 Partial;
9 Partial (correct deletion end state); 10 Pass for production admission.
Any failed hard gate blocks adoption.

### Performance results

Fresh P comparison: nine graph invocations, two scripted physical attempts,
11 mocked provider calls; current first, candidate second, same process, one
sample each. This measures fixture overhead, not live model or robot latency.
RSS is an end-of-run process observation, not peak or isolated memory overhead.

| Metric | Current path | Follow-on checkpointed candidate |
| --- | ---: | ---: |
| User input to first decision | Not measured | Not measured |
| Physical result to next decision | Not measured | Not measured |
| Total fixture elapsed time | 16.44 ms | 1,094.15 ms |
| Provider calls per physical attempt, objective-wide average | 5.5 | 5.5 |
| Total provider calls per scripted objective | 11 | 11 |
| Real model inference calls | 0 | 0 |
| Total serialized provider-message characters | 51,633 | 51,633 |
| Actual input/output tokens and vision tokens | Not measured | Not measured |
| Checkpoint writes | 0 | 203 |
| Checkpoint put latency, median / p95 | N/A | 0.442 / 2.958 ms |
| Checkpoint put latency, mean / maximum | N/A | 3.126 / 213.805 ms |
| CPU user / system | 16.623 / 0.961 ms | 419.547 / 40.016 ms |
| End-of-run RSS | 126,681,088 bytes | 148,742,144 bytes |
| Checkpoint DB size from empty | 0 bytes | 10,866,688 bytes |
| Scripted Bridge calls / duplicate calls | 2 / 0 | 2 / 0 |
| Real duplicate physical-action rate | Not measured | Not measured |
| Real task completion rate | Not measured | Not measured |
| Real false-completion rate | Not measured | Not measured |
| Adversarial false completion | No paired measurement | Original S accepts unrelated reconciliation |
| Restart behavior | No paired production test | Original S selected matrix passes; intermediate result-checkpoint recovery fails |

The implementation's earlier fixture measured about 19 ms versus 1.67 s and
10,870,784 candidate DB bytes. The fresh sample above is a separate observation,
not an averaged benchmark. Full context-character arrays are identical in P.
The original S complete-action database is 286,720 bytes; its unrelated
64-conversation-entry fixture is 856,064 bytes. Neither is a realistic visual
task comparison. Correctness has not established a performance improvement.

### Architecture comparison

Remain: SvelteFlow editor and saved graph contracts; current model router;
canonical Work Coordinator finite-work owner; Environment Bridge transport;
canonical profile paths; buffers/memory as context; optional Agency Desire;
direct emergency-stop path.

Proposed replacement: graph continuity/scheduling behind the existing Core facade,
with durable parent state, event ordering and dispatch intent. Robot Status must
become a projection, not the source from which subsequent tasks are reconstructed.

Required migration deletions: the superseded graph-executor scheduler/admission
wiring after parity for every maintained entrypoint; Robot Operator polling-based
fresh Controller/result/review continuation; feedbackGraph and result-buffer
fresh-graph re-entry; replayable send-node direct admission; status/prose-driven
objective reconstruction; temporary adapters, flags, registries and duplicated
receipt/lease persistence. Work Coordinator and Bridge are retained, not replaced
by the spike's fixture wrappers.

The corrected map no longer endorses a permanent bounded one-shot executor beside
a durable executor. No second production runtime has been introduced. There are
two disconnected experimental paths, which must not be combined into a claim that
one implementation has passed both safety and real-graph compatibility.

### Correction directives

These are proposed bounded tasks, not authorization to edit production.

1. F1/F2/F3 — Observed: cancellation dispatch, intermediate receipt-recovery
   failure, stale updates and duplicate/reordered events. Invariant: one ordered
   durable owner, CAS, and recoverable handoff. Allowed scope: a new correction
   copy of the isolated runtime/checkpointer/relay and its tests. Do not change
   production Coordinator files, original frozen evidence, dependencies or
   safety stop. Verify cancellation before/after enqueue/claim, SIGKILL at every
   checkpoint and receipt transition, stale concurrent writers and repeated
   steering/results. Supply failing-before/passing-after assertions, exact diff,
   SQLite/ledger snapshots and command output; rerun all original passing cases.

2. F4 — Observed: stale cached owner accepts and lowers generation. Invariant:
   exclusive execution lease and monotonic final-boundary fencing. Allowed scope:
   isolated fake adapter/body ledger and integration tests. Do not alter Ainekio
   firmware or claim production enforcement. Verify two simultaneous owners,
   handoff, stale dispatch, restart and duplicate action IDs. Supply one-effect,
   no-generation-regression durable traces.

3. F5/F6 — Observed: unrelated reconciliation completes an objective; cancellation
   at that wait fails; changed executable state resumes. Invariant: correlated
   result evidence, semantic review, cancellation at all waits and explicit
   version compatibility. Allowed scope: isolated resume/admission handlers,
   manifests and tests. Do not reconstruct objectives from buffers/status or
   silently migrate old state. Verify wrong execution/action/generation,
   completed action without goal evidence, each wait cancellation, graph content,
   schema and required-node-version changes. Supply parked-state and exact-thread
   continuation traces.

4. F7/F12 — Observed: original configuration loss and separate, non-durable
   actual-graph comparator. Invariant: one isolated candidate must demonstrate
   both existing graph semantics and safe durable execution. Allowed scope:
   experimental compiler and fixture integration. Do not edit saved production
   graphs, add production admission, preserve a permanent second runtime, or
   send real commands. Verify real NodeDefinition context/properties, explicit
   loops, output re-entry, skipped branches, child failure/cancellation, editor
   round-trip and process restart across all participating workflows. Supply
   paired raw traces and checkpoints; preserve existing 11-case passes.

5. F8 — Observed: 149 inline-image checkpoint copies, repeated context and no
   retention. Invariant: structured bounded state, single-owned referenced
   assets, protected active/waiting executions and bounded terminal data.
   Allowed scope: experimental serialization/asset/retention fixtures using a
   temporary profile resolved through the canonical path owner. Do not access
   private production profiles or introduce a new production store. Verify
   realistic sanitized images, long transcripts, retention pressure and restart
   after collection. Supply per-step DB/WAL/asset growth and reference integrity.

6. F9/F10 — Observed: stale cutover recommendation and historical telemetry leak.
   Invariant: truthful single-runtime migration map and isolated diagnostics.
   Allowed scope: report and harness boundary configuration. Do not revise away
   failed evidence, stop production services or claim live proof. Verify all
   adoption statements agree, search production imports/admission and assert
   no live telemetry/effect boundaries. Supply document diff and boundary logs.

7. F11 — Observed: committed history-window regression predates the spike.
   Invariant: bounded Controller context includes latest user turn.
   Allowed scope now: report and regression evidence only; obtain separate
   owner authorization before any production correction. Do not silently revert
   another author's changes or use durable migration to mask this defect.
   Verify History to Controller to router after 7, 8 and more replies and after
   a user correction, with ordinary conversation behavior preserved. Supply
   distinct pre-existing-defect attribution and before/after integration traces
   if a repair is later authorized.

8. Missing measurements — Observed: no live input/result latency, token,
   completion-rate or hardware evidence. Invariant: measure correctness,
   latency, resources and reliability separately. Allowed scope: reproducible
   isolated instrumentation first; require separate authority for live
   providers/Bridge/physical tests. Do not substitute scripted success or unit
   tests for physical proof. Verify paired multi-step scenarios, repeated runs,
   realistic context and controlled failures. Supply distributions, sample
   sizes, call/token counts, DB growth and recovery/false-completion outcomes.

### Recommendation to the owner

Request corrections and another review. Do not approve production migration
design/cutover on the current evidence. Retain the actual-graph comparator as
useful limited compatibility evidence, preserve the original failures, and
separately decide whether to authorize the pre-existing history regression repair.
There is not yet evidence requiring rejection of LangGraph itself in favor of
checkpointing the existing executor.

Validation rerun: supplied original matrix passed; four independent failure
probes reproduced their defects; all 11 paired comparisons and parent trace
comparison passed; 38 saved graphs valid; 344 nodes have executors; environment
and graph-schema test files passed; architecture check passed with zero violations
after a sandbox spawnSync git EPERM required an approved read-only rerun.
No build, live provider, browser, deployed Coordinator/Bridge, firmware or
physical test was performed. No production code/configuration, dependency,
existing evidence, commit or remote branch was changed by this reviewer.
