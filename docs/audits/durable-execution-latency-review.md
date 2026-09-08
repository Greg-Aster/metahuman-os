# Durable execution latency diagnosis — 2026-09-08

Read-only runtime diagnosis, not final migration acceptance. No implementation,
configuration, service, or robot changes were made. Only this review record and
an isolated read-only diagnostic were authored by the reviewer.

Snapshot: `main`, HEAD `d7dbb7bababd524f595051eff5bd24bdad4cfeb5`.
There were 60 pre-existing porcelain-status entries before adding this record;
their authorship is not inferred from dirty status. HEAD and status names were
rechecked during review. Local source is dirty, while the Site runs a compiled
bundle and Brain workers run source; identical executable versions are not proven.

Evidence: current Coordinator history, model-router audit events, and latest saved
node timestamps read through a **readonly** SQLite connection (no ExecutionStore
constructor). The retained sample queried after 17:40 UTC actually contains work
from approximately 17:59–18:06 UTC. It is not a representative long-term benchmark.
No model requests or physical actions were initiated to obtain these measurements.

## Measured elapsed time

A Full-mode turn from 18:03:02.852 to 18:03:38.440 UTC took 35.588 seconds:

| Stage | Seconds | Meaning |
| --- | ---: | --- |
| Admission through command claim | 15.129 | Includes 2.701 seconds of initial queue wait, Controller, intent routing, action selection, and runtime overhead |
| Command claim through terminal feedback | 13.743 | Movement plus adapter/transport/feedback; not a measurement of network latency alone |
| Terminal feedback through completed continuation job | 6.716 | Resume admission, saved graph continuation, model-backed action review, and persistence |

The four model calls in this same execution took 3.886, 0.998, 1.622, and
1.707 seconds: **8.213 seconds total**, already included in the rows above.
The Controller, Executor, and Action Result checkpoints retain one parent identity.
Do not add child graph wall durations to the parent wall duration.

The selected saved graphs also contain **8.054 seconds of accumulated positive
subsecond gaps between consecutive nodes**. This is outside the node execution
timers, not a direct measurement of SQLite write latency.

Across the retained sample: 13 Controller jobs (three failed), median finite-job
runtime 11.90 seconds and median queue wait 3.56 seconds. There were 22 resume jobs,
median queue wait 7.94 seconds, maximum 25.15 seconds. Many long-waiting resumes
were already redundant; these statistics must not be represented as 22 useful
decisions delayed by that amount. Two direct chat jobs ran for 6.41 and 6.95 seconds.

## Coordinator wakeups and cooldown — confirmed avoidable overhead

- Owner/layer: Core Coordinator, `durable-execution/store.ts:625`,
  `durable-execution/coordinator-outbox.ts:13`,
  `queue/unified-queue-manager.ts:382` and `:460`; configuration `etc/queue.json:6`.
- Evidence: physical result and following observation separately admit resume jobs.
  In the sampled turn, the first finishes useful continuation at 18:03:38.440.
  The second runs at 18:03:41.296–41.378 (82 ms) after its event was consumed.
  The next Controller is admitted at 18:03:38.705 but starts at 18:03:44.037.
- Consequence: an already-satisfied wakeup still consumes the single local-model
  lane and resets its configured two-second post-job cooldown. Duplicate event
  delivery is not duplicate physical execution, but redundant scheduling costs time.
- Smallest correction: retire/coalesce satisfied wakeups at the existing
  Coordinator/durable admission boundary before claiming model capacity. Preserve
  both ordered events, receipt idempotency, restart recovery, and body fencing;
  do not introduce another queue or indiscriminately increase body concurrency.
- Verification: paired result and observation arriving before and during resume
  must both be recorded, with one necessary graph continuation, no extra model
  call/effect, and no model cooldown charged to an already-satisfied wakeup.

## Failed Controller output — confirmed failure, probable context-budget cause

- Owner/layer: Core context construction/model routing; saved graph
  `etc/cognitive-graphs/robot-autonomy-controller-mode.json:248`, provider transport
  `packages/core/src/providers/bridge.ts:636` and `:651`.
- Evidence: model calls ending 18:02:54.593 and 18:03:02.505 report prompt/completion
  counts of 8000/192 and 8166/26; both total 8192. The configured context and the
  live model process also use 8192. Both correlated Controller jobs fail strict
  JSON validation. Saved model responses contain 940 and 72 characters.
- Consequence: failed decisions consume whole cycles without useful action.
  Answer-space exhaustion is strongly indicated; provider finish-reason evidence
  is still needed to close the causal diagnosis. The parser is not the established
  root cause and must not be weakened.
- Smallest correction: establish full request token use and provider termination
  reason; budget the existing context to preserve the current instruction and
  required decision schema while reserving output capacity. Do not silently drop
  user instructions, fabricate JSON, or add a fallback runtime.
- Verification: a near-capacity real-provider request must either produce a valid
  bounded decision or report explicit context exhaustion; replay tests must retain
  current corrections/cancellation. Compare useful completion rate and elapsed time.

## Inter-node overhead — measured, attribution pending

- Owner/layer: Core scheduler/checkpointer and Coordinator maintenance;
  `durable-execution/checkpointer.ts:102–134`, `queue/execution-engine.ts:555–574`,
  `durable-execution/recovery.ts:15–106`.
- Evidence: the above 8.054-second sum, with median subsecond gaps around
  102–122 ms in the three participating graphs. Source commits checkpoints and
  awaits relay; the Coordinator awaits recovery before admission, scanning retained
  receipts and executions. These code paths are candidates, not a timed root cause.
- Recommended action: measure serialization, SQL transaction, relay, and recovery
  separately in an isolated representative saved workflow before optimizing the
  demonstrated hot path. Preserve checkpoint/intent atomicity and replay safety.
- Test gap: no direct checkpoint-write, GPU-utilization-during-call, or provider
  prompt/decode/load timing breakdown was obtained here. No before/after speedup
  or physical completion claim is made.

## Additional observed wasted work

Two finite Curiosity Researcher calls at approximately 18:04 UTC failed with
`Saved execution does not match the executable graph/schema/node versions`.
This is a confirmed live failure, not yet a diagnosis of why definitions differ.
Compare parent/child definitions and running build identities; do not disable
version validation to make the calls pass. This is separate from inference speed.

Local reproduction helper: `/tmp/metahuman-latency-review-e7X4rU/timings.mts`.
It reads current retained history and emits timings/IDs, not conversation or image
contents. Its fixed time window will become stale; the measurements above record
the inspected window. No generated/private runtime data is added to maintained source.
