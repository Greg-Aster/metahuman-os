# Buffer Pipeline Overhaul

Date opened: 2026-07-19
Status: Complete
Scope owner: MetaHuman conversation, inner-dialogue, system, and robot buffer admission, persistence, streaming, and chat presentation

> This document is the working paper trail for the overhaul. Preserve earlier findings and append corrections or progress entries rather than rewriting history. Every migrated producer and every deleted compatibility path must be recorded before this work is considered complete.

## Goal

Replace the current mixed chat-store behavior with four canonical per-profile buffers presented through three strict tabs:

1. **Conversation Buffer** — spoken user/persona conversation.
2. **Inner Dialogue Buffer** — unvoiced user thoughts plus generated reflections, dreams, daydreams, and reasoning.
3. **System Buffer** — durable system, service, agent-execution, warning, failure, and lifecycle events.
4. **Robot Buffer** — structured outbound robot-bridge activity and delivery state.

The interface presents those files as:

- **Conversation** reads only Conversation Buffer.
- **Inner Dialogue** reads only Inner Dialogue Buffer.
- **System** chronologically merges only System Buffer and Robot Buffer and displays a visible source badge.

Tab selection controls which streams are visible. A separate, explicit compose target controls where submitted text is admitted:

- **Conversation compose** treats input as spoken conversation and writes through the Conversation Buffer node.
- **Inner compose** treats input as an unvoiced thought and writes through the Inner Dialogue Buffer node.
- System and Robot are read-only output streams and can never become compose targets.

`TerminalManager` is not a buffer. It moves behind its own Terminal control and is no longer coupled to selection of the System tab.

## Non-negotiable architecture contract

```text
producer
  -> designated graph input
  -> designated buffer node
  -> canonical core buffer service
  -> one per-profile JSON file
  -> buffer notification
  -> buffer SSE stream
  -> strict tab projection
```

- Every durable buffer write is admitted by exactly one designated graph node.
- API handlers, UI callbacks, agents, services, and other nodes may submit typed graph input; they may not append buffer files directly.
- The four graph nodes share one canonical storage owner. They are not four storage implementations.
- The interface never treats its transient Svelte store or IndexedDB cache as authoritative when the server profile is available.
- A buffer reader returns the selected buffer only. Cross-buffer context is an explicit context-node decision, not a UI merge side effect.
- Unified Consciousness may inject bounded Inner Dialogue into model context, but it does not change file ownership or tab membership.
- Existing history is preserved in place. No fifth compatibility buffer or duplicate migration file is introduced.
- Legacy helpers and direct-writer paths are deleted after their callers migrate and focused reference checks confirm they are orphaned.

## Canonical files

All files remain under the active profile's resolved `state` directory:

| Mode | Canonical file | UI projection |
| --- | --- | --- |
| `conversation` | `conversation-buffer-conversation.json` | Conversation tab |
| `inner` | `conversation-buffer-inner.json` | Inner Dialogue tab |
| `system` | `conversation-buffer-system.json` | System tab, source `system` |
| `robot` | `conversation-buffer-robot.json` | System tab, source `robot` |

The existing System Buffer file is retained and made explicit through a System Buffer node. Creating another system file would duplicate the existing data owner.

## Input semantics

### Conversation compose

- The user input is a voiced `user` conversation message.
- The generated reply is an `assistant` conversation message.
- Both entries are admitted through the Conversation Buffer node.
- Conversation history and memory capture consume the same correlated turn without writing a second copy.

### Inner Dialogue compose

- The user input is an unvoiced `thought`, visibly attributed to the user.
- The generated continuation is inner dialogue, not a spoken assistant reply.
- Both entries are admitted through the Inner Dialogue Buffer node.
- The turn is eligible for memory generation and bounded future context according to the graph's memory/context policy.
- Selecting several tabs never guesses the write target. The compose target remains explicit and visible.

## System-event admission

