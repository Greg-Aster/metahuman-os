# Factory Reset control review — 2026-09-09

The findings below record the pre-repair baseline. The implementation section at
the end records the subsequent authorized repair and its verification.

The existing **Security & Account Settings → Factory Reset** control does not
work as wired. Its backend also cannot currently provide an isolated, complete
profile memory reset. Correcting the button alone would expose destructive scope
errors. This was a diagnostic review; no production implementation or real
profile data was changed.

## Entrypoint and request contract

Owner group: `apps/site/src/components/SecuritySettings.svelte`,
`apps/site/src/pages/api/reset-factory.ts`, and
`packages/core/src/api/router.ts`.

- The settings component is reachable through `CenterContent.svelte` and presents
  an owner-only Factory Reset button. It is not orphan UI.
- At `SecuritySettings.svelte:544`, the button posts to `/api/factory-reset` with
  no body. The actual Astro route and shared router registration at
  `router.ts:1004` expose `/api/reset-factory`. There is no registration for the
  button's address.
- `reset-factory.ts:59–70` in the Core handler also requires an explicit
  `confirmToken`. The browser confirmation dialog does not supply this token.
  Fixing only the URL would therefore still return HTTP 400.
- The installed client bundle contains the same incorrect URL and no confirmation
  token. The installed server manifest contains only the registered spelling.
- Disposition: repair the existing control and request contract together, after
  resolving the deletion scope below; keep the thin Astro transport.

## Deletion owner and scope

Owner: `packages/core/src/api/handlers/reset-factory.ts`.

- At lines 74–77, the handler selects the authenticated user's profile, the
  **system-wide** logs directory, and that profile's `out/chat` archive. It does
  not accept a separate target profile.
- At lines 98–100, it recursively empties those directories, preserving only
  `README.md` and `schema.json` directly under memory. This includes tasks and
  other data stored within the profile memory tree, not just conversational
  memories.
- System logs include `logs/run/sessions.sqlite`, shared process receipts and
  audit records (`path-builder.ts:455–462`). Deleting this tree affects installation
  state beyond the selected profile. The handler also deletes its own just-written
  reset audit event because `audit.ts:124–127` writes into that same tree.
- The operation does not coordinate with active memory writers, admitted work or
  training. Filesystem deletion alone does not establish a clean boundary against
  later writes. Failure partway through can leave a partially deleted profile;
  the error response cannot restore preceding deletions.
- Disposition: repair this existing Core owner with an explicit profile scope,
  using the existing storage and work-lifecycle owners. Do not introduce another
  reset service or bypass the canonical handlers. Preserve shared authentication,
  process tracking and audit records.

## Data that survives and misleading UI promises

Owner group: Core reset handler, `conversation-buffer.ts`,
`durable-execution/storage.ts`, and existing training/model owners.

- Conversation and inner-dialogue buffers live in the profile's `state` directory
  (`conversation-buffer.ts:139–147`), outside every directory the handler empties.
- Durable graph checkpoints, inputs and outputs persist under
  `state/sessions/executions.sqlite` (`durable-execution/storage.ts:5–10`). The
  reset does not address those records or their recovery lifecycle.
- Profile-local logs, learned persona data, model assignments, training candidates
  under `out/adapters`, and frozen datasets under the per-user training work
  directory are also outside the deletion scope. This is a statement about the
  implementation's coverage, not a claim that a particular profile contains each
  artifact.
- The UI promises restoration of the default base model at
  `SecuritySettings.svelte:1114`. The handler never invokes model assignment or
  restores model configuration. Deleting source memories would not itself change
  a trained model's weights.
- Disposition: define the intended memory reset boundary and expose it clearly
  through this existing settings surface. A repair must account for conversation
  state and derived training data, and accurately state what happens to persona,
  tasks, model assignments and retained artifacts.

## Separate account-deletion control

`ProfileDangerZone.svelte:115–122` calls `/api/profiles/delete` with a named
profile and matching confirmation. Its Core handler delegates to
`deleteProfileComplete` (`profiles-manage.ts:131–160`). This is a separate account
deletion operation, not the requested memory reset. Its full deletion lifecycle
was not audited in this review and it was not invoked.

## Verification and limits

The real Core reset handler was invoked against a newly created temporary root
containing only synthetic sentinels. The harness asserted the canonical system
and profile paths before invocation and disconnected the test process's event
bus to prevent transmission to an installation service.

