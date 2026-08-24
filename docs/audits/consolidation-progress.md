# Consolidation Progress

This document is the chronological evidence ledger for the MetaHuman cleanup and
refactor. The canonical program, principles, scope, and completion criteria live
in `docs/technical/REFACTOR_BLUEPRINT.md`.

## Active System-Wide Refactor Goal - 2026-08-24

The Installation Owner opened a repository-wide refactor under the Engineering
Principles in the System Refactor Blueprint. The goal covers the complete
maintained source surface and proceeds owner by owner through audit, scoped
implementation, cleanup, and validation.

Starting evidence:

- `HEAD` and `origin/main` both resolve to
  `c081c1218f1db4d1912f81b7e53d11e36167a6ca`.
- Maintained-source inventory dry run: 2,035 maintained files, including 1,531
  code files.
- `pnpm -s check:architecture`: pass with zero current architecture violations.
- `git diff --check`: pass.
- The starting worktree contains 128 tracked changed paths and nine untracked
  paths. Existing work must be attributed and preserved before overlapping edits.

Current phase:

1. Canonical refactor principles and repository-wide execution order: complete.
2. Starting architecture and maintained-source baseline: complete.
3. Attribute the existing dirty worktree by owner and validation state: active.
4. Site validation and client cleanup slice: complete.
5. Core backup export ownership slice: complete.
6. Agent graph executor ownership slice: complete.
7. Node property-schema vocabulary slice: complete.
8. Cognitive-layer persona contract slice: complete.
9. Identity and decision-rule consumer contract slice: complete.
10. Connector ingestion contract slice: complete.
11. Runtime service configuration normalization slice: complete.
12. Event-bus lifecycle slice: complete.
13. Dreamer continuation output contract slice: complete.
14. Encryption storage-configuration contract slice: complete.
15. Agency-node contract slice: complete.
16. Model-registry handler contract slice: complete.
17. CLI voice-training and persona lifecycle slice: complete.
18. Server provider boundary slice: complete.
19. Remaining package validation and owner attribution: complete.
20. Brain agent, training, and scheduler ownership slice: complete.
21. Retired Environment Context Router cleanup slice: complete.
22. Mobile and secondary maintained applications: complete.
23. Curator agent and curated-training ownership slice: complete.
24. Root configuration, scripts, tests, support files, and public docs: active.

No production source was changed while establishing this goal and baseline.

## Curiosity Researcher Repair - 2026-08-24

Scope and surviving owners:

- Kept three distinct curiosity agents. Curiosity Service owns user-facing
  question generation, Curiosity Researcher owns scheduled investigation of
  those pending questions, and Inner Curiosity owns private self-directed Q&A.
- Trigger Manager remains the Curiosity Researcher's hourly admission owner.
  The researcher reads the shared canonical pending-question state but owns its
  separate typed research records and learned memory events.

Findings and repair:

- The researcher was scheduled and executable but read the retired
  `memory/curiosity/questions/pending` tree instead of the canonical profile
  `state/curiosity/questions/pending` tree. Current runs therefore either failed
  user-context setup or completed without seeing current questions.
- Replaced permissive `any` parsing, path-derived unchecked IDs, swallowed model
  and search failures, partial Markdown commits, false-success CLI exits, and
  conflicting schedule metadata with strict typed contracts and one truthful
  bounded cycle.
- Research now queries the authenticated profile's canonical vector index,
  persists a compact versioned JSON finding, and captures the finding through
  the canonical memory owner. Prepared records survive a capture failure and
  resume without repeating the LLM work; completed records are idempotent.
- The typed research store is an active input rather than an orphan archive:
  later runs select relevant prior findings as explicitly secondary evidence.
  The normal content-mode policy still decides whether the accompanying learned
  inner-dialogue event enters the global vector index.
- Aligned the executable path, one-hour interval, Agent Catalog description,
  generated-profile defaults, current agent documentation, and configuration
  guide. Removed stale web-research, debug, default-user, and missing-doc claims.

Validation:

- Focused Curiosity Researcher contract and filesystem lifecycle tests: pass,
  five tests covering strict CLI input, path safety, truthful failure status,
  idempotency, prior-finding reuse, and retryable prepared records.
- `pnpm -s typecheck:brain --pretty false`: pass.
- Two bounded live CLI cycles completed successfully through the local model and
  vector-search owners. Each committed one typed finding, one learned memory
  event, one completion audit record, and a completed index handoff. The active
  `user` index-content policy intentionally declined indexing the generated
  inner-dialogue events; the researcher's own typed prior-finding reuse remains
  active and was covered by the focused test.

## Failed System Coder Removal - 2026-08-24

Scope and surviving owners:

- Removed the failed autonomous System Coder product and its `coder` Agent
  Catalog identity.
- Preserved the separate model-router `coder` role, Big Brother session owner,
  Active Operator critic/self-healing code, and generic skill approval flow.
  Those are maintained execution and review capabilities, not the removed agent.

Baseline findings:

- The brain agent selected one user, converted Big Brother suggestions into
  proposal records with no file changes, skipped its advertised TypeScript
  maintenance check, and swallowed several failures while reporting a successful
  cycle.
- Core contained a second competing error, request, fix, and maintenance stack.
  Its maintenance checks included placeholders and age-based dead-code guesses,
  while its authenticated API could apply or revert model-parsed file content.
- Static discovery found no consumer outside the product itself. The only
  external helper wrote Active Operator feedback into the same orphan coding
  request store, and its API route had no site or mobile caller.
- No active System Coder process, profile-owned System Coder state, fix, request,
  or maintenance report was found in the accessible runtime tree. Three November
  2025 coder-named test drafts under excluded `out/` identified a second old
  self-healing coder experiment.
- That older experiment had no maintained draft producer or UI caller. Its two
  ad-hoc tests were not registered and directly mutated `out/`; its approval API
  trusted a staged absolute path when overwriting a file.

Implementation and cleanup:

- Deleted `brain/agents/coder`, the duplicate `packages/core/src/system-coder`
  domain, its public exports and unified handlers, all 19 Astro transport routes,
  the System Coder dashboard/store, and its right-sidebar and Settings wiring.
- Removed the `code_analyze` queue/proposal type, remote dispatch special case,
  catalog definition and assertions, dead Operator improvement-request endpoint,
  `system-coder` feedback provider, and speculative help-ticket statuses.
- Deleted the System Coder configuration, implementation plan, generated-agent
  playbook, and stale 2025 architecture document that existed to guide that agent.
- Deleted the orphan `code-approvals` core/transport path, coder-only permission
  helper and tests, automatic `code-drafts` directory creation, and stale
  `code_generate`/`code_apply_patch` documentation. The old excluded runtime
  drafts themselves were left untouched.
- Updated current agent and repository orientation docs. Runtime/profile data was
  not deleted.

Validation:

- `pnpm exec tsx packages/core/src/agent-catalog.spec.ts`: pass.
- `pnpm validate:agent-monitor`: pass, 69/69 checks. The command required an
  unsandboxed rerun because managed-sandbox `tsx` IPC returned `EPERM`.
- `pnpm typecheck:core`: passed after the primary System Coder removal. A later
  rerun after concurrent provider work became red on seven unrelated
  provider/server diagnostics; no touched coder, queue, router, skills, profile,
  or memory-policy file was reported.
- `pnpm typecheck:site`: pass, 380 files with zero diagnostics.
- `pnpm --dir apps/site build`: pass with existing accessibility and mixed-import
  warnings.
- Focused memory-policy import and write-policy assertions: pass. The old broad
  memory-continuity script remains unverified because it imports the absent
  `packages/core/dist/index.js` build artifact.
- Maintained-source inventory dry run: pass, 1,967 maintained files and 1,476
  code files. The command required an unsandboxed rerun because sandboxed
  `spawnSync git` returned `EPERM`.
- `pnpm check:architecture`: pass with zero violations after the same required
  `tsx` IPC rerun.
- `./bin/audit check`: pass with only the existing large tracked training-file
  warnings.
- Live browser navigation and a production server restart remain unverified.

## Curator Agent and Training Store Consolidation - 2026-08-24

Scope and surviving owners:

- Kept Curator as a distinct finite worker because it converts episodic memories
  into reviewed training records; Organizer and transcript ingestion do not own
  that transformation.
- Sleep Workflow remains Curator's scheduled parent, Work Coordinator remains
  its queue owner, the Curator graph remains its execution owner, and
  `memory/curated/conversations` remains the one durable training-review store.
- Curated Aggregator remains the downstream adapter from accepted durable records
  into run-scoped training samples.

Findings and repair:

- Removed permissive LLM parsing, fabricated error records, mark-on-failure
  behavior, false graph-success accounting, debug logging, and the unused second
  training-pair JSONL branch.
