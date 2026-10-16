# Robot Status Workflow Scratchpad

Status: temporary local acceptance checklist; source is integrated in the current
uncommitted worktree, automatic runtime acceptance remains pending, started
2026-08-27. This file is not maintained architecture documentation and should be
deleted when acceptance is completed or explicitly deferred.

Latest process check: on 2026-08-31 neither the Site nor Robot Operator was
running. Process state recorded in the dated evidence below is historical, not a
claim about the current runtime.

## Goal

Add one independently runnable Robot Status agent and editable cognitive graph
that periodically converts bounded, canonical robot information into a compact
per-profile situational snapshot. Other graphs can opt into that snapshot
through one reusable Robot Status context node.

The snapshot is supporting self-context for Ainekio. It does not execute robot
actions, schedule work, replace fresh Environment evidence, or become a second
goal, queue, buffer, Agency, or Environment state owner.

## Baseline evidence

- The Agent Catalog, `etc/agents.json`, Execution Engine, Robot Operator, and
  cognitive-graph registry have no `robot-status` agent or workflow.
- Robot Operator currently schedules only Boredom Observer, Movement, and
  Reflection.
- Environment Bridge already owns current sessions, latest observations,
  correlated action results, and Ainekio telemetry such as `vbat`.
- Agency storage already owns active desires through `listActiveDesires()`.
- Conversation, inner, system, and robot histories already have four canonical
  per-profile buffers.
- The Conversation interface's System view already reads the canonical System
  Buffer and projects the separate Robot Buffer beside it. A fifth buffer is
  neither needed nor permitted.
- `packages/core/src/state.ts` owns system-level orchestrator working memory in
  `out/state/short-term.json`; it is not profile-resolved robot self-context.

## Canonical ownership

- `packages/core/src/robot-status.ts`: typed, profile-resolved current Robot
  Status snapshot and bounded snapshot history.
- Environment Bridge: raw connection, body telemetry, current observation, and
  correlated action facts.
- Robot Buffer: verified prior action records.
- Conversation Buffer: recent user/assistant narrative used only to infer
  current situational intent.
- Agency storage: active desires and their strength/status.
- Robot Status graph: one bounded LLM pass deriving semantic situation fields
  from those sources.
- Robot Status writer node: validates the semantic result, combines it with
  deterministic source facts, and atomically updates the canonical JSON file.
- System Buffer: one concise visible status update in the System Feed.
- Robot Operator: the only automatic timer/admission owner for Robot Status and
  the three boredom children.
- Work Coordinator: the only queue and interruption owner.

## File format decision

Use JSON for the canonical snapshot. Graphs need typed fields, bounded history,
timestamps, and source separation. Markdown would force every consumer to parse
prose and would make deterministic telemetry indistinguishable from LLM-derived
interpretation.

The System Feed receives a concise human-readable summary generated from the
same validated snapshot; it does not read or duplicate the file.

## Snapshot contract

The snapshot separates source facts from model-derived semantics:

```text
version / updatedAt
sourceUpdatedAt
body                 exact bounded Bridge status, explicit battery voltage,
                     motion availability and activity, and telemetry
lastAction           latest verified Robot Buffer action result, including the
                     preserved semantic movement summary when one exists
agency.activeDesires bounded summaries from Agency storage
situation             LLM-derived summary, environment description,
                      current goal/intent, user context, uncertainties
history               compact prior status summaries only
```

Raw images, full conversations, full desire plans, chain-of-thought, and
unbounded historical snapshots are not persisted.

## Workflow

```text
Robot Operator or manual Agent Monitor run
  -> Robot Status graph
       Environment Bridge Status
       Recent Conversation Buffer
       Recent Robot Buffer
       Active Desires
       Previous Robot Status
       Editable instructions
       Robot Status Context Builder
       one model-router call
       Robot Status Writer
       System Buffer
```

The reusable Robot Status read node is inserted into Boredom Autonomy and
Environment Mode. The Boredom Observer, Movement, and Reflection planner graphs
do not read Robot Status; they author an intention first, and only the downstream
Boredom Autonomy executor combines that intention with Robot Status. Each
consumer includes the snapshot exactly once as supporting context. Fresh
correlated observations and action results remain authoritative for physical
claims.

The read node exposes a compact decision context rather than replaying the full
Bridge snapshot. It keeps current battery, motion, connection, semantic
situation, verified last action, active desires, and bounded status history.
Raw telemetry, gateway state, and capability catalogs remain in the canonical
JSON and in their live Environment owners; they are not duplicated into the
downstream model context where they could crowd out goals or desires.

## Implementation checklist

- [x] Inspect maintained-source and refactor authorities.
- [x] Establish the missing-agent baseline and trace existing owners.
- [x] Confirm the System Feed already has a canonical System Buffer.
- [x] Add typed profile-resolved Robot Status storage.
- [x] Add bounded active-desire retrieval node.
- [x] Extend Environment Bridge Status with bounded current robot telemetry.
- [x] Add Robot Status read, context-builder, and writer nodes.
- [x] Add and validate the editable Robot Status graph.
- [x] Register Robot Status in the Agent Catalog and `etc/agents.json`.
- [x] Add Robot Status to Robot Operator timing/admission and Agent Monitor
      variables without adding another scheduler.
- [x] Feed Robot Status into downstream Boredom Autonomy and Environment Mode
      once while keeping all three boredom planners status-free.
- [x] Add focused storage, node, graph, catalog, and Robot Operator tests.
- [x] Run graph, node-default, architecture, type, build, stale-reference, and
      diff validation.
- [x] Build one coherent canonical site distribution containing the same queue
      owner/service-token module for middleware and the internal enqueue route,
      plus the current Robot Status battery and motion projection.
- [x] Execute the canonical Robot Status work handler without robot-action
      dispatch: all 10 graph nodes completed, one configured-model call ran,
      the profile snapshot updated, and System Buffer persisted one event.
- [ ] Restart the canonical site and Robot Operator together so the graph
      registry and four-child Robot Operator use that built/runtime generation.
- [ ] Observe one automatic Robot Status admission from Robot Operator.
- [x] Verify a live manual run writes a fresh snapshot with current body,
      battery, motion, action, Agency, and semantic fields and appends one
      System Buffer event.
- [x] Verify subsequent live Boredom Autonomy runs load that fresh snapshot
      once.
- [ ] Verify a subsequent live Environment Mode run loads that fresh snapshot
      once; keep physical effects separately unverified unless observed.

## Acceptance evidence

- A manual `workflow.robot-status` run executes the checked-in graph through the
  Work Coordinator.
- The graph performs one model call and atomically updates the current
  per-profile `robot-status.json` snapshot.
- The file contains exact bounded body/action/desire facts and a validated
  semantic situation, with bounded history and no image data.
- The run appends one durable `robot_status` event through the existing System
  Buffer node, making it visible in the System view.
- Robot Operator schedules Robot Status in Semi and Full without overlapping
  another robot-autonomy child.
- Boredom Autonomy and Environment Mode receive the same snapshot through the
  reusable read node without gaining persistence responsibility.
- Focused tests and repository guardrails pass. Live model output, physical
  telemetry, and timing remain separately unverified until the runtime is
  rebuilt/restarted and connected to Ainekio.

## Source validation results

- Focused Robot Status, Robot Operator, Boredom Autonomy, Environment context,
  buffer ownership, and Agent Catalog tests: 6 files passed.
- Core, Brain, repository-test, and Site typechecks: passed; Site reported 353
  files with zero errors, warnings, or hints.
- Cognitive graphs: 27/27 valid. Graph executor coverage: 262 nodes with no
  missing executors. Node defaults and Agent Monitor validation passed; Agent
  Monitor listed `robot-status` as startable.
- Full `pnpm test`: passed after rerunning outside the filesystem sandbox. The
  first run reached the user-agnostic check and was denied permission to spawn
  its read-only `git ls-files`; the unrestricted rerun passed that check and all
  remaining suites.
- Architecture guardrail: zero violations. Site production build and
  `git diff --check`: passed.
- Final source search found one contextual Robot Status snapshot owner, one
  writer, one Robot Operator admission path, and the intended read-node uses in
  Environment Mode and Boredom Autonomy. Existing Environment Bridge
  `robotStatus` telemetry remains an input source rather than a competing
  situational-state owner.
- Consumer regressions now parse the actual Environment selector envelope and
  Boredom Autonomy model messages. They prove that battery, motion, verified
  last action, inferred goal, and active-desire title/reason survive the bounded
  prompt projection. This caught and repaired an existing generic projection
  depth that previously emptied nested active-desire objects.
- The site distribution was rebuilt again after that repair. Its middleware,
  internal enqueue route, and Robot Status runtime import the same generated
  Work Coordinator owner module; the built selector contains the bounded
  Robot Status projection and the built status nodes contain explicit battery,
  motion, situation, action, and active-desire fields.
- A non-physical live acceptance run completed all 10 nodes in the checked-in
  Robot Status graph in 4.099 seconds using the configured Ollama backend. The
  saved snapshot timestamp and the latest `robot_status` System Buffer event
  timestamp match that run. It recorded the latest connected session, motion
  availability, verified completed action, semantic goal/intent, and an empty
  active-desire list. Battery voltage remained explicitly unknown because the
  Bridge supplied no current telemetry timestamp or `vbat`; the workflow did
  not fabricate a value. This run exercised the canonical work handler directly,
  not automatic Work Coordinator admission.
- A second non-physical live run refreshed the snapshot at
  `2026-08-27T17:11:46.437Z`; its System Buffer event followed four milliseconds
  later. Robot Status now describes the latest verified historical motion as a
  16-frame, 4.8-second generated plan ending in `hold`. Movement Generator also
  preserves its semantic plan summary in action metadata for future Robot
  Buffer results, so later status updates retain what the movement represented
  rather than only its protocol type.
- The existing Environment and Boredom Autonomy context builders each loaded
  that same fresh Robot Status timestamp and retained its battery, motion,
  verified action, goal, and Agency desire count. Selectors and action dispatch
  were intentionally not invoked, so this is downstream context evidence and
  not a claim about model decisions or physical behavior.
