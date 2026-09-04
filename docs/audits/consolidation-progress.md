# Consolidation Progress

This document is the chronological evidence ledger for the MetaHuman cleanup and
refactor. The canonical program, principles, scope, and completion criteria live
in `docs/technical/REFACTOR_BLUEPRINT.md`.

## Completed System-Wide Refactor Goal - 2026-08-24 to 2026-08-25

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
3. Attribute the existing dirty worktree by owner and validation state: complete.
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
24. Root configuration, scripts, tests, support files, and public docs: complete.
25. Final cross-repository validation and evidence reconciliation: complete.

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

## Curiosity Service Lifecycle Repair - 2026-08-25

Scope and surviving owners:

- Kept Curiosity Service as the separate user-facing question owner. Trigger
  Manager remains its sole inactivity/admission owner; the editable Curiosity
  graph remains its execution path; Curiosity Researcher and Inner Curiosity
  retain their distinct responsibilities.
- Added one typed Core question-store contract for profile-isolated pending,
  answered, and skipped records. The graph saver, reply-context node, response
  pipeline, Skip transport, memory browser, and open-question guard now use that
  contract instead of audit-log lookup or transient pause state.

Findings and repair:

- `maxOpenQuestions` previously acted only as an on/off flag. Current profiles
  had accumulated 1,214 pending records and no answered records. The agent now
  counts canonical pending state before model execution and stops at the exact
  configured limit. Existing user-owned records were preserved.
- Question publication previously preceded its non-atomic filesystem write,
  and TTS could execute directly from the generator. Pending records are now
  written atomically before chat audit, conversation-buffer, or TTS publication.
- Answers and skips now durably resolve the exact profile record. Removed the
  unused Active Operator curiosity pause state and the same-day global audit-log
  reply lookup. Resolution publication is atomic and exclusive: duplicate
  requests are idempotent, while competing answer/skip requests report a
  conflict instead of overwriting or falsely succeeding.
- Graph/node failures now produce failed agent work rather than successful
  zero-question cycles. Expected disabled, trust, limit, and no-memory outcomes
  remain explicit successful skips.
- Removed per-agent mobile timing metadata and registration. Mobile supplies
  in-process executors only; canonical Trigger Manager configuration owns timing.
- Curiosity configuration now validates its complete contract and explicitly
  migrates legacy profile fields instead of retaining unused interval settings.
- Curiosity Researcher, Desire Generator, and the memory browser now consume the
  same public Core question-store contract; their distinct research, desire,
  and presentation responsibilities remain separate.
- Curiosity uses strict trust loading, so missing, malformed, or unsupported
  decision rules fail the work item instead of silently lowering trust and
  reporting a misleading successful cycle.

Validation:

- Focused Core question lifecycle, configuration, response-resolution, graph
  ordering, cap, and truthful-failure tests: pass.
- Core, Brain, mobile, Agent Runtime, and site typechecks; all cognitive graphs;
  memory inventory; Agent Catalog; Trigger Manager catalog; work-owner
  architecture; and `./bin/audit check`: pass. The audit retained one unrelated
  warning for the tracked environment-action-selector training JSONL file.

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
  action-lineage, and completion owner.
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
  metadata, the bridge-owned limiter, Robot Operator's `maxCycleSteps`, and
  Task State's step cap. Task State serializes one correlated action per
  decision pass but imposes no total action count or deterministic autonomy
  stop.
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

## Robot Boredom Planner and Executor Repair - 2026-08-25

Canonical owners retained:

- Robot Operator is the only boredom scheduler and admission owner.
- The three boredom cognitive graphs own trigger-specific contextual planning.
- Boredom Autonomy is the only shared boredom consequence executor.
- Work Coordinator, Environment Task State, Environment Action Parser,
  Movement Generator, Environment Bridge Out, canonical buffers, and TTS retain
  their existing queue, lifecycle, validation, transport, and output roles.

Repair and consolidation:

- Rebuilt Observer, Movement, and Reflection as visible planner graphs. Each
  loads persona, bounded current context, verified robot history, and its
  trigger-specific evidence before one strict JSON LLM decision.
- Made Observer's image acquisition a visible re-entrant graph phase and skip
  its planner inference until correlated evidence returns.
- Restricted planner delegation to `observed`, `instruction`, and `reason`;
  technical commands, movement plans, evidence contracts, and execution
  sequences remain Boredom Autonomy responsibilities.
- Rebuilt Boredom Autonomy as the one receding-horizon executor. One admitted
  consequence yields to the coordinator, and its correlated result returns to
  the same Task State objective for revision or completion.
- Preserved the entire live advertised capability schema, current state,
  persona, bounded conversation and reflection, sampled memory, verified action
  history, Task State, and current correlated evidence without adding a context
  store or replay transcript.
- Deleted the legacy `robot-operator-mode.json` graph, service/editor/template
  routing, direct dispatch and trigger lifecycle inputs, hidden minute-based
  limiter, static observer instruction, redundant thinking-strip node, stale
  action-context carryover, duplicate-plan policy, and the undocumented
  `workflow.robot-observer` admission alias.
- Added registered editor schemas for the repaired planner nodes and a strict
  model-facing motion schema matching the existing 0..180 joint validator.
  Invalid plans remain visible failures; no clamp, retry, or fallback was added.
- Added the spiky-friend/head-tilt evaluation as test data only. It proves that
  intention prose cannot dispatch a physical action and that an exact advertised
  structured command can; no scene or activity rule entered production policy.
- Retired the implementation scratchpad on 2026-08-31 after its surviving owner
  decisions and validation evidence were captured here, in the maintained-surface
  authority, graph inventory, executable graphs, and focused tests.

Validation:

- Nine focused Robot Operator, boredom graph, Environment parser/Task State,
  motion, bridge-correlation, and TTS test files: pass.
- Cognitive graphs: 29/29 valid; graph executor coverage: 280 nodes with zero
  missing executors.
- Core, Brain, and Site type checks plus the production Site build: pass; Site
  type checking reports zero errors, warnings, or hints.
- Node defaults: pass. Agent Monitor: 69/69 checks pass.
- Architecture guard: zero current violations.
- Maintained-source inventory refreshed: 1,587 maintained files and 1,315 code
  files. The generator required an unsandboxed rerun because its sandboxed
  internal `git` subprocess returned `EPERM`.
- `./bin/audit check`: pass. It reports the existing tracked large-file warning
  for the Environment selector development corpus and no architecture failure.
- Live model behavior, bridge re-entry, TTS ordering, and physical robot motion
  remain unverified; no robot action was dispatched during source validation.

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

- Core calendar, chat, document, and photo connectors own external
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
  aligned summarizer, digest, dreamer, mobile, and drift boundaries.
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

## System-Wide Refactor Slice 19 - Root Support and Final Ownership Cleanup

Scope and owners:

- Root package metadata owns the complete type, architecture, test, and production
  build gate. The maintained-source policy owns inventory membership, and
  `bin/audit` consumes that policy instead of maintaining a second exclusion set.
- Core owns embeddings, provider transport, security policy, work-coordinator
  authentication, and GPT-SoVITS lifecycle. Site, CLI, add-ons, and shell helpers
  delegate to those owners.
- Agent Catalog definitions and modular `brain/agents/<id>/cli.ts` entrypoints are
  the only maintained agent discovery contract.

Baseline findings:

- Root support retained false add-on installation state, duplicate GPT-SoVITS
  process control, ineffective tier routing, profile-generated configuration,
  stale public schema URLs, and flat-agent compatibility fallbacks.
- The audit command duplicated maintained-source exclusions, while the normal
  build omitted the complete type and behavior suites. Several validators used
  the IPC-dependent `tsx` launcher and one scanned generated dependency trees.
- Site compilation reported inaccessible interaction semantics and dynamic
  imports of modules already loaded statically. The lockfile retained duplicate
  dependency versions and obsolete stub type packages.