- Reordered the graph to save atomically before marking source memories. Failed
  model or file operations now fail the graph and leave the affected sources
  retryable; accepted and rejected decisions are both recorded explicitly.
- Added bounded batch draining, strict CLI options, truthful committed counts,
  deterministic output names, idempotent marking, and explicit legacy cognitive
  mode provenance. The UI temperature option now reaches the graph override.
- Published one durable Curator record contract for Curated Aggregator. Invalid
  persisted records and invalid formatter modes now fail closed instead of being
  skipped or silently remapped.
- Deleted the orphan `user-dataset-builder`, orphan `big-brother-tasks` training
  proposal path, the unused Curator training-pair nodes, superseded Curator plans,
  and stale training documentation. Fine-tune callers now drain Curator and stop
  on curation failure unless preprocessing was explicitly disabled.

Validation:

- Focused Curator, agent-catalog, and Sleep Workflow tests: pass, four test files.
- `pnpm validate:graphs`: pass, 30/30 graphs including the canonical Curator graph.
- `pnpm check:architecture`: pass with zero current violations.
- `./bin/audit check`: pass with only the existing large tracked selector-training
  file warning.
- `git diff --check`: pass; final maintained-source and obsolete-path searches
  found no non-test references to the removed Curator paths.
- Maintained-source inventory refreshed: 1,892 maintained files and 1,446 code
  files. The generator required an unsandboxed rerun because sandboxed `tsx` IPC
  returned `EPERM`.
- `pnpm -s typecheck:core` and `pnpm -s typecheck:brain`: pass on the final
  Curator state. No live LLM curation was run because it would mutate
  profile-owned memory data.

## Robot Boredom Autonomy Lifecycle Consolidation - 2026-08-24

Scope and canonical owners:

- Robot Operator remains the only boredom timer/admission owner.
- Work Coordinator remains the only queue and interruption owner.
- Environment Task State remains the only objective lifecycle, evidence,
  action-budget, and completion owner.
- Environment Bridge Out remains transport and one-path conversation routing only.

Finding and repair:

- The first Boredom Autonomy implementation added a competing Robot Autonomy
  Episode State node and fed its model-authored `selfInstruction` back as the
  next execution authority. That bypassed Task State's objective lifecycle and
  allowed a gesture name to become the repeated task.
- Deleted that node, its types, graph wiring, transport inputs/outputs,
  response metadata, and repair fallbacks.
- Rewired the editable Boredom Autonomy graph through the existing Task State
  prepare/reduce nodes. The autonomy selector now authors or revises one generic
  `taskDecision.objective`; Task State persists it with correlated evidence.
- Activated the existing strict Environment selector validator at the existing
  Action Parser boundary, so prose and partial JSON cannot authorize work.
- Removed graph-local Environment-dispatch limits, Robot Observer limit
  metadata, and the bridge-owned limiter. Robot Operator's `maxCycleSteps`
  supplies the single action-budget value enforced by Environment Task State.
- Removed the Movement Generator's duplicate-plan rejection plus its plan-list
  and repetition-counter fields. The existing fresh-frame evidence guard
  remains, but no action-repetition policy blocks a valid generated motion.
- Restricted Task State's canned exact-result closure to reactive one-step user
  commands. Autonomous physical consequences now return to the existing
  Boredom Autonomy selector, which may complete with verified `action_result`
  evidence or revise the objective and queue one next consequence. Removed the
  false bounded-result instruction that pushed completed expressions toward an
  unnecessary camera request; no reviewer or parallel lifecycle was added.

Validation:

- Focused Environment parser, Task State, Robot Operator graph, and Robot
  Operator service tests: pass.
- Environment selector corpus and regression tests: pass.
- Cognitive graph validation: 30/30 pass.
- Node defaults and Agent Monitor validations: pass.
- Architecture guard: pass with zero violations.
- Core typecheck remains red on the pre-existing broad TypeScript backlog; it
  reported no error in this repair's changed owner files.
- Live model behavior, correlated bridge re-entry, and physical robot motion
  remain unverified until the runtime is rebuilt/restarted and hardware is
  exercised.

## System-Wide Refactor Slice 1 - Site Validation and Client Cleanup

Scope and owner:

- Existing root `typecheck:site` command and the `apps/site` package.
- Site component registry, local IndexedDB owner, profile sync utilities, and
  unused client/server imports exposed by the checker.
- No concurrently modified Svelte component was edited.

Baseline findings:

- `pnpm -s typecheck:site` did not run a check. Astro prompted to install the
  missing `@astrojs/check` package and exited without diagnostics.
- After installing the checker, the real baseline was 11 errors and 18 hints
  across 402 files.
- The card registry used the retired class-style `SvelteComponent` type for
  function-style Svelte components.
- The local IndexedDB schema indexed boolean `synced` and `deleted` fields even
  though booleans are not valid IndexedDB keys. The `by-deleted` memory index and
  `by-synced` task index had no callers.
- Remaining hints were unused imports, an unused response body, unused sync-state
  constants, an unused tier-selection argument, a dead battery helper, and an
  EventSource reference duplicated by the connection-pool handle.

Implementation and cleanup:

- Added the official `@astrojs/check` development dependency to the existing Astro
  validation path; no second checker or script was introduced.
- Typed the dynamic message-card registry against the shared card contract while
  preserving each generated component's concrete type.
- Advanced the local database to version 5, removed invalid boolean-key indexes
  during upgrade, retained the canonical boolean fields, and replaced invalid
  indexed queries with direct bounded scans.
- Removed the unused imports, response parse, constants, argument, helper, and
  duplicate EventSource state reported by the checker.

Validation:

- `pnpm -s typecheck:site`: pass, 402 files, zero errors, warnings, or hints.
- Browser-backed version-4 to version-5 IndexedDB migration probe: pass. Retained
  memory indexes were `by-timestamp` and `by-type`; retained task index was
  `by-status`; one unsynced fixture and all aggregate counts matched expectation.
- `pnpm --dir apps/site build`: pass. Existing accessibility and mixed
  static/dynamic import warnings remain as later owner-group work.
- `pnpm -s check:architecture`: pass with zero current architecture violations.
- `git diff --check`: pass.

Remaining evidence boundary:

- This slice proves the checker, production build, and isolated IndexedDB upgrade.
  It does not claim full interactive site acceptance.
- Core and CLI type checks remain red and are tracked as separate owner work.

## System-Wide Refactor Slice 2 - Core Backup Export Ownership

Scope and owner:

- `packages/core/src/system-operator/backup.ts` owns profile-level system backups.
- `packages/core/src/safe-file.ts` owns per-file atomic-write backups.
- `packages/core/src/config.ts` exposes config-specific recovery helpers over the
  per-file owner.

Baseline findings:

- The root core barrel exported three `listBackups` paths: the System Operator
  profile API, the low-level safe-file helper, and the config module's re-export
  of that same helper.
- TypeScript reported two ambiguous root exports, and Vite ignored the conflicting
  namespace during the site build.
- Static maintained-source discovery found no consumer importing the low-level
  helper as `listBackups`; its only callers were `safe-file.ts` and `config.ts`.
- The concurrently edited root barrel only adds environment types and did not need
  modification for this repair.

Implementation and cleanup:

- Kept `listBackups(username?)` as the System Operator's canonical public name.
- Renamed the per-file helper to `listFileBackups(filePath)` and updated its direct
  restore and config-backup callers and exports.
- Added a focused test proving per-file listing and restoration through the new
  unambiguous contract.

Validation:

- `node --import tsx --test packages/core/src/safe-file.spec.ts`: pass.
- Maintained-source reference search: no stale low-level `listBackups` caller.
- `pnpm -s typecheck:core`: the two `src/index.ts` ambiguous-export diagnostics are
  removed; unrelated core diagnostics remain.
- `pnpm --dir apps/site build`: pass; the conflicting `listBackups` namespace
  warning is removed. Other existing build warnings remain separate owner work.
- Focused `git diff --check`: pass.

## System-Wide Refactor Slice 3 - Agent Graph Executor Ownership

Scope and owner:

- `packages/core/src/graph-runtime.ts` and the cognitive graph API handlers own
  graph loading and execution.
- `etc/cognitive-graphs` is the canonical built-in graph resource directory.
- `brain/agents/organizer` remains the production Organizer owner.

Baseline findings:

- `packages/core/src/agent-graph-executor.ts` pointed at the deleted
  `apps/site/src/lib/cognitive-nodes/templates` directory.
- The executor duplicated the canonical Svelte Flow graph types, validation,
  loading, and execution path already provided by core.
- Maintained-source discovery found no production caller. Its only caller was an
  ad-hoc script that expected a legacy `links` field from an `edges` graph and
  attempted live graph execution despite describing the operation as a dry run.
- The user guide still named the deleted UI directory as the built-in graph
  owner.

Implementation and cleanup:

- Deleted the unused parallel executor and removed its root barrel export.
- Deleted the stale ad-hoc execution script; existing canonical graph validation
  remains the maintained verification path.
- Corrected the user guide to name `etc/cognitive-graphs/*.json` as the built-in
  graph location.
- Preserved the Organizer agent and `organizer-agent.json`; this slice removes a
  duplicate loader/executor, not either maintained resource owner.

Validation:

- Maintained-source reference search: no active executor API or deleted template
  path references remain. Historical ledger and generated inventory references
  are retained until the next inventory checkpoint.
- `pnpm validate:graphs`: pass, 30 of 30 graphs valid.
- `pnpm -s check:architecture`: pass with zero current architecture violations.
- `pnpm -s typecheck:core`: all four `agent-graph-executor.ts` diagnostics are
  removed; unrelated owner groups remain red.
- `git diff --check`: pass.

## System-Wide Refactor Slice 4 - Node Property-Schema Vocabulary

Scope and owner:

- `packages/core/src/nodes/types.ts` owns the node property-schema vocabulary.
- The existing flow-editor property inspector owns rendering for that vocabulary.

Baseline findings:

- Eleven prompt fields across the response LLM and response synthesizer nodes used
  the undeclared property type `textarea`.
- The shared core contract and editor already agreed on `text_multiline`, which
  the editor renders as a textarea. Adding `textarea` would create a redundant
  alias and another UI branch.

Implementation and cleanup:

- Normalized all eleven prompt fields to the existing `text_multiline` contract.
- Did not alter the shared type or concurrently modified property inspector.

Validation:

- Maintained-source search: no `textarea` property-schema declarations or
  handling branches remain.
- `pnpm -s typecheck:core`: all eleven affected node diagnostics are removed;
  unrelated owner groups remain red.
- `pnpm -s typecheck:site`: pass, 402 files with zero diagnostics.
- `git diff --check`: pass.

## System-Wide Refactor Slice 5 - Cognitive-Layer Persona Contract

Scope and owner:

- `packages/core/src/identity.ts` owns the canonical persona contract.
- Cognitive-layer prompt and validation utilities consume that contract.
- The Subconscious layer owns mode-specific context retrieval settings.

Baseline findings:

- Cognitive-layer consumers still expected experimental top-level persona aliases
  for name, traits, values, goals, and background instead of the canonical nested
  identity shape used by templates and live profiles.
- Value alignment tested whether the complete `values` object was an array. It
  therefore returned "aligned" without evaluating any canonical core values.
- Environment mode was part of `CognitiveModeId` but had no Subconscious context
  policy, leaving a non-exhaustive execution path.

Implementation and cleanup:

- Added one pure cognitive-layer adapter for prompt-ready persona name, numeric
  traits, core value names, active goals, and background.
- Reused that adapter across prompt building, consistency analysis, and value
  alignment; removed the obsolete alias reads from those consumers.
- Removed the experimental alias fields from the declared persona contract while
  retaining canonical top-level background.
- Assigned Environment mode the existing lightweight contextual retrieval policy
  used by Agent mode.

Validation:

- `node --import tsx --test packages/core/src/cognitive-layers/utils/persona-summary.spec.ts`:
  pass, including canonical and legacy-value adapter cases.
- Cognitive-layer stale-alias search: no flat persona name, traits, current-goal,
  or array-values reads remain.
- `pnpm -s typecheck:core`: all seven cognitive-layer diagnostics are removed;
  unrelated owner groups remain red.
- `git diff --check`: pass.

## System-Wide Refactor Slice 6 - Identity and Decision-Rule Consumers

Scope and owner:

- `packages/core/src/identity.ts` owns persona goals and decision-rule shapes.
- Context Builder, Policy Loader, and Goal Manager consume those public contracts.

Baseline findings:

- Context Builder placed the complete values configuration object into a
  `string[]` summary, which later formatted as `[object Object]` rather than value
  names.
- Policy Loader formatted structured hard rules and preferences as strings,
  producing `[object Object]` prompt entries.
- Goal Manager indexed goal tiers with an unchecked property value, ignored its
  named input, omitted `midTerm` from the editor, and matched mutations only by
  mutable goal text.
- The proposed-goal API promised required IDs while admitting entries whose ID
  was absent.

Implementation and cleanup:

- Moved the pure persona projection helper beside the identity owner and reused
  it from Context Builder and cognitive-layer consumers.
- Exported the canonical goal and decision-rule contracts; updated policy prompts
  to render descriptions and honor the explicit soft-preferences selection.
- Restricted Goal Manager to canonical tiers, added `midTerm`, honored named and
  positional inputs, normalized legacy string goals, defaulted missing statuses,
  and matched updates/removals by stable ID or exact name.
- Limited the proposed-goal result to actionable entries with non-empty IDs.

Validation:

- `node --import tsx --test packages/core/src/persona-summary.spec.ts packages/core/src/nodes/persona/goal-manager.node.spec.ts`:
  pass, two files including canonical, compatibility, tier, and selector cases.
- `pnpm -s typecheck:core`: all ten context, identity, policy, and goal-manager
  diagnostics are removed; unrelated owner groups remain red.
- `pnpm -s typecheck:site`: pass, 402 files with zero diagnostics.
- `pnpm -s check:architecture`: pass with zero current architecture violations.
- `git diff --check`: pass.

## System-Wide Refactor Slice 7 - Connector Ingestion Contracts

Scope and owner:

- Core calendar, chat, document, photo, and voice-memo connectors own external
  ingestion.
- `packages/core/src/memory.ts` owns the episodic capture and serializable metadata
  boundary.

Baseline findings:

- Document ingestion passed an event object where `captureEvent` requires the
  content string, so the memory body contract was invalid.
- Its copied profile path was overwritten by the original source path during a
  metadata spread.
- Every connector stored the legacy capture wrapper's returned file path in fields
  named `memoryId` or `eventId`.
- Photo ingestion cast the EXIF library's grouped result into a flat invented
  interface, bypassing the declared `Image`, `Photo`, and `GPSInfo` groups.
- Optional connector fields were not normalized before entering recursively
  serializable episodic metadata.

Implementation and cleanup:

- Added one shared memory-boundary serializer that removes undefined object
  fields, preserves array positions as null, normalizes dates, and rejects
  non-finite numbers as null.
- Corrected document capture arguments and preserved copied paths.
- Migrated all five ingestion connectors to `captureEventWithDetails` and return
  its actual event ID while keeping source provenance in metadata.
- Replaced the invented flat EXIF shape with the library's declared grouped
  result and stopped inventing current timestamps for invalid EXIF dates.
- Removed an unused Chat ingestor profile-path lookup.

Validation:

- `node --import tsx --test packages/core/src/memory-tool-parameters.spec.ts packages/core/src/connectors/document-ingestor.spec.ts packages/core/src/connectors/photo-ingestor.spec.ts`:
  pass, three files covering recursive metadata, text extraction, EXIF dates, and
  GPS conversion.
- Connector search: no ingestion connector still calls the legacy `captureEvent`
  wrapper or assigns its file-path result as a memory ID.
- `pnpm -s typecheck:core`: all seven connector diagnostics are removed;
  unrelated owner groups remain red.
- `git diff --check`: pass.

## System-Wide Refactor Slice 8 - Runtime Service Configuration

Scope and owner:

- Tool Executor configuration owns the materialized escalation settings used by
  escalation backends.
- Voice Service Manager owns shared Kokoro and Whisper process configuration.

Baseline findings:

- `loadToolExecutorConfig` always merged a complete escalation configuration but
  declared that result optional, forcing a consumer to bypass the contract with
  `any`.
- Voice configuration widened its validated `cpu | cuda` device into `string`
  when constructing shared service fields, obscuring an otherwise correct
  normalization path.

Implementation and cleanup:

- Made escalation required on the fully materialized Tool Executor result and
  removed the downstream `any` cast.
- Separated pure voice configuration normalization from file loading and typed
  the shared service fields against the public voice contract.
- Preserved environment-over-file precedence, port validation, service defaults,
  and the existing Whisper CUDA compute policy.

Validation:

- `node --import tsx --test packages/core/src/voice-service-manager.spec.ts`:
  pass, covering file values, environment overrides, invalid-value fallbacks,
  and CUDA compute normalization.
- `pnpm -s typecheck:core`: all three affected configuration diagnostics are
  removed; unrelated owner groups remain red.
- Stale-contract search: no optional escalation declaration, escalation `any`
  cast, or widened untyped shared voice object remains.
- `git diff --check`: pass.

## System-Wide Refactor Slice 9 - Event-Bus Lifecycle

Scope and owner:

- `packages/core/src/infrastructure/event-bus/server.ts` owns the local event-bus
  HTTP, WebSocket, subscriber, and NDJSON lifecycle.

Baseline findings:

- Start stored newly created servers in nullable instance fields and immediately
  read those fields back, producing an unsafe ownership path.