- The previous site process began at 09:26 from generated
  `mode-controller_Dxh...`; the canonical distribution was rebuilt afterward
  and now consistently imports `mode-controller_CHy...`. While that process was
  alive, middleware ownership remained in the old in-memory module while
  dynamically loaded routes used the replacement module and rejected service
  tokens. The site is now stopped. The still-running Robot Operator remains the
  old three-child process and is retrying against port 4321 with
  `ECONNREFUSED`. This is stale/mixed runtime generation, not a second queue or
  a reason to weaken the coordinator token contract; the site and Robot
  Operator must be restarted together.
- Not yet accepted: coordinated restart into the rebuilt distribution,
  automatic Robot Status admission through Work Coordinator, an automatic
  Semi/Full status cycle, live full-graph downstream selector consumption, or
  any physical Ainekio behavior. The previous goal was
  closed from source validation before these runtime requirements were met; this
  scratchpad remains open until the non-physical runtime evidence is captured.

## Live acceptance update: 2026-08-27 10:16 PDT

- Two Agent Monitor admissions of `workflow.robot-status` completed through the
  Work Coordinator. Queue metadata identifies both as `source=user` and
  `triggeredBy=manual`; they are not evidence of periodic Robot Operator
  admission.
- The second run updated the canonical snapshot at
  `2026-08-27T17:16:46.769Z` and appended the matching System Buffer event. It
  recorded connected session `ainekio-01`, current Bridge telemetry,
  `motion.available=true`, the latest verified `captureImage` result, zero
  active desires, populated semantic situation fields, and three bounded prior
  summaries. The Bridge supplied `vbat=0`; Robot Status preserved that source
  value rather than interpreting it.
- Live Boredom Autonomy executions completed the single `robot-status` read node
  before the context builder and selector. The queue then recorded completed
  command, observation, movement, conversation, and continuation work matching
  the operator-visible crab-walk and camera sequence. This proves runtime
  consumption and protocol-level completion; the user's observation is the
  separate physical confirmation.
- The live Robot Operator state still contained only Boredom Observer, Movement,
  and Reflection. At `17:16:04Z` it automatically admitted those three agents,
  while no automatic Robot Status item was admitted. The operator process had
  not been restarted into the four-child source generation, so periodic Robot
  Status remains unaccepted.
- The terminal failures during otherwise successful autonomy turns were
  `vector.semantic-search` embedding calls, not Robot Status or robot-action
  failures. Embeddings are configured for the enabled, auto-started local model
  service on port 4324, but the service was absent. Its launcher trusted the
  stale `logs/run/local-models.pid` value `133` because that PID existed at
  launch time, reported `already running`, and never checked the service health
  or process identity. Port 4324 remained closed, so semantic familiarity
  searches failed while the main Environment observations continued. Repairing
  that launcher is a separate local-model service lifecycle task, not a reason
  to alter Robot Status or autonomy error handling.
- The System Feed projection previously published only the model-authored
  `situationalSummary`. That hid the rest of the saved snapshot and repeatedly
  exposed a historical lockout narrative. The canonical Robot Status Writer now
  publishes a compact report from the validated snapshot it just saved:
  timestamp, robot connection, battery, motion, last verified action,
  environment, goal, intent, user context, active desires, and uncertainties.
  The editable status instruction now carries historical conditions forward
  only when current deterministic facts still support them. The existing
  writer-to-System-Buffer edge remains the sole publication path.
- Focused Robot Status tests, Core typecheck, 27/27 graph validation, node
  defaults, architecture guardrail, site production build, stale-reference
  search, and `git diff --check` passed for the System Feed repair. The rebuilt
  site distribution contains the new report formatter. A fresh live Robot
  Status run remains required to verify the rendered event with current robot
  data.


### 2026-10-14 20:45–20:46 PDT — body-event backlog after handling the robot

- Owner reported ten Queue items after turning on and moving the robot. Authenticated live Queue read at 20:45:14 confirmed ten unfinished work items: seven `environment.observation` jobs and three `graph.resume` jobs belonging to two Body Event Trigger executions. Two were running and eight queued; these were not completed history rows.
- Read-only inspection of the existing SQLite ledger identified the seven observations as two `tipped` events and five `rapid_movement` events, with distinct event identities/timestamps from 20:41:58 through 20:43:24. The bridge admitted them to `body-event-trigger`; no user speech was present in those seven inputs.
- Execution `eaa825d1-7ed5-41dc-8d5d-24a6fbe99356` retained one accepted resume and one pending follow-up, rather than the earlier unbounded per-event resume fan-out. Its Persona Qwen3.5 9B image-input call failed after 107,993 ms with `llama.cpp returned no assistant text (finish reason: length)`; retry failed again after 112,704 ms. Other successful Persona/Visual Planning calls took approximately 105–108 seconds. These API elapsed times include any backend waiting and do not establish pure generation speed.
- At 20:46:13 ten items remained, now three running/seven queued; at least one original observation and one resume had completed, so the system was making progress but accumulating slow body-event processing. No unresolved physical Stop receipt was established as this backlog's cause.
- Remaining diagnosis: inspect the failed call's saved input/output and backend timings, including reasoning and image processing; trace whether the event's selected objective actually warranted its subsequent review. Goal Review currently enables reasoning with maxTokens 8192, but this setting alone does not prove why these calls returned no assistant text. Preserve distinct event evidence when considering any admission/lifecycle repair; do not silently discard events or impose new behavior limits.
- Inspection only: no model calls, robot commands, cancellations, restarts or production source changes. Private snapshots: `/tmp/robot-ready/natural-wake-2026-10-15T03-45-24-645Z.json`; audit evidence: `logs/audit/2026-10-15.ndjson`.


### 2026-10-14 20:54 onward — repeated body reactions, cancellation, and evidence repair

Confirmed causal chain from saved model inputs/outputs:

1. Distinct body events created distinct Body Event Trigger executions. The Qwen 9B event interpreter repeatedly copied “Whoopsie-daisy” and an earlier execution's stretch/stand objective into new instructions, despite its own `currentTask` being null. The 20:58:29 boot event (`1484b289-ee47-4227-a13e-22036efd99ce`) explicitly claimed that null field contained an unfinished task. This is model misinterpretation, not the queue replaying one identical admission.
2. The .8B Task model selected that speech and motion again. Body receipts include both completed and rejected stretches; the rejection text is `Motion mapping failed or pulse exceeds PWM timer capacity`. The firmware maps multiple invalid-argument paths to that text, so it does not establish which mapping/pulse operation failed. No firmware or calibration change was made here.
3. Goal Review generated another user-visible response, in one case copying the just-delivered response almost verbatim, and selected continuation. The subsequent Task call repeated the original program even though returned evidence included rejection and already-delivered speech. Distinct producer/occurrence identities explain the multiple chat entries; text deduplication would conceal the faulty decisions.
4. Current Execution separately cut the event stream to its last sixteen entries. In incident review inputs, display/speech/resume records evicted early action evidence. This is a concrete delivery defect independent of the model mistakes.

Owner-authorized cancellation used the existing Queue execution API. The two remaining executions at 20:56 were cancelled; Queue reported zero work afterward. A new boot at 20:58:29 admitted another reaction; this was a new execution, not resurrection of a cancelled one. It and its pending speech were subsequently cancelled under the same incident authorization. At 21:00:32 the API again reported zero running/queued items and no unfinished executions. Physical rest was not inferred from this Queue state.

The dream question in the supplied transcript belongs to execution `2a65e42a-9b1c-4acf-9bdd-db38aa0ac43f`, distinct from the boot execution producing the intervening stretch replies. Its saved execution is failed. Do not describe the interleaved stretch replies as a verified answer to or rerouting of that dream request. Separate concurrent dream-routing work is outside this repair.

Source repairs in progress/validation:

- Removed the sixteen-event cutoff from the existing Current Execution node, its editor schema, and every maintained graph configuration using it. Complete ordered execution evidence retains existing image references and observation-change compaction; no extra store, scheduler, response filter, or automatic stop was added.
- Body Event now uses the existing shared Robot Status context projection instead of injecting the full saved gateway snapshot containing older body events. Read-time live status and independently attributed active executions remain available. Shared status projection preserves its execution/effect provenance and complete task outcomes, feedback, dates, and uncertainties; removed its field/depth budgets for those records.
- Forty focused context/status tests pass, including early rejection/correction preservation after 24 later display events, unchanged original records/image bytes, and new boot versus historical tip attribution. Core typecheck, all 45 graph definitions, and node-default validation passed; the latter retains pre-existing documentation/persistence warnings. Staged Site build is tracked separately; activation is not yet claimed.

Offline model qualification, with no robot dispatch or chat publication:

- Owner approved exact factual ownership and already-delivered-response clarifications. The event wording alone was evaluated on two saved cases, three repeats per variant: all six baseline outputs copied the old phrase/task; five of six clarified outputs did too, and the sixth misidentified boot as a historical tip. No demonstrated semantic fix; that wording has not been applied to production graphs.
- Seven further calls compared shared status projection alone and projection plus the approved wording. Some boot outputs recognized the boot and selected a new sequence, but rapid-event task copying persisted and two no-action outputs used null `instruction`, failing the existing string contract. Qualification remains incomplete; no reliable behavioral success is claimed.
- The application and model endpoints disappeared during the eighth projected replay. The lead terminated only its own evaluation process and asked whether services should remain off. Goal Review reasoning was concurrently changed from true to false by another task; that edit was preserved. The approved Goal Review wording evaluation was prepared but not run before shutdown. No services were restarted by this repair.

Private frozen inputs, complete outputs, and evaluation scripts: `logs/benchmarks/body-event-loop-20261014/`. Remaining work: finish controlled model qualification when service ownership is resolved, verify compiled source, and activate only within the owner's runtime authorization. Source evidence delivery is repaired; model interpretation, response repetition, and the firmware rejection are not declared solved.

