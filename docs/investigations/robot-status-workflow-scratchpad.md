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
