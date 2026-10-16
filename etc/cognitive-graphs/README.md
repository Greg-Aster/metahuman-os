# Cognitive Graphs

This directory contains the built-in executable graphs used by Core's graph
executor and the web editor.

- Every graph that emits outward conversation owns one `conversation_buffer`
  instance and routes its exact admitted entries to `memory_capture`. Interactive
  modes connect both user input and response; autonomous conversational graphs
  connect only their response.
- `dual-mode.json`, `agent-mode.json`, `emulation-mode.json`, and
  `environment-mode.json` own the four interactive conversation modes.
- Agent and workflow graphs own bounded background work such as curation,
  reflection, dreaming, agency, and Robot Operator behavior.
- Desire Agent remains the sole public Agency controller. `desire-executor.json`
  loads the persisted reviewed plan, prepares one finite step, and records its
  result before advancing. Digital steps use the configured operator; native
  robot steps call `environment` within the same durable execution. Returned
  action evidence is bound to the Desire, plan version, and step. A failed step
  stops the plan; finalization admits one outcome review through Desire Agent.
  The parent closes after that review returns. Recurring outcomes stop when the
  current cycle is satisfied; another cycle requires fresh evidence and review.
  Reduced inhibition remains part of Agency approval policy.
- Model-backed product operations that are not cataloged Brain agents are also
  explicit graphs: Desire Check-in, persona extraction and interview questions,
  weekly goal review, self-healing analysis, and semantic-turn classification.
  Their API and domain services load these graphs; they do not reproduce prompts
  or model calls.
- `inner-curiosity.json` is the complete private self-question workflow. Its
  Brain adapter only resolves execution identity and runs this graph; the graph
  owns cognition, both Inner Dialogue persistence effects, and optional Train
  of Thought admission.
- Active Operator (`robot-autonomy-controller-mode.json`) is the shared Semi/Full
  activation-assessment workflow. Its catalog supplies operation meanings,
  retained levels and dated work/execution activity. Semi requests each returned
  update at 100; Full requests the highest returned activation, with returned
  order resolving ties. Selected operations are independent Coordinator work.
  The assessment records its decisions and emits selected intentions through
  Inner Dialogue Buffer and Memory Saver; it neither waits for those operations
  nor authors outward speech. Existing handlers and Environment Mode execute them.
- Boredom Observer, Movement, and Reflection retain contextual planning. They and
  the Controller send intentions to the Autonomy Input of `environment-mode.json`.
  Human Input and Autonomy Input join before Intent in this single execution graph.
  The join preserves origin and selects the existing editable instructions for that
  source; a new human turn replaces inherited autonomy metadata. The separate
  Robot Autonomy Executor graph has been removed.
- `robot-active-task-mode.json` is the sole physical task executor called by
  the shared Environment Mode graph. Its ordered semantic actions,
  generated gestures and ongoing behaviors run inside the existing durable parent.
  It updates an ongoing gait from fresh perception while image identification runs
  as finite Coordinator work. Identification finishes a behavior phase; remaining
  gestures complete before the whole objective. No per-movement model review runs.
- `robot-goal-review-mode.json` reviews an unfinished Current Execution objective
  inside the same durable parent after a correlated result. It receives
  conversation and reflection, verified outcomes, Robot Status, bridge facts,
  and time-labelled camera evidence. It updates the durable goal, including its
  objective, completion criteria, completion or abandonment, and returned evidence.
  It cannot start another workflow or publish speech. Full Auto or an appropriate
  Semi Auto trigger supplies goal state to planning through the existing operator
  and agent owners; Robot Status projects the durable record.
  Agency-owned steps return to their Desire plan and outcome review instead of
  entering this goal assessment workflow. Pending Desire summaries convey
  lifecycle work, not robot motion instructions.
- `robot-status-mode.json` performs one bounded situational update. Its reusable
  Robot Status input node supplies supporting context without replacing fresh
  Environment evidence.
- Separate admission graphs remain only for the distinct Inner, System, and
  Robot buffers. There is no standalone Conversation Buffer admission graph.

Built-in graphs are maintained source. Update their public site/mobile copies
with `pnpm sync:graph-artifacts <graph-name>` where the sync contract applies,
then run `pnpm validate:graphs`.

New graphs saved by the editor belong in `custom/`. First-write backups belong
in `backups/`. Both directories are local runtime data and are intentionally
ignored by Git.

Graph structure and node property schemas are defined by Core. Do not add a
second graph format or embed business behavior in the transport handlers. See
`docs/user-guide/advanced-features/node-editor.md` for usage and
`docs/technical/ARCHITECTURE.md` for ownership.

## Scheduler contract

Every graph declares scheduler contract version 1. Core executes active nodes
serially in deterministic topological order and reports inactive nodes as
`skipped`; it does not invoke their executors. Registered node definitions own
their default activation mode and required input handles. A graph node may add
an `activation.when` condition when an entire branch depends on another node's
output.

Edges copy only the exact declared `sourceHandle`. `data.when` selects an edge
from a source output, `data.loop: true` marks the one intentional re-entry edge,
and `data.kind: "control"` orders effects without copying data. False, zero, and
empty strings are valid connected values; missing, `undefined`, and `null`
outputs do not activate a data edge. Loops are bounded by
`scheduler.maxLoopIterations`.