Staged Site build completed at 21:08:26 PDT under `apps/site/node_modules/.cache/body-event-repair-build`; source repairs have not been activated. The task adds no new response suppression or retry gate.
Compiled runtime verification subsequently passed against `/home/greggles/metahuman`, including all 45 workflows. Model qualification remains incomplete because services stopped; the approved Goal Review wording remains unapplied and unevaluated.

## 2026-10-15 — speech interruption and abandoned delivery repair

### 09:08 PDT incident — repeated approach announcement, one conversation entry

Read-only investigation of execution `16873fd9-9c17-4087-a0ce-9a41f52b122d` found two distinct model-selected utterances. Task speech work `task-1792080487395-4f591dc2` spoke “I'm moving closer now to get a better look at your expression.” Its two chunks completed at 09:08:13 and 09:08:15. Conversation inference `task-1792080501807-1138d9eb` then generated the longer glare response, repeating that sentence as its opening. Speech work `task-1792080510074-71d712c9` rendered that full response once; its three chunks completed at 09:08:36, 09:08:43 and 09:08:51. Body Control receipts identify computer playback. The supplied conversation context already contained the initial speech text, its delivery identity, and completed speech evidence in `taskResult`; this was not an absent-receipt case. The Task speech branch calls TTS directly without conversation-buffer admission, whereas conversation delivery persists its response before TTS. That explains two audible occurrences of the opening with one full chat entry. Records establish repetition of the opening; they do not establish two complete playbacks of the full paragraph. No source changes, model calls, or robot commands were made for this investigation. Remaining work: align selected task speech with canonical conversation evidence and separately evaluate the model's repetition despite supplied completion evidence, without text filtering or unapproved prompt changes.

### 09:21 PDT — remove Task's direct speech delivery path

Owner explicitly authorized removing the duplicate path while retaining model-selected speech steps. Active Task now calls the same Environment conversation-delivery owner as generated Persona replies. That owner runs the existing editable `environment-conversation` graph: buffer admission, configured memory capture, then TTS Output. Selected text is passed unchanged; no model inference, prompt change, response filter, new queue or playback wait was added. TTS Output returns its existing admission result to the task's receipt tracking. Existing speech-step admission errors remain errors.

Eighteen focused tests passed, including a real isolated durable-graph integration: one exact assistant buffer record, one long-term memory record with memory saving enabled, one robot-render admission, and no duplicate record/admission when the saved execution is replayed. The task finishes its selected phases without a graph-node playback wait; the execution separately retains its outstanding render work. Core typecheck, staged Site build and compiled/source verification of 45 workflows passed. Both speech tests are registered in the durable-execution test command. No physical actions or model evaluations were dispatched for this repair.

Activation is pending: Full Auto still had unfinished workflows at the deployment check. Requested approval to briefly pause admission, cancel those live workflows with their results preserved, and restart MetaHuman. This repair does not establish that the Persona model will stop choosing repeated words; that remains a separate evaluation.

### 09:30 PDT — duplicate feed entries traced to Goal Review

Read-only inspection confirmed exact duplicate persisted conversation entries, not a browser-only rendering duplication. In execution `87831981-1f0a-4186-a211-66ccd8f910d5`, the Persona conversation at 09:19:57 was repeated at 09:20:18; the next Persona conversation at 09:21:34 was repeated at 09:22:07. Each pair has distinct buffer occurrence keys and distinct robot-speech rendering work. Saved Goal Review checkpoints contain the exact earlier Persona text in the review model's raw JSON `response` field, which its parser forwards for delivery. Both reviews selected `outcome:continue`, resulting in additional observation/continuation work. This is an independently authored duplicate response from Goal Review, not a transport replay or the Task executor's direct-TTS branch. Removing that Task bypass does not resolve these review-generated duplicates. No prompt changes, runtime mutations, or physical/model calls were made during this diagnosis; next repair boundary is Goal Review's user-response responsibility and its handoff to the conversation owner.

Owner clarified the product contract: new input proceeds immediately and newer speech interrupts the previous utterance. Completion receipts report outcomes; an old speech receipt must not authorize or delay replacement playback. Chunks within the same utterance retain their order. No model-visible instructions changed.

Observed startup backlog at 08:18 PDT: 18 speech chunks and five graph continuations. The first speech claim was from the previous evening. Its action identity had no record in the running Body Control receipt database; Core had restored the claimed item as outcome_unknown without requesting cancellation/reconciliation. Shared user-turn interruption cleared browser delivery only. Body Control additionally serialized whole PCM producers, delaying replacement speech.

Repairs at existing owners:
- Coordinator interruption cancels old render work and unsent chunks, allows replacement speech immediately without the old receipt, and preserves movement independence. Late chunks and responses from interrupted turns cannot replace current speech.
- Shared TTS user-input/manual interruption now reaches robot speech. Stream closure releases its own interrupted delivery through the existing cancellation transport. Restart performs the same reconciliation and cancels the interrupted utterance's remaining chunks.
- Unsent speech cancellation now delivers factual not-sent evidence to the owning durable execution. Activation exposed a race between that delivery and terminated-parent reconciliation; confirmUndispatched now verifies the original receipt and reuses its committed confirmation, including after terminal result delivery. The parent objective is not automatically cancelled or declared achieved.
- Body Control cancels the previous PCM producer at the speaker handoff; its computer playback path also interrupts the previous process. These changes do not flash firmware, synthesize substitute responses, or change model choices.

Validation: 33 final Coordinator/cancellation tests, eight stream/camera-read tests, 65 receipt/recovery tests, and 18 Body Control speech/pacing tests passed. TTS delivery tests also passed. The existing gateway-restart speech test expected a fabricated cancellation; updated it to require unknown earlier effect plus positively identified ended execution session. Core typecheck and staged build passed before final activation; final deployment verification follows below.

Broader workflow test limitation: 34 existing tests fail on stale intent fixtures or associated graph expectations (for example needsConversationHistory/needsMemory/needsRobotStatus are no longer accepted intent fields). Those tests fail before the speech repair path; their contract migration is separate work, not concealed by relaxed parsing. Repeated Body Event/model-authored reactions and motion-mapping errors remain separate unresolved issues. User explicitly approved activation after observing MetaHuman had been stopped externally.

Activation and live evidence, 08:50–08:56 PDT:
- Final staged build and compiled-runtime parity verification passed, including 45 graph definitions. MetaHuman started through `start.sh --app-only`; Body Control restarted through its existing physical-gateway entrypoint. Existing model and Kokoro services were retained. No firmware was flashed and no movement test was dispatched.
- The previous evening's abandoned speech claim received a real cancellation result from Body Control after reconnection. Its missing historical receipt no longer holds the speech resource.
- First live test used an unsupported standalone, non-durable rendering invocation. Playback interruption occurred, but both rendering jobs failed with `Robot speech admission did not complete`; this is not counted as a passing graph integration test. Evidence: `/tmp/robot-ready/live-speech-replacement-result.json`.
- Repeated using the existing audio-preparation, command-preparation and Coordinator submission owners. The first utterance was playing; the second interrupted it, cancelled its remaining unsent chunk, and completed playback. Replacement command admitted at 15:55:55.400 UTC; old playback cancellation recorded at 15:55:55.545 UTC, and replacement playback completed at 15:55:59.797 UTC. Evidence: `/tmp/robot-ready/live-prepared-speech-replacement-result.json`.
- Playback target was Body Control's configured **computer** speakers. This proves live transport/computer playback interruption, not physical robot-speaker playback or an end-to-end model conversation. Robot transport preemption is covered by the gateway tests.
- Authenticated Queue snapshot at 08:56:04 PDT contained no active tasks, zero queued/running work, and no in-flight remote work. Evidence: `/tmp/robot-ready/natural-wake-2026-10-15T15-56-04-814Z.json`. Startup also reported old saved-graph conflicts and Body Event model-output failures; those are not declared resolved by this speech repair.

### 10:13 PDT — one final conversation output and selected-result handoff

Owner approved removing Goal Review's outward `response` field and supplying its assessment to final conversation instead. Owner additionally clarified that replies are not goals: Intent `needsResponse` selects the conversation route. Approved removing `response` from Task/Goal Review completion-basis choices; the remaining model-visible choices are action_result, visual_observation, environment_state and user_input. No other model prompt text was changed.

Environment Mode and Robot Autonomy Executor now order selected task results and applicable Goal Review before the final context builder. Intent analysis connects directly to `routingAnalysis`; each consumer retains its independently selected context. Existing graph dependencies provide readiness; inactive sources remain skipped. The builder does not generate text: the configured Persona model does, followed by one explicit Conversation Out. Goal Review's conversation, memory and TTS nodes were deleted. Its internal recursive continuation/wait nodes were removed; assessment and selected continuation return to the caller, which handles continuation after selected response delivery. Robot Autonomy Controller's direct review consumer uses the same finite assessment contract. No polling, timeout, response filter or duplicate-message suppression was added.

The existing execution-event receiver accepts the returned continuation once per pass; newer human input and task-result handoffs retain precedence. An interrupted/unfinished task pass does not start premature review or final conversation. Updated graph labels, positions and the editor-only guide distinguish context, task execution, assessment, Persona, Conversation Out and continuation. Browser node ports and canonical/public graph copies match. The graph validator now recognizes nested output paths already supported by the executor (for the child assessment and continuation outputs).

Validation: 81 focused owner/integration tests passed, plus 22 executor tests. A later targeted rerun of four action/result/continuation/restart cases passed after marking Conversation Out as the explicit graph output; 14 Task contract tests passed after adding rejection of response-goal output. Core typecheck, staged Site build and compiled-runtime parity verification of all 45 workflows passed. Simulated tests prove selected slow data delays the join, unselected camera work never starts, greetings call only Intent and Persona, assessment/receipts reach Persona, continuation starts after the reply is recorded, newer input supersedes an old continuation, and saved replies/assessments survive restart without regeneration or duplicate admission. No physical actions or actual-model qualification calls were dispatched.