Backend systems that are not already inside a cognitive graph submit a typed System Event work item to one small system-event workflow. That workflow owns the System Buffer node. Meaningful warnings, failures, lifecycle transitions, and execution progress are durable. Short-lived browser interaction states such as microphone button animation remain transient UI state and do not masquerade as persisted system history.

## Initial maintained-source audit

### Shared storage owner

- `packages/core/src/conversation-buffer.ts` already owns per-profile paths, locks, timestamps, pruning, notification touches, corruption recovery, and event emission.
- This owner should be narrowed into a typed four-mode persistence service; it should not retain producer-specific convenience writers once designated nodes own admission.
- Current pruning uses `maxHistoryMessages` for Conversation, Inner, and System. Only Robot has a dedicated limit in the active worktree.

### Current Conversation paths

- `persona-chat.ts` performs an early direct `appendToUserBuffer(..., 'conversation')` before graph execution.
- `buffer_manager` is present in maintained conversational graphs and appends user and assistant entries through the canonical service.
- The early write plus graph write relies on duplicate detection rather than one admission owner.
- `dual_writer`, `curiosity_question_saver`, and agency helpers also write Conversation directly from node/service code.
- A generic authenticated `/api/conversation-buffer` append route can select a mode and write without a designated buffer graph node.

### Current Inner Dialogue paths

- `inner_dialogue_capture` correctly exists as a graph node, but it directly invokes role-specific convenience writers after separately saving episodic memory.
- `reasoning_capture` and dreamer nodes also invoke Inner Buffer convenience writers directly.
- Several maintained agents and agency services invoke `appendReflectionToBuffer` outside a designated buffer workflow.
- When the UI submits with `mode=inner`, `buffer_manager` saves `user` and `assistant` roles to the Inner Buffer, while the Inner renderer hides those roles. This is the confirmed hidden-message bug.
- `innerDialogHistoryLimit` and `innerDialogHistoryDays` are exposed and saved but currently have no runtime consumer.

### Current System paths

- `conversation-buffer-system.json` and canonical helper support already exist.
- There is no System Buffer graph node.
- Desire Executor writes execution progress by directly calling `appendExecutionProgressToBuffer` from inside its executor. Several nearby comments still incorrectly call this the Inner Dialogue buffer.
- `appendSystemMessageToBuffer` exists but has no maintained call sites in the first reference scan.
- Numerous chat-interface errors and microphone/TTS notices use browser-only `messagesApi.pushMessage('system', ...)`; they are neither durable System Buffer records nor node-admitted events.

### Current Robot paths

- The active worktree adds a Robot Buffer mode, Robot Buffer node, dedicated retention setting, structured Environment Bridge output, and one Environment Mode edge.
- This is the correct storage/node boundary and remains the foundation for the four-buffer overhaul.
- The Robot Buffer currently skips `no_actions` turns by default and records structured queued, rejected, disabled, partial, and waiting bridge results.

### Current UI/read paths

- `ChatInterface.svelte` fetches selected modes from `/api/buffer`, falls back to IndexedDB, flattens all results into one store, and then filters by message role.
- Conversation, Inner, and System are multi-select views, but compose mode is inferred from the visible combination: only Inner-only selection sends `mode=inner`; every other combination sends Conversation.
- The common store loses authoritative buffer provenance. Role-based filtering cannot guarantee strict tab ownership.
- Conversation SSE updates are intentionally ignored while Inner and System SSE updates append into the common store. Conversation relies on request-stream callbacks for live insertion.
- Selecting System also mounts `TerminalManager`, which owns ttyd/Big Brother/Event Bus UI and is unrelated to buffer persistence.

## Target owner map

| Concern | Owner |
| --- | --- |
| Mode types, schemas, locks, file IO, pruning, notification | canonical core buffer service |
| Conversation admission and role validation | Conversation Buffer node |
| Inner admission, unvoiced-thought semantics, role validation | Inner Dialogue Buffer node |
| System-event admission and role/severity validation | System Buffer node + system-event workflow |
| Robot bridge-record admission | Robot Buffer node |
| Long-term memory capture | explicit memory nodes downstream of the same correlated turn |
| Initial reads and live updates | thin buffer API handlers over canonical service |
| Tab projection and compose-target selection | `apps/site` interface shell |
| Live terminals | independent Terminal control and `TerminalManager` |