Implementation and cleanup:

- Replaced add-on placeholders with a truthful static catalog and explicit
  installers, removed false tier routing and unused compatibility/configuration
  surfaces, consolidated embedding control and provider proxy behavior, and
  repaired the security allowlist at its policy owner.
- Made the Core server manager the sole GPT-SoVITS lifecycle owner with atomic
  process identity, bounded group shutdown, and delegating API, UI, CLI, add-on,
  and shell consumers. Removed the competing Site server manager.
- Extracted work-coordinator ownership/authentication from submission so the
  queue facade has no hidden dynamic-import cycle. Replaced other ineffective
  dynamic imports with direct canonical owners, including direct node contracts
  inside Loop Controller rather than registry self-import.
- Removed flat-agent discovery, stale schema claims, orphan registry helpers,
  and misleading legacy naming. Generated agent defaults now resolve real
  modular entrypoints.
- Added one root `test`/`validate` contract and made `build` run all workspace
  typechecks, architecture checks, registered behavior suites, and the Site
  production build. The inventory generator now owns listing for both reports
  and audit policy.
- Repaired Site labels, dialogs, keyboard controls, and icon names with native
  semantics; removed all Svelte and Vite code warnings. Deduplicated the lockfile,
  removed obsolete bundled-type stubs, refreshed browser data, and aligned Core
  and CLI compilation with the Node 22 / ES2022 runtime contract.

Validation:

- `pnpm -s build`: pass. All workspace typechecks pass; Site checks 353 files
  with zero errors, warnings, or hints; architecture reports zero violations;
  every registered behavior suite passes; all 30 cognitive graphs validate; and
  the production Site server/client build completes.
- A post-refresh `pnpm --dir apps/site build`: pass with no compiler, Vite, or
  stale browser-data warning.
- `./bin/audit check`: pass with zero architecture violations. Its only warning
  is the retained Action Selector development-training corpus already documented
  as an intentional maintained training artifact.
- Maintained-source inventory: 1,587 files, including 1,315 code files.
- No external GPT-SoVITS model, signed Android package, robot hardware, or remote
  provider was started by this source-validation slice; no live or physical
  completion claim is made for those systems.

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
- Voice training/upload routes: `/api/rvc-training`, `/api/sovits-training`, `/api/voice-training`, `/api/voice-profile/upload`.
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

- Remote-safety cleanup verification: complete, historical report in `docs/archive/audits/remote-safety-cleanup.md`.
- Core/brain architecture refactor: complete for storage ownership; its superseded point-in-time report was removed after the boundary was repaired.
- Web/API consolidation: complete for `voice-settings`, report in implementation notes below.
- Stale docs authority: complete, historical report in `docs/archive/audits/stale-docs.md`.
- Maintained-source audit batches: complete; the obsolete count snapshot was removed in favor of the generated current inventory.
- Guardrail hardening: complete, historical report in `docs/archive/audits/guardrail-hardening.md`.

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

## Desire Executor Ownership Repair - 2026-08-25

Scope and surviving owners:

- Work Coordinator is the sole admission and lifecycle owner for desire
  execution work. Core Agency owns status claims, the editable execution graph,
  durable attempt recording, and the handoff to Desire Outcome Reviewer.
- The brain Desire Executor remains only as a removable manual/mobile admission
  interface. It owns no review, scheduler, lock, task store, execution backend,
  persistence, or fallback path.

Findings and repair:

- Replaced direct fire-and-forget graph calls from approval, execute, and
  streaming handlers with one `agency.desire-execute` coordinator handler.
  Sleep, Agent Catalog, defaults, CLI, and mobile admission now resolve to the
  same handler. External effects use one attempt and are never automatically
  replayed.
- Removed the 739-line legacy brain implementation, including its competing
  step executor, duplicate trust/review transition, orphan task-linking path,
  dormant process lock, fabricated default-user behavior, and interval metadata.
- Added a profile-and-desire execution claim guard in the coordinator owner.
  Graph infrastructure failures are durably recorded as failed attempts in
  `awaiting_review`; they fail the work item instead of reporting success or
  leaving a desire stranded in `executing`.
- Repaired the graph so the executor node is the only desire finalizer. Removed
  the invalid `executed` updater and duplicate scratchpad writer, corrected the
  audit contract, and made TTS consume only text admitted by Inner Dialogue.
- The executor now discovers its graph node by type, checks graph and required
  persistence outputs, propagates cancellation between steps, uses canonical
  Agency execution configuration, rejects missing configured backends, and no
  longer logs external-provider response content or swallows save errors.
- Removed the superseded Agency implementation plan and updated current agent
  and user documentation to describe queued execution.

Validation:

- Focused Desire Executor, Work Coordinator, Agent Catalog, and Sleep Workflow tests: pass, eleven
  tests including concurrency exclusion, durable infrastructure-failure handoff,
  graph ownership, single-attempt wiring, and strict CLI selectors.
- Core, Brain, CLI, and Site typechecks: pass. Site reported 353 files with zero
  diagnostics.
- Cognitive graph validation, strict node-default validation, graph-executor
  coverage, Agent Monitor validation (69/69), architecture guardrail, and
  `./bin/audit check`: pass. The audit retains only the existing large tracked
  environment-action-selector training-file warning.
- No live desire was executed because that would invoke external tools and create
  real effects. Mid-provider cancellation remains dependent on the selected
  escalation backend; cancellation before and between plan steps is source-validated.

### Desire Executor graph contract follow-up - 2026-09-02

- Replaced the invalid legacy `slot_0` Loader-to-Executor edge with the declared
  `desire` contract. The Executor no longer bypasses graph wiring through
  `context.desire`, numeric inputs, or a fabricated username-as-user-ID value.
- Removed the unused approved-status property and the redundant Audit Logger
  branch. The canonical Agency manifest, execution-attempt record, and
  scratchpad remain the durable execution owners; provider response content is
  no longer copied wholesale into the best-effort audit log.
- Desire execution now preserves the authenticated account ID and profile
  username, runs in the graph's declared Agent mode, and explicitly requires
  both rolling Inner Dialogue and long-term Persona Memory receipts. TTS remains
  optional and downstream of confirmed memory text.
- Added strict registered-node validation for the graph plus focused identity,
  graph-wiring, and persistence-receipt coverage. Desire Executor and Brain
  adapter tests, Core and Brain typechecks, node defaults, all 27 cognitive
  graphs, and the architecture guardrail pass. No live desire was executed.

## Desire Explorer Retirement Follow-Up - 2026-08-25

Scope and surviving owner:

- Desire Planner remains the sole feasibility and clarification owner. Core
  Agency owns question policy, model-response validation, and generation; the
  graph node is only an adapter to that public contract.

Findings and repair:

- Removed the empty local `brain/agents/desire-explorer` directory and the stale
  root README entry left after the executable agent, registrations, and Sleep
  Workflow stage were retired.
- Moved clarification policy and generation out of the graph-node module into
  `packages/core/src/agency/desire-questions.ts`. Invalid model output now fails
  the planning attempt instead of creating a generic fabricated question.
- Made Desire Planner configuration and feasibility output strict typed
  contracts. Missing, malformed, or out-of-contract data fails visibly instead
  of enabling default configuration or treating an unassessed desire as
  feasible.
- Persisted infeasible desires as rejected so later cycles do not repeat the
  same assessment and chat notification. Failed review graphs, promotion
  writes, and individual planning attempts now make the agent result fail and
  remain visible to Work Coordinator retry/audit handling.
- Removed unused planner-local retry, planning, review, and verbose settings.
  Editable graphs own node behavior; Trigger Manager and Work Coordinator own
  retries. Planner feasibility now consumes the canonical Core Agency config
  loader, whose optional profile override fails on storage errors and falls back
  to system configuration only when the override file is genuinely absent.

Validation:

- Desire Planner and Core Agency question contract tests: pass (2 files).
- Agent Catalog and Sleep Workflow specifications: pass (2 files).
- Core and Brain typechecks: pass.
- Cognitive graph validation: 29/29 pass; node-default validation: pass.
- Maintained-source policy dry run, architecture guardrail, `./bin/audit check`,
  final stale-reference search, and `git diff --check`: pass. The audit retains
  only the existing tracked training-data size warning.
- No live model-backed desire was processed because that would write profile
  Agency state and could progress toward external execution.

## Agency Generator, Planner, and Outcome Ownership Repair - 2026-08-25

Scope and surviving owners:

- Desire Generator remains a distinct finite Brain worker that synthesizes and
  nurtures desires from canonical profile inputs.
- Desire Planner remains a distinct finite Brain worker whose feasibility input
  is the registered Core Tool Catalog and whose editable planning and review
  graphs own plan generation and review.
- Core Agency is the sole Outcome Review and durable outcome-transition owner.
  The Brain agent, manual API, Sleep Workflow, and platform integrations only
  admit work through Work Coordinator.
- Trigger Manager and Sleep Workflow retain all scheduling ownership.

Repair and consolidation:

- Made Generator model output and reinforcement decisions strict typed
  contracts. Empty arrays remain valid no-op decisions; missing, malformed,
  duplicate, unknown-source, or unsupported-source output fails the work item
  before it can be interpreted as absence and decay existing desires.
- Replaced three Generator filesystem walkers with the canonical episodic file
  inventory, removed swallowed profile/task/memory/persistence failures, added a
  per-profile atomic process lock, and removed the fabricated default profile
  and interval metadata.
- Replaced Planner's invented full-computer, internet, communication, and CLI
  capability claims with the live registered Tool Catalog. Planner now loads
  graphs through the shared graph runtime, resolves result owners by stable node
  type, propagates cancellation, uses one effective per-profile lock, and fails
  when no real profile is selected.
- Replaced the 979-line competing Brain implementation with a thin Desire Outcome Reviewer admission
  interface. Removed its recurring-task creation, duplicate state machine,
  duplicated metrics/scratchpad persistence, hidden config defaults, repair-task
  path, and fabricated profile behavior.
- Rebuilt `desire-outcome-reviewer.json` around one strict reviewer and one canonical
  `desire_updater` transition. Possible system defects pause for user approval;
  no repair task or second execution path is created.
- Removed the manual API's independent verification/prompt/mutation outcome
  owner and the duplicate in-process mobile Executor/Outcome registrations.
  Browser outcome-review SSE retains its existing unnamed event contract while
  the work itself is admitted to Core.
- Removed Agency's competing scheduling configuration and unused capability and
  execution flags. Removed the uncalled `desire-generator.json`,
  `desire-generator-proactive.json`, and `desire-retry.json` graph artifacts.
  Removed their now-unreachable Detector, Folder Creator, Memory Analyzer, and
  Enricher node implementations, plus the superseded Outcome Verdict Router.
  Current docs now describe folder-based desire storage and the canonical queue
  and graph boundaries.

Validation:

- Ten focused Generator, Planner, Executor, Outcome, Agency configuration,
  transition, graph-runtime, and model-contract suites: pass. Agent Catalog and
  Sleep Workflow suites: pass.
- Core, Brain, CLI, and Site typechecks: pass; Site reports 353 files with zero
  errors, warnings, or hints. The Site production build passes.
- Cognitive graphs: 26/26 valid; graph executor coverage: 250 nodes with zero
  missing executors. Node defaults and user-agnostic guard: pass.
- Architecture guardrail: zero current violations. `./bin/audit check`: pass
  with only the existing tracked large environment-action-selector corpus
  warning.
- Maintained-source inventory refreshed: 1,577 maintained files and 1,309 code
  files.
- No live profile desire was generated, planned, executed, or reviewed because
  those checks would call configured models and mutate user Agency state.
- The root build passed all package typechecks and architecture, then stopped in
  an unrelated Environment Mode contract test whose expected prompt says
  `inspect only fresh correlated evidence` while the existing dirty graph says
  `inspect fresh correlated evidence`. That Robot Operator change was not
  altered as part of this Agency repair.

## Robot Status Context Ownership - 2026-08-27

Scope and surviving owners:

- Added one profile-resolved Robot Status JSON snapshot owner in Core. Exact
  bounded Environment Bridge telemetry, verified Robot Buffer action results,
  and active Agency desires remain distinct from the one LLM-derived situation.
- Added one editable Robot Status graph with one model call, one atomic writer,
  and one System Buffer projection. The existing System Buffer remains the sole
  System Feed persistence owner; no queue, scheduler, buffer, or Agency store
  was added.
- Extended Robot Operator's existing child rotation and independent Semi timers
  to admit Robot Status. Agent Monitor uses the same owner-aware manual workflow
  route as the existing boredom children.
- Added one reusable Robot Status read node to Environment Mode and Boredom
  Autonomy. The snapshot is supporting context only; current correlated
  Environment evidence remains the physical-truth owner.

Focused source, graph, catalog, Robot Operator, and consumer validation passed at
the time of implementation. Manual non-physical workflow runs wrote the bounded
snapshot and System Buffer event and proved Boredom Autonomy consumption. A
coordinated current-generation restart, automatic Robot Operator admission, live
Environment Mode consumption, and physical behavior remained unverified. The
temporary local Robot Status checklist is not an architecture authority and must
not replace this durable evidence record.

## Psychoanalyzer Persona-Learning Consolidation - 2026-08-27

Scope and surviving owners:

- Sleep Workflow remains the only automatic persona-review admission owner;
  manual Agent Catalog execution remains available.
- Brain Psychoanalyzer owns deterministic memory selection, one psychotherapist
  request, cancellation checks, per-profile locking, and insights provenance.
- Core Persona Learning owns the strict evidence/change contract and bounded
  persona mutation. Core Identity owns atomic persona saves and archives.
- Preference Learner remains separate and supplies only user-confirmed or
  user-modified preferences to persona-facing chat context.

Repair and consolidation:

- Replaced Psychoanalyzer's competing legacy and seven-section update paths with
  one validated proposal path. Every change cites selected memory IDs; identity
  is not an allowed target; low-confidence and disabled-field changes are not
  applied; automated removals cannot delete entries without Psychoanalyzer
  provenance while `preserveUserEdits` is enabled.
- Replaced random memory sampling with deterministic priority-and-recency order,
  added completed-input digests for repeat-run idempotency, and made malformed
  model output, memories, preferences, and configuration explicit failures.
- Moved persona writes and archives through Core's atomic persistence owner.
  Unified profile configuration validation now serves both the agent and API;
  authenticated settings update the selected profile rather than an unrelated
  system file.
- Deleted the unregistered Digest agent, its mobile wrapper, Agent Catalog and
  model-role entries, documentation, and Digest-only persona cache API. Mobile
  now registers Psychoanalyzer. Chat/context derive durable persona data from
  persona core plus confirmed preferences.

Validation:

- Focused Persona Learning, Psychoanalyzer config/CLI, Trigger Manager, and Agent
  Catalog suites: 10/10 pass.
- Core, Brain, and Site typechecks: pass; Site reports 353 files with zero
  errors, warnings, or hints.
- Root production build: pass, including 27/27 cognitive graphs, Agent Monitor
  69/69, security and ownership guards, Site server build, and included contract
  suites.
- Architecture guardrail: zero violations. `./bin/audit check` passes with only
  the existing large tracked training-corpus warning. Maintained-source dry run
  validates 1,592 maintained files and 1,324 code files.
- No live model-backed profile review was run because it would call the selected
  backend and mutate private persona, archive, and insights data. Runtime model
  quality and real profile persistence therefore remain unverified.

## Inbox Ingestor Canonical-Owner Repair - 2026-08-27

