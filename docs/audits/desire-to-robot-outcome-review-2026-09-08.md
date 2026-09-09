# Desire-to-robot outcome review — 2026-09-08

The original read-only baseline is retained below. The authorized repair and
its validation are recorded in the implementation follow-up at the end.

## Verdict and scope

The reported repeated slow movement is supported by saved runtime evidence. The
Desire System has planning, execution, and outcome-review implementations, but
the robot consumes desires through a separate motivational-context path that
does not require those stages. Unplanned desires can repeatedly motivate body
actions without those actions satisfying or updating the originating desire.

This is a read-only review of production source and existing runtime records,
against source commit `a94fbfddf5cdde7185e92255ff6e3c122929ad67`. Only this audit
document was added. Existing changes to `etc/active-operator.json` and
`docs/audits/full-auto-design-runtime-review-2026-09-08.md` were preserved. No
production code, graphs, profile data, settings, services, or robot commands
were changed; no commit or push was performed.

Authorities: `MAINTAINED_SURFACE.md`, `REFACTOR_BLUEPRINT.md`, `AUDIT_PROTOCOL.md`,
and the current consolidation ledger. Agency remains the Desire lifecycle
owner; Work Coordinator owns admission; durable execution owns the execution
thread; Robot Status is a projection. The findings below concern implementation
gaps and the mismatch with the requested product behavior, not an authority
conflict requiring a different runtime owner.

## Evidence from the installed run

Inspected the profile-resolved Desire manifests and Robot Status, then opened
the existing execution database with SQLite `mode=ro` and `query_only=ON`.
Decoded committed checkpoint heads and their referenced evidence blobs; no
execution was resumed. Private transcripts, profile identifiers, action IDs,
images, and original manifests are intentionally absent from this report.

For the last 20 saved Robot Autonomy Controller executions, created between
22:06:04 and 22:18:42 UTC on September 8:

- All 20 selected Robot Autonomy Executor. All 20 decision receipts mentioned
  slow movement; 19 explicitly mentioned a desire.
- All 20 received the same three slowing-related desires among five selected
  summaries. These three records were `questioning`, with no current plan,
  review, execution, outcome review, or completion criteria. Their persisted
  updates were weeks old. The inspected profile had ten active desires, all
  `questioning`.
- All 20 had a null current execution task. All 20 model context envelopes also
  contained Robot Status's older task, whose owning execution was `failed`.
  The projected task did not expose that execution's failed status.
- Across these executions, correlated adapter results reported 11 completed and
  two cancelled `walk_slow` actions, three completed motion plans, and one
  completed left turn. This is repeated distinct work, not proof of replaying
  one action. It also does not establish that every motion was slow.
- Seventeen saved Action Result parser invocations returned null task decisions;
  all seventeen corresponding Goal Review nodes were skipped.

The older task's completion-criteria field merely repeated its general
exploration objective. The recent Controller decisions repeatedly treated that
older goal as active despite having no task in their own execution.

This establishes the model-visible inputs, selected intentions, admitted action
history, and adapter-reported outcomes. It is not independent physical
observation or a controlled experiment isolating desires from persona and
conversation. Those other inputs also contain related narrative, so removing
one desire alone is not proven to resolve every repetition. The old Desire
records predate current source; their original generation cannot be attributed
to the current generator solely from these snapshots.

## F1 — High: unplanned desires become operational motivation

- **Owners/layers:** Core Agency selector and robot graph context; keep these
  owners and repair their consumer contract.
- **Evidence:** `packages/core/src/agency/lifecycle-policy.ts:16–20` includes
  `pending`, `questioning`, `awaiting_approval`, and `needs_attention` in the
  active set. `agency/storage.ts:228–230` selects by that status set.
  `nodes/agency/active-desires.node.ts:30–46` sorts by strength and emits title,
  description, reason, status, strength, and update time. It omits the plan,
  approval receipt, completion criteria, and execution identity.
- `nodes/robot-operator/context-builder.node.ts:450–463,568–574` gives the
  Controller and Goal Review these fresh summaries. It removes the duplicate
  `agency` section from their status input, but retains status's situation and
  task. `etc/cognitive-graphs/robot-autonomy-controller-mode.json` explicitly
  asks the model to consider active desires. This influence therefore does not
  depend solely on Robot Status refresh.