Broader consumer check: 155/174 initially passed; 15 failures were Goal Review fixtures using its removed response field/old internal continuation ownership and were migrated and passed in the focused run. Four other existing failures remain outside this repair: two active-task-state tests expect the retired action-only review eligibility, one speech-interruption test expects an older job to complete rather than cancel, and one planner-context test rejects already-present capability wording. These do not constitute a passing full-suite baseline. Evidence: /tmp/robot-ready/final-response-{acceptance,scheduler,final-handoff,contract,consumers,typecheck,build,runtime-check}.log.

Activation: authenticated Queue inspection at 10:13 PDT showed Reactive mode, zero tasks and zero unfinished executions. Activated the verified staged build through the existing app-only restart owner; no workflows were cancelled. The earlier Task direct-TTS removal is included. Previous generated build retained under apps/site/node_modules/.cache/before-final-response-20261015-1013. Runtime health verification follows. Actual-model routing/grounding quality and physical playback remain separate live checks; removing the competing Goal Review publisher does not prove a model will never independently repeat wording on another turn.

Post-activation check at 10:14 PDT: compiled runtime matches source and validates all 45 graphs; server PID 197453 is running. Authenticated Queue GET returned HTTP 200, lifecycle running, paused=false, degraded=false, zero tasks and zero unfinished executions. Startup nevertheless reported old receipt-recovery errors, including task-1792077456059-18051f28: Execution intent is not eligible for non-dispatch confirmation. This is an unresolved runtime finding, not hidden by the empty Queue or declared fixed by the final-response repair. No receipt was deleted or fabricated.


### October 15 — Goal Review updates state; Active Operator owns further work

The 10:22–10:29 Boredom Observer burst was one durable execution. Its visual planner authored speech steps and walk commands; Persona also authored a final reply on each pass. Goal Review's `continue` assessment constructed another Environment/autonomy invocation, causing immediate replanning of the same goal. The supplied autonomy attribution was present, but the planner called its own intention a user request. Review inferred screen-viewing progress from face detections, which did not establish screen readability. These model errors and overlapping program-speech/Persona announcements remain separate from the removed execution loop.

Owner clarified that Goal Review updates Robot Status only; Full Auto or an appropriately triggered Semi Auto agent considers goals with other available context, plans work and executes it. After selected work, review can evolve or retire a goal. Explicitly authorized removal of the continue assessment and approved the exact objective/completionCriteria revision wording.

Removed continue from the review schema/parser/prompt; deleted the parser's workflow invocation and unused awaitContinuation output, caller continuation edges, Autonomy Controller's continue-reviewed-objective node and the event receiver's assessment-continuation input. Preserved actual user/autonomy events and task-result handoffs. Review now returns model-authored objective and completionCriteria through the existing Robot Status Out/durable execution owner, preserving the original instruction, objective identity and receipts. Abandonment retires active consideration without claiming success. No new manager, scheduling path, duplicate filter or automatic stop was added.

Validation and activation are pending below. Tests use simulated provider and robot transports. The initial regression pass exposed two fixture adapter setup errors (corrected) and two restart-version conflicts while source was changing; these are not passing evidence.

Validation: 69 distinct focused tests pass (68 in the combined run plus the affected Robot Status graph-contract test after migrating its retired activity-selection assertions). Coverage includes all supported assessment outcomes in Reactive/Semi/Full modes, no review-started workflow or speech, one Intent-selected final response, no further calls without new input, preserved revised-goal provenance/receipts, abandonment without fabricated success, revised-goal delivery to a separately triggered Full Auto controller, and saved-answer/receipt restart. Core typecheck and staged Site build passed. Compiled runtime matches current source and validates all 45 workflows. Task-scoped diff check passed. Evidence: /tmp/goal-review-removal-{tests-v2,status-rerun,typecheck,build,runtime}.log. No actual-model inference or physical actions were dispatched by these tests.

Activation pending owner permission: the 10:40 read found a newer Boredom Movement execution (b73bf620-f558-4f4b-8e92-92662bcedbb3) with a perception wait and live command work. Asked to cancel that execution through Queue and restart the app; have not cancelled it or changed running services. The 10:22 execution is no longer listed as active. Built output is staged at apps/site/node_modules/.cache/goal-review-state-only-build.


### October 15 — Visible autonomy intentions and long-term recall

Owner requested that autonomy-to-Environment commands expose the model's reasoning in the existing Inner Dialogue output and save the entry to memory under autonomy. Source inspection found that selected plannerDecision records existed in execution checkpoints, and optional outward responses could be saved as conversation, but the four autonomy-to-execution handoffs had no Inner Dialogue Buffer or Inner Dialogue Memory Saver.

The shared Robot Operator Environment Dispatch now emits a reflection entry containing its delegated instruction, stated reason and observation. Observer, Movement, Reflection and Full Auto Controller graphs route the entry through the two existing output nodes before forwarding the unchanged child invocation. Saved entries retain source=autonomy, dialogueSource/agentId, decision timestamp, original observation timestamp, triggerSource, sessionId, cycleId/correlationId, step, target graph, executionId and structured plannerDecision. Tags include autonomy and autonomy-intention. A manually triggered autonomy planner retains triggerSource=user without attributing its model-generated intention to the user. No model-visible prompt change or extra LLM call was made. No TTS path was added.

The existing memory-write policy remains at its owner; Environment-triggered workflows provide canWriteMemory(environment), which currently enables these saves. Buffer admission and long-term capture retain existing occurrence identities, so resuming the same execution does not republish its entry, while distinct decisions with equal text remain separate records. Controller entries gain an Autonomy label in the existing reflection card; the three Boredom labels already existed. Validation and activation follow below.

Validation: 44 combined tests passed across the new six-case autonomy intention suite, existing autonomy workflow tests and durable goal-continuation integration. The new suite exercises each of the four real saved handoff/output paths with simulated child execution, real durable buffer admission and actual local memory files, checks unchanged delegated instruction, full provenance/time preservation, no public conversation, no duplicate replay, distinct equal-text decisions and rejected handoffs. Three additional delegation/dispatch checks passed. A broader name selection also hit the already-recorded planner-context assertion rejecting the pre-existing requested-step-count capability text; that unrelated test remains failing and was not weakened.

Core typecheck passed. The final Site build includes the Autonomy card label; compiled runtime/source parity and all 45 saved workflows validate. Canonical/public graph copies match and task-scoped diff check passed. Evidence: /tmp/autonomy-inner-output-{integration,dispatch-tests,typecheck,build,runtime}.log. No production model or physical robot action was called by these tests. No new prompt wording was introduced by this output repair.

Not activated: the combined Goal Review and autonomy-inner-output changes are staged in apps/site/node_modules/.cache/autonomy-inner-output-build, superseding the earlier staged Goal Review build. The previously requested live-work cancellation/restart approval remains pending; no additional work was cancelled and running services were not changed.

Activation at 10:54 PDT: owner explicitly requested activation. The authenticated pre-activation Queue read found zero queued/running tasks and no unfinished executions, so no workflow or command cancellation was necessary. Verified staged compiled-runtime/source parity, retained the previous build at apps/site/node_modules/.cache/before-autonomy-inner-output-20261015-105426, switched the staged build into apps/site/dist, and requested the existing app-only restart via ./start.sh --restart-app. Model and Body Control services were left to their existing owners. The new server reports listening at 10:54:26 PDT. Authenticated Queue returned HTTP 200 with coordinator running, paused=false, degraded=false and no unfinished executions. Served Goal Review and all four autonomy handoff graphs contain the repaired contract/output wiring. Compiled runtime matches current source and validates all 45 workflows. No physical action or actual-model evaluation was dispatched to verify activation; live model and robot behavior remain to be observed. Evidence: /tmp/autonomy-inner-output-live-runtime.log and /tmp/robot-ready/natural-wake-2026-10-15T17-54-35-452Z.json.


### October 15 — Autonomous evidence handoff and shared execution workflow (in progress)

The recorded lighting incident supplied Task with inputSource=autonomy and the planner decision, but Qwen described it as a user suggestion. That Task call contained no persona, dialogue history or retrieved memories, so those sources did not directly cause this instance. Unchanged-context replay reproduced the error twice. The approved attribution wording failed 3/3 replays, assistant-role authorship failed 3/3, and their combination failed 3/3; none is deployed. Big Brother interpreted authorship correctly in two identical-context baseline comparisons. These are narrow actual-model observations, not overall accuracy or physical success. No actions were dispatched by these evaluations. Evidence is retained locally under /tmp/autonomy-evidence-repair.

Separately repaired the factual handoff: Observer/Controller now carry the selected frame identities, original timestamps and current-image selection into execution. The observation-current flag comes from the bridge output, rather than inherited initial context. Task-selected speech now carries the same autonomy provenance as Persona responses through existing buffer, memory and speech owners. Thirty-five distinct focused tests, Core typecheck, staged Site build and all 45 then-existing workflow validations passed; these source changes were not activated before the next requested refactor.

Owner authorized merging Robot Autonomy Executor into Environment Mode with two explicit inputs, then explicitly requested deletion of the duplicate executor to prevent confusion and regression. Environment Mode remains the single execution graph. The independent Autonomy Controller and boredom planners remain intention producers. The merge preserves existing human/autonomy prompt text verbatim, source metadata, and selected result joins; it does not deploy the failed prompt experiments or train an adapter. Validation and activation remain pending. After the shared workflow is stable, paired human/autonomy attribution tests should qualify any proposed training change; no autonomy LoRA is yet trained or selected. Separate known Goal Review grammar compilation and cancellation-recovery failures remain unresolved by this change.

Merge implementation: Environment Mode now has Human Input and Autonomy Input feeding the existing Environment Request join. Shared Intent/context nodes select their original source-specific prompt properties. All eight instruction strings were compared byte-for-byte with the pre-merge graphs. Source metadata reaches Task speech and Persona; a new human message clears inherited planner attribution. Body Event and autonomous producers replace the other source's inherited turn fields. The two retired executor JSON files are deleted, all maintained callers and training prompt loading now use Environment Mode, and the duplicate service-level autonomyGraph setting was removed in favor of environmentGraph. The Controller remains separate. History keeps its pre-merge source-specific inner-dialogue selection. Shared Task/vision model nodes use Environment Mode's existing sampling settings (repeatPenalty=1); the retired executor had 1.15. No model-role assignment was changed by this merge.

