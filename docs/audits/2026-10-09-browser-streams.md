# Browser stream ownership audit

Scope: maintained Site persistent SSE subscriptions, their mounting paths and
Core transport owners, following removal of the browser connection pool.
Finite task, editor and Agency streams were checked at their lifecycle boundary;
their domain execution logic was not audited. Robot transport, media streaming,
model token streaming and excluded applications are outside this audit.

Evidence: current source and focused isolated lifecycle reproductions. No live
browser connection census or physical actions were performed. The removal was
built into an isolated output directory; the running Site was not restarted.
The findings below preserve the audit baseline. The owner-authorized repair is
implemented in source:

- Deleted the orphan audit component, dormant window client/registry/routes/badge,
  and Thinking Trace’s incompatible monitor subscription and audit parser.
- Repaired both Queue stream wait lifetimes; events and heartbeats release their
  abort listeners. Proposal delivery now wakes on events with no polling loop.
- Combined selected buffers on one transport; preserved separate projections and
  attribution. Initial snapshots replace redundant initial fetches. Buffer and
  monitor read/watch failures are delivered to their existing displays.
- Replaced Agency/editor chunk parsers with one tested SSE reader that releases
  its reader on completion, error, early exit or abort. Editor transport now uses
  the shared Core router and Astro adapter; its superseded adapter exception and
  direct-handler package export are removed.
- Inspection during implementation found that Agency disconnects implicitly
  cancelled admitted tasks. Removed that behavior and their polling waits;
  Coordinator events now wake observation, and explicit cancellation retains its
  existing owner. Editor disconnect likewise leaves admitted graph work intact.
- Retained active speech, Queue, Trigger Manager, proposals, Agent Monitor,
  terminal, debug, buffer and finite-task functions. The clear-events store remains
  because the maintained LogStream component uses it.

No new connection limits, admission scheduler, fallback execution path or
model-visible instructions were introduced. The server has not been restarted;
source/build proof is distinct from live browser and physical-device proof.

## Inventory and disposition

| Consumer | Endpoint | Lifetime / purpose | Disposition |
| --- | --- | --- | --- |
| ChatInterface | `/api/buffer-stream?mode=...` | Four buffers across three selected views; close on hide/unmount | Keep projections; consider one subscription carrying named buffer updates |
| ChatInterface, profile-sync | `/api/unified-queue/tasks/:id/stream` | Finite admitted task output; terminal/error/dispose cleanup | Keep; repair server listener lifetime |
| QueuePanel | `/api/queue-stream` | Mounted Queue tab; initial snapshot and work changes | Keep; repair server listener lifetime |
| TTSQueueConsumer | `/api/tts-queue-stream` | Application playback owner after audio unlock | Keep distinct playback semantics |
| Trigger Manager store | `/api/trigger-manager/stream` | Reference-counted across mounted consumers | Keep shared owner |
| AgentMonitor | `/api/monitor/stream` | Mounted Agents tab; agent snapshots | Keep |
| useThinkingTrace | `/api/monitor/stream` | Per-request audit trace; incompatible payload | Remove incorrect subscription or reconnect to the actual task-event contract |
| proposals store | `/api/operator-proposals/stream` | Mounted Chat; state used by OperatorProposalCard | Keep feature; remove server polling |
| TerminalController | `/api/terminal/events` | Mounted terminal and selected session | Keep; hiding display must not terminate sessions |
| DebugDashboard | `/api/event-bus-stream` | Live `/debug` page | Keep; not orphaned |
| AuditStreamEnhanced | `/api/monitor/stream` | No maintained mount/import found | Delete candidate |
| window-session client | `/api/window-session/stream` | Startup explicitly commented out in ChatLayout | Dormant feature; review complete owner group for removal |
| AgencyDashboard | Agency plan/run/outcome streams | User-triggered finite operations | Keep; consolidate task observation and reader lifecycle separately |
| FlowEditorLayout | `/api/execute-graph-stream` | Explicit graph execution | Keep; repair transport cancellation boundary |

## Queue streams: `packages/core/src/api/handlers/unified-queue.ts`

- Owner: Core Work Coordinator transport; Site QueuePanel and finite task clients consume it.
- Summary: both `handleQueueStream` and `handleQueueTaskStream` add an abort
  listener every time they wait for the next update. A normal update or heartbeat
  resolves the wait without removing that listener. `once: true` removes it only
  on abort, so listeners accumulate during one live connection.
- Boundary issues: none found in client-to-Coordinator delegation. This is a
  lifecycle defect, not a reason to introduce another coordinator.
