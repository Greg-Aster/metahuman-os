# Environment follow-up context and objective continuity — 2026-09-09

Initial read-only review of seven owner-supplied chat turns after the selector
repair. The findings below describe that baseline; the subsequently authorized
implementation and its verification are recorded separately at the end.
The initial review performed no production change, task mutation, model call,
robot command, or restart.
Private checkpoint extracts remain outside Git at
`/tmp/metahuman-turn-context-review-7a497F/turns.json`; `inspect.mts` opens SQLite
read-only and uses the existing document decoder without constructing a writable
execution store. Fields reported below were read from saved node inputs/outputs,
not inferred from conversational claims.

## Findings

1. **Loaded dialogue is removed before the final decision on follow-ups.**
   The conversation-history node supplied 25 entries, including the recent user
   turns. Each of three continuation requests received a routing decision with
   `needsAction:true` and `needsConversationHistory:false`. The final selector
   consequently received `recentConversation:[]` and selected speech without an
   action. The history was not lost from storage. Owners:
   `nodes/llm/orchestrator-llm.node.ts:287-299,356-366` and
   `nodes/environment/context-builder.node.ts:139-168`.

2. **Graph completion and objective completion diverge.**
   An objective-status question generated a new incomplete objective with
   `continuationPolicy:none`; the workflow finished and its execution was marked
   completed. Its saved task still had `objectiveComplete:false`. Subsequent
   inputs could not steer that terminal execution. The preceding Robot Status
   task referred to an already failed execution, not an active search. The
   status question therefore reconstructed a task rather than resuming one.
   Environment's wait/review branch depends on dispatched commands; there is no
   corresponding visible non-action objective continuation in that graph.
   Owners: `etc/cognitive-graphs/environment-mode.json` nodes `action-results`
   and `review-action`; `durable-execution/runtime.ts:112-117`;
   `nodes/robot-status/out.node.ts:148-176,250-251`.

3. **Execution visibility differs between admission and intent routing.**
   All seven turns received an empty `activeExecutions` array even though an
   older physical execution was waiting. `graph-executor.ts:794-797` omits an
   execution without a saved task. `brain/services/robot-operator.ts:290-312`
   still waits for that unfinished execution before admitting another Full
   cycle. This is an information mismatch: the work preventing new autonomy is
   absent from the router's list of existing executions. It is not proof that
   every standalone motion should acquire an objective.

4. **One recall error is a model error, not missing input.**
   The explicit recent-dialogue question selected conversation history and the
   final selector received the actual last four messages in order. It answered
   using an older statement anyway. Separate reductions remain in the router
   (four messages, 150 characters each) and selector envelope (four messages,
   `SELECTOR_MAX_STRING_LENGTH` per message), but the most recent short request
   and response were both intact in this case. Owner:
   `nodes/environment/helpers.ts:388-391`. Increasing the model token limit is
   not established as a remedy for this observed error.

5. **Explicit search selected actions, but no objective; dispatch remains blocked.**
   The final two requests each produced an admitted preset action with
   `taskDecision:null`. These are independent waiting executions without a task,
   not a continuation of the originally stated multi-step objective. Their
   physical work was queued behind the older unresolved turn. At initial
   inspection that host receipt remained `started`, with no result or pending
   terminal delivery; Core recorded `outcome_unknown` after restart. No new selector-validation failure
   explains these turns. The precise body/gateway terminal-loss cause remains
   unproven and is independent of the conversation problem.

### Subsequent owner cancellation

The Installation Owner cancelled the unresolved action from the queue. Both the
host adapter and Coordinator then recorded a terminal cancellation. The two
queued preset actions and later autonomous turns subsequently received completed
physical receipts. This verifies that the old unresolved receipt was blocking
dispatch and Full-mode admission, and that the user cancellation path released
it. It does not establish why the original completion was missing or resolve the
separate context/objective findings above. The assistant performed no cancellation.

## Repair boundaries to establish before implementation

