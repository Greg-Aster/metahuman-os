# Companion qualification

[Robot Bible](ROBOT_BIBLE.md) defines the intended companion. This page connects
representative user-visible functions to their existing owners and tests. It is
a guide to selecting evidence, not a new runner, runtime gate or claim that the
robot currently passes these scenarios.

The local cleanup diary records dated findings, repairs and evidence
from the owner-requested system cleanup; it does not redefine these contracts.

## Evidence levels

| Evidence | What it establishes |
| --- | --- |
| Owner intent | The desired behavior; implementation may still be incomplete |
| Source/configuration | What the inspected code and settings express |
| Software test | The tested transition under its stated fixtures and simulated dependencies |
| Model evaluation | Decisions from the specified model, prompt and supplied evidence |
| Live software | A result observed in the identified running services |
| Physical observation | A result observed on the identified body and installed firmware |

A passing layer does not imply the next. Missing evidence remains unverified;
a recorded failure remains a failure until a relevant retest establishes otherwise.
Dated statements about a disassembled body, serving model, active mode or repaired
fault describe their original conditions and must be refreshed before reuse.

## Representative scenarios

These are development scenarios, not prescribed robot behavior. Use the cases
relevant to the requested change, including the actual failure and an interacting
case. The links identify existing coverage to inspect; they do not report fresh
passing results or imply complete coverage of a row.