- Technical debt: duplicated wait/heartbeat handling. Isolated execution of the
  actual Queue handler with a simulated EventEmitter produced eight abort
  listeners after eight updates; disconnect removed the Coordinator listener.
  This proves listener accumulation, not accumulation of browser connections.
- Security/privacy notes: authenticated snapshots and per-task read checks remain required.
- Test gap: repeated update and heartbeat cycles must retain a constant number of
  listeners; disconnect must release timers and event listeners. Exercise both streams.
- Recommended action: fix each wait's cleanup in this owner. The existing Trigger
  Manager stream already removes its abort listener when its wait settles.

## Monitor consumers: `useThinkingTrace.ts`, `AgentMonitor.svelte`, `monitor-stream.ts`

- Owner: Core Agent Monitor snapshot producer; Site owns display subscriptions.
- Summary: Thinking Trace expects `event`, `category`, and `details.sessionId`
  (or conversation/task identity). The producer emits `connected` and `snapshot`
  records containing agent cards, failures and completions, not those audit events.
  `handleAuditTrace` therefore rejects these records for a normal nonempty session.
- Boundary issues: an unvalidated TypeScript cast hides a producer/consumer contract mismatch.
- Technical debt: during a request with Agents visible, two monitor connections
  independently trigger the same snapshot work and filesystem/bridge subscriptions.
  Chat already receives `reasoning` and progress through its task stream.
- Security/privacy notes: monitor endpoint and trace activation are owner-scoped.
- Test gap: feed the real producer payload to the trace consumer, then verify
  intended trace output from the existing task event contract.
- Recommended action: retain AgentMonitor; eliminate the incorrect trace
  subscription after mapping every needed trace event to its real producer.
  Do not simply share this endpoint with a consumer that cannot use its payload.

## Orphan UI: `apps/site/src/components/AuditStreamEnhanced.svelte`

- Owner: unused Site audit display.
- Summary: no maintained static import, dynamic import, route or mount found.
  `/debug` mounts DebugDashboard instead. Its source also interprets monitor
  snapshots as audit events, using a default `unknown` event name.
- Boundary issues: no active owner relationship remains.
- Technical debt: dead component, incompatible stream assumptions and associated display code.
- Security/privacy notes: no running subscription demonstrated from this component.
- Test gap: deletion reference check plus Site build.
- Recommended action: delete the component and check its solely owned styles/store
  exports before deleting those dependencies. It is not the cause of current live load.

## Dormant window feature: `ChatLayout.svelte`, `lib/client/window-session.ts`, Core window owner/handlers

- Owner: Core window-session registry; Site window client and badge.
- Summary: ChatLayout imports the client but comments out both startup and stop
  because the feature is incomplete. No other maintained startup caller was found.
  It should not be counted as an active stream in the normal current layout.
- Boundary issues: dormant client remains beside registered public Core exports
  and HTTP routes; no evidence establishes that external clients never use them.
- Technical debt: `broadcastWindowUpdate` has no callers, yet the server retains
  its connection registry. File-watcher updates are drained by a one-second loop.
  Client focus/blur/visibility listeners are anonymous and not removed by stop;
  an in-flight registration can connect after stop if this feature is re-enabled.
- Security/privacy notes: authenticated window lists must retain user filtering.
- Test gap: delayed registration resolved after stop, repeated start/stop, and
  actual window consumers across supported interfaces.
- Recommended action: retire the dormant client and unused broadcast machinery
  as a coherent feature decision; establish external API usage before route/export removal.

## Proposals: `stores/proposals.ts`, `OperatorProposalCard.svelte`, `operator-proposals.ts`

- Owner: Core proposal state/events; Site shared store and active proposal cards.
- Summary: this is not orphaned. The handler subscribes to proposal events but
  checks its outgoing queue every 250 ms instead of waking on those same events.
- Boundary issues: none found in profile filtering or state ownership.
- Technical debt: unnecessary server timer wakeups while idle and up to one
  polling interval of additional event latency. Pool removal already replaced
  client reconnect timers with native SSE reconnect and registered named listeners
  once per source; a test proves reopen does not duplicate proposal-created delivery.
- Security/privacy notes: authentication and username-filtered proposal events are present.
- Test gap: server event-to-client delivery without polling, abort cleanup and
  initial state delivery alongside a concurrently created proposal.
- Recommended action: wake the existing stream on proposal events; keep the store
  and card integration. Do not replace model proposal choices.

## Buffers, speech, triggers and terminal

- Owner: existing Core buffer, TTS delivery, Trigger Manager and terminal owners;
  components/stores own browser connection lifetimes.