- Reconcile the existing history node's configured window with the actual
  routing/selector handoff. Follow-up decisions need their conversational referent;
  do not add phrase-specific motion rules or a second context store.
- Preserve the distinction between a finished graph pass, an unfinished
  objective and a pending physical action using the existing durable graph and
  event-wait owners. Expose relevant execution facts consistently. Do not infer
  completion, fabricate objectives for every message, or reactivate historical
  failed work silently.
- Keep Robot Status a projection. The model's task decisions, including its
  observed literal `objective:"none"` and absent search objectives, need separate
  semantic evaluation from correct storage of those decisions.
- Obtain the missing body/gateway ACK/terminal evidence before repairing that
  physical boundary. Context repair is separate from physical receipt recovery.

The initial review did not establish a production repair or improved live behavior.
The preceding selector repair addressed action/progress validation and corrective
inference; it did not prove that these follow-up and non-action lifecycle cases
worked. Concurrent memory/training changes were preserved.

## Subsequent failure and authorized owner repairs

The later autonomous stall was a different failure from the cancelled physical
receipt: 70 selector calls produced two distinct invalid answers, each choosing
both an advertised preset and a freestyle request. All 69 corrective checkpoints
preserved the rejected answer and its validation error. No new physical command
was dispatched by that failed execution.

Independent native-library probes established that the installed Ollama grammar
converter ignored the selector's root `allOf` refinements beside `properties`.
Removing that `allOf` produced identical grammar. The grammar accepted mutually
exclusive motion routes, empty decisions and premature action completion. Core's
parser correctly rejected those outputs; repeatedly adding feedback did not fix
the provider contract.

Authorized implementation:

- The existing shared selector-schema builder now emits a union of complete
  alternatives that the installed converter actually enforces. Advertised
  presets, capture, freestyle, optional speech and optional objective changes
  remain available. The parser is not weakened. Removed the overlapping
  `requireProgress`/`requireAutonomousConsequence` schema options; selected-action
  routing still uses its existing capability contract.
- Buffer History remains the owner of its configured window. Removed downstream
  four-message/text truncation and the duplicate Environment history-limit
  setting, including its editor schema and saved graph property. The intent LLM
  still chooses whether the final selector needs conversation history.
- Current Execution exposes unfinished standalone work as well as objectives,
  with original input and actual wait state. Environment intent now receives its
  own current execution on resumption. No objective is fabricated for a motion.
- Environment and Autonomy explicitly review a remaining objective after their
  decision/result, including passes that selected no physical action. Completed
  objectives and ordinary taskless turns skip that branch. The existing Goal
  Review/continuation wait remains the owner of the next LLM-selected step.
- Independent review reproduced input being consumed during a taskless motion
  without returning to an action-capable decision. The result wait now exposes
  that unchanged input, its ordered events and the correlated returned view.
  After Action Result finishes, the parent's existing child-workflow node sends
  received input through Environment before considering the remaining goal.
- Removed Action Result's continuation tail. It now only interprets and records
  the result; the parent owns continuation ordering. Goal Review receives the
  correlated result context, with explicit activation so an attached data edge
  cannot activate an otherwise unnecessary review.

These are changes to existing owners and editable graph connections. They add no
replacement runtime, scheduler, store, model, phrase-specific motion rule, forced
speech, forced goal, physical timeout or automatic physical replay.

### Input arriving after the result wait

Independent review found a second handoff boundary: a user correction admitted
while Action Result was evaluating an already checkpointed receipt could remain
unread while the parent was marked completed. The redundant wake then returned
the completed checkpoint without another decision. The same case is reachable
when a critical user request interrupts a background resume after its result wait.

The existing event-wait node now also supports receiving available input without
blocking. Environment, Autonomy Executor, Controller and Goal Review declare that
node as their input tail, followed by the existing child-workflow call and
remaining-objective review. The agent-result wait exposes input received during
specialist work as well. The graph, not a hidden runtime router, selects the user
or autonomy workflow. The editor exposes the saved input entry and validates that
it remains an enabled, always-active receiver.

