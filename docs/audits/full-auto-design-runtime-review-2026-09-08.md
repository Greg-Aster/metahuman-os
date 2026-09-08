# Full Auto: intended design versus recorded execution

Date: 2026-09-08. The numbered findings below preserve the pre-repair diagnostic
baseline. The implementation follow-up records subsequent authorized work;
source verification is not a deployed robot-behavior claim.

## Implementation follow-up — 2026-09-08

The existing durable runtime, Work Coordinator, Bridge, model router, buffers,
optional Desire system, and visual editor remain the owners. No second runtime,
scheduler, store, production dependency, speech requirement, movement filter,
or anti-repeat policy was added.

- **Facts and objectives:** Robot Status Out now records new same-execution
  action IDs and correlated terminal facts even when `taskDecision` is null.
  A new action clears the prior action's feedback. Objective identity, meaning,
  and completion criteria remain unchanged without a semantic decision; an
  unrelated execution does not adopt the dashboard's objective. Selectors can
  supply explicit completion criteria, and current-execution authority replaces
  the obsolete Robot Status instruction.
- **Actual inputs:** the image selector supplies available saved Bridge images
  with their recorded identity/time; result-specific review still matches the
  action. Controller and Goal Review messages include capability meanings.
  The Executor intent template now uses its connected conversation and execution
  context. No history window or model assignment was changed.
- **Result-driven choice:** Goal Review reuses the Controller's capability
  catalog and choice parser in its existing model call. It can select a specialist,
  the Executor, or no downstream work independently of its objective assessment.
  This removes the Executor-only continuation restriction without adding another
  Controller inference per physical iteration. Existing reactive/semi/full
  authorization still governs dispatch.
- **Specialist handoff:** Boredom children receive the actual `plannerDecision`
  input. Eight finite specialist workflows expose an optional task-brief Text
  Input wired to their existing reasoning node. Saved child graph returns reach
  the same parent; process logs are not presented as answers. Failed children
  return their failure and no intermediate-node answer. Receipt replay retains
  its originally committed return snapshot and rejects changed Coordinator facts.
- **Representation and capacity:** repeated observation envelopes use lossless
  changes in model context; their complete durable records remain untouched.
  Removed the sliced-JSON fallback. Activity history reads current execution
  outcomes rather than presenting initial admission as the latest result.
  Replay of 55 recorded contexts reduced the largest message from 52,377 to
  about 43,000 characters. Local Qwen3.5 tokenization and the original measured
  image/template overhead put the two largest repaired requests plus their full
  output allowances at about 16.9K/16.6K tokens. The existing authenticated model
  settings owner changed only the selected model's context from 16,384 to 24,576;
  all other registry fields were verified unchanged. This is capacity for the
  measured cases, not an indefinite-context or measured latency guarantee.

One repair-plan detail changed based on actual-graph tests: the explicit
`remaining-objective` return check is retained. A speech-only or specialist child
can return while the objective remains unfinished; deleting that check would
lose its next review. Completed objectives skip it. Controller now connects its
child returns to the same check. This is visible saved-graph continuation, not
an added scheduler or an unconditional extra model call.

Verification: 206/206 durable tests; 64/64 specialist/context checks; 4/4
Environment graph checks; all 38 graph definitions; model defaults; Core,
Brain, test, and Site typechecks; architecture guard; and isolated Site build
passed. Node-default validation passed while reporting its existing 462 schema
documentation gaps and eight editor-only persistence fields; neither baseline
was weakened. Independent review found three additional defects (null-decision
dispatch facts, failed-child output projection, and old receipt replay); all
were corrected and independently reverified. Tests use actual saved graphs,
node contracts, model routing, SQLite and Coordinator with controlled external
effects—not physical robot movements or real-model judgment.

Evidence and exact commands: local `metahuman-full-auto-repair-CJwjET/README.md`
and independent `metahuman-full-auto-review-4b25kU/README.md` under `/tmp`.
Private snapshots and the profile-registry backup stay outside tracked source.
Only existing browser graph copies were synchronized; no duplicate specialist
graph distribution was added. Unrelated worktree changes were preserved.

Deployment remains unverified. The installed Site build and services were not
replaced; rebuild and restart before evaluating a new Full Auto run. Real model
choices, GPU use with 24K context, physical image quality, and browser/audio
delivery were not measured in this repair. Existing version-incompatible saved
executions must use the existing cancellation/restart controls, not bypass
checkpoint compatibility.

## Verdict

