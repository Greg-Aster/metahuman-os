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
- Model-backed product operations that are not cataloged Brain agents are also
  explicit graphs: Desire Check-in, persona extraction and interview questions,
  weekly goal review, self-healing analysis, and semantic-turn classification.
  Their API and domain services load these graphs; they do not reproduce prompts
  or model calls.
- `inner-curiosity.json` is the complete private self-question workflow. Its
  Brain adapter only resolves execution identity and runs this graph; the graph
  owns cognition, both Inner Dialogue persistence effects, and optional Train
  of Thought admission.
- Robot Autonomy Controller (`robot-autonomy-controller-mode.json`) is the one
  Full-mode LLM decision workflow. Its task-catalog node advertises configured,
  currently executable finite agents with their canonical descriptions. After
  the prior autonomy chain finishes, one LLM may select one of those tasks,
  delegate one high-level embodied intention to Robot Autonomy Executor, and
  optionally speak.
- Boredom Observer, Movement, and Reflection are contextual planner graphs;
  Robot Autonomy Executor (`boredom-autonomy-mode.json`, stable runtime key
  `boredom-autonomy`) routes the unchanged internal intention, executes one
  self-directed consequence, records Robot Status, and ends.
- `robot-action-result-mode.json` interprets one correlated returned action result
  and records it in Robot Status without selecting or dispatching another action.
- `robot-goal-review-mode.json` is a separately scheduled, persona-guided LLM
  review after a correlated action result leaves a Robot Status objective
  incomplete or failed. It receives bounded conversation and reflection,
  verified robot-action outcomes, Robot Status, current bridge facts, and only
  genuinely current camera evidence. It may complete, continue, wait, request
  the user, abandon, or speak; only continuation delegates one high-level
  intention to Robot Autonomy Executor, and then the review ends.
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