- Summary: all have real callers. Buffer watchers are event-driven; speech uses
  file notifications, delivery deadlines and heartbeat timers; Trigger Manager
  uses events plus a 15-second reconciliation; terminal observes existing sessions.
- Boundary issues: no need for a browser admission scheduler. Native SSE does not
  mean the server creates a separate operating-system process per connection.
- Technical debt: four buffer subscriptions each maintain a watcher and send full
  selected-buffer snapshots. Sharing their transport could reduce overhead without
  merging buffer persistence or changing source/speaker attribution. Snapshot/read
  failures in buffer and monitor handlers currently log server-side without a
  corresponding stream error; a connection may appear open with stale data.
- Security/privacy notes: buffer access is authenticated/profile-scoped; terminal
  and Trigger Manager remain owner-scoped; TTS delivery ownership is not a browser cap.
- Test gap: real-browser navigation/reconnection and server watcher cleanup. The
  removal's isolated tests cover immediate Queue allocation with twelve existing
  streams, repeated mount/dispose, buffer replacement, and preserving speech/Queue.
- Recommended action: retain these capabilities. If consolidating buffer transport,
  preserve named projections and eliminate the superseded subscription path together.

## Debug and finite stream boundaries

- Owner: DebugDashboard/event-bus transport, finite Coordinator tasks, Agency
  adapters and the explicit graph-editor execution entrypoint.
- Summary: `/debug`, profile sync, Agency and graph-editor consumers exist; these
  endpoints are not deletion candidates merely because they are outside normal Chat.
  Profile sync explicitly closes its task subscription on terminal/error/abort.
  Agency outcome EventSource closes through its existing unmount cleanup.
- Boundary issues: `pages/api/execute-graph-stream.ts` has a separate
  `ReadableStream.start` adapter with no cancel handler or request signal passed
  through its callback contract. The shared Astro adapter does propagate disconnect.
- Technical debt: finite POST readers in Agency/editor use separate manual SSE
  parsers. Agency resets event/data framing variables inside each reader chunk,
  so an event/data pair split across chunks can lose the event name. Fetch readers
  lack a clear component-disposal abort path. These are separate from the deleted pool.
- Security/privacy notes: retain authentication, work identity, and explicit
  execution authority when consolidating; aborting observation must not silently
  cancel admitted physical work.
- Test gap: split SSE frames across arbitrary byte chunks; unmount mid-response;
  prove reader release and continued durable task ownership separately.
- Recommended action: repair these finite transport boundaries in their owners
  after the persistent subscription cleanup, without a new execution path.

## Suggested repair sequence and validation record

1. Repair Queue abort-listener lifetime and remove the incompatible Thinking Trace subscription.
2. Delete the orphan audit component; resolve the dormant window feature's complete scope.
3. Replace proposal server polling with event wakeup and report buffer/monitor read failures.
4. Consolidate useful duplicate subscriptions only where their payload contracts match.
5. Repair finite parser/cancellation boundaries with chunk-split and disposal tests.

Pool removal validation: 12 focused lifecycle/terminal/conversation tests passed;
Trigger Manager UI ownership check passed; three focused TTS client suites passed;
Site typecheck passed with zero diagnostics; isolated production build passed.
The broad TTS ownership script fails because Environment Mode has zero standard
TTS Output nodes where its assertion requires one. The same failure was reproduced
using the pre-removal test and pre-removal affected sources. No graph or assertion
was changed to conceal that unrelated mismatch.

No prompts, model settings, physical robot actions, or model-service lifecycle were
changed. Browser transport capacity and live UI behavior remain unverified by the
isolated EventSource tests; removal of the application cap is not proof of unlimited
network capacity. No additional limits or automatic blocking mechanisms are proposed.

## Repair verification

- `pnpm validate:streams`: 38 tests passed, including the original graph-outcome
  tests, Queue listener stability over 40 updates and a heartbeat, profile-scoped
  proposal wakeup, mode-attributed buffer snapshots and read failure recovery,
  monitor errors, every-byte SSE splits, reader cancellation, terminal ownership,
  and all three Agency disconnects leaving Coordinator tasks admitted.
- `pnpm typecheck:core` and `pnpm typecheck:site`: passed; Site had zero diagnostics.
- `pnpm check:architecture`: zero violations after removing the obsolete custom
  graph-stream adapter exception.
- Isolated production Site build passed. Task-scoped whitespace checks passed.
- Reference searches found no executable window-session or orphan audit-component
  callers. Active LogStream still uses the clear-events store, so it was preserved.
- No live deployment or browser session was changed during this repair. The prior
  unrelated TTS graph assertion failure remains outside this stream repair.