The current system does not satisfy the intended Full Auto behavior. This is not
adequately explained by saying the model has a bias or that context needs tuning.
There are reproducible gaps between the documented contracts, graph connections,
model-visible information, and result handling.

The durable runtime can deliver a movement, receive its result, and resume the
same execution. However, that does not ensure the next decision receives a
coherent account of what happened or can reconsider the full range of activities.
Those parts of the workflow integration are incomplete.

In the inspected run:

- Twelve distinct `walk_slow` commands were reported completed in the initial
  observation window. This was repeated selection, not replay of one action ID.
- The first five completed Controller cycles produced no outward speech at any
  model stage. The conversation and TTS nodes therefore had nothing to publish.
- The Controller received no attached camera image even though a valid saved
  frame existed. The later Action Result graph did receive correlated images.
- An ongoing objective could enter an Executor → Action Result → Goal Review →
  Executor chain that did not reconsider the Controller's other agent choices.
- Two such executions failed when requests exceeded the configured 16,384-token
  context. The service subsequently admitted fresh Controller decisions.

The foundational repair is to finish the existing decision/result contracts,
not add a movement ban, forced speech, an anti-repeat counter, another scheduler,
or another task store.

## Scope and evidence

The recorded Site boot was at approximately 13:00:48 PDT. The main inspected
window ends at 13:06:54 PDT; preserved records extend through approximately
13:09. The last of the initial twelve commands completed at 13:06:38 PDT.
Across the extended snapshot there were nine Controller decisions that reached
the model, all selecting Robot Autonomy Executor, plus one execution cancelled
before its model ran. A later Goal Review did author speech. Thus the finding is
not that every response path was permanently silent.

Evidence includes saved graph checkpoints with actual node inputs and outputs,
Coordinator records, Bridge/result data, Robot Status, buffers, server errors,
current source and graph definitions, and six isolated owner-boundary probes.
Raw private evidence is preserved outside the repository in
`/tmp/metahuman-full-auto-audit-uTD5GD/`; its README lists reproduction commands.
No private conversation, persona contents, camera data, or runtime databases are
copied into this report.

The Site, Robot Operator, and Bridge processes were no longer running at the
later process inspection. This report analyzes their recorded execution; it is
not a claim that they remained running throughout the audit. No service was
stopped or started, no model inference was requested, and no robot command was
sent by the audit. Existing worktree changes were preserved.

An adapter's `completed` receipt proves reported execution, not semantic success
or independent physical observation. The user's observation of repeated walking
is consistent with the receipts. Physical camera quality, exact travel, and
audible/browser delivery were not independently exercised.

## 1. What the intended design says