If input arrives after the tail has run, the canonical scheduler resumes only
that declared tail and its downstream nodes with new occurrence identities.
Earlier node outputs and dispatched effects remain checkpointed. Store completion
and input admission serialize in SQLite: accepted unread input keeps an execution
runnable; input arriving after terminal completion is explicitly rejected, not
acknowledged and lost. Repeated committed handoffs return the same receipt.
Delivery/audit receipts alone do not restart model work. Cancellation remains
separate and available regardless of whether a workflow accepts steering.

Independent public-handler overlap and actual Coordinator preemption probes now
pass for Environment and Autonomy: one same-parent follow-up action, no decision
replay on duplicate wakes, and completion after its correlated result. Owner tests
also cover input admitted at finalization, reopening the database, repeated tail
occurrences, specialist input and completion/admission races. These are software
delivery guarantees, not rules about which action the model must choose.

Verification artifacts and exact commands are retained in
`/tmp/metahuman-decision-continuity-repair-m4WEqw` and the independent review in
`/tmp/metahuman-selector-provider-review-Y5UHgs/README.md`. Native-provider probes
verify all 42 advertised presets, capture and freestyle remain admissible while
the invalid route combinations are rejected. Actual saved-workflow tests use the
current nodes, model router, SQLite and Coordinator with isolated state and
mocked external effects. They establish continuation, steering, evidence handoff,
optional goals, branch skipping and same-parent completion—not physical target
recognition or a deployed robot wave.

### Integration with the completed input-memory work

After resumption, the whole durable suite passed 225/225. The Environment routing
test still expected the former direct input edge; it now verifies the exact
User Input → Conversation Buffer → Memory Saver → intent/context path, including
the original text passthrough. The separate provider-failure test confirms that
all four conversational graph prefixes preserve the exact input before inference.

Independent review then reproduced a real integration defect: a user correction
was saved before intent selected an existing execution, but the handoff forwarded
only its text. The target's child workflow saved it again under its own node
occurrence. Both buffer and long-term memory counts grew from one to two.

The existing input handoff now forwards the original `ConversationMessage` entry,
including its admission key and timestamp. User Input exposes that entry through
an optional typed output connected to the existing buffer entry port. The four
conversation graphs preserve this connection; connected text/speech and genuinely
new messages do not inherit a previous chat entry. No new deduper, persistence
owner, phrase rule or memory-suppression flag was added. The unchanged buffer and
memory owners now reuse the original identity across the two executions.

The unchanged independent reproduction passes with one buffer entry and one
memory before and after the target resumes. The maintained owner test also covers
duplicate target resumption and a separate, identical-text request acquiring a
fresh identity. The buffer-ownership check now traces the actual saved assistant
response feeding TTS instead of assuming every typed entry contains an assistant
message. This preserves its exact-response and single-owner assertions.

Final verification commands and results, including earlier failed runs, are in
`/tmp/metahuman-decision-continuity-repair-m4WEqw/README.md`. Subsequent concurrent
memory-reset edits changed Core after one temporary build; its compiled checker
correctly rejected that source mismatch. No compatibility check was bypassed and
no other agent's source was reverted.

The corrected chat-output fixture preserves the authenticated profile context
supplied by the maintained public route and middleware. Its twelve original
delivery/failure/waiting/cancellation cases pass, with assertions unchanged and
independent review. The owner-level handoff, capture, graph/editor, type and
architecture checks also pass for their recorded snapshots. A new temporary Site
build and its real compiled startup checker passed at 16:18 PDT.

The previous broad acceptance run was 225/226 and could not establish a stable-source pass: other
work edited Core Queue at 16:22, reset/response-buffer code at 16:27, and TTS at
16:28. The new-process restart test rejected the changed executable as designed.
The version check and other agent's code remained untouched. That run required a
later stable-source verification; its results from different snapshots were not
treated as one successful deployment.

### Stable-source build verification