## Refactor phases

### Phase 1 — Contracts and audit

- [x] Record product decisions and non-negotiable target architecture.
- [x] Confirm the existing System file must be reused rather than duplicated.
- [x] Complete the maintained producer/reader/settings/route inventory.
- [x] Add architecture tests for direct writer imports and strict graph-node ownership.

### Phase 2 — Canonical service and designated nodes

- [x] Define typed message contracts for Conversation, Inner, System, and Robot.
- [x] Give each mode an independent retention setting with compatibility migration.
- [x] Add/refactor the Conversation Buffer node.
- [x] Add/refactor the Inner Dialogue Buffer node.
- [x] Add the System Buffer node and system-event workflow.
- [x] Add the Robot Buffer node and structured Environment Bridge record.
- [x] Make read/stream handlers delegate to the canonical service rather than rebuild paths and filtering.

### Phase 3 — Producer migration and deletion

- [x] Remove the pre-graph Conversation early-write path.
- [x] Migrate conversational graphs to the Conversation Buffer node.
- [x] Migrate inner graphs, agents, reasoning, dreams, and user-authored thoughts to the Inner Dialogue Buffer node.
- [x] Migrate desire execution and other backend events through the system-event workflow.
- [x] Keep Environment Bridge records exclusively behind the Robot Buffer node.
- [x] Remove generic/direct append APIs or narrow them to graph-work submission.
- [x] Delete orphan convenience writers, stale comments, unused settings, duplicate filtering, and legacy IndexedDB authority paths.

### Phase 4 — Interface overhaul

- [x] Preserve independent per-buffer client state and provenance.
- [x] Make selected tabs affect reads only.
- [x] Add explicit Conversation/Inner compose target with clear voiced/unvoiced labeling.
- [x] Render Conversation from Conversation only.
- [x] Render Inner Dialogue from Inner only, including user-authored unvoiced thoughts.
- [x] Render System as a chronological System+Robot merge with source badges.
- [x] Move TerminalManager behind a separate Terminal control.
- [x] Replace browser-only feed messages with transient status UI or typed System Event submission as appropriate.

### Phase 5 — Validation and completion audit

- [x] Add four-mode persistence, pruning, recovery, and notification tests.
- [x] Add graph validation and no-direct-writer architecture tests.
- [x] Add multi-select read versus explicit-compose-target UI tests.
- [x] Add System+Robot chronological merge/source-badge tests.
- [x] Validate all cognitive graphs and focused buffer/Environment tests.
- [x] Build the production site and run the architecture guardrail.
- [x] Perform a final reference scan proving removed bypasses and settings have no maintained callers.
- [x] Record remaining unrelated baseline failures without widening scope.

## Activity log

### 2026-07-19 — Goal and product contract

- Created an active persistent goal for the complete four-buffer/three-tab overhaul.
- Confirmed System combines System and Robot records but no longer owns the Terminal panel.
- Confirmed Inner Dialogue remains interactive: submitted Inner text is an unvoiced thought used for memory generation and future conversational context.
- Confirmed multi-select tabs control reads only; the compose target must be explicit.
- Confirmed every durable write, including non-graph backend system output, must pass through its designated graph node.
- Confirmed the existing canonical storage service and System file will be corrected and reused rather than duplicated.

### 2026-07-19 — Initial source audit

- Traced the current shared service, graph nodes, API handlers, chat store, SSE streams, and TerminalManager coupling.
- Confirmed the active Robot Buffer worktree is compatible with the target and should be consolidated rather than reverted.
- Identified direct writers in persona chat, response pipeline, curiosity, agency/desire execution, dream/reasoning paths, and maintained agents.
- Identified two settings with no runtime consumer: `innerDialogHistoryLimit` and `innerDialogHistoryDays`.
- Identified the hidden Inner message bug caused by saving `user`/`assistant` roles and rendering only inner roles.
- No runtime profile files were read or modified during this audit.