- **Boundary issue:** an unresolved candidate can motivate physical execution
  without passing its Desire planning/review gates. This is a bypass of the
  Desire lifecycle, not a claim that global mode or hardware safeguards are
  bypassed. A high strength is relevance, not evidence of an executable plan.
- **Test gap/action:** distinguish unresolved motivation from eligible Desire
  work at the existing selector/context boundary. Waiting-for-clarification or
  approval records must not serve as standing body instructions. Test their
  presence through the actual Controller context, including fresh and cached
  Robot Status, rather than testing only status membership.

## F2 — High: native robot actions do not close the originating Desire

- **Owners/layers:** Core Agency execution/outcome services, Brain internal
  planner, and existing durable robot workflows; consolidate their handoff.
- **Evidence:** `nodes/robot-operator/autonomy-controller-parser.node.ts:9–15,
  128–144` accepts a catalog selection and an instruction, producing only
  observed text, instruction, and reason for the robot executor. It carries no
  Desire/plan/step identity. `durable-execution/types.ts:13–19` declares optional
  `desireId`, but the maintained robot objective writer at
  `nodes/robot-status/out.node.ts:136–190` does not populate it. A maintained
  source reference search found no robot outcome consumer closing that link.
- The actual approved Desire path is different:
  `agency/desire-execution-service.ts:82–109,176–209` gates and claims an
  approved plan; `nodes/agency/desire-executor.node.ts:115–215` sends each step
  to the configured escalation backend. `queue/desire-execution-handler.ts:24–40`
  admits a correlated Desire outcome review after that path executes. It is
  real execution machinery, but not a first-class approved-plan handoff to the
  native robot executor. An external operator's available tools are a separate
  capability question; this review does not claim they can never affect a robot.
- **Boundary issue:** the native robot can embody a Desire's wording while
  Agency still sees an unanswered question and no execution. A motion result
  consequently cannot satisfy that Desire, reduce its influence, or advance its
  next plan step.
- **Test gap/action:** bind an approved Desire and exact plan version/step to the
  existing durable execution contract. Route embodied work through the existing
  Coordinator and Bridge, and return correlated evidence to Agency's existing
  outcome transition. Preserve ordinary user-command and non-Desire autonomy
  paths. Do not add another executor, scheduler, store, or completion owner.

## F3 — High: a failed historical task is presented as current motivation

- **Owners/layers:** Core execution projection, Robot Status loading, and
  model-context projection; repair the existing projection boundary.
- **Evidence:** `durable-execution/store.ts:174–189` prioritizes active tasks but
  falls back to the most recently updated task even when its execution failed.
  It returns the task without its execution status. `robot-status.ts:416–424`
  then derives an ongoing current goal from semantic decision fields alone.
  `nodes/environment/helpers.ts:167–212` forwards the task and situation into
  decision context without that execution status.
- `nodes/robot-operator/action-result-parser.node.ts:90–95` correctly limits
  outcome decisions to null when the current execution has no objective.
  `etc/cognitive-graphs/robot-action-result-mode.json:653–665` gates Goal Review
  on `hasActiveTask`. In the inspected run, each new execution therefore ended
  while the next Controller again interpreted the old projected goal as active.
- **Boundary issue:** this sample is not one endless approved Desire plan. It
  is a sequence of new decisions repeatedly acting on unresolved motivation and
  stale goal narrative. Adding a timeout to a single motion would not close it.
- **Test gap/action:** retain historical task visibility with truthful terminal
  execution status; prevent historical projection from masquerading as the new
  execution's active objective. When selecting actual Desire-driven goal work,
  establish its bounded objective before dispatch so results reach its review.
  Test a failed old task followed by several new executions with null tasks.

## F4 — High: satisfaction is optional at admission and inconsistently enforced

- **Owners/layers:** Core Agency generation, planning validation, execution
  eligibility, and outcome transition; repair existing contracts.