- Server and client used separate CommonJS and ESM loading strategies for the
  same `ws` package.
- Repeated starts could replace live ownership, stopping an idle instance emitted
  a false shutdown event, and shutdown resolved before the log stream flushed.
- Ephemeral-port startup logs and events reported configured port zero instead of
  the actual bound port.

Implementation and cleanup:

- Consolidated the server onto the supported ESM `ws` import and local non-null
  server instances.
- Rejected duplicate starts, reset uptime at real startup, made idle stop a no-op,
  and cleared owned fields before asynchronous close callbacks.
- Terminated subscriber sockets for deterministic shutdown and awaited WebSocket,
  HTTP, and log-stream closure before resolving.
- Reported and emitted the actual bound port.

Validation:

- `timeout 5s node --import tsx --test packages/core/src/infrastructure/event-bus/server.spec.ts`:
  pass on an ephemeral port with isolated logs; the process exits and exactly one
  startup and one shutdown event are fully persisted.
- `pnpm -s typecheck:core`: the event-bus diagnostic is removed. Concurrent
  vector-index changes introduced separate new diagnostics during this check.
- Stale-loader search: no server-side `createRequire`, `require('ws')`, or nullable
  `this.wss.on` path remains.
- `git diff --check`: pass.

## System-Wide Refactor Slice 10 - Dreamer Continuation Metadata

Scope and owner:

- Episodic memory owns the recursive metadata value contract.
- Dreamer Continuation Generator owns parent-child dream lineage.

Baseline findings:

- The episodic metadata index repeated only part of `ToolParameter`, excluding
  arrays and null even though both are valid serializable metadata values.
- Dreamer captured an empty sources array against that incomplete contract.
- The first generated continuation overwrote `lastDream` before recording
  lineage, causing it to identify itself as its parent.
- Synchronous memory capture was misleadingly awaited.

Implementation and cleanup:

- Reused `ToolParameter` directly as the custom episodic metadata value contract.
- Preserved the prior dream fragment before state mutation and recorded it as the
  continuation parent.
- Removed the meaningless await from synchronous capture.

Validation:

- `pnpm -s typecheck:core`: the Dreamer diagnostic is removed; unrelated model,
  encryption, agency, and concurrently changing vector-index owners remain red.
- Stale-pattern search: no self-parent expression, awaited synchronous capture,
  or repeated partial metadata union remains.
- `git diff --check`: pass.

## System-Wide Refactor Slice 11 - Encryption Storage Configuration

Scope and owner:

- User metadata owns the persisted profile-storage configuration.
- Encryption Manager owns validation and encryption behavior derived from that
  configuration.

Baseline findings:

- Encryption Manager trusted an optional metadata object as though it were a
  complete `ProfileStorageConfig`.
- Unlock and lock updates could spread partial or invalid persisted metadata
  back into the user store.
- The boundary accepted unsupported storage and encryption discriminator values.

Implementation and cleanup:

- Added one reusable runtime guard for the existing `ProfileStorageConfig`
  contract instead of creating a second storage schema.
- Centralized fail-closed storage resolution for status, unlock, lock, and file
  encryption decisions.
- Reused only the validated storage object when persisting lock-state changes.
- Typed the resolver against safe user metadata because encryption policy does
  not require password hashes.

Validation:

- `node --import tsx --test packages/core/src/encryption-manager.spec.ts`: pass,
  including valid and malformed storage configurations.
- `pnpm -s typecheck:core`: all four Encryption Manager diagnostics are removed;
  the remaining 22 diagnostics belong to the separately owned model-registry
  and agency-node clusters.
- `git diff --check`: pass for the implementation and focused test.

## System-Wide Refactor Slice 12 - Agency Node Contracts

Scope and owner:

- Model Resolver owns the finite model-role vocabulary.
- Agency graph nodes own named graph-input admission and LLM request shaping.
- Agency storage remains the sole milestone state mutator.

Baseline findings:

- Several agency nodes read positional array indexes even though the graph
  executor supplies named handles such as `slot_0`, `slot_2`, and `userInput`.
- Verdict Router therefore missed the live outcome-review input and could default
  a valid verdict to escalation.
- Milestone advancement assigned the service's result wrapper where a `Desire`
  was required, and persisted reviews omitted the milestone decision fields.
- Editable role properties crossed into the model router as unrestricted strings.
- Prior execution result metadata was accessed as a known object even though its
  canonical contract is `unknown`.

Implementation and cleanup:

- Established one canonical runtime-normalized model-role vocabulary in Model
  Resolver and reused it across all agency LLM nodes.
- Admitted current named graph handles first while retaining positional fallback
  only for legacy callers.
- Added milestone decisions to the existing `DesireOutcomeReview` contract and
  persisted them with the review.
- Kept `advanceDesireMilestone` as the only state mutator and consumed its
  documented wrapper without creating parallel milestone logic.
- Narrowed prior step-result metadata before extracting response text.

Validation:

- Focused model-role and verdict-router tests: pass.
- `pnpm -s typecheck:core`: all seven original agency-node diagnostics are
  removed; the remaining 15 diagnostics are isolated to Model Registry.
- `pnpm -s validate:graphs`: 30/30 cognitive graphs valid.
- `pnpm -s check:architecture`: pass with zero violations.
- `./bin/audit check`: pass; the two existing tracked training-data size warnings
  remain warnings.
- `git diff --check`: pass.

## System-Wide Refactor Slice 13 - Model Registry Boundary

Scope and owner:

- Model Resolver owns the model-registry schema, migrations, cache, and finite
  model-role vocabulary.
- Model Registry API owns authenticated request validation and profile-registry
  mutations.

Baseline findings:

- The API handler inferred a union of untyped JSON and incomplete fallback
  objects, leaving all registry mutation paths effectively untyped.
- Role, model ID, and cognitive-mode request values were used as record keys
  before runtime validation.
- The handler maintained an unused, conflicting role list containing `fallback`
  while omitting current canonical roles.
- A synchronous file writer was marked async and awaited.
- Generic LoRA discovery could persist the backend selector value `auto` as
  though it were a concrete model provider.

Implementation and cleanup:

- Added one shared registry parser and role guard to Model Resolver and reused
  them in both the resolver loader and API boundary.
- Made optional registry sections accurately partial while preserving the
  existing `ModelRegistry` owner.
- Typed profile initialization, reads, writes, inventory projection, and model
  mutations against that canonical contract.
- Rejected unsupported roles and malformed request discriminators before any
  registry mutation.
- Removed the unused conflicting role list and meaningless async wrapper.
- Resolved generic LoRA provider identity to the concrete active backend.

Validation:

- `pnpm -s typecheck:core --pretty false`: pass with zero diagnostics.
- `pnpm -s typecheck:site`: pass across 402 files with zero errors, warnings, or
  hints; the dependency-data age notice is informational.
- Focused Model Registry, model-role/parser, agency-router, and encryption tests:
  pass (4 files).
- `pnpm -s check:architecture`: pass with zero violations.
- `./bin/audit check`: pass with the two existing tracked training-data size
  warnings.
- `git diff --check`: pass.

## System-Wide Refactor Slice 14 - CLI Voice and Persona Ownership

Scope and owners:

- Core Voice Training owns Kokoro voicepack training admission, dataset
  selection, process launch, status, and logs.
- Core Persona Session Manager owns interview persistence, lifecycle states, and
  index metadata.
- CLI remains an explicit-user interface over those owners.

Baseline findings:

- The CLI maintained a second Kokoro trainer with its own dataset resolution,
  process launch, status, and log behavior beside the Core owner.
- Persona CLI commands used removed global path fields and the host OS username,
  dispatched asynchronous commands without awaiting them, and called the audit
  API through a stale signature.
- Persona Generator used `finalized` and `applied` lifecycle states that its
  canonical session contract rejected.
- Session cleanup searched a second, unused directory layout instead of the
  Session Manager's profile-local files.
- The orphan Morning Loader generated and activated `active-profile.md`, which
  no maintained runtime consumer read; CLI help still advertised its commands.

Implementation and cleanup:

- Replaced the CLI's duplicate trainer with the existing Core
  `startKokoroVoicepackTraining` owner and rejected unsupported custom dataset
  paths at the interface boundary.
- Replaced shell-based uninstall deletion with the direct filesystem API.
- Required explicit MetaHuman user context for all Persona CLI paths and routed
  reads and writes through existing public Core exports.
- Awaited Persona command dispatch and normalized audit calls to the canonical
  event contract.
- Added `finalized` and `applied` to the canonical session lifecycle, centralized
  lifecycle timestamps and completed-state counting, and reused one session and
  artifact path layout in persistence and cleanup.
- Removed the unregistered Morning Loader, its dead active-profile commands, and
  maintained-source references that claimed it was a runtime consumer.

Validation:

- `node --import tsx --test packages/core/src/persona/session-manager.spec.ts`:
  pass, covering canonical paths, lifecycle timestamps, and completed-state
  classification.
- `pnpm -s typecheck:core --pretty false`: pass with zero diagnostics.
- `pnpm -s typecheck:cli --pretty false`: pass with zero diagnostics.
- `./bin/mh help`: pass outside the managed sandbox; the help surface advertises
  only current Persona commands and explicit-user admission.
- Maintained-source search: no Morning Loader, `active-profile.md`, deleted
  `persona activate`, or standalone `persona diff` command reference remains.
- `git diff --check`: pass.

## System-Wide Refactor Slice 15 - Server Provider Boundary

Scope and owners:

- Core Provider Types owns the shared provider message, options, response,
  progress, configuration, and provider-name contracts.
- `@metahuman/server` owns only cloud-provider transport behavior for RunPod and
  HuggingFace.
- Core Deployment owns the configuration values that current runtime consumers
  actually read.

Baseline findings:

- Server storage imported the Core root barrel for two path helpers, causing the
  server checker to compile the entire Core graph under a different library
  environment and report 83 unrelated diagnostics.
- Provider Bridge and RunPod declared competing copies of existing Core provider
  contracts; HuggingFace then imported the RunPod copies.
- RunPod duplicated response extraction across synchronous and polling paths,
  trusted unvalidated JSON, lost the requested model after polling, and treated
  an explicit zero-retry policy as the default retry count.
- Server builds emitted colocated specifications as production package files.
- The exported scaling and network-storage modules had no maintained consumer.
  They duplicated Core model routing and path ownership while Redis, cold-start,
  keep-warm, and scaling configuration was loaded but never executed.

Implementation and cleanup:

- Added a narrow public Core provider-type export and updated Core to the modern
  Bundler resolver already used by the Server package.
- Replaced all server provider-contract copies with type-only imports from the
  canonical Core owner.
- Centralized and runtime-validated RunPod job/output parsing, preserved model
  identity through polling, honored zero retries, forwarded existing sampling
  options, and stopped logging unexpected provider payloads.
- Made provider construction fail early on incomplete or invalid settings and
  explicitly rejected unsupported HuggingFace image input.
- Excluded colocated specs from package emission.
- Deleted the unconsumed 732-line scaling and network-storage surface, its package
  exports, and the associated false Redis/scaling/cold-start configuration and
  feature claims.

Validation:

- `pnpm --dir packages/server exec tsc --noEmit --pretty false`: pass with zero
  diagnostics.
- Clean Server emit to `/tmp`: pass; output contains only production provider
  modules and declarations, with no specs or deleted scaling/storage modules.
- Focused provider-contract and RunPod parsing tests: pass (2 files).
- `pnpm -s typecheck:core --pretty false` and
  `pnpm -s typecheck:cli --pretty false`: pass with zero diagnostics.
- `pnpm -s typecheck:site`: pass across 380 files with zero errors, warnings, or
  hints; the dependency-data age notice is informational.
- Stale-surface search: no maintained Redis, scaling, cold-start, network-storage,
  or duplicate server provider contract remains.
- `pnpm -s check:architecture`: pass with zero violations.
- `./bin/audit check`: pass with the two existing tracked training-data size
  warnings.
- `git diff --check`: pass.

## System-Wide Refactor Slice 16 - Brain Agent and Training Ownership

Scope and owners:

- Brain agents own background orchestration but consume public Core contracts for
  users, memory search, models, storage, Agency state, and queue admission.
- Trigger Manager owns inactivity admission; Desire Planner owns feasibility and
  clarifying questions inside the Agency lifecycle.
- Brain training utilities must compile against the same production contracts
  they prepare data and remote jobs for.

Baseline findings:

- Brain had no package-wide strict TypeScript boundary, so stale agent-runtime,
  user-context, memory-index, embedding, storage, and training-result contracts
  could coexist without a maintained validation command.
- Curiosity inactivity was represented in Trigger Manager, a graph node, service
  options, and configuration. Web research was configurable but unimplemented.
- Desire Explorer duplicated Desire Planner's feasibility checks, question
  generation, persistence, chat notification, scheduling, and Sleep Workflow
  stage, while writing fields the canonical `Desire` contract did not own.
- Mobile wrappers called internal cycle functions through obsolete signatures;
  drift monitoring called a removed embedding helper.
- Fine-tune utilities consumed fields their remote trainer did not return, read a
  username before CLI validation, and retained an untyped `mkdirp` helper where
  the Node filesystem owner already supplies recursive directory creation.

Implementation and cleanup:

- Added strict `brain/tsconfig.json` validation and the root `typecheck:brain`
  command; exposed only the narrow Core `llm-config` contract Brain already
  consumes.
- Moved memory-facing agents to the canonical vector-index and explicit user
  resolvers, normalized agent-runtime entry points and priority vocabulary, and
  aligned summarizer, digest, transcriber, dreamer, mobile, and drift boundaries.
- Consolidated Curiosity admission under Trigger Manager, removed the duplicate
  graph activity node and unused threshold/interval/topic settings, and reduced
  research modes to the implemented local owner.
- Deleted the five-file Desire Explorer agent, its Trigger Manager and Agent
  Catalog registrations, documentation entry, and redundant Sleep Workflow
  stage. Desire Planner remains the single feasibility/question owner.
- Runtime-validated classifier selection evidence, aligned remote-training
  results and model paths, retained therapy category as explicit dataset
  provenance, and replaced the legacy directory helper with `fs.mkdirSync`.

Validation:

- `pnpm -s typecheck:brain --pretty false`: pass across all 132 Brain TypeScript
  files with zero diagnostics.
- Core, CLI, Server, and Site typechecks: pass; Site reports 380 files with zero
  errors, warnings, or hints.
- Agent Catalog and Sleep Workflow specifications: pass (2 files).
- Environment Action Selector corpus and regression specifications: pass
  (2 files).
- Cognitive graph validation: 30/30 pass; node-default validation: pass.
- Maintained-source search finds no Desire Explorer handler, workflow stage,
  registration, or exploration metadata owner.
- `git diff --check`: pass.

## System-Wide Refactor Slice 17 - Retired Context Router Removal

Scope and owner:

- The active Environment graph and Environment Action Selector own current
  interpretation, action selection, and typed task decisions.
- The retired 14-field Context Router retains no executable owner. Its closed
  held-out lock is immutable provenance owned by the successor training lane.

Baseline findings:

- The active Environment graph no longer contains `context-router`, and no
  runtime module imports the old Core classifier contract.
- The replacement Action Selector documentation explicitly identifies that
  classifier as retired, but root commands still advertised its validator,
  generator, trainers, checkpoint evaluators, exporter, scorer, and benchmark.
- The obsolete lane retained 20 tracked files, including a generated 13 MB JSONL
  dataset, manifest, duplicate prompt/decision contract, and tests that failed
  because their runtime node no longer exists.
- The successor consumes only the 527-byte closed held-out lock plus a local,
  ignored one-shot receipt; it does not consume or rerun the retired corpus.

Implementation and cleanup:

- Moved the immutable lock to
  `brain/training/environment-action-selector/prior-context-router-held-out.lock.json`
  and updated the successor's provenance path and ownership documentation.
- Deleted the complete retired classifier training/evaluation lane, its generated
  dataset and manifest, the unused Core implementation and specification, its
  public export, and nine obsolete root commands.
- Preserved historical technical evidence and Model Registry migration logic
  that removes retired classifier assignments; neither is an executable routing
  authority.

Validation:

- Core and Brain strict typechecks: pass with zero diagnostics.
- Environment Action Selector corpus and regression specifications: pass
  (2 files), including prior-lock and one-shot-receipt provenance validation.
- Maintained executable-source search finds no retired classifier path, Core
  export, specification, or root command.
- `git diff --check`: pass.

## System-Wide Refactor Slice 18 - Android and Generated Mobile Boundary

Scope and owners:

- React Native owns the Android shell, WebView, device speech recognition, and
  embedded-process lifecycle.
- Brain owns mobile agent registration, while the public Core HTTP adapter owns
  API dispatch and root `etc` owns deployable agent, model, and graph config.
- The normal mobile build owns local debug artifacts. The release command alone
  owns signed publication and version advancement.

Baseline findings:

- The mobile package tracked a second `etc` snapshot whose 14 graphs and agent
  catalog had drifted from the canonical owners. Its Node entrypoint also kept a
  shadow status, boot, and profile API for use when canonical bundles failed.
- Build scripts could regenerate the backend without rebuilding the installed
  APK, changed release state during ordinary debug builds, and temporarily moved
  maintained Site routes and middleware out of the source tree.
- The Android manifest requested broad storage, media, package-install, and
  notification access that the shell did not use. An unsupported iOS scaffold,
  sample Node project, stock documentation, and unused dependencies remained.