Concurrent-work note: another owner-authorized task consolidated environmentIntent into orchestrator and moved larger planning delegation to planner while tests were running. The owner confirmed that migration; this repair preserves it and updates its isolated fixtures accordingly. A newer Goal Review role assignment also required psychotherapist in the isolated test model registry. These changes invalidated the intermediate build and some fresh-process test runs; those runs do not establish acceptance.

Broader baseline findings, not repaired here: durable-execution/workflows.spec.ts still supplies retired Intent fields, producing unsupported-field failures and subsequent fixture lease failures (34 failures). buffer-ownership.spec.ts expects retired direct Environment/Goal Review conversation writers and omits current delivery graphs. robot-operator.spec.ts has stale queue-watch and dashboard-text expectations. An intermediate Core typecheck encountered concurrent llama-cpp.spec.ts lines 419–421 narrowing errors. These are separate from the shared graph's focused behavioral checks; no validation was weakened to hide them. Final validation/activation is recorded below when complete.

Final merge qualification: 109 distinct focused checks passed across the shared human/autonomy graph, selected context and final-result routing, real durable goal persistence/continuation/restart with simulated transport, dated image handoff, speech provenance, Inner Dialogue persistence, history, graph/editor contracts and producer dispatch/configuration. The 103-case run had one outdated assertion listing robot_operator_input as retired; it was replaced with the requested one-Autonomy-Input assertion, and all six graph-contract tests then passed. Six producer/configuration checks also passed. Source-specific instruction strings remain byte-for-byte unchanged. A separate production-source TypeScript check passes; full Core typecheck still reports the concurrent llama-cpp.spec.ts narrowing errors listed above. The Site build passes, scoped diff checks pass, and compiled runtime matches current source with 44 workflows validated. Evidence: /tmp/autonomy-evidence-repair/merge-{qualified-tests,final-graph-tests,final-dispatch-tests,production-typecheck,qualified-build,live-runtime}.log.

Activated at 11:43 PDT via the existing app-only restart owner. Pre-activation Queue had zero queued/running work and zero unfinished executions, so nothing was cancelled. The old build is retained in apps/site/node_modules/.cache/before-autonomy-merge-20261015-114313. After restart, authenticated Queue returned HTTP 200 with running=true, paused=false, degraded=false and no queued/running work or unfinished executions. The served Environment Mode graph has 43 nodes and both Human Input and Autonomy Input; Intent uses the concurrently consolidated orchestrator role. The retired boredom-autonomy-mode.json URL returns 404. The independent Autonomy Controller remains available (HTTP 200). Model and Body Control lifecycle were not changed. These activation checks prove runtime/editor wiring, not physical robot behavior or resolution of Qwen's known authorship confusion. Next model-quality work is paired human/autonomy evaluation against this shared workflow before deciding between a qualified wording revision and targeted adapter training.

### 2026-10-15 — Training GPU handoff and repeated speech diagnosis

Owner requested all models use Big Brother while training and the GPU remain free. Through the existing model-registry assignment handler, all nine language-model roles were assigned to `big-brother.configured` in defaults and Dual/Agent/Emulation/Environment overrides. The embedder remains its existing non-chat provider. Existing Kokoro device owner moved synthesis from auto/GPU to CPU and verified readiness; Whisper was already CPU and ready. Both llama.cpp services were stopped through `bin/llama-cpp-services`; boot autostart was disabled, retaining the linked 9B unit for explicit future startup. The 9B service required its existing systemd stop timeout to exit. No model files were deleted. Prior registry and voice configuration are retained locally under `/tmp/metahuman-training-handoff/`. An unchanged recorded planning request through the configured Vision role returned from Big Brother / GPT-6 Sol in 5.933 seconds, without physical action dispatch. Final GPU inspection showed no compute processes and approximately 14.2 GiB free; desktop/display allocation remains. User indicated Blender would be closed; this task did not close it.

Owner also requested investigation of duplicate answers. Confirmed exact 11:55 message beginning “You know, that look on your face…” appears twice in the persisted conversation buffer, at 18:55:09.342Z and 18:55:29.383Z, under Boredom Reflection execution `bd7e4781-7cf7-4e8c-874c-774f987ba795` and the same correlation ID but different output identities. Saved checkpoints show the first came from a Task-selected speech step through `active-task` and Environment Conversation; the second came from final Persona response through a separate invocation of that same output workflow. Both buffer and TTS nodes completed for each invocation. Intent selected both needsAction and needsResponse. The final conversation context did contain the exact prior speech text and its admitted/rendering evidence; this is not simply absent task-result context. Persona nevertheless returned the same sentence. The defect is overlapping conversational authorship/admission between program speech and final response, not a frontend-only duplicate or one TTS item played twice. No duplicate-output source repair, prompt change, cancellation, or suppression was applied in this diagnostic. Local checkpoint evidence: `/tmp/metahuman-training-handoff/duplicate-*.json`. Next repair should resolve speech ownership while preserving explicitly selected ordered speech; do not use text deduplication to hide competing output decisions.


### 2026-10-15 — Independent 9B autonomy/persona LoRA preparation

Owner requested two independent candidates without deployment or production-role changes. This task prepared local review evidence at `out/ainekio-9b-lora-preparation-20261015/REVIEW.txt`, with source/artifact hashes, exact draft messages, family assignments, token measurements, retained negative examples and reproduction scripts. This is preparation, not completed training or qualification. No new launcher, production prompt, model assignment, adapter activation, service lifecycle change or physical command was introduced.

**Current baseline and resources.** Canonical profile configuration resolves the Environment language-model roles to Big Brother following the concurrent GPU handoff. The initially observed local 9B process used the installed Q4_K_M GGUF, F16 projector, dynamic-KV llama.cpp binary, q8_0/q4_0 KV cache and one slot. Its subsequent shutdown was confirmed; the requested unchanged replay through Core's llama.cpp provider failed with `ECONNREFUSED 127.0.0.1:8080`. No new 9B output was obtained. Previously saved Qwen authorship failures and Big Brother comparisons remain historical regression evidence. Final hardware reading: RTX 4080, 16,376 MiB total / 14,639 MiB free; approximately 5.0 GiB disk available. Local BF16 weights alone do not fit. Unsloth's published example estimates 22 GB for 9B BF16 LoRA and cautions about Qwen3.5 four-bit training; longer complete examples require measured capacity. No remote resources were reserved or charged and no profile data was uploaded.

**Dataset readiness.** The existing personalization inspector found 815 source memories, 24 curated records, 21 rejected records and three nominally trainable legacy reviews. The three lack verified mode attribution, so the canonical Environment-only selector returns zero training and zero evaluation examples. The existing Environment decision bank contains 403 decisions and one rejecting review, with zero approved positives. These findings concern eligibility, not permission to reinterpret old modes or learn raw outputs. The packet contains 12 synthetic executor drafts across six source-paired families and three attributable persona review examples, all explicitly unapproved. The source-family allocation precedes paired generation; the recorded lighting and previously inspected persona incidents remain regressions. Fresh final-evaluation families and reviewed high-level planner examples remain outstanding.

**Contract evidence.** Six executor drafts pass the existing output validator. Six speech-bearing drafts are blocked: the current Environment Task prompt permits speech steps and `requiredCompletionBasis: response`, while the working-tree helper rejects both. This task did not change that concurrent speech-ownership work. Owner instructed preparation to continue independently. The blocked records are diagnostic drafts, not positive training labels. The current personalization selector reconstructs conversational pairs and a persona context; it does not directly ingest arbitrary exact planner/executor messages. Existing personalization review exposes Ollama/vLLM, while Core's llama.cpp provider separately supports loaded-adapter selection. Exact autonomy ingestion and llama.cpp candidate review need work at the existing owners; the 0.8B specialist configuration remains unchanged.

**Identity, tokens and validation.** Installed 9B GGUF, projector and server checksums are recorded in the private manifest. Its metadata identifies the Qwen upstream but not an exact source revision, so native-weight lineage remains unverified. Only public tokenizer/configuration files were fetched from pinned `unsloth/Qwen3.5-9B` revision `005429cee5cb648998cf2b70eebdd83175989c9a`; native weights were not downloaded. Native and installed template source bytes differ, but explicit non-thinking rendering matches on all 17 measured records. The real trainer tokenizer verifies final-continuation-only labels on all 15 target-bearing draft/review records. Complete examples measure 249–1,584 tokens; the complete lighting regression needs 7,208 autonomy / 6,897 human prompt tokens before output. No truncation was used. Future capacity must follow the complete approved corpus, not the profile's current 2,048 sequence setting. Identity-only/no-static persona variants are written as exact proposals for owner review, not applied; 304/344 standalone-section tokens are potential savings, not behavioral qualification or measured whole-prompt savings.

Existing focused evidence: the two Core objective/dataset test files passed; all six dataset-pipeline checks passed after rerunning outside the sandbox to permit its Python subprocess; Python trainer contracts passed eleven checks with two optional actual-model tests skipped. No optimizer, exported-adapter, served-candidate, composition, long-context behavior or physical qualification ran. Remaining work: owner example/variant review, corpus curation and exact-context preservation, fresh independent evaluation families, verified native base, resource quote/authorization, small independent diagnostic fits, and native-versus-served evaluation. Production persona injection remains intact and no static material is yet qualified for removal.

### 2026-10-15 — Single Persona speech owner repaired and activated

Owner approved deleting Task's `kind:speech` step and its delivery path, accepting removal of exact spoken lines inserted between motion steps. Approved replacement: “The task planner selects task state and executable actions. The conversation model receives the selected task results and generates the outward response when Intent selects needsResponse.” This replaces the former speech-step wording in both shared graph source prompts and capability context. The schema branch, parser case, program type, Task speech admission/progress state, conversation-delivery call and unused Task speech metadata edge are removed. The final Persona delivery retains buffer/memory/TTS ownership. No text-equality suppression, additional waiting, automatic stop, or fallback was added.