After the other agent finished, the reported build failure reproduced exactly:
the Dual Mode test expected 21 nodes, while the completed input-memory workflow
has 23. Its speech-edge assertion and the separate TTS ownership test also still
expected the retired direct Buffer → TTS edge. The two tests now verify the
actual input-persistence prefix and Buffer → Memory Saver → TTS path, including
preserved entry identity and absence of bypass/duplicate speech inputs. Existing
loop, failure, node-contract and artifact-parity checks remain intact. Independent
review found no weakened assertions. No production workflow or runtime changed
for these build-test corrections.

The production source fingerprint stayed unchanged throughout the new tests,
temporary Site build and compiled-checker verification. All 226 durable tests now
pass, including the previously interrupted new-process recovery case. Launcher,
model-defaults, Dual/Environment graph checks, the complete `pnpm validate` chain,
all root-build typecheck packages, architecture/remote-safety, four exact-input
capture cases and all eight touched graph artifact comparisons pass. The isolated
Site build completed in 21.68 seconds and its compiled runtime compatibility test
passes. Existing node-documentation/editor-field and Vite warnings remain visible.
Exact commands, source fingerprint and logs are in the existing evidence README.
The full test command first stopped at the stale TTS assertion; after correction,
its remaining validation chain passed. These are verified build-chain stages,
not a claim that the earlier failing command exited successfully.

The older missing body/gateway completion remains a separate, unproven physical
boundary. The cancelled receipt was not replayed or declared successful. This
repair does not restart historical failed executions, replace the installed Site
build, restart services, edit firmware or issue live robot commands.

### Successive-continuation failures after the rebuilt server

Two distinct terminal errors were traced and reproduced in isolated saved
workflows. Each nested Executor/Goal Review call expanded the entire parent
invocation into the next node's identity. With conversation memory enabled,
successive actions eventually exceeded Memory Capture's 512-character key
contract. Separately, Controller/Goal Review's model schema allowed an empty
Executor instruction while its parser rejected that choice with a generic error,
bypassing the existing model-output correction path.

The canonical graph executor now derives bounded, replay-stable occurrence IDs
from the execution/invocation/node/iteration tuple. Checkpoint ancestry, specialist
return wrappers, committed receipts and executable compatibility remain unchanged.
Memory's boundary was not raised. Controller/Goal Review now generate complete
schema alternatives matching their existing selection/evidence contracts, and
invalid model output returns through `NodeInputValidationError` to the same
configured model. Missing authoritative objective context still fails explicitly.
No action policy, model assignment, workflow wiring, speech requirement, extra
router or retry mechanism was introduced.

All 230 durable tests pass, including six successive real saved-workflow action
cycles with memory enabled, duplicate result delivery, distinct same-text memory
identities, a separate-process restart, and corrected Controller/Goal Review
answers before dispatch. The real speech acknowledgement API accepts the bounded
IDs for renewal/completion without replay. Independent installed-provider grammar
review passed all 281 cases, preserving other agents, optional speech, and goal
completion with a subsequent capability choice. Core/tests type checks, all 38
graphs, Environment/Dual workflow checks, TTS ownership, architecture and diff
checks pass. The isolated Site build and compiled startup checker pass on the
same source. Evidence and exact commands, including failed baselines and isolated
build setup corrections, are in
`/tmp/metahuman-continuation-identity-14AiaV/README.md`.

The installed server and robot were not changed or tested physically. Historical
failed/incompatible executions were not rekeyed or replayed; deployment testing
requires rebuilding/restarting and a new request.

### Follow-up diagnosis: conversational objective closes immediately

Read-only inspection of the reported 17:48–17:55 PDT interval found a different
failure from the identifier repair above. The installed server still used its
17:24 build and expanded occurrence IDs. However, the following decision-contract
defect also reproduces against current source; deployment age does not explain it
away. No production files, profile data, queues or services changed during this
diagnosis.

#### Environment selector / Current Execution / Robot Status output

