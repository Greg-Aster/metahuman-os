# Visual observation history: review and implementation

Date: 2026-09-10. The initial review below is retained as the pre-change baseline. The subsequent authorized implementation is described here; its software checks are not deployment or physical-camera acceptance.

## Implemented after approval

- **Observation History** loads image-linked model interpretations through an explicit context-builder port. Its saved `Observations to load` setting defaults to five; changing it changes prompt context, not evidence retention. Environment Mode, Autonomy Executor, Controller, Observer, Movement, Reflection, Action Result, and Goal Review now include this node. Conversation-only Environment turns skip it with the existing environment route.
- **Save Visual Observation** records optional `visualObservation` output from the existing image-bearing model call. It makes no model call and requires neither speech nor a task decision. The record contains the interpretation, uncertainties, optional comparison, exact source-frame IDs/capture times/action IDs, producing execution/node occurrence, robot identity, and interpretation time. The six image-bearing workflows include this conditional output node; Movement and Reflection consume history without inventing new sightings.
- The existing profile-scoped **ExecutionStore/checkpoint transaction** owns persistence. A typed observation index and execution-reference table inside that database enable chronological cross-execution reads without scanning unrelated checkpoint documents. Large values and images use its existing content-addressed storage. Retrieval is scoped by profile, environment, adapter and body identity; an unidentified body remains session-scoped. No separate database, buffer owner, scheduler, or agent was added.
- A history reader retains its selected records and original frames with its checkpoint, including when source cleanup races the read. Existing terminal cleanup removes unreferenced observations; active/waiting executions protect their evidence. Stable producing-occurrence IDs prevent replay from duplicating a saved interpretation.
- **Robot Status Out** projects `latestVisualObservation` into the existing status file. Selection uses image capture time, so interpreting an old frame later or refreshing telemetry does not make it a new view. General situation text remains distinct. Robot Status does not own observation history, task continuity, or completion decisions.
- Model contexts receive recent text interpretations, not another bundle of old image bytes. Original frames remain retained for selected image use. Exact frame metadata now follows the actual selected image parts through each parser. Existing before/after selection remains conditional; the tested comparison reaches one existing review call with both original images. Text history is not reversible image compression or guaranteed recognition.

Implementation owners: [shared contract](../../packages/core/src/visual-observation.ts), [history node](../../packages/core/src/nodes/environment/observation-history.node.ts), [save node](../../packages/core/src/nodes/environment/save-visual-observation.node.ts), and [ExecutionStore](../../packages/core/src/durable-execution/store.ts). Source graphs and their public editor copies were updated together. Existing conversation/inner/robot/system buffers, model routing, task decisions, optional Desire behavior, and physical dispatch remain with their existing owners. No existing feature or execution path was replaced by a parallel implementation.

### Verification

All effects and provider/voice transports in runtime tests were isolated or mocked; actual saved workflows, node implementations, configured model routing, SQLite checkpoints, and Coordinator contracts were used.

| Check | Result |
| --- | --- |
| `node --experimental-test-module-mocks --import tsx packages/core/src/durable-execution/store.spec.ts` | 23 passed; the visual-history case was rerun after the final storage refinement. Covers restart/replay, profile/body isolation, immutable evidence, source cleanup racing a reader, large-value retention, and final cleanup. |
| Same Node invocation for `packages/core/src/durable-execution/workflows.spec.ts` | 35 passed. Covers actual graph handoff, standalone observation with no speech/task, a later Controller reading it, before/after review, no additional model calls, and existing cancellation/steering/Desire workflows. |
| Same Node invocation for `packages/core/src/nodes/robot-operator/boredom-autonomy.spec.ts` | 29 passed. |
| Same Node invocation for `packages/core/src/robot-status.spec.ts` | 18 passed; the extended out-of-order projection case also passed separately. |
| Same Node invocation for `packages/core/src/nodes/robot-operator/result-contract.spec.ts` | 3 passed. |
| `pnpm test:environment-graph` | 4 passed. |
| `pnpm validate:graphs` | 38 valid graphs; all eight changed source/public pairs match. |
| `pnpm typecheck:core`, `pnpm check:architecture` | Passed; no architecture violations. |
| `pnpm --dir apps/site exec astro build --outDir <isolated-directory-under-apps/site/.astro>` | Passed without replacing the running `apps/site/dist`. |