- **Evidence:** `nodes/agency/desire-generation.node.ts:48–64,91–112` accepts
  durable preferences as candidates and validates typed descriptive fields,
  without requiring a bounded user outcome. `agency/types.ts:704–709` makes
  completion criteria optional. `nodes/agency/desire-plan-generator.node.ts:464–467`
  accepts missing criteria and defaults the goal type to `one_time`.
- `nodes/cognitive/plan-validator.node.ts:105–108,129–132` requires criteria only
  for `long_running`; a one-time or recurring plan can omit them.
  `agency/desire-execution-service.ts:82–109` does not add a satisfaction gate.
  For robot objectives, `nodes/robot-status/out.node.ts:166` falls back to the
  objective sentence itself when criteria are absent.
- `agency/desire-outcome-transition.ts:184–228` checks an unmet
  `completionCriteriaMet` value for long-running goals, but a one-time
  `completed` verdict still completes when that field is explicitly false.
  The review prompt's request for evidence is not a consistent state-transition
  invariant. Recurring completion resets the Desire for another cycle and also
  needs a defined per-cycle outcome.
- **Reproduction:** synthetic probes accepted an indefinite one-time plan
  without criteria through structural validation and execution eligibility.
  A separate in-memory probe supplied a one-time outcome with verdict
  `completed` and `completionCriteriaMet: false`; the canonical transition
  returned `completed`. No real plan was executed.
- **Test gap/action:** require observable satisfaction conditions for every
  executable plan, with scope and a failure/stop boundary appropriate to its
  effects. Reject contradictory completion receipts for every goal type. A
  nonempty but circular sentence is insufficient; test measurable progress and
  actual result evidence, not merely the presence of a string.

## F5 — Medium: unanswered desires can retain influence indefinitely

- **Owners/layers:** Brain Desire Agent lifecycle selection and Core Agency
  status/strength policy; repair through the existing Desire Agent.
- **Evidence:** `brain/agents/desire-generator/core.ts:870–875` nurtures/decays only
  `nascent` and `pending` records. Its lifecycle scan at `1522–1555` admits
  planning, execution, and outcome review; it does not resolve stale
  `questioning` records. Those records remain active under F1. Activation
  capacity at `1086–1105` also counts them. The observed active records were all
  waiting for clarification, including the old slowing-related records.
- **Boundary issue:** waiting for an answer is legitimate, but remaining eligible
  to influence every movement while waiting is not completion behavior. There
  is no decay-based escape for these records in the inspected nurture path.
- **Test gap/action:** make pending clarification visibly dormant for execution;
  give the existing lifecycle owner a deliberate stale-question/reassessment
  policy. Preserve user evidence and answers. No background timer or automatic
  destructive deletion is needed. Test repeated Desire Agent runs with no answer
  and ensure no physical work is implied or admitted by the unresolved record.

## F6 — Medium: duplicate motivations amplify the same interpretation

- **Owners/layers:** Brain generator deduplication and Core selected-context
  projection; consolidate equivalent evidence under Agency.
- **Evidence:** `brain/agents/desire-generator/core.ts:747–765` compares only
  lowercased exact/substring titles. `1362` filters all new candidates against
  one existing-summary list rather than adding each accepted candidate to the
  comparison set. Semantically equivalent titles, and duplicates within one
  generated batch, can survive this deterministic filter. The model is asked
  to avoid duplication, but that is not a storage invariant.
- `nodes/agency/active-desires.node.ts:35–46` then ranks records individually;
  three near-equivalent motivations occupied three of five slots in every
  inspected Controller context. This makes one interpretation unusually
  prominent and can crowd out different useful work.
- **Test gap/action:** consolidate equivalent user outcomes and attach further
  evidence to the existing Desire. Test paraphrases, same-batch duplicates,
  outcome distinctions, and repeated old input. Existing traceable evidence and
  once-only reinforcement should be preserved. Any cleanup of actual profile
  records requires a separately authorized, inspectable data migration.

## Intended behavior and repair boundary

The requested distinction is between understanding a preference and completing
work that benefits the user. A preference such as wanting a calmer life can be
valid context, but it is not itself a robot motion objective. Agency should
derive a concrete proposed outcome or request the missing clarification before
acting on that preference. A literal slow gait does not establish a calmer life.

