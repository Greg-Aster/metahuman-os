# Profile Sync Repair and Network Settings Trace

Scope: repair the existing profile pull and examine the desktop communication
settings needed to import a profile from another installation. No profile data,
credentials, host addresses, or machine-specific configuration are included here.

## `packages/core/src/profile-sync.ts`

- Owner: bounded transfer, validation, profile storage requests and checkpoints.
- Baseline findings: `decodeBundleFile` validated JSON only for plain-text
  encoding; base64 text bypassed JSON and binary checks. `exportProfileSyncBundle`
  silently omitted supported files above its per-file size limit and did not
  validate the completed outgoing bundle.
- Evidence: malformed base64 JSON and oversized-export reproductions accepted
  data or reported success before the repair. The new regression tests fail on
  the original implementation.
- Repair: apply text/JSON validation after decoding, reject invalid UTF-8,
  explicitly reject oversized supported files, and validate outgoing bundles.
- Removed: encoding-specific validation bypass and silent oversized-file skip.
- Boundary: existing bundle version, limits, roots and storage owner retained.

## `brain/agents/profile-sync/core.ts`

- Owner: one finite remote pull through Core profile and memory owners.
- Baseline findings: the request timeout and cancellation listener ended at
  response headers, before the body was consumed. Cancellation after a remote
  response could still allow local writes and a successful profile-only
  checkpoint. Missing/malformed `hasMore` was interpreted as completed pagination.
- Repair: keep request lifecycle through response consumption, check cancellation
  between phases and before persistence/checkpoints, and require valid bounded
  pagination responses.
- Removed: header-only timeout scope and implicit pagination completion.
- Evidence: response-body timeout/cancellation, post-response cancellation and
  invalid-page tests fail before the repair and pass afterward.

## `packages/core/src/memory.ts`

- Owner: canonical durable episodic capture, encryption and idempotency.
- Baseline finding: an identified producer record with no existing durable file
  could still be rejected by the process-wide recent-content cache. Profile Sync
  then counted it as deduplicated and advanced its checkpoint. Distinct source
  identities with identical text could be lost.
- Evidence: an isolated HTTP pull reported success but imported zero of 103
  synthetic source records after source capture populated the content cache.
  A focused test also reproduces loss within one profile and between profiles.
- Repair: persisted producer identity controls identified captures; the existing
  content heuristic continues to handle captures without a producer identity.
- Removed: competing transient-content suppression for durable producer records.
- Evidence after repair: all 103 records persist; a full repeat reports 103
  deduplicated durable records with the destination count unchanged.

## `apps/site/src/components/AuthGate.svelte`

- Owner: login and permitted missing-profile bootstrap UI.
- Baseline finding: bootstrap reported success after priority file import and
  configuration save, without queuing the documented memory pull. Every later
  login requested a full memory history, even without a configured source.
- Repair: bootstrap waits on the existing finite Profile Sync agent and displays
  incomplete status on failure or a lost status stream. Login checks configured state, uses
  incremental sync and reports trigger failure visibly.
- Removed: premature complete-import claim and unconditional full-history login
  request. No browser replica, credential store or independent sync executor added.
- Live validation: the owner subsequently completed the browser bootstrap against
  the remote account; see the authenticated transfer evidence below.

## Communication settings and tunnel bootstrap

- `NetworkServerSettings.svelte:626-681`: WiFi Broadcasting is disabled on
  desktop. Its `/api/network-info` and `/api/network-settings` handlers are in
  `apps/react-native/nodejs-assets/nodejs-project/main.js`, where the saved
  boolean selects loopback or all-interface binding on the next mobile launch.
- `packages/core/src/api/handlers/server-info.ts:47-100`: desktop URLs are
  constructed from network interfaces; they do not establish listener binding,
  firewall admission, reachability, or successful profile authentication.
- `start.sh:76-118`: desktop listener exposure is owned by startup environment
  and the existing configured tunnel path. The Network UI has no desktop LAN
  sharing toggle wired to that owner.