- Owners: `nodes/environment/helpers.ts:582`, `:608`, `:937` validate model task
  output; `nodes/utility/execution-context.node.ts:64` decides whether the saved
  objective remains active; `nodes/robot-status/out.node.ts:167` stores its
  completion criteria and projects its state.
- A request explicitly establishing an ongoing conversational objective reached
  the selector unchanged and was saved with a real objective ID. Its model
  decision simultaneously said `outcome: complete` and `objectiveComplete: false`.
  The parser accepted both. Current Execution treated the complete outcome as
  terminal, returned `hasActiveTask: false` / `needsGoalReview: false`, and the
  workflow finished without Goal Review. Later Full cycles therefore had no active
  execution objective. This was not a failed memory write or an omitted user input.
- The schema independently exposes both completion signals, allowing the
  contradictory combination. The selector prompt at
  `etc/cognitive-graphs/environment-mode.json:208` frames persistence around action
  results and observations while calling conversation taskless. Its wording does
  not clearly distinguish one conversational reply from an ongoing conversational
  objective. Missing explicit completion criteria are also silently replaced with
  the objective text in Status output; this supplies no meaningful success test.
- A pure, isolated call through the current selector validator and Current
  Execution node reproduced acceptance followed by skipped review. Recommended
  repair: make the existing model-owned lifecycle contract unambiguous, align its
  consumers, and clarify persistence for ongoing conversational requests without
  forcing a goal for ordinary conversation or inferring a state in application
  code. Do not replace an invalid model decision with a fabricated success or
  automatic continuation.

#### Full Controller choices and supplied context

- Owners: `nodes/robot-operator/task-catalog.node.ts` advertises installed choices;
  `context-builder.node.ts:462` packages them; `autonomy-activity-history.node.ts:112`
  includes prior decision rationale; `brain/services/robot-operator.ts:291` resumes
  an active execution or admits a fresh Controller.
- All eleven completed Controller invocations inspected in that interval chose
  Robot Autonomy Executor. The actual saved input advertised ten other finite
  agents, including reflection, daydream, curiosity, and Desire Agent. The later
  Controller context also contained the user's conversational-objective request
  and verified prior action records. Thus agent dispatch was not attempted and
  failing; these were repeated model selections, not a rotation or replay.
- Recorded reasoning cites repeated prior turns as justification for further
  turns. That demonstrates repetition in model decision-making despite available
  alternatives, but does not isolate model capability, prompt wording, list order
  or historical-rationale influence as its sole cause. A controlled comparison is
  needed before changing that context. Preserve history and available choices;
  do not add forced diversification, action bans or a replacement scheduler.

Evidence and read-only commands are in
`/tmp/metahuman-companionship-review-lrAYkw/README.md`. Local detailed checkpoint
extracts remain outside maintained source. Only this audit record and temporary
inspection artifacts were added; no repair is claimed for these new findings.

### Follow-up diagnosis: new person-search request remains taskless

Read-only evidence from 18:19–18:23 PDT on the newly started 18:18:52 server
establishes a separate admission failure. This is not attributed to the previous
server build. Detailed profile checkpoint extracts remain in the same local
inspection directory, not in maintained source.

- **Intent Orchestrator → Environment context / selector:** the new person-search
  instruction arrived unchanged. The orchestrator selected environment, vision,
  action and response routes. A saved Bridge JPEG was available, but
  `nodes/environment/context-builder.node.ts:135` excluded it because it was not
  a current-run observation. The model input correctly distinguished
  `currentVision: false` from `cameraReady: true`; the response nevertheless
  described the camera as not capturing and asked permission while simultaneously
  requesting `captureImage`. Its structured output contained `taskDecision: null`.
  The request consequently never received an authoritative search objective.
- **Bridge → Action Result:** the camera action received correlated completed
  feedback at 18:20:48.878 and a JPEG observation at 18:20:49.508. The Action Result
  context included that image and the originating search instruction. Its model
  output was `response: ""`, `taskDecision: null`. This proves capture, return and
  image attachment at the graph/model-input boundary, not visual identification
  of the requested person. There is no camera-disconnection failure in this
  execution's records.