The configurable history count survived saved-graph serialization/validation and was exercised by the actual Controller. Browser interaction, real-model interpretation quality, latency improvement, and physical camera behavior have not been tested. No services were restarted and no robot command was sent. New observations accumulate after deploying this source; old conversational prose is not relabelled as visual evidence. Full workspace `pnpm verify` was not run.

## Original pre-implementation review

## Conclusion

Use the familiar buffer input/output pattern in the graph, but retain the existing durable execution store as the owner of image-linked observations. Do not create another memory service, scheduler, or independent JSON history. Robot Status should display the latest relevant observation; it should not become the observation archive or own execution continuity.

The missing piece is not image storage. It is a separately readable record of what a model observed in particular images, independent of whether it also made a task decision.

## Existing buffers and graph input/output nodes

- Owner: Core [conversation-buffer.ts](../../packages/core/src/conversation-buffer.ts), [Buffer History](../../packages/core/src/nodes/context/conversation-history.node.ts), [Robot Buffer](../../packages/core/src/nodes/output/robot-buffer.node.ts), and [System Buffer](../../packages/core/src/nodes/output/system-buffer.node.ts).
- Summary: One buffer owner stores conversation, inner dialogue, robot, and system streams. Buffer History loads a configured stream into a graph. Robot Buffer records command dispatch and action feedback. System Buffer records notices such as Robot Status refresh reports. Output nodes stage durable buffer deliveries rather than directly owning another persistence path.
- Boundary issues: Robot Buffer entries are not image interpretations. The robot context builder's action-history formatter specifically reads `meta.bridgeRecord`; inserting unrelated summaries there would not automatically expose them to the model. Conversation entries are narrative, not evidence tied to source images.
- Technical debt: No additional buffer service is justified. Keep these owners and their existing jobs. A visual-history node can reuse the editor's property and port conventions without pretending to be a conversation stream.
- Security/privacy notes: Buffer paths resolve through profile storage. Visual history must retain this profile isolation and distinguish robots within a profile. Do not copy profile content or images into graph JSON or logs.
- Test gap: Existing buffer ownership tests cover admission boundaries, not visual-observation retrieval.
- Recommended action: Keep all four streams. Do not use the conversation or robot stream as the authoritative visual history.

## Robot Status and the status messages in the feed

- Owner: Core [robot-status.ts](../../packages/core/src/robot-status.ts), [Robot Status input](../../packages/core/src/nodes/robot-status/status.node.ts), [Robot Status Out](../../packages/core/src/nodes/robot-status/out.node.ts), and the dedicated refresh graph's [writer](../../packages/core/src/nodes/robot-status/writer.node.ts).
- Summary: `robot-status.json` is the current body/action/task/situation projection. It retains eight compact previous status entries, not eight image interpretations. The input node exposes this snapshot and configurable status history. The separate Robot Status refresh graph includes a model call and sends its saved-status notice to System Buffer. Robot Status Out itself does not call a model.
- Boundary issues: `situation.environmentDescription` can retain an earlier description or fall back to general semantic text. Its status-update time is not an image capture time. Robot Status Out's `semanticSummary` can come from a response, decision reason, action feedback, or user instruction. These fields therefore cannot establish what was seen in a particular frame.
- Technical debt: Making the status file a second observation archive would duplicate durable evidence ownership and confuse status refreshes with new sightings.
- Security/privacy notes: Keep canonical profile paths and durable task projection. A status view must not silently mix another robot's observation into the current body's scene.
- Test gap: Status projection coverage does not prove image-linked history continuity.
- Recommended action: Keep Robot Status as the overview. Give its existing output node the latest relevant visual observation and source time/reference when available. Retain general situation text separately; a new status write must not make an old image appear newly captured.

## Images, interpretations, and current context construction