Scope and surviving owners:

- `brain/agents/ingestor` remains the sole generic profile-inbox worker. Server
  CLI, Agent Runtime, and mobile execution now enter one `runIngestor` contract;
  Work Coordinator and TriggerManager ownership are unchanged.
- Core Memory Capture owns durable producer idempotency. The ingestor supplies a
  stable source-and-chunk key plus source timestamp so capture and archive
  retries do not create a second memory path.
- Inbox Ingestor remains installed but is not registered in the current Trigger
  Manager configuration. This repair did not silently enable a schedule.

Repair and consolidation:

- Added explicit file and chunk outcomes, failure propagation, per-profile
  exclusion, deterministic archive names, bounded UTF-8 TXT/Markdown/JSON
  validation, a 1 MB file ceiling, and bounded chunk and run limits.
- Replaced legacy `captureEvent` use with detailed capture results and persistent
  idempotency in the existing memory owner. Removed fabricated owner contexts,
  duplicated CLI/runtime option parsing, unused `singleUser` behavior, and
  duplicate interval metadata.
- Deleted the unregistered `brain/scripts/ai-ingestor.ts` execution path after
  source, process, cron, and systemd searches found no operational invocation.
  Deleted both unused `ingestor.json` schemas and their profile/CLI/docs wiring;
  PDF and DOCX remain owned by Document Ingestor.

Validation:

- Focused Inbox Ingestor and Core Memory idempotency suites: pass (2 files),
  covering strict options, malformed/binary/unsupported/oversized files,
  bounded chunks, explicit partial failure, archive retry, repeated invocation,
  durable capture identity, and real-profile resolution.
- Core, Brain, CLI, and Site typechecks: pass; Site reports 353 files with zero
  errors, warnings, or hints. Agent Catalog specification: pass.
- Root production build: pass, including 27/27 cognitive graphs, Agent Monitor
  69/69, security and ownership guards, Site server build, and included contract
  suites. Architecture guardrail remains at zero violations.
- `./bin/audit check`, maintained-source dry run (1,587 maintained files and
  1,320 code files), and `git diff --check`: pass. The audit retains only the
  existing large tracked training-corpus warning.
- No live profile inbox was processed because that would create and archive
  private runtime memory. Real scheduled admission and profile mutation remain
  unverified; the current installation still has no Ingestor trigger entry.

## Inner Curiosity Canonical-Owner Repair - 2026-08-28

Scope and surviving owners:

- `brain/agents/inner-curiosity` remains the distinct finite owner for private,
  self-directed question generation and answering. Curiosity Service remains
  the user-question owner, and Curiosity Researcher remains the independent
  research owner; none of the three were merged.
- Trigger Manager and Work Coordinator remain the only scheduled admission and
  execution owners. Their configured hourly Semi-mode schedule is unchanged.
- Core's bounded curiosity sampler now serves both the Curiosity graph and Inner
  Curiosity. The existing Inner Buffer graph remains the only Q&A persistence
  path and Core Memory Capture remains the durable event owner.

Repair and consolidation:

- Replaced the agent's full episodic-memory scan and the Curiosity graph's
  duplicate weighted sampler with one bounded, profile-scoped Core sampler. It
  validates limits, rejects oversized or malformed records, excludes generated
  inner content, bounds prompt content, and reports sampling diagnostics.
- Unified CLI, Agent Runtime, and mobile execution behind one typed contract
  that resolves a real profile identity, propagates failures, distinguishes
  disabled/no-memory skips from generated work, and honors cancellation before
  persistence. Removed the no-op `singleUser` option and conflicting 20-minute
  module interval.
- Added stable coordinator execution identity to process and mobile contexts.
  Prepared per-profile execution receipts preserve exact Q&A across a partial
  persistence failure; retries reuse that receipt and pass the same producer
  idempotency key and timestamp through the existing Inner Buffer and Memory
  owners. Completed receipts are bounded without deleting pending retries.

Validation:

- Focused Inner Curiosity, bounded sampling, and real Inner Buffer/memory
  idempotency suites pass (11/11 assertions), covering success, skips,
  model/index failures, partial persistence, retry, repeated invocation,
  limits, malformed and oversized records, cancellation, strict options, and
  identity failure. Curiosity Service (3/3), Agent Catalog, Trigger Manager,
  and Core Memory idempotency regressions pass.
- Core, Brain, and Agent Runtime typechecks pass. Root production build passes,
  including Site diagnostics for 353 files with zero issues, 27/27 cognitive
  graphs, Agent Monitor 69/69, security and ownership contracts, and Site
  server/client output. Architecture remains at zero violations; audit check
  reports only the existing tracked training-corpus size warning.
- No live model-backed Inner Curiosity cycle was run because it would spend
  backend inference and write private profile state and memory. Real scheduled
  admission, model quality, and profile mutation remain unverified.

## Memory Pruner Retirement - 2026-08-28

Root cause and surviving owners:

- The Memory Pruner was dormant destructive code, not a functioning scheduled
  system. It had no Trigger Manager registration, no recorded runs, no agent
  logs, and no local `_pruned` output. Its Memory Controls action could not run
  through the current coordinator path because the agent was unregistered and
  its CLI required a username the control did not supply.
- Core Memory Capture remains the canonical durable memory writer, the existing
  memory inventory remains the Persona Memory read owner, and the vector index
  remains a search accelerator. No replacement pruner, queue, scheduler, store,
  archive, or fallback was introduced.
- The separate targeted memory-corruption repair utility and backup-retention
  policy remain in their existing owners; neither performs heuristic memory
  deduplication and neither was changed by this retirement.

Removal and consolidation:

- Deleted the three-file `brain/agents/memory-pruner` implementation and removed
  its Agent Catalog definition and registerable-agent expectation.
- Removed its launch/settings card, unused launch arguments and component event
  wiring, the Persona Memory `Pruned` tab, and the `pruned` API inventory branch.
- Removed active documentation claims and regenerated the maintained-source
  inventory through its canonical generator. No profile memory was deleted or
  moved.

Validation:

- Memory inventory and Agent Catalog focused specifications pass. Core, Brain,
  and Site typechecks pass; Site reports 353 files with zero diagnostics.
- The root production build passes, including 27/27 cognitive graphs and 69/69
  Agent Monitor checks. Architecture remains at zero violations.
- `./bin/audit check` passes with only the existing tracked training-corpus size
  warning. Final operational-reference searches find no Memory Pruner source,
  configuration, registration, launch control, API field, or UI tab.
- No live profile mutation was run because retirement required no runtime memory
  changes. Live behavior is therefore unmodified rather than exercised.

## Memory Sync Agent Retirement - 2026-08-29

Root cause and surviving owner:

- `brain/agents/memory-sync` was a registered but unused competing agent. It had
  zero recorded runs, no agent logs or process, and no configured sync server in
  the current profiles. Its outbound route did not exist in the current router,
  and its direct filesystem scan/write path did not support Core's current dated
  and categorized memory layout.
- `brain/agents/profile-sync` remains the finite synchronization coordinator
  used by login and Sync Manager. This retirement did not create a replacement
  queue, scheduler, store, transport, or fallback.
- The maintained browser offline-memory queue and Core `/api/memory/sync/*`
  handlers remain because they have separate current callers. Their eventual
  consolidation with Profile Sync is a distinct scoped repair, not part of this
  agent retirement.

Removal and consolidation:

- Deleted the three-file `brain/agents/memory-sync` implementation and removed
  its Trigger Manager registration, Agent Catalog definition, registered-count
  expectation, and active agent documentation.
- Preserved the registered `profile-sync` path and all of its UI/login callers.
  No profile memory, sync credentials, runtime state, or external server data was
  written, moved, or deleted by this retirement.

Validation:

- Agent Catalog and Trigger Manager focused contracts pass. Core and Brain
  typechecks pass. The CLI Agent Catalog lists `profile-sync` and no longer lists
  the retired Memory Sync agent.