- **Action Result contract → remaining objective:**
  `nodes/robot-operator/action-result-parser.node.ts:91` permits only a null task
  result when no objective was admitted. That node intentionally reviews an
  existing objective rather than creating one. Current Execution then returned
  `task: null`, `hasActiveTask: false`, `needsGoalReview: false`. The workflow
  completed; it was not stalled waiting for an image or a physical result.
- **Next Full Controller:** the 18:21:12 execution received the new request in
  conversation and Robot Status user context, plus eleven available task choices
  and prior action records. Its execution task was null. The model selected
  another turn, explicitly citing the completed prior search and previous turns
  as reasons for more idle inspection. The recent request was not lost from the
  buffer, and the alternative agents were not absent from its supplied catalog.

The proven break is upstream objective admission, followed by a Controller choice
that disregards the new request despite receiving it. Repair belongs in the
existing model-owned decision/context contract; camera reconnect logic, forced
agent rotation, command bans or a second goal creator would not address this
trace. The cached-image/current-image distinction also needs to be evaluated
without interpreting missing current evidence as broken hardware. No claim is
made that one prompt change has been demonstrated to correct these choices.
No production repair or live robot action was performed during this diagnosis.

#### Why these failures compound

- **Goal admission is the decisive handoff.** The existing selector prompt does
  ask for a durable objective when the requested outcome extends beyond one
  action. In this trace the model did not do that. A null decision is valid for
  genuine standalone actions, and `nodes/robot-status/out.node.ts:151` correctly
  does not invent a missing objective. Consequently a semantically mistaken
  standalone decision follows the same successful runtime path as a genuinely
  standalone capture. Missing continuation is downstream of that decision, not
  failed checkpoint persistence. Adding arbitrary task creation to Status or
  Action Result would create another semantic owner rather than fix admission.
- **Completion is represented inconsistently.** The independent `outcome` and
  `objectiveComplete` fields still accept contradictory values in the Environment
  parser. The existing pure owner probe was rerun and again demonstrated accepted
  conflicting values followed by inactive-task/skip-review outputs. This is a
  reproducible code contract defect, not an inference about model intelligence.
- **The next decision receives conflicting temporal context.** Status output at
  `nodes/robot-status/out.node.ts:272` retains the previous intent when a task
  decision is absent, while `:275` updates user context. The saved Controller
  input therefore contained the new search request but still described current
  intent as post-completion idle inspection. Its ten activity receipts occupied
  12,772 characters of a 29,103-character text envelope and mentioned the previous
  target seventeen times. Those receipts include earlier model reasons as well
  as actual outcomes (`autonomy-activity-history.node.ts:179`). The next model
  reason explicitly cited the prior turning pattern as justification for another
  turn. This supports a self-reinforcing-context hypothesis; it does not prove
  that history volume, field order or prompt wording alone caused the choice.
- **This instance is not explained by the former 8K cutoff.** Recorded successful
  calls used `qwen3.5:9b` through the existing Ollama router, without an adapter.
  The initial selector recorded 1,872 prompt / 99 completion tokens; the following
  Controller recorded 10,290 / 187. Their saved answers were complete JSON. The
  image-result call also recorded image input. No new inference was triggered for
  this diagnosis.
- **Prior validation did not establish semantic reliability.** The durable
  workflow tests exercise real graph/node/router contracts with controlled model
  answers, including taskless actions and correctly supplied objectives. They
  establish delivery, persistence and continuation of those decisions, not that
  the installed model will infer the appropriate objective and choose relevant
  capabilities from real context. Provider grammar tests establish representable
  output choices, not good choices. The observed model-decision failures remain
  uncorrected even where those infrastructure tests pass.

### Authorized repair and verification — 2026-09-09