| Probe | Observed result |
| --- | --- |
| Owner request without token | HTTP 400; all sentinels retained |
| Standard-user request with token | HTTP 403 |
| Owner request with token | HTTP 200 |
| Memory, curated records, index, tasks and chat archive | Synthetic files deleted |
| Shared session file, training receipt, unrelated audit log | Synthetic files deleted |
| Reset audit event | Deleted by the same operation |
| Conversation buffers, durable-state file, profile logs, persona, model settings, candidate and frozen dataset | Synthetic files retained |
| Another profile's memory file | Retained |

The session and model sentinels were ordinary test files: this proves the handler's
filesystem scope, not the behavior of an open SQLite connection or a loaded model
after deletion. Source and installed artifacts were inspected; no running local
MetaHuman web server was found during the host process/port check, so no live
browser reset was attempted. No real reset endpoint was invoked.

A future repair needs isolated tests for profile targeting, confirmation,
preservation of shared state, complete agreed deletion scope, failures and repeated
requests, and coordination with existing producers. Browser verification must
then establish that the existing settings control reaches that repaired owner.

## Authorized repair

The existing route now implements a signed-in owner's **profile memory reset**.
It requires both the existing confirmation token and the exact authenticated
username, then revalidates the account identity. The settings component calls that
route and displays its actual failure or success result. Its controls link to the
existing sidebar and training surface. The incorrect URL, root-log wiping code,
generic error alert, and unsupported factory-model promise were removed.

Ownership remains in the existing Core handler and domain owners:

- Storage validates the entire profile-local deletion set, encryption readiness,
  canonical storage availability, symlink boundaries, overlap with other accounts,
  and path changes during deletion. It clears memory except tasks, projects and
  structural documentation, plus profile logs and conversation archives.
- The existing lock owner excludes overlapping resets, memory writes, buffer
  writes, graph admission, queue admission and training launches while reset runs.
  Work Coordinator refuses unfinished work and persists removal of only this
  profile's terminal receipts. It continues to own all admission and execution.
- The durable checkpointer validates the complete execution set and transactionally
  retires terminal checkpoints, events, blobs and dispatch records. Active leases
  and unresolved external results block deletion. Retirement uses the existing
  receipt protocol rather than unlinking an open SQLite database.
- Conversation buffers, card-response buffers and recent-tool caches are cleared.
  The recent-tool owner drains its previously accepted asynchronous writes before
  deletion. Persona Chat's process-local history is profile-scoped and cleared;
  memory capture's deduplication cache is likewise profile-scoped and invalidated.
- Speech delivery clears queued, failed and admitted text through its existing
  owner, including an existing overflow copy. Generation and interruption counters
  advance so old synthesis and playback receipts cannot revive old speech.
- Shared sessions, audit logs, process receipts and other profiles remain. Persona,
  tasks, projects, settings, model assignments and generated training artifacts
  remain as stated in the UI and user guide. Local reset does not erase external
  backups or remote sync sources.

Errors before deletion leave memory intact. Errors after deletion begins report an
incomplete operation, retain shared diagnostics, and release admission locks for an
explicit retry. This is not an all-or-nothing filesystem transaction or a secure
media-erasure operation. No automatic cancellation of uncertain physical work,
paid-provider operation, real profile reset, or new reset service was introduced.

### Repair verification

- `node --import tsx packages/core/src/api/handlers/reset-factory.spec.ts`:
  12 tests passed. These exercise real temporary profiles, encrypted and external
  storage, open/reopened SQLite history, persisted Coordinator receipts, valid
  authentication sessions, all four conversation buffers, speech generations,
  profile isolation, concurrent admission, confirmation, partial failure and retry.
  A separately held reset lock survives rejection, while the rejected request
  releases only the training lock it acquired.
- Existing focused tests for speech delivery, durable store/checkpointer, buffer
  ownership, conversation buffers, memory idempotency/enrichment, storage and locks
  passed. Work Coordinator's contract passed. Authenticated recovery passed 19
  tests and durable recovery passed 11 tests. Those two recovery suites initially
  encountered sandbox restrictions on child processes and localhost listeners;
  their unrestricted reruns passed without code or assertion changes.
- `pnpm typecheck:core` and `pnpm typecheck:site` passed; Site reported 365 files
  with zero errors, warnings or hints. Security route checks passed 14/14;
  user-path validation passed across 749 maintained runtime files; architecture
  and tracked-tree remote-safety checks reported zero violations.
- A headless browser mounted the actual styled Security Settings component and
  submitted to the actual authenticated Core HTTP router, default reset handler,
  and Work Coordinator, all pointed at a temporary synthetic installation. All
  12 checks passed: exact-name confirmation, rejection during unfinished work,
  working sidebar/training links, successful reset, retained tasks/other profiles/
  process receipts/session, removed Coordinator history, and no browser errors.
  No reset dependency was substituted in this HTTP probe. Browser evidence is
  available locally in `/tmp/metahuman-reset-ui/result.json` and
  `/tmp/metahuman-reset-ui/reset-control.png`.