- The root production build passes, including Site diagnostics for 353 files
  with zero issues, 27/27 cognitive graphs, and 69/69 Agent Monitor checks.
  Architecture remains at zero violations.
- `./bin/audit check` passes with only the existing tracked training-corpus size
  warning. No live synchronization was attempted because no server is configured
  and a live run could mutate private profile or remote data.

## Profile Sync Canonical-Owner Repair - 2026-08-29

Root cause and surviving owners:

- The registered Profile Sync agent was the intended finite coordinator, but
  profile bundle validation, credential/config persistence, and memory transfer
  were duplicated across Brain, Core API handlers, a large browser executor,
  login bootstrap, and an IndexedDB credential store. The old Core importer
  accepted a traversal path, wrote outside the selected profile, and still
  returned success.
- `brain/agents/profile-sync` remains the only finite synchronization
  coordinator. Core now owns the bounded profile bundle, per-profile sync
  configuration, syncable credential mapping, storage, and memory-capture
  contracts. Trigger Manager and Unified Queue remain the admission and task
  lifecycle owners; Astro routes and Site code are transport and UI adapters.
- The separate browser offline-memory queue remains because it buffers current
  offline writes and has distinct maintained callers. This repair did not add a
  queue, scheduler, store, execution path, compatibility shim, or fallback.

Repair and consolidation:

- Added strict version, identity, path, root, format, JSON/base64, duplicate,
  file-size, file-count, and aggregate-size validation. Imports now return one
  explicit outcome per file and fail the job on a partial write. Storage writes
  are atomic and encrypted deletes remove their actual persisted representation.
- Replaced fabricated owner contexts and global sync state with real profile
  resolution, strict options, abortable bounded remote requests, stable memory
  idempotency, explicit page and capture outcomes, and checkpoints written only
  after all enabled phases complete. A bounded historical pull no longer
  advances the complete incremental-memory cursor.
- Routed CLI, Agent Runtime, mobile, login, and Sync Manager through the finite
  coordinator or the same Core import contract. Removed the browser-side sync
  executor, IndexedDB password/credential replica, Profile Manager component,
  global state poller, legacy export/metadata/task/change routes, obsolete
  options, duplicate parsing, and unsupported sync controls. Sync configuration
  now has one authenticated per-profile API and never returns its password.

Validation:

- Focused Profile Sync, API transport, Agent Catalog, and Trigger Manager suites
  pass (18/18), covering traversal, malformed/duplicate/unsupported/oversized
  input, per-file partial failure, configuration and credential failure,
  pagination, retry/deduplication, repeated invocation, cancellation, and
  checkpoint behavior.
- Core, Brain, and Site typechecks pass; Site reports 349 files with zero
  diagnostics. The root production build passes, including 27/27 cognitive
  graphs, 69/69 Agent Monitor checks, security 14/14, ownership contracts, and
  server/client output.
- Architecture remains at zero violations; the user-agnostic guard, maintained
  source dry run (1,575 maintained files and 1,308 code files), `git diff
  --check`, and `./bin/audit check` pass. The audit retains only the existing
  tracked training-corpus size warning.
- No live remote synchronization was run because no agent-readable server is
  configured and doing so could mutate private local and remote profile data.
  Remote authentication, network transfer, and live profile effects therefore
  remain unverified.

## Conversation Summarizer Retirement - 2026-08-29

Scope and owner decision:

- Retired `brain/agents/summarizer` after source, catalog, Trigger Manager,
  interface, storage, graph, test, documentation, and local-runtime inspection
  agreed that it was unscheduled and no maintained prompt path consumed its
  periodic output.
- Preserved the canonical Conversation, Inner, System, and Robot buffers and the
  Robot Status workflow. Preserved the separate `summarizer` model role because
  Specialist Broker still owns explicit on-demand text summarization.

Implementation:

- Deleted the Summarizer CLI, runtime module, Core summary-state store, summary
  read/trigger APIs, and their Astro adapters. Removed its Agent Catalog definition and
  replaced Summarizer-specific catalog/Trigger Manager fixtures with generic
  surviving-agent coverage.
- Removed the unconsumed context-package summary lookup/cache, Conversation
  Buffer summary marker fields and writer, summary graph-node branch/schema,
  unused Persona Chat summary metadata, public exports, focused obsolete tests,
  and current documentation claims.
- At that time, kept `conversation-buffer-admission.json` as the admission graph
  for ordinary conversation entries. The 2026-09-02 Conversation Graph Buffer
  Ownership Repair below supersedes that decision. Historical runtime summaries
  and state were not modified.

Validation:

- Agent Catalog, Trigger Manager, buffer ownership, and Conversation Buffer
  focused suites pass. Core, Brain, and Site typechecks pass; Site reports 347
  files with zero diagnostics.
- All 27 cognitive graphs and node defaults pass. Architecture remains at zero
  violations; `./bin/audit check`, the user-agnostic guard, maintained-source dry
  run (1,568 maintained files and 1,301 code files), and the production build
  pass. The audit retains only the existing tracked training-corpus size warning.
- Final maintained-source reference search retains only the shared on-demand
  model role and historical audit evidence; no agent, route, state, buffer-marker,
  execution, or scheduling reference remains. No live runtime was restarted, so
  post-restart UI absence remains unverified.

## Conversation Graph Buffer Ownership Repair - 2026-09-02

Scope and owner decision:

- Kept `packages/core/src/conversation-buffer.ts` as the rolling storage owner
  and `conversation_buffer` as its sole graph writer node. Multiple graph
  instances are intentional; multiple writer implementations are not. Inner
  Dialogue remains a separate sister system with its own writer and saver.
- Made each outward conversational graph own its Conversation Buffer instance.
  Interactive graphs connect user input and response, while Curiosity and
  Boredom Autonomy connect response only. Reflector remains an Inner Dialogue
  workflow and does not write Conversation Buffer.
- Preserved Inner, System, and Robot buffers as separate feeds with distinct
  roles. `display_buffer` remains read-only and `memory_capture` remains the
  downstream long-term Persona Memory saver.

Implementation:

- Deleted `conversation-buffer-admission.json`, Persona Chat pre-admission, the
  `userMessageAdmitted` suppression flag, the public append route, and the
  conversation/Agency admission wrappers.
- Removed hidden request-context and conversation-history fallbacks from
  `conversation_buffer`; persistence now comes only from explicit graph edges.
- Routed Environment continuations through a distinct fresh-player-text output,
  preventing task feedback and reused objectives from becoming user messages.
- Routed conversational TTS from the exact response returned after Conversation
  Buffer persistence. Inner TTS and Inner Dialogue workflows were kept on their
  separate `inner_dialogue_buffer` and `inner_dialogue_saver` path.
- Reclassified non-graph Agency lifecycle notices as System Buffer events rather
  than fabricating conversational turns.

## Update Ownership Repair - 2026-08-30

Scope and owner decision:

- Confirmed that `brain/agents/update-check` was retired in July 2026 and had
  no maintained entrypoint, registration, scheduler, process, or UI caller. Its
  remaining empty directory and stale local state were not an active update
  system.
- Kept updates as explicit Installation Owner actions. Mobile release metadata
  and binaries now have one Core-owned store under `out/releases/mobile`; the
  React Native release script is its only producer. Server source updates remain
  behind the owner-guarded Core server-update handler.

Implementation:

- Removed the retired update-state handler and route, the obsolete
  `/api/app-version` route, the empty legacy agent directory, and stale local
  update state. Profile Sync and Sync Status no longer contain a competing update
  checker, installer, polling loop, or update modal.
- Repaired `/api/mobile/version` and `/api/mobile/download` to use strict release
  metadata, explicit status failures, exact-version downloads, file-size checks,
  and the configured remote installation. The existing APK was moved into the
  canonical ignored release store with its actual size and SHA-256 checksum.