Migrated speech delivery/replay and playback receipt tests to the surviving conversation owner. Focused latest results cover 133 distinct passing checks across parser/schema/context, shared human/autonomous routing, explicit silence, final action evidence, conversation persistence/replay, correlated speech playback, graph contracts, and training corpus. Production Core typecheck passes. Full Core typecheck still has the three previously recorded `llama-cpp.spec.ts` lines 419–421 narrowing errors; those files were not changed. Site build and compiled/source parity passed with 44 workflows validated. Scoped diff checks pass.

Three offline replays rebuilt the recorded duplicate incident's Task context with the approved contract and used configured Big Brother / GPT-6 Sol, without action dispatch. All returned valid current-contract outputs and no speech steps. Two selected a face expression and one selected adapter `sendText`; all retained a conversational task objective. Thus the competing speech path is removed, but model task-selection correctness is not qualified by this repair. `sendText` remains a separately advertised adapter-text capability, not TTS; the gateway publishes a transcript. Its conversational misuse is recorded for separate investigation, not silently filtered. Recorded input, schemas and outputs are retained under `/tmp/persona-speech-repair/replay-*.json`.

Owner reserved specialist training sources for this repair. Source labels and generated corpus are now version 16: speech-only requests have no Task program, mixed requests retain physical/sensing steps, and explicitly requested speech uses Intent's response route. All 6,358 development, 1,518 evaluation and 187 regression records have zero speech-step targets, including larger-planner reference outputs. Existing run snapshots, adapters and qualification reports were not modified. These revised comparison references must not be mixed with previous-version scores; reviewed cases are not newly unseen holdouts. The training README and Robot Bible describe the new boundary.

Owner authorized cancellation of incident execution `bd7e4781-7cf7-4e8c-874c-774f987ba795` and activation. Cancelled that execution via the authenticated Queue endpoint with history preserved; briefly paused admission and used an app-only launcher restart at approximately 12:10 PDT. One Body Event execution already in flight at preparation, `a9ac1aa6-3739-4127-96db-5c04b25ebdad`, subsequently became failed across the runtime transition; startup logged the existing executable-version conflict. It was not silently migrated or cancelled by this task. Post-start authenticated Queue reported running, unpaused, not degraded, zero queued/running work and zero unfinished executions. Served Environment Mode returned HTTP 200, contained the approved wording and one final conversation delivery node, and lacked the retired speech wording. Big Brother role assignments remain, local llama.cpp services remain stopped, voice remains CPU, and GPU inspection showed no compute processes. No physical or audible robot validation was performed. Prior Site build is retained at `apps/site/node_modules/.cache/before-persona-speech-20261015`.


### 2026-10-15 — 9B training resource follow-up and approved seeds

The Installation Owner approved both exact candidate-only persona ablations (identity plus goals, and goals without static persona), preserving all dynamic context and execution contracts. The owner also approved six paired capture/change-goal/cancel autonomy seed targets and the attributable “How are you?” greeting continuation. The function-status and dream examples remain diagnostics. These approvals are recorded with sample identities in the private preparation packet; they do not authorize a paid run or production changes. The seven seeds are not complete independent training/evaluation corpora.

Refreshed the six valid autonomy prompts and paired lighting regression through the current Environment context builder after the single Persona speech-owner repair. Old speech-bearing Task targets remain in the original snapshot as excluded diagnostics; the earlier reported contract discrepancy is no longer a current blocker. All six refreshed action targets pass the current parser. The current eleven tokenizer comparisons render identically with explicit non-thinking mode; final-continuation masks pass on nine target-bearing review records. Complete review rows use 249–1,478 tokens; the lighting prompts now use 7,022 autonomy / 6,711 human tokens before output. These counts supersede the earlier snapshot; no context was truncated and no model inference ran.

Corrected the feasibility distinction after the owner reported previous local 14B training: fully GPU-resident 9B BF16 weights exceed the 16 GB GPU, but this does not rule out local quantized LoRA training. The canonical trainer supports 4-bit loading and Unsloth checkpointing. Its current pinned-package/CUDA preflight passes outside the sandbox; the sandbox failure was accelerator visibility, not a broken local environment. A located successful 2025-12-31 Qwen3-14B log records 4-bit loading on a remote RTX 5090, and does not establish or contradict the separate owner-reported local runs. No local 9B fit or quantization-quality comparison has yet run. After the owner's cleanup, free disk is 19.65 GiB; native weights alone are 17.98 GiB, before checkpoint/export workspace. No weights were downloaded.

Read-only authenticated RunPod checks confirmed an available account and no active pods or hourly spend; balance and live quotes are retained only in the private packet. The configured trainer tag was last pushed 2025-10-27, whereas current source pins Unsloth 2026.8.3 / Transformers 5.5.0. The worker uploads current trainer and requirements then checks packages, without upgrading the image. Public image manifest/config metadata was read without pulling image layers. Remote environment readiness remains unverified; no image was built or published and no template changed. A 48 GB GPU BF16 quote and 80 GB alternative include the existing launcher's 306 GB volume plus 40 GB container allocation. Duration scenarios are estimates, not an authorized run or measured throughput.

The updated private REVIEW.txt and machine-readable manifests identify approved examples, exact experimental wording, current source hashes, local readiness, account/quote evidence and remaining owner integration work. Remaining work includes a sufficient curated persona corpus, full planner/executor envelopes through the existing personalization dataset owner, fresh family-independent evaluation, a verified common native snapshot, then independent diagnostic fits and native/exported/llama.cpp comparisons. No adapter was trained, deployed or overwritten, and no physical commands were dispatched.

### 2026-10-15 — Restored pre-training local model assignments

Owner moved training to RunPod and requested the original LLM settings. Restored the exact saved default and cognitive-mode assignment maps from the pre-training handoff backup, removing temporary all-role Big Brother overrides and retaining current model definitions and artifacts. Environment Intent/Task again select the existing .8B Intent/Task adapters; Persona, Planner, Vision, Curator, Coder and Summarizer use local Qwen 3.5 9B through llama.cpp. Pre-existing Big Brother assignments (including Environment Psychotherapist and global Persona) remain as saved.

Re-enabled both existing llama.cpp systemd units and started them through `bin/llama-cpp-services`; both report active/enabled and healthy. The shared .8B server lists the two expected adapters. Restored Kokoro device selection to `auto` through the voice lifecycle owner; its managed restart completed and health reports CUDA with no fallback. Whisper remains CPU. The running Site's authenticated model-registry endpoint returned HTTP 200 and the restored Environment assignments. No app rebuild/restart, new model training, inference-quality evaluation, or physical command was performed. The previously activated single-Persona speech repair remains in place. Evidence is in `/tmp/metahuman-training-handoff/restore.log` and `restored-live-registry.json`.


### 2026-10-15 — Authorized RunPod trainer update and first 9B diagnostic

The owner explicitly requested updating the online training system and training there. Updated the existing personalization remote worker to install the uploaded pinned requirements before its existing environment validation, so the old template does not prevent current Qwen3.5 dependencies from running. Kept Core's launcher and the shared Python trainer; no alternate launcher, production model assignment, robot action path or 0.8B adapter changed.

Added an explicitly reviewed-message input through the same Core launch/dataset owners. It preserves complete planner/executor messages, per-sample system context, source hashes, target authors, review attribution and family splits, including prior frozen split history. The same manifest consumer verifies the objective and target author. The native checkpoint revision is frozen in the launch configuration and saved in the PEFT adapter for reload. Optional native baseline/reloaded-candidate generations retain exact evaluation prompts, outputs, latency, token counts and peak allocation. These outputs supplement loss rather than establish behavioral acceptance.

Prepared two intentionally small BF16 diagnostics from the same pinned 9B base: autonomy has four training examples and two separate cancellation-family evaluation examples; persona has five individually reviewed attributable expressions and one expression from a separate conversation. Excluded known errors, unsupported action/vision claims and the dream incident. No paraphrases were generated. Full native example lengths are at most 1,478/345 tokens, with 9,216 capacity provisioned for the longer authorship regression plus the existing 2,048 output allowance. The native baseline will replay the retained authorship case before optimizer steps; final fresh behavioral evaluation remains distinct and unperformed.

Validation before launch: shared Python contracts passed eleven checks with two optional GPU cases skipped; eight dataset-pipeline checks passed, including real Python manifest consumption and preserved exact messages. Core launch/dataset and artifact/history focused files passed. Brain typecheck passed. Core typecheck still has only the three previously reported llama-cpp.spec.ts lines 419–421 errors. Source diff checks pass. The first run was admitted by the canonical launcher at 19:40:49Z; provider creation is confirmed and SSH readiness is pending. Account and pod identities/costs are retained in the private remote-diagnostic packet, not this maintained document. No optimizer or candidate success is claimed at this checkpoint.

### 2026-10-15 — Active Operator agent ownership consolidation

Owner requested an Active Operator agent to command the existing operator functions before configuring new behavior. Moved the existing persistent scheduling implementation and its test from `brain/services/robot-operator` into `brain/agents/active-operator/index`. The catalog names that single agent Active Operator and maps its source directory through the existing source-identity mechanism. Retained the durable `robot-operator` ID, lock, settings key, runtime records and six child-workflow ownership links. No parallel scheduler, new model call, prompt change, trigger timing change or mode behavior change was introduced. Agent Monitor retains process lifecycle; the Core mode controller, Work Coordinator and shared Environment workflow retain their existing responsibilities.

The Agent Catalog entry now embeds the existing Active Operator mode control component. Dashboard, mode descriptions and child-owner labels use Active Operator. Agent Monitor default executable settings now follow the catalog's declared service path, so regeneration preserves the moved entrypoint. Removed the old service entrypoint and updated test registration, current Bible/architecture links and the existing roadmap's owner paths. Existing model assignments and trained adapters are untouched.