For example, a candidate could identify one unwanted recurring interruption,
propose a specific change, apply it when authorized, and verify that the
interruption is disabled. A physical plan should likewise name an observable
result, the actions intended to produce it, and its stop condition. Neither
requires changing every unrelated future movement.

The bounded repair should retain this owner chain:

```text
Persisted user evidence -> Desire Agent -> proposed concrete outcome
  -> clarification if necessary -> plan + satisfaction/stop conditions
  -> existing review and authority checks
  -> Work Coordinator + existing durable execution
  -> appropriate existing tool or robot execution capability
  -> correlated result evidence -> Agency outcome review
  -> satisfied / bounded replan / waiting for input / abandoned
```

The owner explicitly retains reduced inhibition: strength and maturity may
lower trust requirements under the existing Agency approval policy. Finite
plans and verifiable satisfaction remain required. Robot Status should display this work and its evidence without
creating independent behavioral obligations. For recurring goals, each cycle
needs its own bounded outcome and a deliberate next-cycle trigger.

Superseded behavior to remove in an implementation: the use of unresolved
Desire summaries as standing body instructions; uncorrelated Desire-to-body
handoffs; missing/circular satisfaction fallbacks; terminal tasks presented as
current goals; and duplicate active representations of the same user outcome.
Retain raw evidence, legitimate preferences, existing lifecycle owners, direct
commands, ordinary autonomous capability selection, and emergency stop.

## Validation and limits

- Source review covered the real graph registrations, generator entrypoint,
  planner, active selector, approved executor, result gates, outcome transition,
  projection, and relevant existing tests. Agency storage uses the canonical
  storage client; robot state and execution storage use profile/path owners.
  The reviewed imports follow the Brain-to-public-Core and Core ownership
  direction; these findings are primarily semantic/lifecycle boundary defects.
- **22 named checks passed**, executing each file directly with
  `node --import tsx`: `agency/lifecycle-policy.spec.ts` (3),
  `agency/desire-strength.spec.ts` (5),
  `agency/desire-outcome-transition.spec.ts` (6),
  `nodes/agency/desire-generation.node.spec.ts` (2),
  `nodes/cognitive/plan-validator.spec.ts` (4), and
  `nodes/agency/desire-plan-generator.node.spec.ts` (2), all under
  `packages/core/src`. These tests do not cover the combined failure above.
- Six synthetic contract assertions reproduced the permissive boundaries in
  F1/F2/F4, using in-memory persistence and no model or robot execution. The
  structural-validator probe isolated structure using the existing test options;
  it makes no claim about skill/trust policy. Importing the broader executor
  dependency graph attempted an observability socket connection; sandbox access
  rejected it. The assertions completed and the process exited successfully;
  no live bus access was required or enabled.
- The initial combined `--test` invocation reported only six file-wrapper
  passes; those were not counted as behavior checks. Direct file runs above
  established the named-test results.
- Final whitespace and scope checks passed. No production build, full
  architecture suite, deployment, new model inference, or physical test was
  performed because this pass changed only audit documentation. No repaired
  behavior is claimed. Implementation acceptance must include repeated cycles,
  completion stopping future Desire-driven dispatch, cancellation/restart,
  truthful failure and no-progress handling, and a separately authorized live
  robot verification with correlated physical evidence.

## Follow-up: current triggers and pending-work context

The owner clarified that Robot Status should retain awareness of pending
desires. The repair must preserve that visibility while preventing descriptive
motivation from becoming an unapproved body instruction. This section refines
the proposed consumer contract; it does not record an implementation.

### Current entrypoints

- `etc/agents.json:311–331` registers one enabled, manual-triggered Desire Agent,
  with startup policy `skip`. Its public ID is `desire-agent`; its existing
  executable and handler still use the name `desire-generator`.
- `packages/core/src/queue/sleep-workflow.ts:32–38` includes Desire Agent as the
  third Sleep Workflow stage. This is automatic workflow admission, not a
  separate periodic Desire generator.
- `etc/cognitive-graphs/robot-autonomy-controller-mode.json` and
  `robot-goal-review-mode.json` include Desire Agent among selectable catalog
  tasks. `nodes/robot-operator/task-catalog.node.ts:45–80` resolves executable
  availability through the existing Agent Catalog. Selection is discretionary;
  having pending desires does not itself prove that Desire Agent ran.
