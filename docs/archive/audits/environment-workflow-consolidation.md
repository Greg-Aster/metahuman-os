# Environment Workflow Consolidation

Date: 2026-08-06

## `etc/cognitive-graphs/environment-mode.json`

- Owner: Environment Mode cognitive graph.
- Summary: Reduced the competing lifecycle workflow and removed the later strict selector-validation/escalation detour. The active graph is now 21 nodes and 52 edges.
- Boundary issues: The previous graph assigned overlapping semantic and completion authority to a Context Router, Task Contract reconciler, Visual Evidence Assessor, Task Validator, Task Refiner, and queued Workflow Command.
- Technical debt: Matching action completion could be ignored, stale refinement prose could enter chat, and one physical objective could create multiple serial model passes and repeated actions.
- Security/privacy notes: No runtime observations, profile data, images, or local logs are included in this report.
- Test gap closed: Exact result closure, failed-action retry, before/after visual evidence, missing-baseline rejection, and active-graph ownership now have focused tests.
- Recommended action: Keep `environmentActionSelector` as the sole semantic action owner, pass its result directly to the existing Action Parser, and keep `environment_task_state` as the sole deterministic lifecycle owner.

## `packages/core/src/nodes/environment/selection-gate.node.ts`

- Owner: Retired and deleted.
- Summary: The gate and its focused test file were removed after live probes showed that 0.8B, 2B, and 9B all selected the exact advertised `stand` command and the gate discarded every result for incomplete auxiliary lifecycle metadata.
- Boundary issues: The gate duplicated Action Parser's typed capability admission and Task State's lifecycle ownership. Its separate persona loader, persona formatter, general-message prompt output, and graph edges were deleted with it.
- Technical debt: General-model conversation escalation is no longer part of this workflow. If later required, it needs an owner outside the physical command path and must not veto an advertised command.
- Security/privacy notes: Runtime and training envelopes are bounded and user-agnostic; no profile persona is supplied to the action selector.
- Test gap closed: Graph tests now require the selector response to flow directly through Thinking Stripper to Action Parser and require the gate and its persona-only support nodes to remain absent.
- Recommended action: Evaluate semantic selection, exact advertised-command admission, bridge delivery, and task completion as separate owners. Do not recreate a full-response veto between selection and parsing.

## `packages/core/src/model-resolver.ts` and model registry owner

- Owner: Profile-configurable model-role resolution and migration.
- Summary: Adds `environmentActionSelector`, migrates defaults/mappings/hierarchy through the registry owner, and removes the retired `environmentRouter` assignment instead of treating the incompatible artifact as the new selector.
- Boundary issues: The graph names a role, never a hard-coded model ID. Existing explicit selector assignments and unrelated model records are preserved.
- Technical debt: The live Ainekio profile is deliberately unmigrated until a gate-passing artifact exists; source and built-bundle validation are not deployment proof.
- Security/privacy notes: No profile data is copied into system defaults or training data.
- Test gap closed: Registry migration, explicit assignment preservation, retired-role rejection, and development-checkpoint inventory filtering have focused tests.
- Recommended action: Install and behaviorally validate the merged selector before loading the live profile through the migration path.

## `packages/core/src/nodes/environment/task-state.node.ts`

- Owner: Typed Environment objective lifecycle.
- Summary: Prepares and reduces task state, persists evidence requirements with actions, bypasses model inference for exact reactive one-step `action_result` completion, returns autonomous results for semantic review, admits one next action, and emits explicit failures.
- Boundary issues: None introduced; the node consumes public Core environment and robot-operator interfaces.
- Technical debt: Baseline image data is retained in a bounded in-process cache while only the frame reference is persisted. A server restart during an action intentionally makes comparison evidence unavailable instead of inventing success.
- Security/privacy notes: The cache is memory-only, bounded to 24 JPEG frames, and is not tracked source.
- Test gap closed: A visual comparison cannot complete from only the current robot camera frame.
- Recommended action: Do not add a parallel recovery or completion model. Extend this state contract only for genuinely new evidence types.

## Retired node group

- Owner: None after graph consolidation.
- Summary: Deleted Task Contract, Visual Evidence Assessor, Task Validator, Task Refiner, and Workflow Command implementations plus obsolete tests.
- Boundary issues: These nodes duplicated lifecycle or semantic ownership and created a hidden continuation workflow.
- Technical debt: Historical `EnvironmentTaskContract` parsing remains only to adopt actions queued by an older running bundle during deployment transition.
- Security/privacy notes: No runtime data was removed.
- Test gap: None for the retired design; replacement behavior is covered by `task-state.node.spec.ts`.
- Recommended action: Remove the legacy contract decoder only after no action created by an older served bundle can still return feedback.