The current authority is
[MAINTAINED_SURFACE, Critical Runtime Ownership Boundaries](../technical/MAINTAINED_SURFACE.md#critical-runtime-ownership-boundaries),
particularly the Mode Controller, Robot Operator, and durable graph owners. The
agreed execution/context requirements are in the
[durable-execution analysis](llm-agent-vs-metahuman-autonomy-analysis.md#authoritative-checkpoint-and-bounded-context)
and its [model-visible context section](llm-agent-vs-metahuman-autonomy-analysis.md#model-visible-context).
The refactor blueprint, audit protocol, current consolidation record, and latency
review were also checked.

The intended product is a contextual, self-directed operator:

1. Receive the active objective, latest action/result, available visual and body
   facts, persona, relevant conversation and inner dialogue, previous activities,
   and optional Desire/memory context.
2. Understand the available capabilities and choose an activity for a reason.
   An activity may be physical action, observation, reflection, curiosity,
   daydreaming, Desire work, other available agent work, and/or outward speech.
3. Execute through the existing capability owner and receive the actual result
   in the same durable execution.
4. Reassess progress and circumstances. Continue, change approach, complete,
   abandon, wait, or choose another relevant activity through LLM decisions.
5. Preserve task continuity without making every utterance or one-shot action a
   goal. Robot Status displays state; it does not invent the next objective.

Specialized graph nodes and conditional execution remain the interface. The
model owns semantic choices; deterministic code owns identity, recorded facts,
delivery, and persistence. Full mode does not require a new user request to have
an opportunity to choose another activity. This does not mean the model must be
forced to move or speak on every decision.

### Documentation drift

[Full Autonomy Workflow Owner Audit](full-autonomy-workflow.md) is dated
September 5 and describes the pre-durable graph arrangements. Its statements
that no graph re-enters itself, that saved images correlate through Robot
Status, and its node inventories no longer describe the current wiring.
[Robot Active Operator Roadmap](../implementation-plans/robot-active-operator-roadmap.md) also contains
older cooldown and separately admitted review arrangements. Those historical
mechanics do not override the current ownership authority or the user's revised
requirements.

The current consolidation tests establish important runtime repairs. They do
not establish that a real model receives the intended capability descriptions,
uses current evidence, or chooses productively across repeated attempts. These
are implementation/documentation gaps, not conflicting architectural authority.

## 2. Intended versus actual

| Responsibility | Intended | Current evidence |
| --- | --- | --- |
| Full-mode admission | One owner continues saved work or starts the next contextual decision | Working in this run; no round-robin selection found |
| Durable continuity | Objective, results, and child workflows retain execution identity | Same execution and child namespaces exist; model-facing state is not consistently updated or presented |
| Latest physical facts | Completion recorded independently of an optional semantic objective change | Task action fields can stay pending when `taskDecision` is null |
| Visual context | Available images inform decisions with their time and correlation stated | New Controller executions omit valid saved frames when their own task is null |
| Capability awareness | Model receives each currently available task's meaning | Catalog meanings are built but appear only in the output schema, not Controller messages |
| Contextual continuation | Reconsider useful capabilities after results | Goal Review's ordinary `continue` path leads only to Robot Autonomy Executor |
| Specialist delegation | Selected purpose reaches the specialist and its result informs the next decision | Boredom handoff field is not read; Controller result nodes have no outgoing decision path |
| Conversation | Optional, model-authored expression informed by context | Early models explicitly returned empty responses; Executor routing did not use its wired history input |
| Efficiency | Concise current state plus relevant evidence, with sufficient answer space | Repeated full observation envelopes grow the prompt beyond 16K; no end-to-end input budget prevents this |

## 3. What caused the observed repetition

Two different routes occurred; they should not be confused with transport replay.

```text
No durable objective selected:
  Controller → Executor: walk → Action Result: no objective change → end
  Full service → new Controller, reconstructed context → walk again

Durable objective selected:
  Controller → Executor → Action Result → Goal Review: continue
                              ↑                │
                              └── Executor ←───┘
  The broader Controller/catalog is not revisited on this continue path.
```

The first five completed cycles each used four model calls: Controller, intent
routing, action selection, and action-result interpretation. All their models
left outward response empty. The Controller repeatedly selected the Executor;
the Executor selected `walk_slow`. Their missing speech was not an additional
unused model call or a discarded nonempty message.

In a representative fifth-cycle decision, the Controller's explanation referred
to an older action as queued even though that action already had a terminal
receipt. The same prompt also contained correct completed-action history.
Therefore it would be inaccurate to claim that *all* feedback was missing. The
model chose an obsolete interpretation from inconsistent views rather than the
current facts. The defects below explain why those views remain inconsistent.

### F1 — Physical-result recording is incorrectly conditional on a semantic decision

Owner: [Robot Status Out](../../packages/core/src/nodes/robot-status/out.node.ts),
`statusTask` and `execute` (lines 136–204 and 244–246).

`statusTask` returns immediately if `taskDecision` is absent. The code that
updates the task's action ID, terminal action status, and feedback is inside that
same function. Meanwhile `lastAction` is updated separately.

The Action Result model is expressly allowed to return `taskDecision: null`
when the result does not change the objective. That valid choice therefore also
prevents a factual task/action update. The isolated probe returned:

```text
lastAction.status: completed
task.actionStatus: coordinated_for_adapter
task.feedback: null
recordTask calls: 0
```

This is a contract defect, not a reason to force a task decision from every
action. The durable event exists, but a model-facing task projection can still
say the action is pending.

Required correction: the execution owner must apply correlated physical facts
regardless of whether the LLM changes objective meaning. Robot Status then
projects that committed state. Keep optional semantic decisions optional.

### F2 — A dashboard projection still competes with the current execution in prompts

Owners: [Robot Status loading](../../packages/core/src/robot-status.ts), lines
416–424; [execution task projection](../../packages/core/src/durable-execution/store.ts),
lines 174–187; [status context projection](../../packages/core/src/nodes/environment/helpers.ts),
lines 166–214; the Executor's `executive-policy` in
[boredom-autonomy-mode.json](../../etc/cognitive-graphs/boredom-autonomy-mode.json).

The storage authority is correctly the durable execution. However, when no task
is active, the dashboard can show a previous cancelled/completed task. In the
representative Controller prompt, `execution.task` was null while Robot Status
contained an older cancelled task and older situation/intent text. The status
context projection preserves task prose and action fields but drops its
`objectiveId`, `executionId`, and `completionCriteria`.

The Executor policy still says, “Preserve an unfinished Robot Status objective.”
Its route description also calls Robot Status the source of an unfinished
objective. This is stale language after migrating authority to Current
Execution. The model must now resolve old narrative, an unrelated dashboard
task, historical dispatch receipts, and the actual checkpoint itself.

Required correction: keep the dashboard useful, but present its identity,
terminal status, timestamps, and relationship to the current execution
accurately. Replace the obsolete ownership wording in the existing prompts.
Do not delete conversation, erase old objectives, or prevent the model from
choosing a new objective because an older one was completed.

### F3 — Valid visual evidence is lost at the new-Controller boundary

Owners: [Environment Image Input](../../packages/core/src/nodes/environment/image-input.node.ts),
lines 64–109; [context image assembly](../../packages/core/src/nodes/robot-operator/context-builder.node.ts),
lines 429–431; Controller graph connections.

The image node accepts a directly triggering frame, or a saved frame matching a
terminal action recorded in `inputs.execution.task`. A new Controller starts
with no task. Its saved Bridge observation is correctly marked as not a new
trigger, but the image selector consequently returns no frame—even when the
saved JPEG is valid and was obtained seconds earlier.

The isolated probe returned zero selected frames and zero malformed-frame
rejections. The representative runtime decision similarly omitted a saved image
from the previous completed movement. Its later Action Result did receive a
correlated image. The Bridge's current state reported camera readiness.

This does not establish a camera disconnection. It establishes an evidence
selection error: “not captured by this new execution” becomes “no usable image.”

Required correction: distinguish the latest available observation from evidence
that verifies one particular action. Both can be supplied with their recorded
time and action reference. Preserve strict result correlation for completion;
do not pretend an older image is live or force a new capture on every decision.
Fresh capture remains an available model-selected capability.

### F4 — Capability descriptions are not part of the Controller's messages

Owners: [Controller context builder](../../packages/core/src/nodes/robot-operator/context-builder.node.ts),
lines 475–477, 530–620, 637–638; [Controller schema](../../packages/core/src/nodes/robot-operator/autonomy-controller-parser.node.ts),
lines 55–79; existing model-router/provider request contracts.

The catalog creates task IDs and descriptions, and the context builder receives
them. It uses them to create `jsonSchema.properties.taskId.description`, but does
not put the catalog in the system/user messages.

This is weaker than the documented requirement to educate the model about its
capabilities. A formatting schema is not a portable replacement for instructions
and capability information. The provider interfaces carry schema and messages
separately. For example, [Ollama's structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs)
also recommends including schema information in the prompt to ground generation.
The probe confirmed that a task's description was absent from messages and
present in the schema. This is not proof of a particular model's list-position
bias; it is proof of an incomplete model-input contract.

The inspected catalog had eleven available tasks: Robot Autonomy Executor,
Boredom Observer, Boredom Movement, Boredom Reflection, Reflector, Daydreamer,
Curiosity, Curiosity Researcher, Inner Curiosity, Train of Thought, and Desire
Agent. The `none` choice was also available. Public tasks are not equivalent to
every internal agent stage; the current catalog consolidates Desire stages, for
example. The other choices have not all been removed, but their descriptions
are not delivered as promised.

Required correction: put the existing catalog's concise meanings in the existing
Controller context. Retain schema validation and current availability checks.
Do not shuffle choices, assign artificial weights, or hardcode motion examples.

### F5 — Goal continuation bypasses the broader activity chooser

Owners: [Goal Review graph](../../etc/cognitive-graphs/robot-goal-review-mode.json),
[Goal Review parser](../../packages/core/src/nodes/robot-operator/goal-review-parser.node.ts),
lines 119–124, and [continuation node](../../packages/core/src/nodes/utility/execution-event-wait.node.ts),
lines 15–26.

Goal Review has no task-catalog input. It can select complete, continue, wait,
request-user, or abandon. For `continue`, its instruction is always sent to
Robot Autonomy Executor. Full mode authorizes that already-selected invocation
immediately. The Executor then invokes Action Result, which can invoke Goal
Review again. There is also a recursive remaining-objective review connection.

The model is still choosing to continue; code is not hardcoding `walk_slow`.
Nevertheless, the available continuation choices are structurally narrower than
the Full Auto Controller's choices. It cannot directly choose a useful reflector,
curiosity agent, or other catalog capability at that decision point while
retaining the same active objective. The broader Controller is reached after
other lifecycle paths, not after every ordinary continuation result.

Required correction: keep semantic outcome review, but return its assessment and
the actual result to the existing contextual capability chooser. Make the
continuation visible in the editable graph and retain one execution. Consolidate
the direct-to-Executor and recursive-review continuation wiring rather than
adding another chooser, poller, or scheduler. Do not require objective completion
before an LLM can choose another useful capability.

This is not a recommendation to append another model call to every iteration.
Reconcile the overlapping Goal Review/Controller next-decision responsibilities
at the existing decision opportunity. Verify the resulting call count and latency
alongside functional behavior; keep action-result interpretation separate from
choosing the next capability.

### F6 — Specialist purpose and return handling are incomplete

Owners: [task dispatch](../../packages/core/src/nodes/robot-operator/task-dispatch.node.ts),
lines 69–118; [Robot Operator Input](../../packages/core/src/nodes/robot-operator/input.node.ts),
lines 35–55; [agent-result wait](../../packages/core/src/nodes/utility/work-result-wait.node.ts);
Controller result edges; [activity-history summary](../../packages/core/src/nodes/robot-operator/autonomy-activity-history.node.ts),
lines 37–118.

For Boredom specialists, dispatch places the selected purpose in
`robotOperatorContext.controllerDecision`. Their input node only reads
`plannerDecision`. The probe supplied a valid selected purpose and got an empty
planner instruction and null planner decision. A specialist may still see a
shared checkpointed objective; that does not restore the missing reason it was
chosen for this step.

Other finite agents receive the Controller fields in Coordinator input metadata.
A maintained-source search did not find their entrypoints consuming this
`controllerDecision` contract. For example, Train of Thought consumes `seed` and
`sourceAgent`, not that field. Dispatching an agent is not proof that the
Controller's targeted brief reaches its prompt. These alternative agents were
not selected in the inspected walking run, so this is a separate integration
finding rather than a claim that they failed during that run.

The durable `agent-result` node does wait for a correlated result, and
`selected-workflow` receives child output. But neither has an outgoing edge to
another Controller decision. The next Full cycle relies on a fresh context
assembly and a compact activity-history record. That summary primarily retains
the prior choice, dispatch status, and older effect fields; it is not the exact
specialist result presented to the same decision process.

Required correction: use each existing specialist's real input/output contract
for the selected brief and return. Remove unconsumed shadow fields. Feed the
correlated result into the next contextual decision under the same execution;
keep the Coordinator as the finite-work owner.

### F7 — Context growth and conflicting histories defeat the increased context size

Owners: [Current Execution input](../../packages/core/src/nodes/utility/execution-context.node.ts),
lines 23–30; [Robot Operator context builder](../../packages/core/src/nodes/robot-operator/context-builder.node.ts);
activity-history projection; existing model request budgeting.

The representative Controller user envelope contained 33,830 characters, before
the system message and output schema. Selected sections were:

| Section | Serialized characters |
| --- | ---: |
| Previous autonomous work and decisions | 14,628 |
| Recent conversation and inner dialogue | 8,802 |
| Active Desires | 2,634 |
| Robot Status | 2,295 |
| Verified action history | 1,147 |
| Active persona | 950 |
| Compact Bridge state | 363 |
| New execution state, without a task or events | 78 |

These are characters, not tokenizer counts. The prompt did include the latest
user turn and eight dialogue entries plus three inner entries. The earlier
missing-user-window regression is not the demonstrated cause in this sample.

For active executions, Current Execution copies up to sixteen complete event
payloads into model context, excluding image bytes. Each observed
`observation_received` payload carried about 6,000 characters of observation/body
and capability data. That accumulates alongside another current Bridge/status
view and other histories. The node does not provide a distinct latest-unprocessed
result view despite the runtime retaining event sequence information.

In two actual multi-attempt executions, model-message text grew to 51,473 and
52,377 characters. Their execution portions alone reached 24,799 and 31,796
characters. The backend rejected requests of 16,932 and 17,720 tokens against a
16,384-token context. These are two underlying failures propagated through
nested workflow calls, not a separate model failure for every stack trace.

Increasing context therefore exposed, but did not solve, the accumulating input
problem. The broad `boundedObject` helper can also replace a large structured
object with a sliced `truncatedJson` string; that is not a sound representation
of authoritative task state.

Required correction: render a coherent typed decision view from the existing
execution, with original objective, success criteria, user steering, pending
action, newest result, and relevant prior outcomes intact. Retain full durable
evidence and existing memory/history owners. Remove duplicate representations
and repeated transport/capability envelopes from the prompt, not inconvenient
events or user instructions. Use the existing model-request owner to account
for the complete input and reserved answer space. Do not promise indefinite
growth can be fixed by another context-size increase.

### F8 — Speech is optional, but the route decision receives less context than the graph suggests

Owners: Executor `intent-orchestrator` configuration and
[Orchestrator prompt rendering](../../packages/core/src/nodes/llm/orchestrator-llm.node.ts),
lines 287–338; conversation/TTS output nodes.

In the inspected early passes, the Controller, action selector, and result
interpreter all returned empty response fields. The Executor orchestrator
selected response, vision, and conversation-history routes as false for the
delegated walking intention. No evidence here shows the chat interface losing
authored speech.

Although conversation history is connected to the Orchestrator, its configured
user template contains only the internal intention. It omits the available
recent-conversation placeholder, so that connected history never reaches this
model call. Its route decision is narrower than the visible input edges imply.
The existing action selector still allows optional expression; there is no need
to force a reply for every action.

Required correction: give that existing route decision the compact intent/context
it actually needs, and preserve any model-authored response through the existing
outputs. Surface silent decision reasons and execution facts in existing debug
views if needed; do not fabricate robot dialogue or require canned narration.

The repeated personal-preference theme in earlier output was present in saved
Desires, narrative, and activity records in this sample, not in the supplied
active-persona text or a maintained hardcoded command to repeat it. This does
not justify deleting the user's preferences. It reinforces the need to separate
historical statements from present body facts and the active task.

### F9 — Success-condition support is only partially connected

`Robot Status Out` accepts `decision.completionCriteria`, but the existing
[Action Selector decision schema](../../packages/core/src/nodes/environment/helpers.ts),
lines 595–606, does not advertise that field. The stored criteria therefore
normally fall back to the objective text when creating a task.

An objective sentence can itself be a good success condition; this is not proof
that every task will fail. It is not, however, the agreed explicit success
condition for multi-step work. Required correction: when the LLM elects to create
or revise an objective, its existing typed decision should carry the completion
condition into the checkpoint. Ordinary conversation and standalone movement
remain free to return no task decision.

## 4. Node-by-node coverage and disposition

The four participating graphs contain 91 nodes: Controller 24, Executor 25,
Action Result 17, and Goal Review 25. The grouped rows below name every node;
grouping shared responsibilities is for readability, not a proposal to merge
the nodes. “Keep” means the responsibility remains necessary, not that every
possible behavior was physically tested.

### Controller — 24 nodes

| Nodes | Actual responsibility and disposition |
| --- | --- |
| `robot-input` | Read the operator trigger; repair specialist handoff contract where reused (F6) |
| `execution` | Load this execution; repair the model-facing event view (F7) |
| `observation` | Read Bridge data; keep, distinguish saved availability from a new trigger |
| `image-input` | Select images; repair new-execution omission (F3) |
| `robot-status` | Read dashboard/body view; preserve execution relationship (F2) |
| `conversation-history`, `inner-history`, `robot-history` | Load separate canonical streams; keep; latest user turn was present |
| `persona-loader`, `persona-formatter`, `active-desires` | Load/format personalization and optional motivation; keep |
| `autonomy-activity` | Summarize prior work; update from actual durable outcomes, not only initial dispatch (F6/F7) |
| `task-catalog` | Obtain available choices and meanings; keep, connect meanings to messages (F4) |
| `policy`, `context` | Supply role and assemble evidence; repair missing meanings and conflicting state (F2–F4/F7) |
| `llm`, `parser` | Make and validate one contextual choice; keep model ownership and strict validation |
| `agent-dispatch`, `executor-dispatch` | Prepare the selected capability call; repair specialist brief contract (F6) |
| `selected-workflow`, `agent-result` | Run/wait for correlated children; add the missing return-to-decision connection (F5/F6) |
| `conversation`, `conversation-memory`, `tts` | Persist, remember, and deliver authored speech; keep optional outputs |

### Robot Autonomy Executor — 25 nodes

| Nodes | Actual responsibility and disposition |
| --- | --- |
| `robot-operator-input`, `execution` | Read delegated intent and active execution; retain their distinct responsibilities |
| `intent-orchestrator` | Choose routes; repair connected-but-unused context (F8) |
| `executive-policy` | Define one-consequence execution; replace obsolete Robot Status ownership language (F2) |
| `observation`, `image-input`, `robot-status` | Read physical evidence/status on applicable paths; shared F2/F3 fixes |
| `conversation-history`, `inner-history`, `robot-history`, `memory-router` | Load selected narrative, outcomes, and recalled experience; keep |
| `persona-loader`, `persona-formatter` | Load/format persona; keep |
| `autonomy-context`, `autonomy-selector`, `action-parser` | Assemble, choose, and validate one effect; fix context/task contract, not preset-specific rules |
| `movement-generator` | Generate a requested novel movement; keep the conditional freestyle branch |
| `bridge-out`, `robot-buffer` | Stage the action and record it; transport worked for the inspected movements |
| `robot-status-out` | Commit semantic change and project state; disentangle factual update from optional decision (F1) |
| `action-results`, `review-action` | Wait for reported execution, then evaluate it in a child graph; retain correlation |
| `conversation-buffer`, `conversation-memory`, `tts-out` | Optional speech persistence/memory/delivery; no missing text shown in early cycles |

### Action Result — 17 nodes

| Nodes | Actual responsibility and disposition |
| --- | --- |
| `observation`, `action-context`, `feedback` | Read and match the returned Bridge result to its action; keep |
| `image` | Select correlated result evidence; actual images reached this graph |
| `robot-input`, `execution`, `robot-status` | Load invocation, execution, and dashboard context; do not equate their authority |
| `policy`, `context`, `llm`, `parser` | Interpret the action versus objective outcome; keep the optional semantic assessment |
| `status-out`, `updated-execution` | Commit/project facts and read the updated task; repair F1 |
| `review-goal` | Invoke semantic objective review when needed; consolidate subsequent continuation ownership (F5) |
| `conversation`, `conversation-memory`, `tts` | Deliver only useful model-authored result speech; keep |

### Goal Review — 25 nodes

| Nodes | Actual responsibility and disposition |
| --- | --- |
| `robot-input`, `execution`, `robot-status` | Load trigger, authoritative objective, and readable state; keep distinct |
| `observation`, `image-input` | Load/select evidence; shared F3 correction |
| `conversation-history`, `inner-history`, `robot-history` | Load narrative and verified outcomes; keep, use coherent context |
| `persona-loader`, `persona-formatter`, `active-desires` | Load personal context/motivation; keep |
| `policy`, `context`, `llm`, `parser` | Assess progress and continuation; retain semantic review, remove competing next-capability responsibility (F5) |
| `status-out` | Commit reviewed outcome/project it; shared F1 correction |
| `prompt-out`, `authorize-continuation`, `selected-workflow` | Currently route ordinary continuation directly to Executor; consolidate through the existing contextual chooser (F5) |
| `remaining-objective`, `review-remaining-objective` | Currently add recursive review; remove superseded recursion with the continuation consolidation |
| `await-context` | Wait for user/autonomy evidence through the existing event mechanism; preserve mode behavior |
| `conversation`, `conversation-memory`, `tts` | Optional reviewed speech; keep |

### Boredom specialist graphs — another 53 nodes reviewed

All three share these fourteen nodes: `observation`, `planner-policy`,
`robot-operator-input`, `robot-status`, `conversation-history`, `inner-history`,
`robot-history`, `persona-loader`, `persona-formatter`, `planner-context`,
`planner`, `decision-parser`, `environment-dispatch`, and `selected-workflow`.
They read their source context, generate an intention with the existing model
router, validate it, and invoke the Executor. Each also has `execution`.
Their shared missing Controller-purpose handoff is F6.

- **Observer, 22 nodes:** additionally has `image-input`, `action-context`,
  `capture-command`, `parse-capture`, `capture-image`, `capture-result`, and
  `captured-observation`. It explicitly captures through the Bridge, waits for
  the result, and supplies that result to its planner. This is an observation
  capability, not a reason to make every Controller capture an image.
- **Movement, 15 nodes:** uses the common nodes to author a contextual movement
  intention. Preserve this distinct task, including movement intent when this
  specialist is deliberately selected.
- **Reflection, 16 nodes:** additionally has `memory-sampler`, providing historical
  material for its planner. Preserve memory-driven reflection as an option.

The non-Boredom finite-agent implementations were reviewed at admission/payload
boundaries for this report, not audited line-by-line internally. Environment Mode
was checked as the user-input comparator, including its shared context/task
contracts; this is not a new audit of every unrelated user-facing workflow.

## 5. Why the previous repairs did not produce the intended behavior

They repaired substantial infrastructure: profile activation, finite-work
admission, cancellation, result correlation, checkpoint resumption, and transport.
The inspected actions demonstrate that those repairs can get a command to the
robot and return a result.

But the migration retained several assumptions from the previous reconstruction
system: Robot Status wording as objective authority, image selection tied to the
old task relationship, initial-dispatch-shaped activity summaries, and nested
Executor-only continuation. Passing runtime tests with predetermined model
responses could not expose all of those mismatches.

The decisive omissions in validation were not more phrase-specific examples.
They were owner-contract checks: whether capability meanings reach messages,
whether a specialist receives its actual brief, whether terminal facts advance
without a semantic change, whether a new Controller gets available sight, whether
the next choice can use every relevant capability, and whether a multi-attempt
prompt still fits the model. The six isolated probes reproduced those boundaries
without asking a real model to behave a particular way.

A better model might resolve some conflicting information more successfully.
That is not evidence the existing integration is correct, and no model-quality
comparison was performed here. Conversely, fixing data flow does not guarantee
perfect autonomous judgment. It makes bad judgment distinguishable from missing
or contradictory information.

## 6. Proper repair sequence within the existing architecture

| Step | Canonical owners and change | Superseded behavior removed | Required evidence |
| --- | --- | --- | --- |
| 1. Make action facts consistent | Execution result transition, Robot Status Out, Current Execution, status-context projection | Factual updates conditional on optional semantic decisions; stale objective-owner wording | Completed/failed/cancelled correlated actions update facts with null semantic decisions; objective remains unchanged unless the LLM changes it |
| 2. Deliver actual context contracts | Existing image selector, Controller context, catalog, specialist input adapters, Orchestrator template | Task-null image omission; schema-only capability education; unconsumed handoff field; unused connected history | Same saved graphs, with mocked effects, receive available images, exact specialist intent, capability descriptions, and relevant route context |
| 3. Reconnect result-driven choice | Existing Controller, Action Result, Goal Review, workflow-call/result nodes | Executor-only continuation and redundant recursive review; terminal specialist outputs with no decision consumer | Physical and specialist results return to a contextual capability choice under the same execution; incomplete goals remain available without forcing the next capability |
| 4. Bound representation, not agency | Current Execution/context projection and existing model request budgeting | Repeated whole observation/capability envelopes and sliced structured state in decision prompts | Multi-attempt input fits the configured context with answer space; objective, corrections, pending action and new evidence remain intact and full history remains durable |
| 5. Verify product behavior | Actual graphs and configured model router; existing chat/debug outputs | Unsupported completion claims based only on fake decisions/builds | Compare before/after recorded prompts and outcomes for contextual movement, observation, specialist choice, goal completion, optional speech, and changed circumstances |

Do not add another runtime, controller service, queue, case-file system, or
parallel memory. Preserve the editor, model assignments, specialized nodes,
preset/freestyle capabilities, optional Desire system, reactive/semi/full modes,
direct emergency stop, and existing cancellation/delivery guarantees.

The choice of activity remains the LLM's. Testing should establish that each
choice has its real data and working route, not demand a fixed rotation, a
particular number of movements, or mandatory speech. No anti-repeat filter,
history deletion, hardcoded preference adjustment, or command-specific fallback
is the proposed correction.

## 7. Verification performed and remaining limits

Completed for this report:

- Compared current documented ownership and intended decision flow with the
  participating graph definitions and canonical implementations.
- Decoded real saved node inputs/outputs and correlated distinct action receipts.
- Measured actual message contents and event-driven growth; confirmed the two
  backend context-overflow errors.
- Reproduced six current defects/missing connections with isolated fixtures:
  task-null image omission, schema-only meanings, lost specialist brief,
  null-decision factual staleness, unconsumed Controller returns, and restricted
  Goal Review continuation wiring. These are failure reproductions, not repaired
  acceptance tests.
- Checked report links and `git diff --check`. No compilation or deployment is
  claimed for this documentation-only change.

Not established by this audit: the efficacy of the proposed fixes, comparative
real-model task-completion rates, physical image quality, camera/firmware safety,
or live browser/audio behavior after a new deployment. No production source,
graph configuration, dependencies, model settings, or runtime state were changed.
The new report and private diagnostic artifacts are the only additions from this
audit. Production repair needs the owner-level changes and verification above;
another passing build alone would not resolve the reported product failure.