- When admitted, `brain/agents/desire-generator/core.ts:542–577` reads up to 20
  persisted user messages, bounded to 1,000 characters each, alongside other
  enabled evidence sources. It does not run once per arriving chat message.
  Its lifecycle scan at `1522–1555` requests the necessary internal stages.
- Explicit Agency UI/API actions, including planning, approval, answers, and
  execution controls, can also advance a particular record through
  `queue/work-submission.ts:142–255`. Planner/executor follow-ons use that same
  Desire Agent ownership. The older independent stage registrations and signal
  handler are retired; `queue/unified-queue-manager.ts:36–88` rejects legacy
  admissions. The two current `desire-agent-architecture.spec.ts` checks passed
  when run directly during this follow-up.

### What reaches the models

Robot Status contains a summary, not the complete Desire manifest. Nevertheless,
`nodes/agency/active-desires.node.ts:30–46` includes ID, title (200 characters),
description (500), rationale (500), lifecycle status, strength, and update time.
The three relevant graphs currently request five records. That permits 6,000
characters of title/description/rationale alone, before metadata and JSON. It
does not include the plan, approval receipt, evidence history, or satisfaction
criteria. These are character limits, not measured token usage.

There are distinct context paths:

1. Controller and Goal Review receive these summaries directly from Active
   Desires. Their context builder removes the duplicate `agency` field from
   Robot Status, but retains status's goal/intent narrative. There is no claim
   that they receive two identical structured Desire arrays.
2. Environment/action context can receive Robot Status's Agency projection when
   that context is selected (`nodes/environment/helpers.ts:167–218` and
   `nodes/environment/context-builder.node.ts:193`).
3. With Agency inner logging enabled, the generator writes a detailed Agency
   Review through `submitInnerReflection`
   (`brain/agents/desire-generator/core.ts:1177–1261,1425–1466`). It includes
   lifecycle counts, strengths, rationales, and evidence summaries. Desire
   review/execution graphs also publish inner-dialogue records.
4. Robot graphs explicitly load recent inner history. General conversation
   history can additionally include inner records when unified consciousness
   is enabled (`nodes/context/conversation-history.node.ts:75–99`). The robot
   context builder excludes the merged inner copies when it has explicit inner
   input (`nodes/robot-operator/context-builder.node.ts:383–392`); semantic echoes
   across reports, status narrative, and fresh Desire summaries still remain.
5. Robot Status Writer emits titles/statuses in a report to System Buffer
   (`nodes/robot-status/writer.node.ts:34–51`). The connected `system_buffer`
   node writes the distinct system buffer. This is not itself a direct append
   to the user conversation buffer.

### Required refinement to the repair

- Keep a compact pending-work projection in Robot Status: stable Desire
  reference, short title, lifecycle state, whether clarification/approval is
  pending, and whether an approved plan is ready or executing. These are
  proposed fields, not the current schema. The dashboard can provide detailed
  inspection without putting those details in every inference request.
- Use one fresh Agency-derived projection for that purpose. Controller should
  be able to select Desire Agent for eligible lifecycle work from this signal;
  it must not realize the prose of an unresolved desire as physical intent.
  A record already waiting for a user answer must not cause repeated attempts
  to run its planner merely because it is pending.
- Fetch full motivation, evidence, and plans only for the selected Desire
  workflow or an explicit user request about that desire. The physical executor
  receives the admitted step and its outcome/authority constraints. Remove the
  superseded verbose general-context path rather than adding a second summary
  store or scheduler.
- Preserve original conversations, evidence, useful inner reflections, and
  inspectable Agency history. Treat detailed lifecycle reports as operational
  records; general model context should receive only a bounded relevant change
  summary when needed. Explicit user discussion of a desire remains supported.
- Verify actual serialized model inputs across normal conversation, Controller,
  Executor, Action Result, and Goal Review. Test pending visibility, absence of
  repeated full motivation, once-only representation, selective detail loading,
  and the absence of Desire-driven motion before eligible execution. Measure
  token changes using the configured model's tokenizer on the same representative
  inputs. This follow-up establishes source paths, not a measured token saving.

