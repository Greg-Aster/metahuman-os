# Robot Operator

## Intent

Create a separately controllable Robot Operator service and Robot Observer agent for Ainekio integration.

Robot Operator is the persistent controller for robot-specific autonomy. It owns the randomized inactivity deadline and decides whether conditions permit an autonomous observation cycle. It must remain dormant while Active Operator is in `reactive` mode and may run autonomous cycles only in `semi` or `full` mode. Its service lifecycle remains independently enabled, disabled, started, and stopped through Agent Monitor.

Robot Observer is a finite, separately registered agent. Robot Operator may invoke it after the configured inactivity period, and an owner may invoke it manually. Robot Observer requests one correlated camera snapshot and routes the returned observation through the maintained Environment Mode graph. Environment Mode remains the one vision, response, TTS, and robot-action workflow.

## Ownership and constraints

- Agent Monitor and `etc/services.json` own Robot Operator's persistent process lifecycle.
- Robot Operator owns its robot inactivity timer and robot-specific condition checks.
- Active Operator mode gates autonomous Robot Operator cycles: `reactive` blocks them; `semi` and `full` allow them.
- The Work Coordinator owns every finite Robot Observer execution and environment command.
- Robot Observer has no independent timer. It is manually runnable and callable by Robot Operator.
- Environment Bridge remains transport; Ainekio remains the hardware execution and completion-feedback owner.
- Environment Mode remains the only LLM vision/action graph for this feature.
- The existing TTS graph node and robot speaker transport remain the only speech-output pipeline.
- Autonomous cycles use correlation IDs, bounded steps, idempotency, and no polling.
- AI output remains semantic. Raw servo instructions are not introduced.

## Planned implementation

1. Add canonical Robot Operator configuration and Active Operator mode gating.
2. Register Robot Operator as a persistent Agent Monitor service with independent lifecycle controls.
3. Register Robot Observer as a manual finite agent and implement its coordinator-backed entrypoint.
4. Add a bounded `captureImage` Environment Bridge action with request/cycle correlation.
5. Extend the Ainekio environment adapter to translate `captureImage` into the existing `snap` hardware command and return a correlated JPEG observation.
6. Route correlated Robot Observer images through Environment Mode exactly once with a robot-observation instruction.
7. Route autonomous Ainekio actions through Robot Operator admission and enforce a bounded cycle step count.
8. Add contract tests for mode gating, inactivity behavior, manual observation, snapshot correlation, graph routing, and completion feedback.
9. Validate the graph, MetaHuman coordinator contracts, Ainekio adapter contracts, and simulator behavior available without physical hardware.

## Activity log

### 2026-07-17 — Inspection and design

- Confirmed the existing Environment Mode graph already owns image validation, vision-model input, response generation, TTS, action parsing, movement generation, and Environment Bridge output.
- Confirmed the installed `qwen3.5:9b` Ollama model reports the `vision` capability.
- Confirmed the live Ainekio session advertises visual support but has no current image in its latest observation.
- Confirmed Ainekio already implements the hardware `snap` command and converts JPEG camera frames into Environment Bridge observations.
- Found the missing transport contract: standalone snapshot capture is not currently an Environment Bridge action, and returned camera observations do not carry the requesting Robot Observer cycle correlation.
- Confirmed the existing environment automatic-step guard is generic and permits eight executions per minute; Robot Operator needs a tighter per-cycle bound.
- Confirmed Robot Operator should own the inactivity deadline rather than adding another Trigger Manager schedule.
- No runtime implementation had been changed before this plan file was created.

### 2026-07-17 — MetaHuman controller and workflow implementation

- Added Robot Operator as an independently controlled Agent Monitor service with boot, enable, stop, restart, idle-threshold, jitter, and cycle-bound configuration.
- Added Robot Observer as an independently enabled manual workflow agent owned by the Work Coordinator.
- Added explicit Active Operator gating: autonomous admissions and mid-cycle actions stop in `reactive`; manual observer runs remain available.
- Added cycle metadata helpers and a three-step default bound so observation, action, and follow-up images remain one correlated workflow.
- Added the MetaHuman side of the semantic `captureImage` action and correlation propagation.
- Corrected the graph boundary after review: `captureImage` is an internal Robot Observer transport command, not an Environment Mode action option. No Environment Mode nodes or edges were added or changed for this feature.
- Added Ainekio snapshot translation and correlation propagation using the existing hardware `snap` command; focused adapter tests cover both initial capture and post-action images.