- Hardened server updating to use argument-safe process execution, require a
  checked-out branch and upstream, reject concurrent runs, preserve fetch,
  install, and build failures, and complete a production build before reporting
  success. Restart remains a separate explicit owner action.
- Consolidated update presentation in `UpdateManager.svelte`; mobile installation
  uses the maintained native URL-opening bridge instead of the unimplemented
  `download-update` message path.

Validation:

- The focused mobile-release, app-info, server-update, and update-ownership suite
  passes (10/10), including malformed and missing metadata, invalid and unavailable
  versions, size mismatch, fetch/install/build failure, dirty-tree and diverged-
  branch refusal, and concurrent invocation.
- Core, Site, and Mobile typechecks pass; Site reports 345 files with zero
  diagnostics. The root production build passes, including 28/28 cognitive
  graphs, 69/69 Agent Monitor checks, security 14/14, ownership contracts, and
  server/client output.
- Architecture remains at zero violations; `./bin/audit check`, the maintained
  source dry run (1,554 maintained files and 1,287 code files), shell syntax,
  and `git diff --check` pass. The audit retains only the existing tracked
  training-corpus size warning.
- No real Git fetch/pull, process restart, remote mobile download, or Android
  package installation was performed. Those external and device effects remain
  unverified. The shared binary-response transport still buffers file bodies;
  streaming large release downloads requires a separately approved public
  transport-contract change.

## Brain Dependency Consolidation - 2026-08-30

Scope and owner decision:

- Audited every direct `@metahuman/brain` dependency against maintained imports,
  operational entrypoints, the workspace runtime contract, and the npm registry.
  No declared package was orphaned, but the maintained training owners used
  three packages solely for behavior already provided by Node 22.
- Preserved the existing training and Environment Bridge owners. No replacement
  loader, HTTP client, filesystem utility, scheduler, or execution path was
  introduced.

Implementation:

- Replaced `dotenv`, `node-fetch`, and `fs-extra` usage in Brain training with
  guarded `process.loadEnvFile`, global `fetch`, and recursive `node:fs`
  directory creation. Removed those three dependencies plus
  `@types/node-fetch` and `@types/fs-extra` from the Brain package.
- Updated shared direct declarations to `ws` 8.21.3 and `tsx` 4.23.13 across
  their workspace owners, updated Core's retained `fs-extra` to 11.4.0, and
  aligned root, Brain, and Local Model Service Node declarations to the latest
  Node 22 type line. TypeScript remains on the validated 5.9 line; TypeScript 7
  is a separate major migration rather than a dependency refresh.

Validation:

- Brain, Core, CLI, Local Model Service, and Site typechecks pass. All 16 focused
  Environment Bridge tests pass with the updated WebSocket client.
- The root production build passes, including 28/28 cognitive graphs, 69/69
  Agent Monitor checks, security 14/14, ownership contracts, and server/client
  output. Architecture remains at zero violations.
- The Brain dependency list contains only the two workspace packages, `ws`,
  Node/WebSocket types, `tsx`, and TypeScript. Final registry comparison retains
  only the intentional Node 22 and TypeScript 5.9 major-version constraints.
- No local GPU training, remote RunPod job, model registration, or adapter load
  was performed; those external effects remain unverified.

## Brain Mobile Entrypoint Consolidation - 2026-08-31

Scope and owner decision:

- Preserved Core's Work Coordinator as the sole queue/execution owner and Brain's
  two root mobile files as the React Native registration and bundle entrypoints.
  `brain/package.json` remains the Brain package boundary; its existing
  `tsconfig.json` requires no competing mobile configuration.
- Replaced per-agent mobile wrappers with one adapter over each maintained
  `AgentModule.run()` contract. The authenticated queue task remains the sole
  profile identity; Sleep Workflow no longer duplicates that identity in CLI
  arguments.

Implementation:

- Mobile now forwards task arguments, structured options, cancellation, and
  stable task identity to the canonical agent modules, resolves real profiles,
  and propagates unsuccessful agent results to the coordinator.
- React Native initializes registrations from validated session cookies before
  authenticated API work, serializes repeated/profile-switch transitions, stops
  on logout or pause, and restores the last authenticated profile on resume.
  The unused WebView `agent-init`/`agent-stop` path and individual wrapper exports
  were removed.
- Narrowed the Brain bundle surface to the three runtime exports actually used:
  agent initialize/stop and local-model startup. Curiosity Service now resolves
  its real profile and propagates graph cancellation through its canonical
  Agent Runtime adapter.

Validation:

- Focused mobile adapter, lifecycle, Curiosity Service, and Sleep Workflow tests
  pass. Brain, Core, and React Native typechecks pass.
- The mobile backend bundle builds successfully; the agent handler bundle is
  5,960.7 KiB, down from the previously generated 7,043 KiB bundle. Architecture
  and user-agnostic guards, `./bin/audit check`, JavaScript syntax checks, stale-
  reference searches, and `git diff --check` pass. The audit retains only the
  existing tracked training-corpus size warning.
- No Android APK or physical-device lifecycle run was performed; device pause,
  resume, logout, and queued-agent execution remain unverified outside source and
  generated-bundle validation.

## Deployment Documentation Consolidation - 2026-08-31

Scope and owner decision:

- Made `docs/user-guide/configuration-admin/deployment.md` the sole current
  deployment and remote-access documentation owner. Preserved the existing
  locally managed named-tunnel implementation in `start.sh`, Core, and the
  Network UI without adding another process manager or deployment path.

Implementation:

- Replaced development-server, manual session-patch, unauthenticated status,
  systemd, stale pricing, and hypothetical Cloudflare Pages instructions with
  the built `./start.sh` lifecycle, explicit local-tunnel ownership, current
  external documentation links, sharing policy, and layered verification.
- Deleted the duplicate `docs/deployment` guides, including the previously
  removed RunPod provider/fallback proposal, redirected maintained references,
  aligned guest-session documentation with the passwordless auth-gate route,
  and repaired the Network settings documentation link and startup labels.

Validation:

- Local Markdown links pass for all touched current guides. Maintained-source
  searches find no references to the removed deployment paths or their broken
  Cloudflare Pages and placeholder GitHub links.
- `pnpm validate:security-routes` passes 14/14 checks,
  `pnpm check:architecture` reports zero violations, Site typecheck reports zero
  diagnostics, and full-worktree `git diff --check` passes.
- No tunnel, Cloudflare Access policy, external browser session, or remote
  deployment was started; those runtime and external effects remain unverified.

## Audit Documentation Authority Consolidation - 2026-08-31

Scope and owner decision:

- Kept `docs/audits` as the current remote-safe evidence layer required by the
  maintained audit protocol. Kept this chronological ledger and the generated
  maintained-source inventories as the current repository-wide authorities.
- Kept the TTS and Robot Operator motion-control ledgers as the only active
  focused work records in this directory. Their status now separates current
  source ownership from unverified live, external, and physical behavior.

Implementation:

- Moved sixteen completed point-in-time reports to `docs/archive/audits`, where
  they remain historical evidence but no longer compete with current authority.
- Deleted the obsolete batch-count summary and Core/Brain boundary snapshot;
  both were superseded by this ledger, the generated inventory, the zero-
  violation architecture baseline, and repaired source ownership.
- Replaced the five-line audit README with a narrow current-authority index,
  updated surviving inbound links, and sanitized machine-specific paths and
  saved profile details from the two active evidence ledgers.

Validation:

- Maintained-source inventory regeneration and dry-run agree on 1,569
  maintained files and 1,326 code files.
- Stale-path and active-audit privacy searches pass; all sixteen archived
  reports are visible to Git and excluded from the maintained-source policy.
- TTS node ownership passes, all six durable-delivery tests pass, and all eight
  local/robot output-routing tests pass.