- `api-config.ts:58-125`: the mobile Server Selection setter changes an in-memory
  URL cache, while initialization resets that cache. It does not save the
  canonical profile sync configuration despite the UI's remembered-setting claim.
- `SyncManager.svelte` and `lib/client/profile-sync.ts`: authenticated source URL
  and credentials persist through `/api/profile-sync/config` to Core's
  profile-resolved storage. This selects an outbound source and does not enable
  inbound sharing. The original browser connection test and bootstrap required
  source CORS admission; the queued agent's HTTP requests are server-side.
- `etc/cloudflare.json` describes an enabled auto-start tunnel in this clone.
  The configured public endpoint returned HTTP 530 / Cloudflare error 1033.
  This established tunnel unavailability at the first check. After the owner
  started the source tunnel, both curl and Node fetch received MetaHuman JSON
  through the public endpoint. Browser preflight still returned HTTP 403 with
  `CORS origin is not allowed`, establishing a separate application blocker.
- `etc/agents.json`: Profile Sync remains a manual finite pull; login admission
  is not a periodic unattended schedule. The existing transfer is not a complete
  profile backup, two-way reconciliation, deletion propagation or execution-state
  migration. Those need explicit scope and contracts before implementation.

## `packages/core/src/api/handlers/auth.ts:556` and Site bootstrap

- Baseline: the existing `/api/auth/sync-user` handler ignored the `serverUrl`
  already supplied by its sole maintained caller. It created a local account
  without fetching a remote bundle and swallowed profile-initialization errors.
  Regression tests proved both empty-account success and ignored source input.
- Repair: the same endpoint now authenticates and downloads through Node, uses
  Core bundle validation before account creation, imports through Core storage,
  saves the canonical source configuration, and issues a local session only
  after successful setup. Local credential mismatch is checked before remote
  requests. Local role policy is retained; metadata comes from authenticated
  source identity. Encrypted storage must be unlocked before import.
- The Site submits one bootstrap request and then admits the existing finite
  memory agent. Removed direct browser remote login/download, browser bundle
  import orchestration, and swallowed initialization failure. No generic proxy,
  new route, dependency, scheduler, or second authenticated executor was added.
- `SyncManager.svelte` and `lib/client/profile-sync.ts` no longer gate a saved
  source on browser remote login. Configuration save and actual queued transfer
  are described separately; the redundant connection-test button and unused
  `remoteFetch` helper were removed. URL normalization preserves explicit HTTP
  for LAN sources and accepts a bare HTTPS hostname.

## Event-driven completion

- Installation Owner instruction: sync on login and when needed, without
  periodic polling or scheduling.
- Baseline: `runProfileSyncAgent` polled task status every second until a
  five-minute deadline. The Sync Manager also rotated decorative status text
  with an interval. Focused client tests reproduced polling and submission
  despite an already-aborted wait.
- Repair: the browser consumes the existing per-task queue SSE endpoint. It
  closes the stream on terminal success, failure, cancellation, or connection
  loss. It does not reconnect or fabricate completion after status is lost.
  Removed the polling reader, polling loop/deadline, and decorative interval.
- Profile Sync remains manual in the Trigger Manager catalog, with configured
  login admission. No periodic profile-sync trigger was added. Existing transport
  request deadlines and the shared queue stream's keepalive are unchanged.

## Validation and remaining limits

- Focused suites: 43 tests pass across Core bundle/config, Core memory identity,
  API transport/bootstrap, Brain sync and the client event adapter. Test data is
  synthetic and stored in temporary directories.
- Isolated HTTP integration through the real shared router: seven profile files
  and 103 episodic records transferred in two pages; repeat transfer deduplicated
  all 103; exact persona bytes and destination record count checked.
- Additional isolated runtime check: bootstrap through the shared HTTP router,
  authenticated session selection, real Work Coordinator admission and agent
  execution, three durable synthetic memories, checkpoint persistence, and a
  terminal per-task SSE event all pass. No polling was used for task completion.
- Core, Brain and Site typechecks pass. Site reports 366 files with zero errors,
  warnings or hints. Site production build passes; compiled runtime matches
  source and validates 38 workflows.