### 2026-07-17 — Boredom Movement agent

- Registered Boredom Movement as a separately enabled finite workflow agent with no independent timer.
- Extended Robot Operator, the existing controller, with a separately configurable 10 minute +/- 2 minute inactivity deadline for Boredom Movement. Robot Observer retains its existing 5 minute +/- 1 minute deadline.
- Kept Active Operator ownership unchanged: Robot Operator admits Boredom Movement only in `semi` or `full`; owners may still trigger the finite agent manually in `reactive`.
- Put the stationary command allowlist in Boredom Movement's dedicated `etc/boredom-movement.json` configuration. `etc/agents.json` remains limited to Trigger Manager's lifecycle fields. At runtime the agent intersects its allowlist with the connected robot's existing advertised `robotCommands` catalog.
- The agent randomly selects one eligible stationary command, narrows the synthetic observation to that exact command, and submits it through the existing `environment.observation` workflow. Environment Mode remains unchanged and its existing direct semantic-command parser guarantees the selected command wins over conflicting model output.
- The current allowlist is `sit`, `stand`, `neutral`, `rest`, `wave`, `dance`, `swim`, `point`, `pushup`, `bow`, `cute`, `freaky`, `worm`, `shake`, `shrug`, `dead`, and `crab`. Locomotion and control commands (`walk`, `backward`, `left`, `right`, and `stop`) are excluded.
- Scope correction: an initial pass added a stationary-capability field to Environment Mode support code and Ainekio. After owner clarification that this work must remain centered on the agents, those additions were removed. The final implementation adds no Boredom Movement logic to Environment Mode nodes and no Boredom Movement capability field to Ainekio.

## Validation log

### 2026-07-17 — Contract and build validation

- `pnpm exec tsx --test packages/core/src/robot-operator.spec.ts packages/core/src/environment-interface/compatibility.spec.ts packages/core/src/queue/work-owner-architecture.spec.ts packages/core/src/queue/service-lifecycle.spec.ts tests/environment-freestyle-graph.spec.ts`: 9 tests passed.
- `pnpm validate:graphs`: all 21 cognitive graphs passed; this feature did not add or rewire an Environment Mode node.
- Ainekio `Emulator.tests.test_environment_adapter`: all 22 tests passed, including correlated `captureImage` and post-action snapshot cases.
- Robot Operator and Robot Observer source modules load successfully through their public package imports.
- Agent Catalog reports Robot Observer as a ready manual workflow and Robot Operator as a ready Agent Monitor service.
- Robot Operator smoke run acquired its service lock, recognized current `semi` mode, armed a randomized deadline, and released its lock when stopped before the deadline.
- `pnpm --dir apps/site build`: completed successfully. The generated server bundle contains `workflow.robot-observer` and the expected `activity-ping`, `tts`, and `unified-queue` route modules.
- Full `packages/core` TypeScript checking remains red on 66 pre-existing diagnostics; none reference the files touched for Robot Operator.
- `git diff --check` passed for the scoped MetaHuman and Ainekio files.
- Physical-robot camera capture has not been invoked from this development session. MetaHuman OS and the Ainekio gateway must both restart to load the rebuilt server and patched Python adapter before the first live cycle.

### 2026-07-17 — Boredom Movement validation and scope audit

- Focused Robot Operator, Environment Bridge compatibility, work-owner architecture, and Environment Mode graph-contract suites passed after the agent-centered correction.
- The agent-selected exact-command test proves that an instruction such as `perform wave`, with capabilities narrowed to `wave`, produces `robotCommand: wave` even when model output attempts `walk`.
- All 21 cognitive graphs validate. No Boredom Movement node or edge was added.
- Static scans find no `boredom` or `stationary` implementation in Environment Mode node files, the Environment Mode graph, the environment capability type, or Ainekio's environment adapter.
- Agent Catalog reports Boredom Movement and Robot Observer as ready finite workflows owned by Trigger Manager, and Robot Operator as a ready persistent service owned by Agent Monitor.
- `git diff --check` passes for the scoped Robot Operator and Boredom Movement files.
- The full core typecheck remains red on unrelated existing diagnostics; none reference Robot Operator or Boredom Movement files.
- The broad Agent Monitor validator is currently blocked by the concurrently deleted `packages/core/src/api/handlers/system.ts`; that unrelated deletion was not repaired here.
- The live Robot Operator process predates these source changes. It must be restarted (or MetaHuman OS restarted) before the Boredom Movement timer becomes active. No physical robot movement was triggered during validation.