- `pnpm --dir apps/site build` passed. Host inspection established that the
  installed MetaHuman Site was stopped before replacing its generated build.
  The resulting client artifact contains `/api/reset-factory`, the confirmation
  token and the new control label; it contains no `/api/factory-reset` reference.
  Vite reported mixed static/dynamic import warnings for durable storage,
  work submission and RunPod configuration; compilation completed successfully.
- Final reference review and `git diff --check` passed. Temporary browser and
  HTTP fixture processes were stopped. Existing training and concurrent
  Environment/Graph Editor changes were preserved; no commit or push was made.

This proves the repaired owners and actual component-to-HTTP path with synthetic
data. It does not claim an installed application restart, deletion of a real
profile, physical audio playback, or erasure of remote copies and model weights.
The real Ainekio profile has not been reset.

### Follow-up: expired execution ownership returned HTTP 409

A subsequent real reset attempt exposed a lifecycle case absent from the original
fixtures. Read-only inspection found a cancelled execution with a saved owner ID
whose lease had expired, while the persisted queue had no unfinished work and no
execution dispatch remained unresolved. No reset-start event was recorded.

`durable-execution/checkpointer.ts` treated any saved owner as active in reset
preflight, direct thread deletion and retention selection. The canonical store's
`assertLease` and `renew` already reject that owner once its lease expires; the
checkpointer was applying a stricter, permanent exclusion with no user-resolvable
work behind it. A synthetic cancelled writer without `release` reproduced HTTP
409 after expiry, and the existing retention path likewise refused terminal
history indefinitely.

The checkpointer now uses the existing lease-expiry rule in all three paths.
Deletion validates terminal status and lease ownership inside its immediate
SQLite transaction, then retains the existing unresolved-dispatch checks and
retirement receipt protocol. It does not clear owner fields manually, cancel
active work, or add a reset bypass. Live leases, unfinished executions and pending
or uncertain effects still block retirement.

Verification: all 13 reset tests, 22 durable-store tests and 11 recovery tests
passed, as did Core type checking, architecture/remote-safety and `git diff
--check`. The new regressions cover completed, failed and cancelled owners that
never release, refusal while their lease remains valid, failed renewal after
expiry, retirement after expiry and continued protection of unresolved effects.
A separate Site build passed along with its actual compiled runtime checker.
The initial temporary build outside the workspace could not resolve an external
package; rebuilding under the existing package's ignored cache resolved build
dependency lookup without any source or dependency changes.

The corrected build is prepared under
`apps/site/node_modules/.cache/reset-lease-build`. Installation awaits a restart:
new conversational work became active during verification, so the running build
was left intact pending the owner's restart instruction. This follow-up has not
reset the real profile or modified its execution database directly.

## 2026-09-10 — Complete reset of inactive saved workflows

The installed build contained the expired-lease repair. A subsequent refusal had
a different cause: an Environment workflow was waiting for operator authorization
with no live writer or unfinished dispatch, while the profile's work queue was
empty. Reset preflight still required every saved workflow to be terminal. An
empty queue therefore did not make a suspended conversation resettable.

The suggested UI path had a separate defect. `QueuePanel.svelte` requested its
stream with `viewDependency: 'chat'`; the connection pool deferred that stream
while Security Settings selected the System view. A browser baseline reproduced
the panel remaining at "Waiting for coordinator state" without opening its stream.

### Canonical repair and user behavior

- The existing reset handler now completes the explicitly confirmed workflow
  lifecycle: it excludes new admission, validates storage and the whole profile,
  refuses queued/running work, live writers, training and unresolved dispatches,
  then calls Work Coordinator's existing `cancelExecution` for inactive saved
  workflows before asking the checkpointer to retire their data.
- The checkpointer's preflight distinguishes a live writer from an inactive
  workflow. Direct checkpoint deletion still requires terminal status and no
  unresolved effects inside its SQLite transaction. Reset does not delete a
  running workflow directly or synthesize a result for uncertain physical work.
  Refusal leaves inactive sibling workflows untouched.
- Security Settings states that reset ends inactive conversations and workflows
  awaiting input or authorization. QueuePanel's obsolete Chat-only constraint is
  removed; the existing connection pool and sidebar remain the UI owners.
- Browser inspection also exposed a stale post-reset sidebar: its last snapshot
  showed cancellation before history retirement. `forgetProfileHistory` now emits
  the existing `task_deleted` event after successful persistence, refreshing the
  same queue stream without a reload or another polling path.

### Acceptance evidence