- `pnpm check:architecture` and `./bin/audit check` report zero architecture
  violations. The audit retains only the existing tracked training-corpus size
  warning. Full-worktree `git diff --check` passes.
- No browser audio, provider service, Environment Bridge speech dispatch, robot
  speaker, camera, or physical motion was exercised during this documentation
  consolidation.

## Technical Documentation Authority Repair - 2026-08-31

Scope and owner decision:

- Kept `MAINTAINED_SURFACE.md`, `AUDIT_PROTOCOL.md`, and the architecture
  baseline as the executable repository-policy owners. Kept `ARCHITECTURE.md`
  and `REFACTOR_BLUEPRINT.md` as the concise ownership and refactor-protocol
  documents, and kept the Environment performance ledger as dated technical
  evidence rather than current runtime proof.

Implementation:

- Corrected persistent-process, agent-runtime, Brain, and graph-composition
  ownership wording. Reframed the completed refactor date as the initial
  repository baseline while keeping the protocol active for later owner work.
- Reconciled the maintained-surface review date and documented why tracked root
  governance is excluded from executable source scanning. Folded the unique Big
  Brother lifecycle invariants into that authority and deleted the unlinked
  duplicate session document.
- Reconciled Environment Mode's current section with the 24-node, 58-edge graph,
  the Robot Status context input, the surviving model role, and explicit
  runtime/bridge/physical proof boundaries. Preserved dated measurements and
  relabeled the cumulative validation record as historical evidence.
- Moved Terms of Service and Ethical Use Policy from technical architecture into
  served User Guide appendix chapters. Replaced the inaccurate local-only data
  promise and unsupported centralized-enforcement claims with the repository's
  actual local-first, optional-remote-provider, operator-controlled contract.
  The new chapter IDs satisfy the existing AuthGate hashes without modifying
  that concurrently edited component.

Validation:

- The actual User Guide handlers return both policy chapters under
  `21-terms-of-service` and `22-ethical-use-policy`; the guide lists 32 chapters.
  All touched local Markdown source links resolve.
- Maintained-source dry run reports 1,568 maintained files and 1,326 code files.
  All 28 cognitive graphs validate and the live Environment graph count matches
  the repaired ledger.
- `pnpm check:architecture` and `./bin/audit check` report zero architecture
  violations. The audit retains only the existing tracked training-corpus size
  warning. Full-worktree `git diff --check` passes.
- No browser navigation, configured remote provider, rebuilt server, Environment
  Bridge, or physical robot was exercised. The policy text was reconciled with
  source behavior but was not reviewed as legal advice.

## Implementation-Plan Authority Cleanup - 2026-09-01

Scope and owner decision:

- Kept one active Robot Active Operator product roadmap. Current architecture
  and validation ownership remains in the tracked technical authorities, live
  manifests, executable graphs, and canonical runtime owners.
- Treated completed implementation records as history rather than current
  authorization. The local `docs/archive` tree remains excluded from maintained
  source and repository tracking by policy.

Implementation:

- Replaced the 1,027-line Robot Active Operator implementation authority with a
  lean roadmap that names current owners, separates source/runtime/external/
  physical evidence, and removes stale pre-authorization language and retired
  graph/node claims.
- Moved six completed or superseded records into the ignored local
  `docs/archive/plans-and-migrations` history area. Their tracked source paths
  are deleted, and their prior contents remain recoverable through Git history.
- Deleted the contradictory Vision Model implementation plan after recording
  its valid invariant in the maintained architecture and User Guide: image input
  uses the normal model/backend/provider path rather than a parallel vision
  backend, with explicit capability failure at the final provider path.
- Replaced the User Guide's completed Work Coordinator plan link with current
  architecture authorities and documented the live Environment Bridge
  configuration/status boundary.
- Refreshed the generated maintained-source inventories to 1,561 files and
  1,326 code files.

Validation:

- Touched Markdown links resolve and final active-source searches find no stale
  references to the seven retired plan paths, deleted Vision owner, or stale
  Robot Operator authority language.
- All 28 cognitive graphs validate. Focused multimodal provider checks pass,
  and Agent Monitor validation passes 69/69 checks, including Environment Bridge
  lifecycle, configuration, status, and singleton ownership.
- `pnpm check:architecture` and `./bin/audit check` report zero architecture
  violations. The audit retains only the existing tracked training-corpus size
  warning.
- No application server, external adapter, model server, or physical robot was
  exercised during this documentation cleanup.

## Desire Planner Graph and Admission Repair - 2026-09-02

Scope and owner decision:

- Kept `brain/agents/desire-planner` and its planner/reviewer graphs as the one
  finite planning owner. Kept the Work Coordinator as the admission and retry
  owner for Sleep, CLI, mobile, and Site-triggered work.
- Confirmed the prior Site handler was a competing inline model, parsing,
  storage, and review path. Confirmed the reviewer graph's conditional router
  did not provide executable branch selection, so its reject, approve, and
  skill-approval nodes could run as independent paths.

Implementation:

- Rewired both graphs exclusively through registered named handles and added
  them to strict graph contract validation. Planning now requires canonical
  tool, policy, semantic-memory, plan-validation, and durable-update receipts.
- Added one profile-scoped plan-review transition that records the validated
  review and applies exactly one manifest status: rejected, approved, or
  awaiting user approval. It does not create a second skill-approval queue.
- Resolved account identity separately from profile identity, made policy and
  semantic-search failures visible, enabled real skill/trust/plan validation,
  and required durable plan, reflection, Persona Memory, and review-transition
  receipts before the agent reports success.
- Routed manual Site generation through one targeted, idempotent Work
  Coordinator submission. Removed the inline planning/review implementation,
  its standalone review route, the unused Desire Conversation Loader, and the
  obsolete Desire Approval Queue node.
- Updated the Agent and Agency user documentation to describe the maintained
  path and removed raw model-stream presentation state from the dashboard.

Validation:

- Focused Desire Planner, plan validator, review transition, and coordinator
  submission tests pass (4 test files). Core, Brain, Site, and scripts type
  checks pass.
- All 27 cognitive graphs validate, including strict registered-node contracts
  for Desire Planner and Desire Reviewer. Architecture and user-agnostic
  guardrails pass with zero architecture violations. Node defaults validation
  passes; its optional event-bus connection logged a sandbox `EPERM`.
- `./bin/audit check` passes its architecture checks and retains only the
  existing tracked environment-action-selector corpus size warning.
- No live model backend, Work Coordinator process, browser session, external
  provider, or physical system was exercised; validation covers source,
  contracts, and isolated behavior only.

### Desire Reviewer completion follow-up - 2026-09-02

Root cause and owner decision:

- The reviewer graph was structurally connected, but its single-entry Inner
  Dialogue Buffer result omitted `savedCount`, so the agent rejected a
  successful write. A failure after review-file or memory persistence also left
  a desire in `reviewing` with no resumable exact-decision contract.
- Generic advance/reset controls and the approval handler could move an
  unreviewed desire directly into reviewer-owned or approved states. Plan risk
  could also understate a step, and execution did not reject an auto-approved
  step marked as requiring explicit approval.
- Kept `brain/agents/desire-planner` as the finite planning/review owner,
  `desire-reviewer.json` as its only editable review workflow, Core Agency
  storage/lifecycle services as the durable owner, and the Work Coordinator as
  admission owner. No second queue, reviewer, or scheduler was added.

Implementation:

- Added complete single-entry buffer receipts. The reviewer now persists one
  immutable, plan-versioned review receipt before buffer and Persona Memory
  effects, then records a real idempotent scratchpad entry before the final
  manifest transition. A retry resumes `reviewing`, reloads the persisted
  desire, reuses the exact receipt when present, and does not reload the planner
  graph.
- Wired Persona Formatter output into one `personaContext` contract and wired
  the Policy Loader trust level into the verdict, removing the second identity
  policy read. Review IDs now include the plan version.