- Owner: Core [Select Available Camera Evidence](../../packages/core/src/nodes/environment/image-input.node.ts), [robot context builder](../../packages/core/src/nodes/robot-operator/context-builder.node.ts), and [action-result parser](../../packages/core/src/nodes/robot-operator/action-result-parser.node.ts).
- Summary: The image-input node selects available image bytes with matching frame metadata; it does not capture an image or call a model. Context builders deliver those image parts to the configured model path. The action-result schema currently places `observationSummary` inside `taskDecision`. Without an existing objective, that schema requires `taskDecision: null`.
- Boundary issues: A useful image interpretation without a task has no independent structured observation output in this result contract. Current context construction does not provide a dedicated visual-summary history. Before/after evidence is also conditional: Robot Status Out records a new baseline frame when the decision requests comparison. Adding text history alone will not ensure both original images reach a comparison call.
- Technical debt: Reusing free-form responses as visual facts or adding a second caption model call would not repair this output contract.
- Security/privacy notes: Model descriptions are interpretations with uncertainty, not verified sensor facts. Preserve the exact source image identity, capture time, and associated action where one exists.
- Test gap: Existing workflow tests retain before/after fixtures but do not establish that every relevant review receives both images or that standalone observations are reusable later.
- Recommended action: Expose visual observations independently of task decisions and speech. Reuse the existing image-analysis call's output. Keep original-image selection available when another examination or before/after comparison is needed.

## Durable storage and participating graphs

- Owner: Core [execution store](../../packages/core/src/durable-execution/store.ts), [checkpointer](../../packages/core/src/durable-execution/checkpointer.ts), [node execution contract](../../packages/core/src/durable-execution/graph-contract.ts), and [graph executor](../../packages/core/src/graph-executor.ts).
- Summary: The profile-scoped execution database already retains events, checkpointed node outputs, frames, and content-addressed large values. Nodes stage changes that commit with successful execution transitions. Terminal cleanup preserves active executions and unresolved deliveries. The inspected graph wiring covers Environment Mode, Autonomy Executor, Observer, Controller, Action Result, Goal Review, and Robot Status refresh.
- Boundary issues: The exposed node contract offers `frame`/`recordFrames` and execution events, but no typed observation-history read/write contract. Saved node output is not yet a convenient chronological visual-history input. A later Controller invocation can have a different execution ID, so same-execution-only retrieval would miss earlier observations.
- Technical debt: Reuse this store and checkpoint boundary. Do not introduce a parallel observation database, direct node-side file writes, or another trigger loop. This review does not prescribe an additional table where existing event/output storage can serve the requirement.
- Security/privacy notes: Retrieval must resolve the authenticated profile and robot/environment identity. Preserve references to evidence reused by an active execution so terminal cleanup of its originating execution cannot break those references. Do not embed raw images repeatedly in text context.
- Test gap: Existing storage tests cover checkpoint conflicts, content reuse, and retention; they do not cover the proposed observation contract or cross-execution retrieval.
- Recommended action: Add the missing structured storage/query contract at this owner, retaining existing transaction, identity, and retention semantics.

## Proposed graph connections

```text
Available camera evidence -> existing image-analysis LLM
                                      |
                            Save Visual Observation
                                      |
                         existing durable execution store
                                      |
                             Observation History
                                      |
                          explicit context-builder input
                                      |
                         existing decision/review LLM
```

`Save Visual Observation` would only record the model's interpretation and its source references through the existing checkpoint boundary. `Observation History` would only retrieve those records. Neither captures images, calls a model, decides goals, produces speech, or dispatches movement. Both would have visible ports and saved editor settings.

A record needs an observation identity, producing execution/node occurrence, robot identity, source frame references and capture times, interpretation time, associated action if applicable, and the model's description/uncertainties. A comparison can reference both frames and record interpreted changes. The write/read contract should permit an observation without a goal or conversational response.

Connect history explicitly to context builders on relevant selected routes, rather than hiding another file read inside them or attaching every record to every prompt. Robot Status Out can receive the same latest observation for its overview. Preserve original images for later inspection; summaries are not reversible image compression.

## Focused acceptance for a later implementation

- An observation without a task is saved and available to a later graph, without extra model calls or forced speech.
- Records retain exact before/after image identities and source times; status updates do not change those times.
- Restart/retry does not duplicate committed observations. Cross-execution retrieval remains profile/robot scoped.
- Active-task evidence and evidence reused by an active execution survive relevant cleanup; terminal history follows the existing retention owner.
- Actual configured graphs deliver selected history to their context builders, with editor settings surviving save/load. Original-image access and existing conversation, task, memory, and optional Desire behavior remain available.

Evidence is static source and saved-graph inspection. Runtime latency, model interpretation accuracy, and physical camera behavior were not exercised or established by this review.
