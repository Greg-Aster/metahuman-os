# Autonomous Work

MetaHuman OS uses one work coordinator for user requests, scheduled agents,
memory indexing, Active Operator policy, and Ainekio environment work. The
coordinator is owned by `packages/core/src/queue` and is visible in the Queue
panel.

Agents do not own a second task queue. `TriggerManager` may admit configured
work, and registered handlers execute work only after the coordinator has
claimed it.

## Autonomy modes

- **Reactive** accepts user, system, approval, and environment events. Timed and
  inactivity-based producers are paused.
- **Semi-autonomous** also enables the configured interval, time-of-day, and
  inactivity producers in `etc/agents.json`.
- **Fully autonomous** adds a bounded Operator Policy Graph. It may select an
  eligible queued task, wait, request input, or propose one allow-listed
  low-priority task. It cannot execute work directly or change coordinator
  priority rules.

Changing mode does not stop the coordinator. Interactive and safety work remain
available in every mode.

## Scheduled work

`etc/agents.json` defines producer timing and handler identity. Scheduled work
uses explicit work IDs and idempotency keys, then competes under the same global
priority rules as manually submitted work.

Examples include:

- `reflector`, `curiosity` (implemented by `curiosity-service`), and
  `inner-curiosity` after configured
  inactivity;
- `dreamer`, `curator`, and other registered agents;
- `mood`, which reviews recent user conversation and/or inner dialogue every
  configured number of persisted user messages;
- `sleep-workflow`, which admits bounded dream and persona-review child work.

The sleep workflow does not silently start audio processing or model training.
Those remain explicit owner-triggered controls.

## Mood persona routing

Mood is registered in the Agent Catalog and admitted by TriggerManager. It is
not an always-running process and is disabled by default. After an owner enables
it, the default trigger queues one review after each ten persisted user messages.
The editable **Mood Persona Review** graph uses a
psychoanalyzer classifier on the established `psychotherapist` model role to
choose among the logged-in user's enabled persona facets. Buffer content is
treated as evidence, not as graph instructions, and a minimum-confidence guard
prevents weak classifications from changing facets.

Use **System → Agent Catalog → Mood** to select conversation, inner dialogue, or
both; choose the baseline facet; set context and confidence limits; and control
whether Mood may override a disabled persona system. Use **System → Trigger
Manager → Mood** to change the message-count threshold or idle cooldown. The
idle cooldown queues the same graph with a forced baseline decision, so a robot
left unused does not remain stuck in a transient mood. Disabling Mood prevents
future admissions without changing the current facet.

## Active Operator

Active Operator is a mode and policy service above the coordinator. It owns no
queue, retry loop, process scheduler, or task executor. Full mode is
event-driven and bounded by cooldown, user-presence, consecutive-work, and
hourly evaluation limits.

## Monitoring and controls

Use the right-side **Queue** panel to inspect:

- coordinator lifecycle and autonomy mode;
- globally ordered queued, waiting, and leased work;
- handler, resource, priority, attempts, and waiting reason;
- cancellation, expiry, failure, and terminal history.

Deleting or clearing queued work requests coordinator cancellation. Running
work remains visible until its executor acknowledges cancellation.

Use **System → Trigger Manager** to change producer configuration. Disabling a
producer prevents new admissions; it does not create another scheduler or
erase running work.

Use **Dashboard → Agent Catalog** to see every maintained agent, including
installed agents that are not scheduled, workflow children, source aliases,
missing implementations, and persistent services. Use **System → Agent Catalog**
to register or unregister finite agents. Unregistering removes the Trigger
Manager entry while preserving source code, logs, run history, and queued work.
Privileged and destructive agents require explicit registration confirmation.

## Operational boundary

The following remain separate because they do not order executable MetaHuman
work: approval state, SSE and WebSocket buffers, TTS playback queues, graph
traversal structures, and robot firmware buffers. Ainekio's hardware emergency
stop remains body-owned.

For the implementation contract and validation evidence, see
`docs/implementation-plans/operator-queue-work-coordinator.md`.