The source now contains other uncommitted changes to terminal-status projection
and objective routing. This follow-up did not modify or validate their behavior.
The original runtime evidence above remains a dated baseline; Desire summary,
trigger, and reporting paths inspected here still require the proposed repair.

## Authorized implementation follow-up — 2026-09-08

The owner authorized repair and clarified that reduced inhibition is intentional.
The existing trust reduction, modes, strength thresholds, and settings are retained.
No dependency, scheduler, queue, profile store, or alternate execution runtime was
added. Existing unrelated terminal-status and graph-routing changes were preserved.

- **Candidate and plan admission:** generated candidates require an observable
  completion condition and a stable semantic outcome key. Equivalent candidates
  reuse an existing intention or deduplicate within the generated batch. The
  generator and feasibility/planning instructions reject indefinite preferences
  and no longer demand invented research steps for impossible outcomes. Shared
  Agency plan policy requires one to ten ordered steps, explicit execution
  targets, plan-bound criteria, consistent risk, and a matching reviewed version.
  The former risk-only module is consolidated into that policy. Node validation,
  owner approval, and execution use the same structural requirements.
- **Pending-work context:** one Agency projection supplies only reference,
  bounded title, lifecycle status, next action, and update time. Old saved status
  summaries are projected through it on read. Full rationale, descriptions,
  strength, and plans no longer enter general robot context. Automatic Agency
  reports remain inspectable in storage and audit, but are filtered from later
  model history; explicit user messages remain. Generation reports are compact
  counts rather than repeated per-desire narratives and model diagnostics.
- **Execution ownership:** the saved Desire Executor graph prepares one step,
  calls the existing native robot workflow when appropriate, records its receipt,
  and advances only on success. Preparation and recording reload the persisted
  reviewed plan; changing a graph input's action text cannot change that plan.
  Attempt identity is persisted before dispatch. Robot tasks carry Desire, plan,
  version, and step identity, with immutable approved criteria. Action Result
  returns to Agency rather than admitting general Goal Review continuation.
  Digital work retains the configured escalation backend, without retrying a
  failed attempt through another backend. Interrupted or unacknowledged effects
  retain `outcome_unknown` and require evidence before another attempt.
- **Completion and recovery:** finalization checkpoints outcome-review admission
  through the existing Desire Agent operation. The durable parent waits for that
  receipt, then closes. Completion requires the matching plan/attempt, all ordered
  step results, and satisfaction of the reviewed criteria. A model completion
  claim cannot overrule an unsatisfied robot result. Recurring completion stops;
  ordinary continuation consumes the existing retry budget. A verified long-running
  milestone requires a newly reviewed plan for its next phase. Duplicate result
  processing does not repeat effects or increment completion metrics again.
- **Existing backlog:** questioning and attention records participate in existing
  elapsed-time decay; they are not reinforced or promoted while waiting for owner
  input. The existing explicit migration can hold incomplete legacy contracts in
  `needs_attention` while preserving evidence and history. It refuses to rewrite
  an active execution. A local dry-run scanned 64 records, identified 33 changes,
  and would activate zero records. No live migration was applied.

Validation uses isolated runtime files, controlled model/provider replies, and a
simulated robot adapter. The saved-graph workflow suite passes 23 tests, including
two-step Desire execution, rejection of altered graph instructions, unsatisfied
step stopping, matching outcome review, and durable parent closure. The reduced-
inhibition case approves a strong low-risk plan at Suggest trust, invokes the
controlled backend, and proves that timeout and replay retain uncertainty with
only one backend attempt. The suite also exercises the canonical runtime's
existing cross-process child-wait recovery and cancellation cases.

Focused Agency, generator/planner, context, Robot Status, and graph tests and
Core, Brain, CLI, tests, and Site type checks are recorded with the repair ledger.
Graph validation, node defaults, architecture/remote-safety, and final diff checks
are included in the handoff. Node-default validation retains its pre-existing
non-blocking documentation and editor-field notices; no baseline was weakened.

No production build replaced the running Site, and no service or physical robot
was restarted or exercised. Model semantic quality on new natural-language inputs,
live token savings, deployment behavior, and hardware outcomes remain unverified.