Acceptance: an isolated catalog test proves one discovered persistent agent, all six child links, preserved durable identity, executable resolution, boot/control availability and absence of a second Trigger Manager schedule. The real agent entrypoint runs against simulated Coordinator work: Reactive admits nothing, Semi admits its configured observer, switching back to Reactive becomes dormant, and Full preserves controller admission, graph-edit recovery and saved-execution signaling. Both focused tests pass, as do Agent Monitor's isolated lifecycle validator and the catalog/UI ownership check. Brain typecheck and production-only Core typecheck pass. The broader existing suites have unrelated failures: catalog expects 13 Trigger Manager entries but installation has 15; Robot Operator tests expect an obsolete watcher expression and dashboard heading; architecture test expects the independently restored thought agent-trigger file to be absent. Full Core typecheck reports existing llama-cpp test narrowing errors plus an unrelated active-task-state test type error. These were not weakened or repaired in this task.

Source/build evidence is separate from activation. The first staged Site build passed, but another task changed five shared motion source files immediately afterward, invalidating compiled/source parity. The second staged Site build also passed, but concurrent Core edits again changed the executable hash before parity verification. Activation is therefore deferred until the concurrent runtime work settles; repeated rebuilds were stopped rather than claiming that the staged artifact matches the moving source. The live installation remains in Semi with an unfinished Boredom Observer and Environment execution; neither was cancelled, and no service was restarted or physical command sent for this refactor. Private evidence and the before-task snapshots are under `/tmp/active-operator-agent/`.

After the owner rebuilt and restarted, the authenticated Agent Catalog returned one Active Operator entry using `agents/active-operator/index.ts`, with all six existing children attached. Live operator status is healthy and Semi/armed; Queue showed zero queued items and one running item at inspection. The background operator process itself retained its 10:08 start time, so the web restart did not relaunch that worker; its scheduling implementation was unchanged by this refactor. The installed compiled/source check still reports a hash mismatch after concurrent edits to motion types and the active-task node. This is live catalog activation evidence, not complete current-source parity or a fresh agent-process launch. No further restart, cancellation or motion was performed. Read-only evidence: `activated-catalog.json`, `activated-runtime-check.log`, and refreshed live snapshots under `/tmp/active-operator-agent/`.

### 2026-10-15 — First remote 9B diagnostic completed; independent persona run active

The authorized autonomy BF16 diagnostic completed through `launchTrainingJob` /
`full-cycle` on RunPod; its pod termination was confirmed. Private run label:
`2026-10-15T19-40-49-912Z`. Four reviewed training samples and two family-separated
cancellation evaluation samples are diagnostic coverage only. Native held-out loss
changed from 0.415508 to 0.022417, and saved-adapter reload produced correct null
program/cancel handoffs for both human and autonomous inputs. The lighting
regressions still fail the executable contract. The autonomous lighting output
stopped explicitly misattributing the request to the human; this does not establish
broad authorship accuracy. Training peak allocated memory was 19,695,173,632 bytes.

Exact native base files were hashed remotely. The first adapter reload used the
dependency's adapter-path loader; its `main` cache reference and sole native
snapshot both matched the requested pinned commit. Inspection identified that
Unsloth can discard an adapter's recorded base revision during loading. The shared
trainer now explicitly loads the pinned base before attaching the saved PEFT
adapter; a focused mocked regression verifies that boundary. The independent
persona diagnostic uses this correction and starts from the same base, not the
autonomy adapter. Run label: `2026-10-15T19-57-39-200Z`.

The owner explicitly approved temporarily stopping the production 9B server for
isolated llama.cpp comparisons and restoring its exact configuration afterward.
The autonomy adapter converted with the installed upstream converter. A live-base
replay showed cancellation already succeeds under runtime schema constraints;
native unconstrained gains must not be presented as a serving improvement. A
concurrent locomotion schema change affected lighting validation, so comparison
inputs were refreshed through the current Context Builder and archived separately
under the private packet's `serving-contract/`. Older baseline outputs are retained
with their original contract context, not silently relabeled. No physical actions
or model assignment changes were made. Serving comparison and persona results are
still pending at this entry.

### 2026-10-15 — Remote 9B diagnostics and serving comparison complete

Both independent BF16 diagnostics completed and both RunPod pods were terminated.
The account reported no remaining pods or hourly spend; the observed balance
change was approximately $0.32. Autonomy used 4 train / 2 evaluation samples;
persona used 5 / 1. Both are small diagnostic fits, not a completed broad training
campaign. Their native weight-shard hashes match the same pinned 9B revision.
The second run exercised the explicit pinned-base PEFT reload repair. Held-out
losses improved, but neither candidate is qualified for activation.

Actual llama.cpp comparisons preserved full context and sampled each adapter
independently. The exact GPU-projector configuration failed to fit; text tests
moved only the unused projector to CPU, with 22 unchanged base outputs matching
the production configuration. The autonomy candidate loses both lighting
objectives after serving and regresses one unconstrained cancellation format.
The persona candidate is more concise but retains invented experiences, source
confusion and an unsupported completed-movement claim under the real conversation
contract. Reduced static persona saves prompt tokens but has not demonstrated
reliable identity internalization. No production persona reduction or combined
adapter qualification is recommended.

The production 9B service is healthy, its startup arguments were restored exactly,
its adapter inventory is empty, and model-assignment bytes match the pre-comparison
snapshot. The existing 0.8B process remained unchanged. No physical actions were
dispatched. Full private results, manifests, commands, hashes, failure examples,
latency/VRAM measurements and remaining coverage gaps are in the existing
`out/ainekio-9b-lora-preparation-20261015/REVIEW.txt` packet. Broader attributed
planner/persona data and fresh final evaluation families remain necessary; these
results do not justify a larger fit on the tiny diagnostic seed set.


## 2026-10-15 — Active Operator activation modernization

Installation Owner approved the exact activation contract and clarified both modes: Semi requests every returned update at 100; Full requests the highest returned activation even below 100, with returned order resolving ties. Empty updates remain allowed. Reactive stays dormant. This supersedes the earlier Semi-only rollout preference.

The existing persistent agent and controller graph are the surviving owners. Agency now has Desires and Active Operator tabs. Activation meters, trends, stated reasons, instructions and dated work records come from the operation catalog and existing durable assessment checkpoints. No second activation store, scheduler or queue was added. Independent operation admissions preserve the existing output, memory, and execution owners. Old Semi timers, the global correlated-cycle barrier, selected-work waits, and the old single-task speech-capable controller contract were removed. Reflection/daydream/curiosity interval and inactivity admissions are migrated to Active Operator; manual invocation and Sleep retain their owners. Goal Review remains outside activation selection.

Source validation is complete; live services have not been restarted by this task. Focused owner tests passed 26/26 and selected graph integration tests passed 3/3. Durable-store and decision-continuity checks passed; an assessment-history SQLite initialization defect found during the combined run was repaired, and all four activation tests passed afterward. Production Core and Brain typechecks and the staged Site build passed. The final compiled runtime matched source and validated all 44 current workflows. The full Core typecheck still reports three pre-existing test errors in `llama-cpp.spec.ts:419-421`; older Goal Review and boredom fixtures also have unrelated baseline failures. These are not passing full-repository validation claims.

Read-only context assembly initially decoded unrelated historical execution payloads. The existing durable store now supports targeted lookup and lazy iteration; the activity projection reads referenced execution records, and activation history opens only relevant assessment checkpoints. This reduced the measured catalog read from about 17 seconds to 298 ms and profile context assembly to 452 ms, without truncating model-selected information or adding a second store.

Offline model checks used the approved wording and configured Persona role, with no physical dispatch. Six sparse-context cases returned valid activation JSON and exercised both mode rules, but reasoning-enabled inference took 71.5–125.1 seconds (median 87.3 seconds); some outputs inferred unavailable prerequisites. A separate read-only profile-context check took 111.7 seconds and returned an allowed empty update list. That check omitted camera acquisition and execution-dependent history nodes; it is not a full live-cycle qualification. Private results are under `logs/benchmarks/active-operator-20261015/`. A final catalog cleanup removed internal dispatch metadata from model-visible operation descriptions after the profile check. Valid formatting is not proof of useful autonomy.

Remaining work: activate the rebuilt services when requested; inspect the Agency tab live; qualify useful operation choices and assessment latency with current profile, camera, and action evidence. No model assignment, reasoning setting, or physical behavior was changed to conceal the slow or empty model decisions. Runtime operation admission and physical behavior remain unverified for this revision.


### 2026-10-15 — Autonomy training scope corrected to independent initiative

The owner clarified that the training goal is an independent robot companion that selects goals and activities, not imitation of current conversation or merely executing assigned tasks. The first broader executor draft (1,258 training rows) is retained privately but set aside. No new paid run or production assignment was made. The live decision bank snapshot contains 446 decisions (251 Intent / 195 Task) and one rejecting review, with no approved positives; none were admitted as positive targets.

Traced the current Robot Bible purpose and Full-autonomy definition, Agent Catalog, connected-body capability advertisement, Autonomy Controller, and Reflection/Movement/Observer graph contracts. The relevant Controller and intention planners use the shared Persona model role, currently the local base 9B; this training objective is autonomy decisions, not persona-expression training. The current connected body advertises gestures, camera acquisition, expression and goal-directed locomotion. Source capability advertisement does not establish physical qualification.

Prepared a replacement private draft at `out/ainekio-9b-autonomy-training-20261015/initiative/`: 1,048 training examples from 32 scenario families, 196 development-evaluation examples from six families, and 200 final examples from six separate families. Seven state stages and four evidence variants are correlated siblings, not independent real-world experiences. Examples cover exploration, play, companionship, embodiment, learning, reflection, imagination and specific desires. Stages distinguish new opportunities, useful work in progress, completed objectives, failures, disconnected body capabilities, new evidence and an explicit changed human context. Targets select operations or author high-level intentions. Historical assistant claims, dreams and private thoughts are attributed input context only.

All examples are synthetic; no conversation reply or raw model decision was copied as a positive target. Existing graph policy wording and canonical context builders are unchanged. Output schemas/parsers and canonical dataset/launch validators passed. Source, family and complete prompt splits have zero cross-split overlap. Native tokenizer measurement verified final-assistant-only supervision, with a 3,720-token maximum complete example and zero truncation; planned capacity is 12,288 to preserve the Controller generation allowance. The image-conditioned Observer is excluded from this text-only fit, although Controller examples can select that installed operation.