### 2026-07-19 — Canonical service and settings

- Established `conversation`, `inner`, `system`, and `robot` as the canonical `CanonicalBufferMode` union while retaining the existing shared storage owner and four established filenames.
- Added independent Conversation, Inner, System, and Robot retention controls to the global template, new-profile template, presets, and Settings UI.
- Centralized legacy `maxHistoryMessages` and `innerDialogHistoryLimit` compatibility hydration in `chat-settings.ts`; consumers no longer parse those keys independently.
- Consolidated reads, clears, corruption recovery, locking, pruning, and notifications behind the canonical buffer service. Removed the duplicate request-context loader and direct path construction in `DisplayBuffer`.
- Restricted the public `@metahuman/core` surface: producer APIs expose graph admission helpers, not `writeBufferEntry`, `writeConversationBufferSummary`, or the generic mode-selecting admission primitive.

### 2026-07-19 — Designated graph admission

- Added Conversation Buffer, Inner Dialogue Buffer, System Buffer, and Robot Buffer nodes. These are the only maintained callers of the low-level entry-write primitive.
- Added one-node admission workflows for Conversation, Inner, System Event, and Robot records so services and agents outside a larger graph still enter through the designated node boundary.
- Migrated maintained conversational, curiosity, daydreamer, dreamer, reflector, train-of-thought, desire-executor, outcome-reviewer, and response-pipeline graphs to the designated nodes.
- Replaced Response Pipeline's `dual_writer` with a response-context writer plus a downstream Conversation Buffer node.
- Preserved dream/daydream memory ownership in the existing saver nodes and disabled duplicate memory capture in their downstream display-buffer admission nodes. Reasoning display nodes likewise no longer create unintended duplicate memory records.

### 2026-07-19 — Producer migration and deletions

- Persona Chat now pre-admits both spoken user input and unvoiced user thoughts through graph workflows before generation. Conversation graphs skip the already-admitted user entry; generated conversation replies remain graph-owned.
- Inner compose now stores a user `thought`, stores the generated continuation as a `reflection`, and captures the correlated unvoiced thought/continuation for long-term memory through the Inner Dialogue Buffer node.
- Migrated desire exploration/planning/generation, inner curiosity, desire check-ins, agency handlers, Big Brother, dream continuations, execution progress, and summarization to graph-admission helpers.
- Narrowed generic Robot Buffer POST admission: outbound Robot records are accepted only from the Environment Bridge graph.
- Deleted `buffer-manager.node.ts`, `inner-dialogue-capture.node.ts`, `reasoning-capture.node.ts`, and `dual-writer.node.ts`, along with all producer-specific direct append helpers and stale duplicate-detection behavior.

### 2026-07-19 — Interface and stream overhaul

- Added an explicit compose target independent of selected read tabs. Conversation is labeled voiced; Inner is labeled an unvoiced thought. A target is captured per request so changing the control during generation cannot redirect the eventual response.
- Attached immutable buffer provenance to fetched and streamed records. Conversation and Inner project only their own sources; System projects only System and Robot and sorts the merged feed chronologically.
- Added persistent `SYSTEM` and `ROBOT` source badges. Canonical System/Robot records always use the source-badged card even when producer metadata would otherwise select another card type.
- Moved `TerminalManager` behind a separate Terminal control. Selecting System now opens only the merged buffer feed.
- Replaced browser-only `system` feed insertions with a transient status banner; durable backend events use the System Event workflow.
- Removed the browser-owned IndexedDB conversation-buffer store and its fallback/write APIs. Offline inference can remain visible transiently but cannot claim durable history without server-side graph admission.
- Clear now targets only the explicit Conversation/Inner compose target; tab selection cannot choose a mutation target.

### 2026-07-19 — Tests and guardrails