The existing selector now describes its objective and completion condition before
choosing progress and an immediate effect. `objectiveComplete` is no longer an
independent model output; the parser derives the existing persisted value from
`outcome`. Goal decisions remain optional. The editable Environment and Autonomy
Executor prompts describe this contract without adding calls or forcing motion,
speech, goal creation, or a particular agent choice.

Selected saved images now reach the selector with their recorded timestamps.
Independent review additionally reproduced mismatched image bytes and metadata:
the context helper picked frames independently of Image Input. Its redundant
selection was removed. An explicit `frames` connection now carries the Image
Input selection beside `images`, including in the public graph/editor schema.
Fresh capture remains available; absence of a triggering frame is not described
as camera failure.

Robot Status Out no longer copies another workflow's old intent into a new turn.
An active objective and its intent are projected from the same authoritative
execution. Old assessments remain historical; no profile history was erased.

Verification: 233/233 durable tests, 19 motion tests, five visual-action tests,
selector corpus, Environment/Dual graph checks, Core/Brain/test types, 38 valid
graphs, architecture guardrail, and the separate Site build/compiled-runtime check
pass. Independent review passed 624 schema/parser checks and 624 installed
provider-grammar checks, including the corrected image reproduction. A new saved
workflow test preserves a speech-only objective through review and concludes it
from a later user turn without admitting physical work.

Real qwen3.5:9b replays supplement those controlled-effect tests: three final
companionship decisions and three downstream Goal Reviews retain the ongoing
objective. Three visual replays consume the selected image instead of claiming a
camera disconnection. Visual identification, criteria formulation, and motion
choice still vary; these tests do not establish physical success or general model
reliability. The unsuccessful prompt-only intermediate experiment is preserved.

Evidence and exact commands: `/tmp/metahuman-objective-contract-yVwSun/README.md`;
independent review: `/tmp/metahuman-objective-contract-review-P9DbXr/README.md`.
Unrelated work was preserved. No running server was replaced, physical command
sent, historical objective rewritten, commit made, or push performed. Deployment
and physical behavior require testing after rebuild/restart with a new request.

### Saved-execution input handoff repair — 2026-09-10

The received user input was routed to a waiting execution from an older build.
`graph-executor.ts` advertised it as steerable solely because its saved graph had
an input node. The input was appended, then resume rejected the incompatible
executable. Separately, `persona-chat.ts` classified a committed handoff without
speech as missing output. No requested physical action reached the Bridge.

Discovery, input delivery and resume now share the existing graph-contract
owner's executable check. Unresumable work remains visible with its objective,
original instruction and actual incompatibility reason; it is not automatically
cancelled, migrated or reset. The unchanged incoming input remains in the
Conversation Buffer. The intent model still chooses new work, continuation or
cancellation; invalid steering reports the actual reason. Delivery rechecks a
definition changed during the model decision, before appending the target event.

A committed handoff produces system progress, not synthetic robot speech or an
empty-response error. The existing foreground/background chat terminal handlers
finish tracking even when no answer was generated. Independent review found and
verified corrections for an import cycle and a profile-selection race introduced
during this repair. Concurrent duplicate delivery retains one input event and one
resume job. Cancellation stays independent of executable compatibility.

No new scheduler, store, router, dependency, model call, prompt or movement rule
was added. The former resume-only definition-loading code was consolidated into
the shared contract. Child-only workflow edits retain their existing child-entry
compatibility check; this repair does not migrate historical checkpoints.

Validation on the final source: 236/236 durable tests, four UI/transport tests,
Core/test/Site typechecks, Environment/Dual contracts, all 38 graphs, architecture
and remote-safety checks, separate Site build, compiled-runtime compatibility and
diff checks pass. Independent review reports no remaining handoff finding.

Exact commands, baseline failures, review evidence and final validation results
are recorded in `/tmp/metahuman-handoff-repair-Q5YzpA/README.md` and
`/tmp/metahuman-handoff-independent-a9Z9H5/`. Tests use isolated state and mocked
external effects. Unrelated changes and installed build files were preserved;
no service restart, live robot command, physical verification, commit or push
was performed.
