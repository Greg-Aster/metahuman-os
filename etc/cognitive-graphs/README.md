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
- Boredom Observer, Movement, and Reflection are contextual planner graphs;
  `boredom-autonomy-mode.json` is their shared iterative executor.
- `robot-status-mode.json` performs one bounded situational update. Its reusable
  Robot Status input node supplies supporting context to Environment Mode and
  Boredom Autonomy without replacing fresh Environment evidence.
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