| Observable scenario | Handoff and behavior to establish | Existing evidence entry points | Remaining live boundary |
| --- | --- | --- | --- |
| Request a movement on V2 | Semantic description → selected Freestyle generator/compiler → gateway → twelve-joint P4 execution and measured feedback; retain failure, cancellation and job identity | [Semantic motion](../../../Ainekio/Emulator/tests/test_environment_motion_request.py), [Freestyle wire/model contract](../../../Ainekio/experiments/freestyle/test_freestyle.py), [P4 body](../../../Ainekio/Slave/firmware/esp32p4-wifi6/tests/test_body.c), [feedback arrival](../../../Ainekio/Slave/firmware/esp32p4-wifi6/tests/test_servo_feedback_position.c); [commands below](#movement-and-v2-body-execution) | Live model decisions, installed calibration, loaded movement and physical achievement |
| Consume results without accumulating disposable state | Producer → durable consumer commit → acknowledgement → release; retained domain memory and unresolved outcomes survive | [Queue persistence](../../packages/core/src/queue/queue-persister.spec.ts), [execution retention](../../packages/core/src/durable-execution/store.spec.ts), [recovery](../../packages/core/src/durable-execution/recovery.spec.ts), [gateway receipts](../../../Ainekio/Emulator/tests/test_action_receipts.py); [commands below](#retained-state-and-memory) | Long-running installed workload and its configured retention; test fixtures do not measure production growth |
| Speak to the robot and receive an appropriate reply | Body audio → Bridge/STT → Environment context/routing → Persona → conversation and selected TTS output; retain speaker and request identity | [Environment routing](../../packages/core/src/nodes/environment/request-routing.spec.ts), [conversation delivery](../../packages/core/src/nodes/environment/conversation-delivery.spec.ts), [gateway speech](../../../Ainekio/Emulator/tests/test_environment_speech.py) | Actual microphone/transcription, model interpretation and audible response |
| Speak and move during the same interaction | Independent speech and movement progress; narration receives the relevant action evidence; replacement speech uses its existing delivery owner | [Speech progress](../../packages/core/src/nodes/environment/speech-progress.spec.ts), [speech interruption](../../packages/core/src/queue/speech-interruption.spec.ts), [Bridge concurrency](../../brain/agents/environment-bridge/async-control.spec.ts) | Supported physical concurrency, speech timing and loaded motion |
| Change or stop an active request, including manual takeover or reconnect | Preserve the original instruction, admitted work identity and actual outcomes through Core → gateway → simulated body; distinguish a stop request from original-motion termination | [Paired task/gateway suite](../../packages/core/src/environment-interface/active-task-gateway.spec.ts), [Ainekio harness](../../../Ainekio/Emulator/tests/program_ownership_harness.py), [Bridge receipt/reconnect suite](../../brain/agents/environment-bridge/core-lifecycle.spec.ts) | Live model routing, network authentication and actual stopping; recovery must not replay a physical action |
| See something, discuss it, remember it and recall it later | Fresh image/evidence → selected context → attributed conversation record → retrieval → appropriate later use | [Perception](../../packages/core/src/environment-interface/perception.spec.ts), [visual reads](../../packages/core/src/environment-interface/visual-read.spec.ts), [conversation memory](../../packages/core/src/environment-conversation-memory.spec.ts), [memory attribution](../../packages/core/src/memory-index-attribution.spec.ts) | Camera quality/freshness and useful semantic recall; a saved record alone does not qualify the complete loop |
| Pursue an autonomous intention and use its outcome | Active Operator selects work or an existing execution; Agency owns desires; actual results and attributed memories inform a later assessment | [Autonomy continuity](../../packages/core/src/nodes/robot-operator/autonomy-decision-continuity.spec.ts), [autonomy workflow](../../packages/core/src/nodes/robot-operator/autonomy-workflow.spec.ts), recorded October 25 qualification (local evidence) | Continuous meaningful self-directed activity, including non-physical work and Sleep; no empty/no-op decisions or event-only suspension; embodied performance |
| Sleep, produce inner activity and return to interaction | Existing Sleep owner admits enabled stages, records individual outcomes and handles user activity; dreams retain their attribution for later recall | [Sleep workflow](../../packages/core/src/queue/sleep-workflow.spec.ts), [Dreamer persistence](../../packages/core/src/nodes/dreamer/dreamer-persistence.spec.ts), [Daydreamer contract](../../packages/core/src/nodes/dreamer/daydreamer-contract.spec.ts) | Complete live cycle, recall/use of inner activity and return to awake interaction; body low-power state is separate |
| Learn from a reviewed experience | Original model input/output and outcome evidence → curation → mode-correct dataset → fitting/evaluation → authorized activation; persona facts retain their subject | [Training review](../../packages/core/src/nodes/environment/training-review.graph.spec.ts), [dataset](../../packages/core/src/training-dataset.spec.ts), [persona learning](../../packages/core/src/persona-learning.spec.ts), [specialist evaluation](../../brain/training/environment-action-selector/README.md) | Better behavior after activation, held-out quality and absence of relevant regressions; a completed fit is insufficient |
| Receive a body event or use an external tool | Event/tool identity survives admission and result delivery; reaction, memory and speech follow the selected workflow's contract | [Body event routing](../../packages/core/src/environment-interface/body-events.spec.ts), [body-event admission](../../packages/core/src/api/handlers/body-event-admission.spec.ts), [tool use](../../packages/core/src/nodes/environment/tool-use.spec.ts) | Physical event/display behavior and actual tool-result delivery, separately from submission |

## Selecting existing checks

[Root package scripts](../../package.json) are the maintained command owner.
`test:environment-graph`, `test:environment-perception`, `test:durable-execution`
and the relevant `validate:*` commands cover different portions of these paths.
`pnpm verify` runs registered workspace validation and the Site build. The
architecture checker detects its defined structural violations; it does not
qualify companion behavior.

Not every linked test is in that chain. In particular, paired task/gateway
qualification is a separate invocation requiring `AINEKIO_SOFTWARE_TEST_GATEWAY`
to identify the paired Ainekio checkout. Its existing
[invocation and limits](../technical/environment-mode-performance.md)
remain documented with that implementation. It uses simulated model replies and
a simulated body; it does not establish live model decisions or physical motion.
Other focused suites must also be invoked explicitly when absent from the
maintained command being used. Inspect the current scripts before selecting work.

The optional [recorded-image gateway suite](../../packages/core/src/environment-interface/perception-gateway.spec.ts)
requires an explicitly selected recording, local weights, Python environment and
artifact directory. It is separate from ordinary perception unit/integration tests.
Reading or editing these documents does not call for starting models, services or
physical tests.

## Maintenance walkthroughs

Use these as concrete starting paths when repairing the named behavior. Read the
[core](ROBOT_BIBLE.md), [architecture](SYSTEM_ARCHITECTURE.md) and relevant contract,
then trace the implementation and check the current commands. A newcomer should
be able to name the intended result, surviving owner, affected consumers, removal
set and evidence without reconstructing the project's chat history. If a route
below is stale, correct it with the owning change.

These commands exercise existing software suites with simulated providers/body
or native host shims. They do not flash, activate models or move the robot. Run
Node commands from MetaHuman with its supported Node/dependencies; Python and CMake
commands from Ainekio with its existing test dependencies. They are focused
invocations, not a replacement for affected package-level checks or physical proof.

### Movement and V2 body execution

Start at [motion intent](BODY_CAPABILITIES.md#motion-and-posture), follow
`GatewayService.request_motion` → Freestyle executor/generator/compiler → P4 body
and feedback owners. Preserve the semantic route when manual library selection
changes. A compiler repair does not create another controller; a calibration
repair must preserve the [physical joint/unit contract](../../../Ainekio/docs/v2-12servo/SPECIFICATIONS.md#joints-units-and-calibration).
Run the owner tests for the layer changed, plus the adjacent handoff:

```sh
PYTHONPATH=Master:Slave/software:Emulator:Emulator/tests:experiments/freestyle python3 -B -m unittest Emulator.tests.test_environment_motion_request experiments.freestyle.test_freestyle
robot_test_build=$(mktemp -d /tmp/ainekio-body-tests.XXXXXX)
cmake -S Slave/firmware/esp32p4-wifi6/tests -B "$robot_test_build"
cmake --build "$robot_test_build" --target test_body test_servo_feedback_position -j2
/usr/bin/ctest --test-dir "$robot_test_build" --output-on-failure -R '^(body_execution|body_feedback_execution|servo_feedback_measured_arrival)$'
```

For a motion-model replacement, the software contract is only one boundary.
Follow [Freestyle's existing evaluation/deployment procedure](../../../Ainekio/experiments/freestyle/README.md)
and [learning intent](MODELS_AND_LEARNING.md): compare behavior with the incumbent,
retain dataset/model provenance and obtain activation authority. Lower loss or a
successful export alone does not qualify a replacement.

### Speech while movement continues

Follow [listening and speaking](BODY_CAPABILITIES.md#listening-and-speaking) through
Core speech delivery, Bridge and the gateway. Preserve independent progress and
the original action identities; narration must use actual action evidence.
Replacing speech must not cancel unrelated movement or become a global barrier.

```sh
node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 packages/core/src/nodes/environment/speech-progress.spec.ts packages/core/src/queue/speech-interruption.spec.ts brain/agents/environment-bridge/async-control.spec.ts
```

### Cancellation and reconnect

Follow the [handoff contract](SYSTEM_ARCHITECTURE.md#contracts-at-the-handoffs) from
Core execution through adapter admission to the original body receipt. Inspect
selection changes and manual takeover as well as ordinary cancellation. Reconnect
may redeliver an unacknowledged result; it must not repeat physical execution.

```sh
AINEKIO_SOFTWARE_TEST_GATEWAY=../Ainekio node --experimental-test-module-mocks --import tsx --test packages/core/src/environment-interface/active-task-gateway.spec.ts
```

Set the variable to the actual paired checkout when the repositories are not
siblings. The [harness](../../../Ainekio/Emulator/tests/program_ownership_harness.py)
uses a simulated body and explicit model replies. It does not exercise live model
interpretation or network authentication.

**Qualification gap observed 2026-10-26:** this paired suite failed 37 of 40 cases
in the working checkouts. Its saved model replies omit the current required
`needsGoalReview` field; other failures concern program-schema and speech-ownership
expectations. The suite is an existing repair/qualification entry point, not
passing evidence for the present implementation. Reconcile its fixtures and
assertions with the approved contracts, then retest both sides before claiming
the combined path is qualified. No production contract was changed to hide this
failure during documentation maintenance.

Run from Ainekio for adapter receipt
delivery/recovery and pruning behavior:

```sh
PYTHONPATH=Master:Slave/software:Emulator:Emulator/tests python3 -B -m unittest Emulator.tests.test_action_receipts
```

### Retained state and memory

Use the [state lifecycle table](SYSTEM_ARCHITECTURE.md#state-memory-and-learning)
to distinguish worker state, undelivered receipts, execution history and domain
memory. Trace normal consumption and reopening before deciding a record is orphaned.
If a producer retains unnecessary copies, repair that transition; do not clear
memories or add a second cleanup owner. Run the persistence/recovery tests and
memory attribution coverage for the corresponding boundaries:

```sh
node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 packages/core/src/queue/queue-persister.spec.ts packages/core/src/durable-execution/store.spec.ts packages/core/src/durable-execution/recovery.spec.ts packages/core/src/memory-index-attribution.spec.ts
```

For a performance or accumulation repair, also measure the actual affected
query/transition at representative volume. Passing these fixtures does not by
itself establish bounded disk use during a long-running installed workload.

### Full Auto engagement

Use the [Full Auto contract](COMPANION_BEHAVIOR.md#full-auto-continuity--owner-contract).
Establish consecutive meaningful model-selected activities without advancing a
configured interval or supplying an external event. Include musing/reasoning,
finite agents, tasks and an actual Sleep handoff; movement alone is not the whole
capability. Existing work must retain its identity and progress independently.
An empty decision, all-zero activation or repeated assessment without selected
activity is a failure, not successful idle behavior. Preserve Semi's interval.

Inspect the existing [service](../../brain/agents/active-operator/index.spec.ts),
[activation/parser](../../packages/core/src/active-operator/activation.spec.ts) and
[continuity](../../packages/core/src/nodes/robot-operator/autonomy-decision-continuity.spec.ts)
suites against the maintained contract. Do not assume an older report of obsolete
expectations describes the current tests. Passing fixture-selected operations
and scheduling checks still does not qualify live meaningful engagement.

During live qualification, record what each assessment selected, which existing
work was already progressing, what actually happened, and how the next choice
used that outcome. Include inference frequency, selected context volume and
resource use alongside useful behavior. Repeated messages, duplicate commands
and heavy GPU use are not evidence of progress. This is observation through
existing evidence owners, not a new runtime limit or monitoring service.

## Recording a result

Use the existing task conversation or dated evidence record. State the scenario,
expected outcome, actual result and failure boundary. Identify both repository
revisions and relevant local edits when both participate; identify deployed builds,
selected body/firmware, model/prompt/configuration and initial state when applicable.
Record the test command or observed interaction and what it did not exercise.

For a lifecycle repair, include the relevant repeated operation, cancellation,
failure or reconnect. Preserve required undelivered outcomes and show that original
work was not executed again. Review the complete affected capability across owners,
including superseded callers and interfaces. The [repair design](../technical/REFACTOR_BLUEPRINT.md)
owns this method; no separate per-repair registry is needed.

## Open boundaries and historical evidence

The pre-consolidation qualification (retained locally)
and troubleshooting diary (retained locally)
retain earlier findings and owner decisions. They are not a fresh fault list or
today's work order. The October 25 autonomy (local evidence)
and queue (local evidence) records give more specific
repair evidence with their own limits. Complete companion qualification remains
unestablished by this documentation edit.

The [Reactive-mode decision](COMPANION_BEHAVIOR.md#robot-autonomy-modes--owner-defined-behavior)
retains physical-event reactions and excludes self-directed activity. Its routing
checks are the existing body-event/wake suites above; source documentation alone
does not establish the live response.

[Ainekio's authority map and amendments](../../../Ainekio/docs/README.md)
distinguish retained specification clauses, approved replacements and V2 hardware.
Source changes do not prove installed wiring, calibration or electrical performance.