- The release command published `app-debug.apk`, Android package versions were
  hard-coded, and failed builds could still advance release metadata.
- Importing the Site index page during a static build launched a second model
  service startup path even though boot services already own that lifecycle.

Implementation and cleanup:

- Added one mobile backend builder that bundles Brain registrations and the Core
  HTTP adapter, then generates ignored config assets from root `etc`; deleted all
  tracked mobile config copies, sample project files, and the obsolete builder.
- Made the Node entrypoint require canonical bundles and fail clearly when they
  are absent; removed its fallback API, duplicate profile initialization, broad
  credentialed CORS reflection, and unsafe static-path resolution.
- Made backend changes rebuild the APK before install, separated debug builds
  from publication, and gave the mobile Site config an explicit injected route
  table so builds no longer move or restore maintained source files.
- Reduced the Android shell to used permissions and secure localhost WebView
  access, fixed listener cleanup, requested microphone access only on use, and
  removed the unused iOS, FileProvider, sample, documentation, and dependency
  surfaces.
- Replaced debug-key release publication with an explicitly signed release path,
  wired Android package versions to release metadata, and made metadata updates
  occur only after a successful build and copy.
- Removed the page-owned prewarmer. Service lifecycle remains with boot owners,
  and static UI builds are side-effect free.

Validation:

- Mobile TypeScript, ESLint, Node syntax, shell syntax, and lifecycle Jest test:
  pass. The Jest configuration explicitly handles pnpm's resolved React Native
  setup and excludes generated Gradle trees.
- Mobile backend generation: pass; both bundles build for Node 18 and all 33
  generated config files byte-match the canonical root owners.
- Isolated mobile Site build: pass, six intentional routes, with no API routes,
  middleware, or runtime-service startup.
- Core, Brain, CLI, Server, Site, and Mobile typechecks: pass; Site reports 379
  files with zero errors, warnings, or hints.
- Cognitive graph validation: 30/30 pass.
- `pnpm -s check:architecture`: pass with zero violations.
- `./bin/audit check`: pass with the one retained Action Selector training-file
  size warning.
- `git diff --check`: pass.
- No APK was assembled in this environment: no Android SDK is installed, and a
  signed release intentionally also requires an external production keystore.
  Gradle reached Android project configuration before reporting the missing SDK.

## Previous Consolidation Work

The kickoff, full-plan cleanup, and bounded API follow-up below are completed
historical inputs to this new goal. Their findings remain evidence; their former
"active" labels do not supersede the current goal above.

## User-Agnostic Voice Service Ownership - 2026-08-04

- Moved Whisper and Kokoro into an independent, boot-managed voice server owner.
- Added one core voice server manager for configuration, status, direct process
  lifecycle, lazy start, and stop behavior.
- Removed profile discovery from boot and compatibility launchers; settings GET
  requests are observational and no longer spawn servers.
- Moved process settings to `etc/voice-servers.json` while retaining per-user voice,
  language, speed, provider, VAD, and output preferences in profile voice config.
- Removed the tracked default-user selector and global personal training model
  registry; training lineage now resolves through an explicit profile.
- Added a build-time user-agnostic source guard.
- Added a build-time ownership guard that prevents any voice server lifecycle or
  status code from entering Agent Monitor, and prevents voice server owners from
  importing or controlling Agent Monitor.

## Active Follow-Up Consolidation Goal

Started on 2026-07-01 after the architecture baseline reached 75 remaining `custom-api-route` violations.

This follow-up goal is finished only when all of these are true:

- The architecture guardrail has no active drift:
  `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline` passes.
- The guardrail baseline has either zero violations or only explicitly documented non-actionable exceptions with owner, rationale, and next review trigger.
- Every remaining custom Astro API route in the current 75-route baseline is handled in one of these ways:
  - converted to thin `astroHandler` transport over a core or documented brain/service owner,
  - replaced by an existing unified route,
  - or documented as an exception because it is intentionally app-local transport/process glue.
- `packages/core` still has no imports from apps, brain, Astro, Svelte, or local runtime data.
- `brain/*` uses public `@metahuman/core` exports instead of deep `packages/core/src/...` imports.
- The remote-safety checks remain green and no personal/runtime/local agent data is added back to tracked source.
- `pnpm -s typecheck:core` is either green, or every remaining failure is grouped in a scoped TypeScript debt report under `docs/audits/` with owner area and non-blocking rationale.
- Six coding helper-agent lanes for this active goal have reported patches/findings and are closed.
- Final verification results are recorded in this document.

The plan must stop at those criteria. New product features, UI redesigns, unrelated cleanups, and full line-by-line rewrites require a new goal.

## Active Follow-Up Helper-Agent Lanes

Launched on 2026-07-01:

- McClintock: non-streaming agency desire workflow routes.
- Russell: agency desire streaming/model workflow routes.
- Gauss: queue, operator proposal, and agent API routes.
- Godel: adapters, addons, and training setup routes.
- Volta: service/status/process/stream API routes outside the other lanes.
- Wegener: focused core TypeScript debt and unified API type mismatches.

All six lanes are closed for this active follow-up. Their route migrations, behavior notes, and validation results have been integrated into the sections below.

## Active Follow-Up Baseline

Current starting point for this active goal:

- `custom-api-route`: 75 remaining Astro API routes that still own custom logic.
- `pnpm -s typecheck:core`: red due broad existing TypeScript debt.

The active implementation sequence is:

1. Integrate helper-agent route migration patches by disjoint owner area.
2. Refresh the architecture baseline only after intentional cleanup or documented exceptions.
3. Keep `./bin/audit check`, `git diff --check`, and `pnpm --dir apps/site build` green after each accepted batch.
4. Drive `pnpm -s typecheck:core` toward green; if full green is not technically practical within the route consolidation scope, record the remaining grouped debt under `docs/audits/` before finishing.
5. Mark this active goal complete only after the finish criteria above are satisfied.

## Active Follow-Up Progress - 2026-07-01

Completed locally after creating the active goal:

- Added this active follow-up goal, stop criteria, helper-agent lane list, and implementation sequence to this progress document.
- Launched six coding helper-agent lanes:
  - McClintock: non-streaming agency desire workflow routes.
  - Russell: agency desire streaming/model workflow routes.
  - Gauss: queue, operator proposal, and agent API routes.
  - Godel: adapters, addons, and training setup routes.
  - Volta: service/status/process/stream API routes outside the other lanes.
  - Wegener: focused core TypeScript debt and unified API type mismatches.
- Converted `/api/response-pipeline` to a thin `astroHandler` route over `packages/core/src/api/handlers/response-pipeline.ts`.
- Registered `POST /api/response-pipeline` in the unified core router.
- Extended the response-pipeline result type to match existing failure payload fields.
- Refreshed the architecture baseline from 75 to 71 `custom-api-route` violations. This removed `/api/response-pipeline` plus three already-thin babysitter routes that had been stale in the baseline.