- A maintained synthetic test reproduced the original 409 with inactive workflows
  and an empty Coordinator queue before the repair. The corrected test exercises
  real Coordinator cancellation, waiting reasons including operator authorization,
  abandoned work without a writer, checkpoint removal, repeated reset and recovery
  after reset. Existing tests retain live-writer and uncertain-effect protections.
- All 14 reset tests, 22 durable-store tests, 11 recovery tests, seven existing
  cancellation/Bridge tests and the Work Coordinator contract passed. Core and
  Site type checks passed, with zero Site diagnostics; architecture/remote-safety
  and diff checks passed.
- The actual styled Security Settings and QueuePanel components were exercised
  through real session authentication, the HTTP router, default reset handler,
  Coordinator, checkpointer and persistence owners in an isolated installation.
  Browser checks cover the broken stream baseline, repaired Settings access,
  running-work refusal without side effects, reset with only a suspended workflow,
  immediate sidebar clearing, and retained tasks, other profiles, shared process
  state and valid login. No profile reset dependency is replaced in this probe.
- The initial browser fixture mistakenly paused its queue before claiming its
  synthetic job. The owner correctly refused that claim; the fixture was corrected
  to claim before pausing, without changing production guards or test assertions.
  Browser evidence is under `/tmp/metahuman-reset-lifecycle-ui/`.

No parallel reset service, cancellation implementation, queue, route or store was
added. Live-profile inspection was read-only; the actual memory reset remains an
explicit action for the Installation Owner.

## 2026-09-10 — Agency history included in profile memory reset

### Failure and ownership

A date-limited memory erasure left older Agency desires visible. The actual Agency
Dashboard loads the Agency API, which reads `agency/storage.ts`; its canonical
storage route resolves to `persona/desires`, outside the memory directory. The
reset handler preserved the entire persona directory. Ordinary individual-desire
deletion deliberately retains its audit history and is not a complete reset.

The reset fixture was extended before production edits to cover Agency history,
retained configuration, and writes during reset. It reproduced surviving records
and successful writes through the unguarded `config/desires` storage route. The
initial fixture used non-JSON sentinels for manifests; these were changed to valid
synthetic desires so the canonical Agency reader also proves the result.

### Implementation

- `agency/storage.ts` supplies profile-relative history paths to the existing
  reset handler. Configuration and its encrypted representation are retained.
  Desires, folder and legacy plans/reviews/executions, scratchpads, migration
  backups, generator evidence history, and metrics are removed together.
- The existing reset handler includes those paths in its original whole-profile
  storage preflight and deletion operation. Queue, live-writer, training, and
  unresolved-effect guards remain. No second reset route, service or store exists.
- `storage-client.ts` extends the existing reset exclusion to `config/desires`;
  its `memory/agency` alias already shares the memory guard. Agency's existing
  write methods now propagate storage failures, preventing a refused write from
  being reported as successful persistence.
- Security Settings and the account guide explicitly describe Agency erasure and
  retention of persona identity and Agency configuration. The existing button,
  confirmation, navigation, and success/error flow remain in place.

### Evidence and operation

- All 15 reset tests pass, including Agency histories and legacy copies, other
  profiles, repeated reset, custom storage, encrypted history/configuration,
  concurrent writes, and refusal of Agency symlink escapes before deletion.
- Focused Agency plan-review, outcome, execution and storage tests pass. Core and
  Site type checks pass; Site reports zero errors, warnings or hints. Architecture
  and remote-safety pass with zero violations. The architecture subprocess was
  initially sandbox-blocked and passed when rerun with host permission.
- Twelve browser checks pass through the actual Security Settings component,
  authenticated HTTP router and default reset handler in an isolated synthetic
  installation. They demonstrate Agency history removal, retained configuration
  and another profile's desires, explicit UI copy, unchanged work refusal, and
  immediate queue-history refresh. The screenshot was inspected.
- The Site build and installed compiled-runtime check pass, including all 38
  workflows. Installation occurred while the Site was stopped. A separate launcher
  started the installed build before this task's start command ran; that command
  correctly refused a duplicate server. The running entry postdates installation,
  the installed build still matches source, and `/api/app-info` returns HTTP 200.
- The owner-authorized live cleanup removed pre-today Agency desires and their
  associated history using the profile storage owner, retaining today's memories,
  persona identity and settings. The full reset was exercised only with synthetic
  profiles, so the owner's retained current-day memories were not erased.
- Temporary browser/server processes were stopped. Unrelated worktree changes
  were preserved. No commit, push, new production dependency or physical command
  was made. Local evidence is under `/tmp/metahuman-agency-reset-*` and
  `/tmp/metahuman-reset-lifecycle-ui/`.