- Architecture/remote-safety check: zero violations. `git diff --check`: pass.
- Prerequisite repair: built the existing `packages/agent-runtime` package;
  missing generated declarations caused the original Brain typecheck failure.
- Two additional existing conversation/buffer integration tests fail with
  `Buffer admission ID conflicts with its committed entry`. Both fail identically
  in a separate clean `HEAD` snapshot. Their tests and owners are unchanged.
- Full root production build chain was not run; focused validation and the Site
  build do not imply that those existing buffer failures are resolved.
- The repaired production build was installed and the local application restarted
  with the existing launcher. Local app and auth routes respond. Remote endpoint
  reachability and the requested source account's existence were confirmed using
  Node from the receiving machine. The owner subsequently entered credentials
  through the local application and completed the real transfer, as recorded
  below. No desktop/tunnel/Wi-Fi configuration or sync schedule was changed.
- Actual encrypted-volume transfer and physical hardware outcomes remain
  unverified. No physical actions were performed.

## Browser NetworkError follow-up

- The owner reported `NetworkError when attempting to fetch resource` from the
  local receiving application. The running local server, bootstrap route and
  same-origin admission all responded correctly when checked afterward.
- Verified the actual served AuthGate asset contains the repaired local bootstrap
  request and no direct remote profile download. The source desktop serves its
  separate, older client build; no remote source update was performed.
- An isolated Chromium session loaded and hydrated the running receiving app,
  opened Sync from Server, filled synthetic fields and clicked Sync Profile.
  The diagnostic replaced the outgoing bootstrap body with an empty object to
  exercise real local transport without creating an account or attempting remote
  authentication. The UI displayed the expected local validation response;
  exactly one bootstrap request and no cross-origin requests or network failures
  were observed.
- Inspection of the owner's actual Firefox console subsequently confirmed direct
  remote `/api/auth/login` requests rejected with CORS HTTP 403. The affected tab
  retained the old browser transfer code, bypassing the receiving server. Opening
  a separate fresh tab did not update that existing tab. This confirms the source
  of the reported browser error. The authenticated transfer was then verified
  after reloading the affected tab with the repaired client.


## Sync diagnostics

- Baseline: a rejected remote login returned HTTP 502 from bootstrap without any
  terminal or audit entry. A regression test captured empty console output.
- The existing Core bootstrap handler now uses the shared logger and audit owner
  for correlated start, failure and completion events. Failure records identify
  the stage, source origin, status and machine error code; completion records the
  imported file count. Validation, transport, storage and session exceptions are
  covered. No new logging service, telemetry endpoint or periodic task was added.
- Credentials, cookies, session identifiers, source URL paths/query strings, raw
  exception payloads and profile contents are excluded from these diagnostic
  records. The old bootstrap session-prefix console message was removed.
- The browser records its failing stage when transport fails before the server
  can observe it. HTTP rejection and incomplete memory sync also get console
  entries alongside the existing visible errors. The delayed success reload was
  removed; completed sync proceeds immediately without a timer.
- Seven bootstrap tests pass, including terminal/audit correlation, redaction of
  secret-bearing URLs and exceptions, network cause codes and safe success logs.

## Authenticated transfer evidence

- Installed the rebuilt application and restarted it through the existing
  launcher. The compiled runtime matches source and validates 38 workflows.
- A live invalid bootstrap request produced matching terminal and persisted audit
  records. The first real rejected source login also logged `remote-login` and
  `HTTP_401`, demonstrating that source rejection is no longer silent locally.
- After reloading the affected Firefox tab, the owner submitted the source
  credentials through the local UI. The source username is case-sensitive; its
  exact spelling was confirmed through the source's public user-list endpoint.
- The real bootstrap completed with 22 imported profile files and created the
  local account. The same request admitted the canonical finite Profile Sync job.
- The persisted coordinator receipt contains a completed task and agent success:
  seven profile files refreshed, 153 episodic records imported, zero deduplicated
  records and zero errors. The canonical profile path contains 153 episodic JSON
  files, and the canonical sync configuration has both completion checkpoints.
- The browser entered the local authenticated application. No password, session,
  imported content or machine-specific address is recorded in this report.