Validation for this local batch:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, 71 baselined `custom-api-route` violations.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s typecheck:core`: still not green due existing broad TypeScript debt; the previous `response-pipeline.ts` result-shape errors are no longer reported.

Integrated helper-agent coding lanes:

- McClintock: moved nine non-streaming agency desire workflow routes into core handlers and thin Astro transport.
- Russell: moved seven streaming/model agency desire workflow routes into `agency-workflows` core handlers while preserving SSE formats.
- Gauss: moved queue, operator proposal, and agent control routes into core handlers and thin transport; added abort-signal propagation for SSE cleanup.
- Godel: moved adapters, addons, and training setup routes into core handlers while keeping long-running training execution in `brain/training` scripts.
- Volta: moved the three read-only babysitter service/status routes into core handlers.
- Wegener: reduced core TypeScript handler debt; after a local `trainingEnv` type fix, `pnpm -s typecheck:core` no longer reports `src/api/handlers/*` diagnostics.

Combined state after all six helper lanes:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, 37 baselined `custom-api-route` violations.
- Remaining baseline is now entirely service/status/process routes.
- `git diff --check`: pass.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s typecheck:core`: still not green due non-handler TypeScript debt in graph execution, cognitive layers, connectors, encryption manager, event bus, legacy CLI adapters, and node schemas.

## Active Follow-Up Godel API Pass - 2026-07-01

Completed for the adapters/addons/training setup lane:

- Moved `/api/adapters` management logic into `packages/core/src/api/handlers/adapters.ts`.
- Kept adapter dataset metadata/config ownership in core while routing long-running LoRA/training work to `brain/training` scripts.
- Extended `packages/core/src/api/handlers/addons.ts` to own addon install, install-stream, and toggle behavior.
- Preserved addon streaming as unified SSE through `astroHandler`; no scoped addon route remains an explicit exception.
- Extended `packages/core/src/api/handlers/training.ts` for training launch, load-model, and operation-status routes.
- Converted these scoped Astro routes to thin `astroHandler` transport:
  `/api/adapters`, `/api/addons/install`, `/api/addons/install-stream`, `/api/addons/toggle`,
  `/api/training/[operation]`, `/api/training/launch`, and `/api/training/load-model`.
- Refreshed the architecture baseline to 37 `custom-api-route` violations after integrating current route migrations in the worktree.

Validation:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, 37 baselined `custom-api-route` violations.
- `./bin/audit check`: pass after running outside the sandbox because `tsx` IPC is blocked by the managed sandbox.
- `git diff --check`: pass.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s exec tsc --noEmit --project packages/core/tsconfig.json --pretty false`: still not green due existing broad TypeScript debt; focused filtering found no errors in the changed API handler/router files.

## Active Follow-Up Final Route Consolidation - 2026-07-01

Completed the remaining current `custom-api-route` baseline.

Final route batches moved into core handlers and thin Astro transport:

- Lizard-brain/event/system service routes: `/api/lizard-brain/logs`, `/api/lizard-brain/trigger-review`, `/api/event-bus-status`.
- Sync/status/process routes: `/api/memory/sync/[id]`, `/api/template-watch`, `/api/astro-servers`, `/api/process-stream`, `/api/tts-queue-stream`.
- Voice training/upload routes: `/api/rvc-training`, `/api/sovits-training`, `/api/voice-training`, `/api/audio/upload`, `/api/voice-profile/upload`.
- Big Brother and local process routes: `/api/big-brother-status`, `/api/big-brother/terminal-events`, `/api/node-pipeline`, and `/api/boot`. Claude Code and Codex share the one ttyd-backed Big Brother session owner.
- Encryption/profile routes: `/api/encryption/setup`, `/api/profile-path/encrypt`, `/api/profile-path/decrypt`.
- Service control routes: `/api/kokoro-addon`, `/api/kokoro-server`, `/api/rvc-addon`, `/api/rvc-server`, `/api/sovits-server`, `/api/whisper-server`.
- Final SSE routes: `/api/buffer-stream`, `/api/monitor/stream`, `/api/tts-stream`.

Core owners added for the final batch include:

- `packages/core/src/api/handlers/tts-service-routes.ts`
- `packages/core/src/api/handlers/whisper-server.ts`
- `packages/core/src/api/handlers/buffer-stream.ts`
- `packages/core/src/api/handlers/monitor-stream.ts`
- `packages/core/src/api/handlers/tts-stream.ts`

Final active follow-up status:

- Architecture baseline: zero violations in `docs/technical/architecture-guardrail-baseline.json`.
- No remaining `custom-api-route` exceptions are documented because none are currently active.
- Six helper-agent lanes are closed.
- The active follow-up goal stops here; new feature work, UI redesign, and deeper TypeScript cleanup require a new scoped goal.

Final validation:

- `pnpm -s check:architecture:update-baseline`: pass, `Current violations recorded: 0`.
- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, `Current architecture violations: 0`.
- `./bin/audit check`: pass after running outside the sandbox because `tsx` IPC is blocked by the managed sandbox; reports `Current architecture violations: 0`.
- `pnpm --dir apps/site build`: pass with existing Svelte accessibility and Vite bundling warnings.
- `git diff --check`: pass.
- `pnpm -s typecheck:core`: still red, but no diagnostics remain for the newly migrated route handler files. The previous consolidated-surface registry typing diagnostics in `src/api/handlers/adapters.ts`, `src/api/handlers/gpu-info.ts`, `src/api/handlers/status.ts`, and `src/nodes/llm/model-resolver.node.ts` were fixed.

Scoped TypeScript debt exception for this finish:

- Executor/graph typing: `agent-graph-executor.ts`.
- Cognitive/persona typing: `cognitive-layers/*`, `context-builder.ts`, `identity.ts`, persona nodes.
- Connector metadata/tool-parameter typing: calendar, document, and photo connectors.
- Storage/encryption config typing: `encryption-manager.ts`, `conversation-buffer.ts`.
- Event bus WebSocket typing: `infrastructure/event-bus/*`.
- Legacy CLI adapter result typing: `legacy-cli-adapters.ts`.
- Model routing/node schema typing: `model-router.ts`, active-operator nodes, agency nodes, cognitive nodes, dreamer/input nodes, `tool-executor-config.ts`.

These failures are grouped as future TypeScript debt because the architecture-route consolidation target is complete and the remaining errors are outside the route ownership changes.

## Active Full-Plan Finish Goal

The full consolidation plan is finished only when all of these are true:

- Tracked personal, runtime, generated, local-tool, and legacy bulk paths are removed from the remote source surface or replaced with sanitized templates.
- `pnpm check:architecture` passes without relying on forbidden tracked-path debt.
- Remaining architecture exceptions, if any, are explicitly documented in the guardrail baseline with owner and rationale.
- Core/brain dependency inversions are removed or converted into documented public interfaces.
- Web API routes identified as first-priority custom logic are moved toward thin transport or documented as scoped follow-up exceptions.
- The maintained-source audit batches have remote-safe summaries under `docs/audits/`.
- Stale public docs either point at the new authority docs or are clearly marked archive-only.
- Six helper-agent lanes for the active full plan have reported findings or patches and are closed.
- Final verification commands have been run and their results are recorded here.

The plan is not allowed to expand beyond these finish criteria without a new goal.

## Active Helper-Agent Lanes

- Remote-safety cleanup verification: complete, report in `docs/audits/remote-safety-cleanup.md`.
- Core/brain architecture refactor: complete for storage ownership, report in `docs/audits/core-brain-boundary.md`.
- Web/API consolidation: complete for `voice-settings`, report in implementation notes below.
- Stale docs authority: complete, report in `docs/audits/stale-docs.md`.
- Maintained-source audit batches: complete, report in `docs/audits/batch-audit-summary.md`.
- Guardrail hardening: complete, report in `docs/audits/guardrail-hardening.md`.

## Final Full-Plan Status

Completed on 2026-07-01:

- Removed tracked personal/runtime/local-tool/legacy-bulk path classes from the Git index while preserving local files with `git rm --cached`.
- Tightened ignore rules so removed persona/profile/runtime files do not reappear as untracked add candidates.
- Removed `apps/code-oss/**` from the tracked maintained source surface.
- Removed tracked credential/runtime classes from the source surface: `credentials.txt`, `data/user-data/**`, `.claude/**`, `.obsidian/**`, `tmp/**`, `apps/site/logs/**`, `audit-state*.json`, `report.json`, `docs/audit-scratchpad.md`, debug keystore, backup tarball, root `persona/**`, and live profile folders.
- Kept `profiles/README.md` tracked as the sanitized profile placeholder.
- Moved storage routing ownership into `packages/core/src/storage-client.ts`.
- Replaced `brain/services/storage-router.ts` with a compatibility adapter over `@metahuman/core/storage-client`.
- Added the public `@metahuman/core/storage-client` export.
- Moved `/api/voice-settings` logic into `packages/core/src/api/handlers/voice-settings.ts`.
- Converted `apps/site/src/pages/api/voice-settings.ts` to the thin `astroHandler` adapter.
- Registered `GET` and `POST /api/voice-settings` in the core API router.
- Updated public/stale docs so current orientation points at `MAINTAINED_SURFACE`, `REFACTOR_BLUEPRINT`, `AUDIT_PROTOCOL`, and this progress document.
- Regenerated the maintained-source inventory after cleanup: 1820 maintained files, 1282 code files.
- Refreshed the architecture guardrail baseline after cleanup: 179 current documented violations.
- Closed the edit-every-file audit workflow and replaced it with report-first audit batch summaries.

Final verification:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass.
- `./bin/audit check`: pass.
- Forbidden tracked path audit target count: 0.
- `git diff --check`: pass.
- JSON parse check for package manifests, inventory, and architecture baseline: pass.
- Focused import smoke for storage adapter and voice handler: pass.
- `pnpm -s typecheck:core`: not green because broad pre-existing strict TypeScript debt remains across agents, API handlers, graph nodes, event bus, connectors, and legacy adapters. The moved `voice-settings` handler no longer appears in the error list after cleanup.

No remaining required steps are open for this bounded full-plan goal. Remaining architecture debt is documented as future follow-up, not an active expansion of this goal.

## Follow-Up Implementation Pass - 2026-07-01

Implemented the first scoped follow-up pass against the previous 179-violation architecture baseline.

Completed:

- Moved mobile concrete agent registration out of `packages/core` into `brain/mobile-agents.ts` and `brain/mobile-handlers.ts`.
- Reduced `packages/core/src/mobile-handlers/mobile-agents.ts` to scheduler compatibility helpers with injected registrations.
- Updated the React Native handler bundle entry to use the brain-owned mobile handler surface.
- Added public core exports needed by brain services/training code: `adapters`, `schema-manager`, `model-registry`, `llm-backend`, `s3-upload`, `mode-validator`, `path-builder`, and `mobile-handlers`.
- Replaced all current `brain/*` deep imports of `packages/core/src/...` with public `@metahuman/core` exports.
- Exposed desire question generation through a public core agency service and removed the desire planner's direct node implementation import.
- Added the missing `cli.ts` and `index.ts` for `brain/agents/desire-explorer`.
- Removed the stale tracked `packages/core/test_skills.ts` inversion.
- Replaced runtime client imports in the flow editor with type-only core imports plus API-fed schema caching.
- Migrated these API route families to core handlers and thin `astroHandler` route files:
  - `active-operator`
  - `unified-queue`
  - `window-session`
  - `persona/generator`
  - `terminal`
  - first agency desire subroute batch: `approve`, `reject`, `reset`, `retry`, and `executions`
- Fixed router parameter extraction for agency desire subroutes and window-session heartbeat routes.
- Refreshed the architecture baseline from 179 violations to 80 violations, all remaining in `custom-api-route`.

Six implementation helper agents were launched and closed for this follow-up pass:

- Active operator API migration: complete.
- Unified queue API migration: complete.
- Window session API migration: complete.
- Agency desire subroute migration: complete for the first non-streaming batch.
- Persona generator API migration: complete.
- Terminal route migration: complete.

Follow-up verification:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass, 80 baselined `custom-api-route` violations.
- `./bin/audit check`: pass after running outside the sandbox because `tsx` IPC is blocked by the managed sandbox.
- `git diff --check`: pass.
- `node apps/react-native/scripts/build-handlers.mjs`: pass; bundle now enters through `brain/mobile-handlers.ts`.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s typecheck:core`: still not green due broad existing TypeScript debt across core API handlers, graph nodes, connectors, event bus, encryption manager, and legacy adapters.

## Follow-Up Local State API Pass - 2026-07-01

Continued the web/API consolidation against the 80-route custom API baseline.

Completed:

- Moved `/api/server-info` network/server discovery into `packages/core/src/api/handlers/server-info.ts`.
- Moved `/api/profile-sync-state` and `/api/update-state` log-backed state reads into `packages/core/src/api/handlers/local-state.ts`.
- Moved `/api/pause-state` Active Operator pause updates into `packages/core/src/api/handlers/pause-state.ts`.
- Converted `/api/training-data` from a duplicate Astro implementation to the already-registered core training-data handlers.
- Preserved the existing `/api/training-data` authentication and default-response contract while moving it through the unified router.
- Converted those five Astro API routes to thin `astroHandler` transport files.
- Refreshed the architecture baseline from 80 violations to 75 violations, all remaining in `custom-api-route`.

Verification:

- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: stale-baseline failure before refresh, confirming exactly five resolved routes.
- `pnpm -s check:architecture:update-baseline`: pass, 75 baselined `custom-api-route` violations.
- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: pass after refresh.
- `./bin/audit check`: pass.
- `git diff --check`: pass.
- `pnpm --dir apps/site build`: pass with existing Svelte/Vite warnings.
- `pnpm -s typecheck:core`: still not green due the existing broad TypeScript backlog; this run did not report the new local-state API handler files.

## Finish Goal

The kickoff is complete when all of these are true:

- Remote-safe architecture authority exists in tracked docs.
- A maintained-source inventory exists for the line-by-line audit.
- Fast guardrails exist and pass with an explicit baseline for current debt.
- The old edit-every-file audit process is marked deprecated.
- Six helper-agent lanes have reported findings or implementation notes.
- The resulting next refactor tickets are recorded without personal/runtime data.

This kickoff does not require fixing all technical debt. It establishes the blueprint, guardrails, inventory, and first tickets so the long audit can proceed without open-ended coding.

## Completed So Far

- Added `docs/technical/MAINTAINED_SURFACE.md` to define maintained source vs runtime/personal/generated/non-system areas.
- Added `docs/technical/REFACTOR_BLUEPRINT.md` to define the app/interface vs core-engine vs agents dependency contract.
- Added `docs/technical/AUDIT_PROTOCOL.md` for line-by-line audit output that does not mutate code while auditing.
- Added `docs/audits/README.md` for remote-safe audit reports.
- Updated `docs/technical/ARCHITECTURE.md` with the monorepo boundary contract.
- Marked `docs/AUDIT-INSTRUCTIONS.md`, `docs/AUDIT-README.md`, and `docs/CLEANUP-PLAN.md` as deprecated historical docs.
- Added `scripts/check-architecture.ts` with guardrails for tracked runtime data, dependency direction, API route ownership, site client imports, and agent contracts.
- Generated an initial guardrail baseline at `docs/technical/architecture-guardrail-baseline.json`.
- Replaced `bin/audit` with a scoped wrapper that checks maintained tracked files and calls the architecture guardrail.
- Added package scripts for architecture checks, baseline refresh, audit inventory, fast audit, and package typechecks.
- Added `scripts/create-audit-inventory.ts` to generate the maintained-source audit inventory.
- Generated `docs/audits/maintained-source-inventory.md` and `docs/audits/maintained-source-inventory.json`.
- Launched six helper-agent lanes for core boundaries, web boundaries, remote safety, audit batching, guardrail review, and docs authority.
- Integrated helper findings into this progress document.
- Marked `docs/AUDIT-QUICKSTART.md`, `docs/AGENT-PROMPT.txt`, and the old `scripts/audit-*` workflow as deprecated historical materials.
- Updated local-only `AGENTS.md` to point future agents at the tracked blueprint while keeping it out of the remote source tree.

## Current Known Baseline Debt

The architecture baseline now records no active architecture violations. Current baseline count: 0 violations.

- `custom-api-route`: 0 Astro API routes in the current scanner baseline own custom logic.

Resolved since the 179-violation baseline:

- `brain-deep-core-import`: 50 resolved.
- `core-layer-inversion`: 13 resolved.
- `site-client-core-import`: 2 resolved.
- `agent-contract`: 1 resolved.
- `custom-api-route`: all current custom-route debt resolved; final current count is 0.

## Helper Agent Lanes

Six helper agents were launched for:

- Core/engine boundary violations.
- Web interface and API boundary violations.
- Remote-safety and cruft cleanup.
- Line-by-line maintained-source audit batching.
- Guardrail script review.
- Documentation authority review.

All six lanes returned findings. Reported findings have been merged into `Next Tickets`, and the guardrail-review lane's implementation notes were integrated into `scripts/check-architecture.ts` and `bin/audit`.

## Residual Follow-Up Tickets

These are future scoped goals. They are not open required steps for the completed consolidation goal above.

### Remote-Safety Cleanup

1. If credential-like files were pushed to GitHub, rotate credentials first and consider history rewriting for the critical path set.
2. Decide whether any sanitized fixtures should replace removed live profile/persona data.
3. Decide whether removed unmapped external gitlinks should be restored as declared submodules or kept out of the remote source surface.

### Architecture Boundary Refactors

1. Normalize training utility ownership:
   decide whether `schema-manager`, `mode-validator`, `model-registry`, `s3-upload`, and `llm-backend` are public core APIs or training-owned helpers.
2. Continue TypeScript debt cleanup by owner group; `pnpm -s typecheck:core` is still the broad failing signal.

### Web/API Consolidation

1. Keep the zero-violation API route baseline strict; any new Astro API route must use `astroHandler` or document a non-actionable exception with owner and rationale.
2. Add focused regression tests for the newly migrated service/stream routes before changing their behavior.
3. Audit oversized UI/client files after route owners are clear: `ChatInterface.svelte`, `AgencyDashboard.svelte`, `useMicrophone.ts`, `CenterContent.svelte`, `TrainingWizard.svelte`, `VoiceTrainingWidget.svelte`, `AuthGate.svelte`, `ProfileLocation.svelte`, `SecuritySettings.svelte`, and `profile-sync.ts`.

### Audit Batches

1. Remote-safety fence.
2. Guardrail and entrypoint map.
3. Core foundation.
4. Core API ownership.
5. Core domain systems.
6. Core graph and nodes.
7. Interface packages and CLI.
8. Web app transport and UI.
9. Brain agents/services/training.
10. Mobile and secondary apps.
11. Support scripts, tests, config, and docs.

### Stale Docs and Scripts

1. Update stale public orientation docs:
   `README.md`, `STARTUP.md`, and any `docs/technical/README.md` references that point at missing or stale files.
2. Mark historical planning/status docs as archive-only unless refreshed:
   `docs/NEXT-STEPS.md`, `docs/MOBILE-IMPLEMENTATION.md`, `docs/UNIFIED-API-LAYER.md`, `docs/REMAINING-WORK.md`, and `docs/OPTIONAL-NEXT-STEPS-STATUS.md`.
