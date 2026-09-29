# Distributed robot foundation: owner and contract review

Date: 2026-09-28. MetaHuman source: `8f9ee64558a9d67854fbaae62d796151f871b98d`.
Ainekio source: `270537fa56c8d77efd72ff694f4294d15381de52`.

Scope: focused source review for the owner's wireless robot architecture. This
is not a fresh exhaustive audit or a claim of deployed distributed behavior.
No MetaHuman production code, profile, credentials, service or model was changed.

The living cross-repository design is
[Distributed Robot Foundation](https://github.com/Greg-Aster/Ainekio-bot/blob/main/docs/DISTRIBUTED_ROBOT_FOUNDATION.md),
linked from [Body Control Integration](https://github.com/Greg-Aster/Ainekio-bot/blob/main/docs/BODY_CONTROL_INTEGRATION.md).
Existing [resource findings](2026-09-28-robot-resource-budget.md) retain their
original source and measurement identities.

## Owner requirements

- P4 remains the robot brain and accepts the same control contract from
  authorized Q6A, remote MetaHuman or standalone manual Body Control sources.
- Q6A owns nearby speech/perception/lightweight work in normal operation;
  remote MetaHuman owns heavy reasoning, memory, training and expensive tools.
- Either host must be usable without the other; manual control must remain
  possible through an independently available device. That device is undecided.
- Remote outages pause remote-dependent tasks while defined Q6A skills continue.
- Define shared status, routing, queue and takeover contracts before feature coding.

## Robot Status and diagnostics

Owner: [robot-status.ts](../../packages/core/src/robot-status.ts), especially
`RobotStatusSnapshot`, `loadRobotStatus` and `buildRobotStatusProjection`;
[status output](../../packages/core/src/nodes/robot-status/out.node.ts).

Source behavior: profile-scoped version-1 status includes body state/telemetry,
capabilities, source timestamps, last action, task, Agency summary, situation and
eight bounded history entries. Loading projects task state from the durable
execution store. Situation text is separate from body/source facts.

Boundary: this is a readable projection, not a scheduler or authoritative
execution database. A shared status/router/queue product must preserve that
separation. Do not reconstruct objectives from status or make LLM summaries
control heartbeat, emergency stop or source election.

Action: extend existing projections with typed provider readiness, source/grant,
job correlation and freshness. Publish owner-specific facts through a shared
versioned contract; use snapshot/resynchronization and reject obsolete source
generations. ROS diagnostics can consume/publish health facts but do not replace
the task/situation model. Test stale data, sequence gaps, restart and conflicting
source claims before treating the view as distributed current state.

## Work routing, queues and physical effects

Owners: [queue-system.ts](../../packages/core/src/queue/queue-system.ts),
[work-submission.ts](../../packages/core/src/queue/work-submission.ts),
[remote-dispatcher.ts](../../packages/core/src/queue/remote-dispatcher.ts),
[model-router.ts](../../packages/core/src/model-router.ts),
[model-resolver.ts](../../packages/core/src/model-resolver.ts), durable execution,
Agent Catalog and Robot Operator as specified in
[MAINTAINED_SURFACE](../technical/MAINTAINED_SURFACE.md).

Source behavior: Work Coordinator already owns finite admission, resource lanes,
execution/recovery and body leases within an installation. Its remote dispatcher
handles provider work; it is not evidence of full MetaHuman-to-MetaHuman task
handoff or host election. Model selection already has a canonical router/resolver.

Action: extend those contracts for explicit remote child jobs and capability
availability. Keep one owner per admitted job and one active body grant. A
MetaHuman execution's local lease must be subordinate to the proposed P4 control
grant; two installations' local generation counters cannot decide robot-wide
ownership. Preserve immutable action identity and uncertain-outcome handling.

Test gaps: dual provider attempts, host loss/return, cancelled and late remote
results, source takeover during an action, and bounded work admission under
degraded capacity. Manual Ainekio control must remain usable without MetaHuman.

## Environment Bridge and Ainekio gateway

Owner: [Environment Bridge](../../brain/agents/environment-bridge/core.ts) and
the shared Ainekio gateway/adapter/body admission owners.

Source behavior: the Bridge is a singleton external transport within its
installation. Ainekio's gateway supplies manual dashboard and Environment
adapter through one service. The Environment endpoint is loopback-only and
replaces its prior bridge socket on new authenticated connection. P4's link
task uses a single configured URL and retries that host. This is not automatic
Q6A/remote/manual priority arbitration.

Action: extend the existing P4 connection/shared admission owner for source
grants and permitted endpoint selection. Reuse the gateway implementation on
available hosts; do not create a second command stack. A gateway hosted solely
on Q6A, or a remote relay pointing back to Q6A, cannot survive Q6A host loss.
Hardware/network acceptance must include an independent surviving route.

## Deployment and remote access

Owners: [deployment.ts](../../packages/core/src/deployment.ts),
[llm-backend.ts](../../packages/core/src/llm-backend.ts),
[provider bridge](../../packages/core/src/providers/bridge.ts),
[remote-server handler](../../packages/core/src/api/handlers/remote-server.ts),
and [deployment guide](../user-guide/configuration-admin/deployment.md).

Source behavior: local/server deployment modes configure storage and inference.
`callRemoteServerProvider` posts model messages to `/api/llm/chat` using the saved
remote session. It does not establish distributed tool/job/memory ownership.
The handler supplies remote health/model discovery and session connection.

Concrete gap: `callRemoteServerProvider` logs the complete `remoteConfig`, which
can contain session credentials. Remove that log through its canonical owner
before activating this path with deployment credentials; verify logs retain only
safe metadata. This review did not invoke the path or inspect live credentials.

Action: one maintained codebase with explicit role/capability configuration;
reuse existing lifecycle and configuration owners. Define machine identity,
authorization, request/result/cancellation and compatibility before enabling
cross-installation work. Profile sync does not own software updates.

## Memory and identity

Owners: [profile-sync.ts](../../packages/core/src/profile-sync.ts),
[profile-sync handlers](../../packages/core/src/api/handlers/profile-sync.ts),
[memory sync handlers](../../packages/core/src/api/handlers/memory-sync.ts), and
canonical memory/storage owners.

Source behavior: profile bundle export/import and memory listing/sync APIs
already exist. Bundle limits include 256 files, 2 MiB/file and 20 MiB/bundle.
Presence of these APIs does not establish continuous conflict-safe replication,
cross-host execution recovery or authoritative persona/memory selection.

Proposed policy: remote long-term authority with bounded local working context,
selected cache and durable pending observations. Trace and consolidate through
existing memory/storage paths before extending sync; do not introduce a new
parallel memory database. Define duplicate/conflicting IDs, deletion, revisions,
retention, offline capacity and authenticated logical-persona mapping. Test these
with sanitized fixtures, not personal profile data.

## Speech, perception, training and lifecycle

Retain canonical STT/WhisperService, KokoroService, voice-service-manager,
robot-speech/delivery, training and catalog/work owners. Q6A speech/perception and
remote heavy work is a target allocation, not proof all services are installed or
meet response targets. The earlier Kokoro measurement remains a known latency
constraint. No selected/deployed YOLO pipeline was established in that audit.

Inventory each moved agent's inputs, state and admission owner. A service must
not be supervised independently by both ROS lifecycle and an existing MetaHuman
manager. Admit body autonomy only through the active controller's existing
Robot Operator/Coordinator and the P4 grant.

## ROS assessment and validation boundary

Primary ROS sources and comparison are recorded in the foundation. Diagnostics
provides standardized component health, aggregation and monitoring; lifecycle
manages participating ROS nodes; twist_mux selects velocity inputs; controller
manager manages controller/hardware lifecycles. These do not supply the full
requested cross-host control election, durable work or shared application state.

Recommendation: evolve existing status/routing/work owners and Ainekio control;
add ROS adapters for selected benefits. This is a proposal, not a new production
owner or infrastructure dependency. Define the schemas and acceptance cases
first. Validation for this change is source/document reconciliation, link and
diff checks, plus the repository architecture check. No live distributed,
external-server, ROS graph or physical behavior was tested by this review.