The draft uses the same pinned Qwen3.5-9B base, independent of the rejected diagnostic: BF16, rank 8 / alpha 16, two epochs, learning rate 0.0001, batch 1 / accumulation 8. It remains on Core training-launch -> existing personalization full-cycle -> shared RunPod trainer. A credential-free draft launch request, hashes, source snapshots, exact examples, split allocation and token report are prepared. Final cases remain outside the training upload.

Read-only provider quote: RTX A6000 48 GB $0.59/hour plus existing personalization storage, approximately $0.638/hour total; estimated 2–6 hours, proposed $4 authorization. The account snapshot showed $8.30 with a separate active pod spending about $0.60/hour. That pod was not changed. Representative-example and specific-run-budget review was requested using `initiative/REVIEW.txt`, as required by the original brief. Pending: owner review, any requested label changes, a funded full fit, native/served behavioral comparison, shared-role conversation regressions, and qualification of independent decisions and outcomes. No robot command was dispatched.

Owner approved the ten representative examples and this run up to $4. Canonical launch started `2026-10-15T21-10-08-733Z` on a 48 GB RTX A6000 at $0.6380556/hour including storage. The one-off supervisor uses the existing `waitForTrainingJob` cancellation owner with a deadline calculated from actual provider pricing and a three-minute termination reserve; no new launcher or runtime budget mechanism was added. Approval, immutable request, dataset identity and budget receipts are retained in the same private packet. Native baseline loss evaluation completed; training and behavioral qualification remain in progress. Two independently managed local 2B training jobs currently occupy the local GPU and the 9B service is stopped by that work; this run has not changed their lifecycle. The separate remote 0.8B training pod is also untouched. Final serving evaluation includes all seven scenario stages, matching no-thinking native-parity probes, retained authorship conversations and the actual empty-activation profile regression. No physical command was dispatched.

The approved initiative fit completed both epochs (262 optimizer steps; 4,824 seconds fitting). Its saved adapter was reloaded for independent evaluation, downloaded and hash-verified; the canonical worker confirmed pod termination at `2026-10-15T22:49:25.435Z`. Creation-to-cleanup time and the quoted all-in rate imply $1.0553, below the $4 authorization; this is a rate-based estimate, not an itemized invoice. Peak allocated training memory was 22.11 GB (23.78 GB reserved). Held-out loss decreased from 2.5370 to 0.4310. All eight native candidate responses pass the existing output parsers, versus zero native baseline responses; this is contract evidence, not qualification of useful autonomy. The shared trainer's numerical quality gate passed, but the candidate remains unactivated. Upstream llama.cpp F32 adapter conversion succeeded; native adapter SHA-256 is `1e3a711ea75cb31f0ab6fbd1820f11f0235de7502be6aee2aca67f59c49ad8d8`, exported adapter SHA-256 is `1755509909132d9e238087ab486210e22b2d9c094fcff04cea8a172fc46fe460`. Serving and shared-role conversation comparisons are pending local GPU availability while the independent 2B task completes its serving qualification. Private receipts are in `initiative/training-completion.json`, with reproducible commands in `initiative/COMMANDS.txt`. No model assignment or physical command was changed by this work.


### 2026-10-15 — Owner-requested removal of robot output caps and shortened comparison

The owner explicitly requested no artificial output-token limit and then reduced the autonomy serving comparison to 0.35% of the planned tests. The 71-case plan cannot express that fraction as a whole case, so the active comparison is one paired case (1.41%), the first case in the previously frozen order. The full capped baseline was interrupted with 28 completed cases, and the uncapped candidate sweep was interrupted with five completed cases. Interrupted in-flight cases are not scored as model failures. Prior results remain under the private initiative artifact directory; capped and uncapped results are separate.

The existing llama.cpp provider now accepts the backend's `max_tokens: -1` unlimited-generation sentinel, uses it by default, and retains explicit caller cancellation without an inference deadline. The existing backend configuration and eight robot graphs (autonomy, reflection, movement, observer, Environment, freestyle, status, and goal review) now request unlimited output. Their graph/editor schemas and the existing Backend Settings input accept that setting. Only token settings changed in graph JSON; model-visible prompt wording, context, capability contracts, and assignments were preserved. The installed llama.cpp source disables context shifting when the vision projector is loaded; actual context capacity remains a backend constraint, not an application output cap.

Validation: all 20 provider HTTP/API tests pass, including default, explicit, and persisted unlimited generation and retained caller cancellation. Node-default validation and all 44 graph validations pass; graph mirrors match. Core typechecking reports three existing `never`-narrowing errors in the unrelated image-routing test at `llama-cpp.spec.ts:432–434`; the failing block is byte-identical to the pre-edit snapshot. No physical robot command was dispatched. Source/configuration repair is not proof of deployment to an already-built running Site.

The owner-shortened paired comparison is complete: identical 3,263-token inputs and unlimited output; base 62.92 seconds / 4,504 completion tokens, candidate 3.72 seconds / 145 tokens. Both satisfy the current output contract and choose valid alternative operations. The base explicitly considers the sculpture's recorded absence; the candidate selects observation but repeats acquiring the sculpture without clearly adapting to that evidence. This single result does not establish functional superiority, so the candidate remains inactive. It is a Full-mode case, not Semi-mode qualification. No static persona reduction was tested or applied; prompt-token savings are zero. Private evidence and the recommendation are in `out/ainekio-9b-autonomy-training-20261015/initiative/SHORT-COMPARISON.txt` and `short-comparison-result.json`. The RunPod training pod was already terminated; only the local isolated comparison server was stopped afterward. Production inference services were inactive before and immediately after the comparison, and were not started by this task.


### 2026-10-15 — Owner-requested eight-case autonomy comparison

The owner requested a slightly longer comparison without the full suite. Selected eight paired controller cases from the frozen 71-case plan: six scenario families, completed-action authorship regression, and the actual retained Semi-mode input. This is a small diagnostic sample, not fresh qualification; previously exposed cases are explicitly identified. Exact prior uncapped results are reused (one base, two candidate). Both models retain identical prompts, complete context, sampling, reasoning, output validation, and unlimited generation. The existing private evaluation helper calls the canonical provider and activation-selection owner; no graph is admitted and no physical action is dispatched. Selection and reuse receipts, individual outputs, and semantic review are under the existing initiative artifact directory. Production inference services were inactive at preflight; isolated server PID 648918 uses port 18080 and the same model/vision-projector placement as the earlier comparison.

Eight-case comparison completed: base final-output validity 8/8, trained 7/8; median complete-call latency 37.7 versus 3.1 seconds. This is parser validity and descriptive single-call latency, not behavioral accuracy or a repeated benchmark. Both selected an operation in 6/8 cases; neither selected one in the retained Semi-mode case (trained returned 82, base returned empty updates). The trained adapter handled quiet-speech correction and new local evidence usefully, but one completion stopped with JSON only in reasoning and empty final text, and other instructions lost the changed-scene, plan-revision, or disconnected-body context. Base also showed imperfect plan-owner selection and dream/observation separation. Functional superiority remains unestablished; no deployment or assignment change was made. The private `SAMPLED-COMPARISON.txt`, `sampled-comparison-result.json`, and per-case semantic review retain the evidence. The isolated comparison server was stopped after completion; production services were left inactive as found. No additional remote cost or physical action occurred.


### 2026-10-15 — Owner-approved autonomy-only production assignment

After reviewing the eight-case results, the owner explicitly requested production use for autonomy only and approved a separate Autonomy category. Added `autonomy` to the shared category catalog and changed only the controller (`llm`) and Boredom Reflection/Movement (`planner`) node roles. Existing Model Resolver migration initializes the new category from prior Persona defaults and mode choices once; it preserves explicit Autonomy choices and later choices to inherit. No checkpoint ID or private model path was embedded in a graph. Persona conversation, Boredom Observer, Planner, Vision, and both 2B specialist assignments are unchanged.

Registered the verified GGUF via the existing Model Registry settings owner and assigned Ainekio Environment / Autonomy via the existing assignment owner. Model ID: `llama-cpp-lora.24c5af08d4c402b0`. The existing `llama-cpp.service` loads the immutable deployed adapter at default scale zero using its local systemd override; Autonomy requests choose scale one. Base conversation requests leave it disabled. The controller's existing image input is preserved; the adapter's base/projector accepted and correctly described a synthetic red square in a live inference smoke test using the unchanged maintained vision-smoke wording. This is image-path evidence, not general image-conditioned qualification.

The production service is running with the adapter loaded. Direct Model Router verification produced a valid Autonomy decision with adapter ID 0 / scale 1 and a conversation response without the adapter. No cognitive workflow was admitted and no physical robot command was dispatched. These configured workflows will use the adapter on their next admission; this task did not start autonomous robot operation.

Validation: 21 provider tests passed, including alternating Autonomy/Persona adapter isolation; registry migration/settings/category presentation checks passed; node defaults and all 44 graphs validate; Site build passed with existing bundler warnings. Core typecheck still reports the three pre-existing `never`-narrowing errors in the unrelated image-routing test at `llama-cpp.spec.ts:432–434`. No clean full-workspace verification is claimed. Private activation, live routing, image smoke, artifact hash, unchanged-assignment proof, and rollback payload are retained under the initiative `production/` directory. The earlier recommendation to keep the candidate inactive is historical evaluation advice superseded by the owner's explicit experimental-deployment decision, not by improved qualification evidence.

### 2026-10-15 — Disable Active Operator assessment reasoning

The owner requested reasoning off in Full Auto after live GPU context-cache allocation failures. Changed only the existing controller model node's `enableThinking` from true to false and synchronized its public graph artifact. Full and Semi share this assessment graph; conversation and other workflow settings are unchanged. The existing loader detects file changes for fresh admissions; already admitted executions keep their graph snapshot. No service restart, token cap, prompt rewrite, or test-issued robot command was introduced. Canonical/public JSON comparison proves this turn's graph change is solely the reasoning boolean. This configuration change does not establish that GPU memory exhaustion is resolved.