- Added `buffer-ownership.spec.ts` to prove the low-level primitive has exactly four designated node callers, retired writers/node types are absent, admission workflows remain one-node owners, legacy settings are absent from the maintained template, and storage primitives are not publicly exported.
- Added `conversation-buffer.spec.ts` with an isolated `/tmp` profile to cover legacy setting hydration, four independent pruning limits, notifications, summary markers, corruption backup/recovery, and clear behavior.
- Added `buffer-feed.spec.ts` to cover strict Conversation/Inner projection, multi-select read composition, authoritative slice replacement, and chronological System+Robot merging.
- Updated the focused Environment test for Conversation Buffer and Robot Buffer ownership.
- No runtime profile or persona files were modified by implementation or tests.

### 2026-07-21 — Robot action lifecycle admission

- Audited the Ainekio adapter's action path and confirmed it sends one terminal `environment.feedback` result only after the controller reports `ack`, `done`, cancellation, or rejection.
- Correlated each result with the original coordinator work item and its owning profile. Completion persistence does not depend on the currently active user and does not introduce a hardcoded profile.
- Routed inbound action feedback through the existing one-node Robot Buffer admission workflow. Robot Buffer now contains both outbound command/plan records and inbound accepted/completed/failed/rejected/cancelled/expired lifecycle records; no additional motion buffer was added.
- Stored the original action and returned feedback together under the Robot record so catalog commands and complete freestyle motion-plan frames remain inspectable beside their outcome.
- Added canonical idempotency-key handling so an adapter retry with the same feedback ID succeeds without duplicating the Robot Buffer entry.
- Made Robot Buffer admission failure visible to the adapter as an HTTP 500 instead of silently reporting successful persistence.

## Validation log

- `pnpm validate:graphs`: passed 25/25 cognitive graphs.
- `pnpm -s check:architecture`: passed with zero current violations.
- `pnpm exec tsx packages/core/src/buffer-ownership.spec.ts`: passed.
- `pnpm exec tsx packages/core/src/conversation-buffer.spec.ts`: passed using only an isolated temporary profile.
- `pnpm exec tsx packages/core/src/environment-conversation-memory.spec.ts`: passed.
- `pnpm exec tsx apps/site/src/lib/client/buffer-feed.spec.ts`: passed.
- `pnpm --dir apps/site build`: passed. Existing repository-wide Svelte accessibility, dependency-age, circular-chunk, and malformed unrelated CSS warnings remain.
- `./bin/audit check`: passed the architecture guardrail with zero violations and completed the tracked-file/package-manifest checks.
- Core `tsc --noEmit`: the new buffer service/nodes and Persona Chat changes are clean; the command remains red on pre-existing errors in agent graph typing, cognitive layers, connectors, encryption, legacy CLI adapters, several older nodes, and duplicate barrel exports.
- Site-wide raw `tsc --noEmit`: the changed feed/UI surface is clean; the command remains red on pre-existing Astro declaration conflicts, optional dependency declarations, card constructor typing, and two existing IndexedDB boolean-index schema errors.
- Final maintained-source scans found no retired direct writer call, retired graph node type, public storage-primitive export, duplicate canonical buffer path constructor, or runtime profile/persona/memory change. Legacy setting names remain only in the centralized compatibility hydrator.
- 2026-07-21 Robot lifecycle follow-up: Environment bridge compatibility, isolated four-buffer persistence/admission, Environment graph ownership, and buffer ownership tests passed.
- 2026-07-21 Robot lifecycle follow-up: all 25 cognitive graphs validated and the architecture guardrail reported zero violations.
- 2026-07-21 Robot lifecycle follow-up: the production Astro server bundle rebuilt successfully, making the handler change available to `start.sh`; existing accessibility, dependency-age, circular-chunk, and malformed unrelated CSS warnings remain.
- 2026-07-21 Robot lifecycle follow-up: Core `tsc --noEmit` reported only the previously documented unrelated baseline errors; none referenced the Robot Buffer, bridge handler, coordinator result, or admission changes.