- The latest seven bootstrap tests, Core/Site typechecks, Site production build,
  runtime verification and architecture check pass. Earlier focused suites remain
  passing as recorded above; the unrelated baseline failures remain unchanged.
- This proves the supported one-way profile and episodic-memory import. It does
  not establish complete backup coverage, encrypted-volume transfer, backend
  inference availability or physical robot behavior.

## Missing conversation buffers after initial import

- Owner trace: ChatInterface reads `/api/buffer` and `/api/buffer-stream`, whose
  handlers call `conversation-buffer.ts`. `getBufferPathForUser` resolves the
  selected profile's `state/conversation-buffer-{mode}.json` for Conversation,
  Inner, System and Robot. These are per-profile files, not shared global history.
- Live baseline: the receiving profile had none of its four canonical buffer
  files. The authenticated source API returned non-empty buffers for all four
  modes, while its priority export contained 22 files and zero buffer/state files.
  The previously verified 153 episodic records therefore did not prove chat
  history transfer; episodic memory and rolling chat buffers have different owners.
- Root cause: `profile-sync.ts` accepted only the obsolete unsuffixed/dot-style
  buffer filenames. Its shared export/import filter excluded the actual
  hyphenated canonical filenames. Earlier tests used obsolete invented paths
  and did not exercise the real buffer owner.
- Repair: replace that filter with the four canonical filenames. Import continues
  through profile-resolved storage, acquires the existing per-user/per-mode
  buffer lock, and notifies the existing chat SSE owner after a successful write.
  Removed acceptance of unused legacy/unknown buffer names. No new buffer store,
  replay source, scheduler, service, export endpoint or browser replica was added.
- Two regression tests failed before the fix: real buffers were absent from the
  bundle, and open chat received no import update. They now prove all four
  canonical paths, selected-profile isolation, unchanged source/other profiles,
  repeated import without duplicates, held buffer locks and a live SSE update.
  Tests use isolated temporary roots and synthetic message content.
- The focused rerun passes 34 tests across profile transfer/buffers, bootstrap,
  API transport and the Brain agent. Core typecheck and architecture check pass.
- Initial deployment boundary: the sending desktop ran the faulty exporter. Its
  existing updater reported uncommitted local changes and refused automatic
  update. Those changes were not altered or stashed. The Installation Owner
  subsequently authorized direct maintenance access for the source repair.
- A reviewable patch for the sync owner and focused tests is provided under ignored
  `out/repairs/profile-sync-buffers.patch`; it applies cleanly to this installation's
  HEAD baseline. The desktop worktree must be inspected before applying it.

- Q6A deployment: Site production build and compiled runtime validation pass
  (38 workflows). Restarted through the existing launcher; local HTTP responds
  200.
- Desktop deployment: authenticated SSH access was verified, and the same
  three-file owner/test repair was applied after checking the source worktree.
  Both new regression tests reproduced the failure before the production edit;
  all ten profile-sync tests pass afterward. Core typecheck, architecture check,
  Site build and the launcher's compiled-runtime verification pass (38 workflows).
  The existing launcher restarted successfully; HTTP responds 200. Hash checks
  confirmed all 320 pre-existing changed worktree files were preserved.
- Live transfer: the receiving application's canonical queue admitted the finite
  Profile Sync agent using its configured HTTPS tunnel source. Its per-task SSE
  reported completion, and the persisted history records a completed receipt.
  No scheduled remote polling was used or added.
- All four received buffer files match the source byte-for-byte. The local chat
  API returns 30 Conversation, 80 Inner, 30 System and 100 Robot messages for the
  selected profile. Profile and incremental-memory checkpoints advanced. This
  verifies real buffer transfer and the data consumed by the chat interface;
  it is not a visual browser check or physical-hardware validation.
- Maintenance uses a dedicated SSH key with a pinned desktop host key. The
  temporary public-key delivery server and bootstrap staging files were removed.
  SSH does not add a second profile-sync path; all profile transfers remain
  owned by the existing finite agent. No credentials, profile content or local
  connection configuration are included in the source change.