- Moved explicit user approval behind a Core Agency transition that requires
  `awaiting_approval` plus an exact plan-version review, records approval,
  updates metrics/stage counts, and persists the correct current stage. Removed
  UI fast-approve/review-status approval and prohibited generic advance/reset
  into `reviewing`, `approved`, or `executing`.
- Enforced aggregate plan risk at validation and execution, made critical plan
  steps approval-bearing by default, and reject execution when an explicitly
  approval-bearing step was auto-approved. Removed the unused root-level legacy
  review save/load surface; plan and outcome reviews now share the canonical
  per-desire review folder functions.

Validation:

- Seven focused test files pass: Desire Planner graph contracts, plan-review
  recording/transition, lifecycle policy, user approval transition, plan
  validation, execution admission, and Inner Dialogue idempotency/receipts.
- All 27 cognitive graphs pass schema and registered-node handle validation;
  graph-executor coverage passes for all 267 configured nodes.
- Site, scripts, and tests typechecks pass. Core and Brain typechecks are blocked
  only by a concurrent Environment context-builder spec syntax error, removed
  Environment task types, and stale selector training fields; no reviewer/Agency
  type errors remain in their output.
- Node-default, user-agnostic, architecture, and audit guardrails pass. The
  audit retains the existing large tracked Environment training corpus warning.
  Maintained-source inventories were regenerated at 1,595 maintained files and
  1,365 code files. `git diff --check` passes.
- No live model, Work Coordinator process, browser interaction, external
  provider, or physical system was exercised.

## Environment Input and Robot Status Lifecycle Consolidation - 2026-09-02

Scope and owner decision:

- Kept Environment Bridge Input limited to adapter-delivered observation data.
  Work Coordinator action context and Robot Operator handoff context now enter
  maintained Environment workflows through their own input nodes.
- Kept the existing Environment Action Selector as the single semantic LLM
  decision owner. The refactor adds no command policy, second router, or second
  model decision.

Implementation:

- Kept feedback correlation and frame selection in explicit single-purpose
  Environment nodes. Added `robot_status_out` as the non-LLM output owner that
  atomically stores the selector's task decision, selected or completed action,
  and correlated result in the canonical profile Robot Status snapshot.
- Sanitized bridge observations at the canonical interface boundary and carried
  coordinator/operator context separately through queue execution.
- Removed the superseded Environment Task State, Environment Task Input,
  Environment Task Preparation, Environment Task Reducer, and lifecycle helper,
  together with their wiring, exports, schemas, serialization, and stale tests.
  Removed the redundant Instruction Resolver pass-through from Boredom Autonomy
  and wired its dedicated Robot Operator input directly to the selector context.
- Rewired Environment Mode and Boredom Autonomy to read Robot Status before the
  selector and update it after Bridge Out. The selector remains the sole semantic
  owner; Robot Status Out does not call a model or choose an action.

Validation:

- All 27 cognitive graphs validate. The focused Environment, Robot Operator,
  Robot Status, bridge, and conversation owner suite passes 42 tests; the graph
  and Freestyle suite passes 4 tests; selector corpus/regression validation
  passes 2 test files.
- The full monorepo typecheck, node-default validation, architecture and
  user-agnostic guardrails, final maintained-source reference searches, and
  `git diff --check` pass. The full root `pnpm build` chain also passes.
- No live model backend, Environment adapter, or physical robot was exercised;
  validation covers source, graph contracts, and isolated behavior only.

## Robot Task Result and Goal Review Lifecycle - 2026-09-02

Scope and ownership:

- Kept Environment Mode and Robot Autonomy Executor as the LLM-owned action
  selectors. Each dispatches at most one action and ends.
- Added one Robot Action Result graph that interprets the later correlated
  terminal result with an LLM and writes the decision to canonical Robot Status.
  It cannot dispatch another action.
- Added one separately scheduled Robot Goal Review graph. It reads Robot Status,
  uses one LLM call to close, wait, request user input, or author one high-level
  next instruction, and can delegate only that instruction to the existing Robot
  Autonomy Executor.
- Robot Operator remains the only scheduler. Reactive admits no timed review;
  Semi uses the configured review idle timer; Full waits for the current
  execution/result chain before reviewing an unfinished objective again.

Consolidation:

- Removed the Environment and Robot Autonomy self-feedback routes that caused
  completed actions to re-enter the same selector graph.
- Kept correlation metadata for result routing, but moved continuation state to
  Robot Status. No step limit, command-specific rule, fallback router, or
  conditional graph-execution system was added.

Validation:

- Root typecheck passed across Core, Brain, CLI, Agent Runtime, local model
  service, scripts, tests, mobile, and Site.
- All 28 graphs passed schema validation, including strict registered-node
  contracts for the two new graphs. The focused Robot Operator, Robot Status,
  Environment Bridge, buffer, TTS, and action-selector suites passed.
- Agent Monitor, node defaults, architecture, and user-agnostic guards passed.
  The combined `pnpm validate` run encountered a sandbox `spawnSync git EPERM`
  at the user-agnostic stage; that guard and the remaining terminal and Big
  Brother checks passed when rerun separately.
- `git diff --check` passed. The running production Site and Robot Operator were
  not rebuilt or restarted, and no live adapter or physical action was tested.
- After those passes, an unrelated concurrent conditional-scheduler project
  changed the shared graph schema and added an unfinished Graph Executor spec.
  In the current combined worktree, graph validation now requires that project's
  not-yet-migrated scheduler metadata and Core typecheck sees its unmatched
  `skipReason` assertion. This lifecycle change did not modify or accommodate
  those concurrent files.

## Environment Intent Routing and Current-Vision Admission - 2026-09-03

Root cause and ownership:

- Interactive Environment Mode had no early intent owner, so context and side
  effect nodes were reached without a single explicit route decision. Saved
  bridge images also lacked provenance that distinguished them from the exact
  observation that triggered a run.
- Restored the shared `orchestrator_llm` as a route-only Environment instance.
  It returns seven independent booleans and cannot rewrite the user input,
  answer, select a robot command, or plan movement. The existing
  `environmentActionSelector` role remains the sole semantic response/action
  owner and still resolves through profile model settings.

Consolidation:

- Environment Mode conditionally admits dialogue history, memory, Robot Status,
  bridge data, and current camera evidence from the orchestrator decision.
  Robot-originated turns can reuse their triggering observation; typed chat can
  use saved capabilities but cannot present a saved frame as current. When
  current vision is absent, the Action Selector may choose the advertised
  `captureImage` action.
- Environment Bridge Out now transports actions and reports transport facts
  only. Removed its conversation rewriting and background familiarity-search
  responsibilities, the orphan familiarity output, duplicate result/feedback
  inputs, empty map input, legacy Environment Chat output, debug viewer, and
  redundant Thinking Stripper from the interactive graph.
- Valid action-only turns now complete without creating an empty assistant
  message or emitting `Graph executed but produced no response`. Movement
  Generator and Environment Bridge Out are inactive when the selector chooses
  no action.

Validation:

- Eight focused Environment, Robot Operator, bridge, parser, context, and graph
  test files pass. Core and Site typechecks pass; all 40 graphs validate; all 323
  configured graph nodes have executors; node defaults and the zero-violation
  architecture guard pass. The complete root `pnpm build` chain passes, including
  workspace typechecks, repository tests and validators, and the production Site
  build. Live model routing, browser display, bridge delivery, returned image
  analysis, and physical robot behavior remain separate runtime evidence.

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
3. Audit oversized UI/client files after route owners are clear: `ChatInterface.svelte`, `AgencyDashboard.svelte`, `useMicrophone.ts`, `CenterContent.svelte`, `TrainingWizard.svelte`, `VoiceTrainingWidget.svelte`, `AuthGate.svelte`, `ProfileLocation.svelte`, and `SecuritySettings.svelte`.

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
