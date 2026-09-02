# Environment Mode Autonomy-Input Caller Audit

Status: audited and repaired in the current worktree, 2026-09-02.

## Question

Does any maintained caller require the Boredom planner instruction input wired
into the interactive Environment Mode graph?

## `etc/cognitive-graphs/environment-mode.json`

- Owner: interactive Environment execution for typed chat, robot microphone
  input, user-originated perception, and their correlated action feedback.
- Finding: `Environment Bridge Input.plannerInstruction` is wired to
  `Instruction Resolver.autonomyInstruction`.
- Caller evidence: no maintained producer was found that targets Environment
  Mode with a planner-authored `robotOperatorDecision`.
- Test evidence: two current structural assertions require the edge, but no
  behavioral test exercises an autonomous planner through Environment Mode.
- Disposition: the autonomy-instruction edge and Instruction Resolver node are
  removed from Environment Mode. User Input now supplies the human instruction
  and its provenance directly to the existing downstream nodes.

## Boredom planner and executor graphs

- Owner: Boredom Observer, Movement, and Reflection author distinct high-level
  intentions; Boredom Autonomy is their shared iterative executor.
- Finding: all three planners dispatch to `boredom-autonomy`, and correlated
  action feedback returns to `boredom-autonomy`.
- Disposition: keep the planner-instruction connection in
  `boredom-autonomy-mode.json`. It is the maintained autonomous execution path.

## Queue and dispatch owners

- Owner: `robot-autonomy-trigger-handler.ts` admits planner work;
  `environment-dispatch.node.ts` delegates the validated planner decision;
  `execution-engine.ts` runs the graph named by the correlated cycle.
- Finding: the only maintained production writer of
  `metadata.robotOperatorDecision` is Robot Operator Environment Dispatch. The
  configured destination is `autonomyGraph`, currently `boredom-autonomy`.
- Finding: `autonomyGraph` accepts any syntactically valid graph name and is
  writable in Agent Monitor. No maintained documentation or test establishes
  `environment` as a supported Boredom executor. This loose configuration is
  not evidence of a current caller.
- Disposition: preserve configurable executor selection, but treat its expected
  input contract as the Boredom Autonomy contract rather than relying on an
  accidental Environment Mode compatibility path.

## Environment Bridge transport

- Owner: authenticated robot observations, capabilities, media, action results,
  and user speech transport.
- Finding: the bridge forwards observation metadata and the API validates only
  the basic observation envelope. An authenticated adapter could therefore
  supply `robotOperatorDecision`, even though that field is internally owned by
  Robot Operator dispatch.
- Disposition: this is a provenance-boundary issue, not a maintained autonomy
  caller. The existing action-context owner now removes externally supplied
  Robot Operator cycle, decision, memory, and stimulus metadata, then restores
  trusted correlation from Work Coordinator state.

## Validation and conclusion

- Static searches covered maintained graph wiring, graph selection, queue
  producers, bridge routes, Robot Operator configuration, tests, and technical
  authority documentation.
- The focused Environment graph, conversation ownership, Boredom Autonomy,
  bridge compatibility, action-first observation, and Robot Operator suites
  pass after repairing their stale ownership and prompt-contract assertions.
- All 27 cognitive graphs validate, Core typechecking passes, the architecture
  guardrail reports zero violations, and the root production build passes.
- Authenticated live queue and bridge state were unavailable to this audit, so
  no runtime non-use claim is made.

Conclusion: Environment Mode contains no autonomy-instruction adapter. Boredom
Autonomy remains the separate autonomous executor and sole user of the shared
Instruction Resolver in these workflows.
