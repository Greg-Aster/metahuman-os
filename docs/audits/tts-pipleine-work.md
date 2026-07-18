# TTS Pipeline Work

Date opened: 2026-07-17
Status: Phase 2 node-ownership cleanup implemented; runtime smoke reached the TTS queue, playback validation pending
Scope owner: MetaHuman TTS request, synthesis, and playback flow, including the Ainekio robot output boundary

> The filename keeps the requested `tts-pipleine-work` spelling. This document is the working paper trail for the cleanup. Update the progress checklist and append to the work log whenever implementation or validation occurs. Do not silently rewrite earlier log entries; add a correction entry when facts change.

## Purpose

MetaHuman currently has more than one way to decide that text should be spoken, more than one Kokoro integration path, and more than one playback sink. Environment Mode was already speaking through a browser-side fallback even though its checked-in graph did not contain the standard TTS node. A paused robot-output implementation began adding another trigger and another Kokoro client before that hidden path was fully traced.

The cleanup must produce one logical TTS pipeline and one graph-visible TTS audio output node. Playback destination may be configurable, but one response must not independently enter multiple synthesis paths.

## Non-negotiable target contract

For every assistant response intended to be spoken:

1. Exactly one standard **TTS Output** node admits the speech request.
2. That node creates exactly one correlated `SpeechRequest`.
3. Saved voice settings select exactly one active output target: browser or robot.
4. Exactly one renderer claims the request.
5. Exactly one synthesis request is sent to the configured TTS provider.
6. The synthesized audio is delivered to exactly one audible sink.
7. Completion, cancellation, and failure refer to the same request ID from node execution through playback.

Strict node-ownership policy:

- LLM response speech may be configured and admitted only by graph nodes.
- Interface code may render text and may play an already-admitted TTS request, but it must never infer “speak this” from raw assistant-answer text.
- No API handler, chat callback, offline fallback, or response-pipeline callback may automatically convert an LLM answer into TTS outside the graph.
- A missing or disconnected TTS node means the response is silent by design.

Muting the browser is a useful temporary operating workaround, but it does not satisfy this contract because synthesis and playback work would still occur. The output-target setting must prevent the unselected renderer from claiming the request.

An explicit multi-output or mirrored mode is out of scope for this cleanup. If it is added later, the audio must be synthesized once and fanned out from that one result.

## Audit boundaries

Included:

- `etc/cognitive-graphs/*.json` TTS and Environment Mode wiring.
- `packages/core/src/nodes/output/tts.node.ts` and graph-result extraction.
- Persona chat answer emission and TTS queue transport.
- `apps/site` response triggers, provider selection, synthesis requests, and browser playback.
- Core TTS configuration, provider creation, batch synthesis, and streaming synthesis.
- Voice settings and TTS service startup.
- Maintained voice-loop and agency call sites that can admit TTS outside the graph node.
- MetaHuman environment speech delivery and the Ainekio environment adapter, Kokoro client, gateway speaker stream, and robot audio boundary.

Excluded for now:

- Voice-training dataset generation and model-training internals, except where they affect runtime voice configuration.
- Reference-audio and Voice Settings preview buttons; these are explicit operator tests, not assistant-response admission.
- Deprecated `apps/code-oss`, generated bundles, runtime profile contents, logs, and private data.
- Hardware acoustic validation, which remains unavailable until exercised on the physical robot.

This is a maintained-source audit. No live speech request was executed during this review.

## Executive finding

The findings and system maps below describe the pre-cleanup baseline traced on 2026-07-17. The first node-ownership cleanup batch is recorded in TTS-006; later work must not rewrite this baseline as though the duplicate paths never existed.

Environment Mode did not need a graph TTS node to speak. Its response was returned as a normal persona-chat `answer`, and `ChatInterface.svelte` automatically called `speakAssistantResponse()` for every answer when assistant speech was enabled. That function called the browser `useTTS()` client directly.

Dual Mode also contains the standard graph `tts` node. That node writes to the TTS queue, which is consumed by the same browser component. The same final `answer` is also auto-spoken directly. A ten-second text comparison usually suppresses the second playback, but this is a deduplication workaround across two admission paths, not one pipeline.

The normal Kokoro browser path is split again at synthesis time: batch `/api/tts` uses the core provider service, while `/api/tts-stream` independently reloads voice settings and calls Kokoro directly. `useTTS.speak()` selects the independent streaming handler for Kokoro.

The paused robot work would add a third Kokoro client in Ainekio and a separate Environment Mode `environment_send_text` trigger. That work is not wired end to end and must not continue until the single-request contract is implemented.

## Pre-cleanup system map

### Existing browser speech path without a graph TTS node

```text
Environment Mode graph
  -> Stream Writer / Chat View response
  -> persona-chat final answer event
  -> ChatInterface.speakAssistantResponse(response)
  -> useTTS.speak(response)
  -> /api/tts-stream for Kokoro
  -> Kokoro /synthesize-stream
  -> browser Audio elements
  -> computer speakers
```

This is the confirmed reason Environment Mode was already speaking.

### Existing graph TTS path

```text
Dual/Agent/other graph
  -> standard TTS Output node
  -> profile TTS queue file + notification
  -> /api/tts-queue-stream
  -> ChatInterface.handleTTSItems()
  -> ChatInterface.speakAssistantResponse(item.text)
  -> useTTS.speak(item.text)
  -> synthesis endpoint
  -> browser playback
```

The final persona-chat `answer` independently calls `speakAssistantResponse()` as well. `lastAutoSpoken` compares text within ten seconds to reduce duplicate playback.

### Current synthesis branches

```text
/api/tts
  -> generateSpeech()
  -> createTTSService()
  -> KokoroService.synthesize()
  -> Kokoro /synthesize

/api/tts-stream
  -> independently load profile Kokoro settings
  -> direct fetch to Kokoro /synthesize-stream

native voice mode
  -> browser Web Speech API
```

The first two branches duplicate Kokoro request/config ownership. Native voice mode is an alternate synthesis engine selected in the browser, not merely an alternate audio sink.

### Existing Ainekio speaker boundary

```text
GatewayService.tts_speak()
  -> protocol-v1 tts start
  -> 640-byte, 16 kHz mono s16le speaker frames
  -> protocol-v1 tts end
  -> robot speaker queue and completion
```

This lower-level speaker path is real. It is not currently connected to Environment Mode text. Ainekio `sendText` presently publishes/acknowledges text and reports `text_received`; it does not synthesize or play speech.

## Owner-group audit records

## `packages/core/src/nodes/output/tts.node.ts` and `packages/core/src/graph-runtime.ts`

- Owner: graph-visible TTS admission and extraction of queued TTS metadata from graph state.
- Summary: the `tts` node does not synthesize audio. It writes text to a profile queue, touches a notification file, and returns queue metadata. Graph runtime scans completed node outputs for `queued: true` plus text.
- Boundary issues: the node is called “TTS Output,” but delivery and synthesis ownership live in the browser. Its output contract does not name a playback target or durable request identity shared through playback completion.
- Technical debt: file queue admission, graph-result metadata extraction, browser answer fallback, and browser queue consumption collectively decide speech behavior.
- Security/privacy notes: queue content is user speech text under profile/runtime paths and must remain outside remote source. The queue is bounded to ten items.
- Test gap: no contract proves that one graph response creates one and only one synthesis request.
- Recommended action: keep one standard TTS node, but make it emit/admit one canonical `SpeechRequest` with correlation, source, mode, and target. Do not add a separate robot-specific speech node.

## `etc/cognitive-graphs/dual-mode.json` and `etc/cognitive-graphs/environment-mode.json`

- Owner: editable LLM workflow and explicit output-node placement.
- Summary: Dual Mode includes `tts-out` and feeds it the stripped response. The checked-in Environment Mode graph had no standard `tts` node. The current worktree adds an `environment_send_text` node labelled “Environment Speech Out.”
- Boundary issues: `environment_send_text` represents environment text delivery, not TTS. Labelling it speech output makes the graph claim audio behavior that the Ainekio adapter does not implement.
- Technical debt: Environment Mode relied on browser answer auto-speech rather than an explicit graph node.
- Security/privacy notes: graph files must not contain runtime addresses, secrets, or profile data.
- Test gap: graph validation checks structural correctness but not “one speech node per response” or target-specific delivery.
- Recommended action: place the same standard `tts` node in Environment Mode. Keep `environment_send_text` only for actual non-audio text delivery. Remove the paused “Environment Speech Out” use of `environment_send_text` during cleanup.

## `packages/core/src/api/handlers/persona-chat.ts` and `apps/site/src/components/ChatInterface.svelte`

- Owner: persona-chat response transport and browser chat behavior.
- Summary: persona chat emits both response text and any queued TTS metadata. ChatInterface auto-speaks final answers even when no TTS metadata exists. It also consumes graph TTS queue items and speaks those.
- Boundary issues: the interface shell independently decides that an LLM answer should become speech. That bypasses the graph architecture and is the hidden Environment Mode TTS trigger.
- Technical debt: `speakAssistantResponse()` is called from normal answers, queued answers, offline answers, and response-pipeline answers. A text/time dedupe marker attempts to reconcile those calls with graph queue items.
- Security/privacy notes: no new secret exposure found. Speech text moves through browser-visible API traffic as expected.
- Test gap: no test asserts that final-answer rendering is silent unless a canonical TTS request is present.
- Recommended action: remove answer-text auto-admission. ChatInterface should render answers normally and play speech only when it receives the one canonical TTS request selected for the browser target.

## `apps/site/src/lib/client/composables/useTTS.ts`

- Owner: browser synthesis request selection and browser audio playback.
- Summary: `speak()` selects native Web Speech, batch `/api/tts`, or `/api/tts-stream`. Kokoro and RVC are automatically sent through streaming. Browser playback uses Web Audio for batch audio and `HTMLAudioElement` chunks for paragraph streaming.
- Boundary issues: this component combines provider selection, synthesis transport, buffering, playback, and active-operator TTS state reporting.
- Technical debt: the same method is reachable from both graph queue events and direct answer fallbacks. Native mode bypasses the configured server TTS provider entirely.
- Security/privacy notes: audio object URLs are revoked; abort handling exists. Provider and voice metadata are fetched per client session.
- Test gap: no renderer-claim test prevents browser synthesis when output target is robot.
- Recommended action: reduce this component to a browser renderer for already-admitted `SpeechRequest` objects. It must refuse requests whose target is not browser. Provider choice must come from one TTS configuration owner.

## `packages/core/src/api/handlers/tts.ts`, `packages/core/src/api/handlers/tts-stream.ts`, and `packages/core/src/tts.ts`

- Owner: server API transport, provider construction, profile-aware voice configuration, and audio generation.
- Summary: `/api/tts` delegates to the core TTS service and provider architecture. `/api/tts-stream` has separate provider-specific logic and, for Kokoro, independently reads profile configuration before directly calling the Kokoro server.
- Boundary issues: streaming synthesis bypasses `KokoroService`, so the nominal provider owner does not own the most common Kokoro browser path.
- Technical debt: voice/profile resolution, Kokoro option mapping, service startup assumptions, and error handling are implemented in more than one place.
- Security/privacy notes: profile paths are resolved server-side. Any future direct browser-to-Kokoro design must not expose filesystem voicepack paths.
- Test gap: no parity test proves batch and stream paths resolve the same provider, profile, voice, speed, custom voicepack, and normalization settings.
- Recommended action: define streaming on the canonical TTS service/provider interface. Keep `/api/tts` and `/api/tts-stream` as thin transports over the same owner, or retire one after callers migrate.

## `packages/core/src/tts/providers/kokoro-service.ts`, `external/kokoro/kokoro_server.py`, and startup scripts

- Owner: MetaHuman-side Kokoro provider integration, Kokoro process runtime, and boot orchestration.
- Summary: the provider sends configured synthesis requests and can auto-start the server. `bin/start-services` starts `bin/start-voice-server`, and Voice Settings can also coordinate provider server changes.
- Boundary issues: the paused work adds two more ways to inject saved defaults into the Kokoro process: `KOKORO_DEFAULT_CONFIG_JSON` from `KokoroService` and `KOKORO_VOICE_CONFIGS` from `start-voice-server`.
- Technical debt: externally started and provider-auto-started Kokoro processes can receive configuration through different paths. The existing streaming handler still sends request-level settings, creating another configuration owner.
- Security/privacy notes: custom voicepack paths are local profile data. Health/status responses must not expose full private paths.
- Test gap: no clean-checkout test proves the tracked server and every imported helper are present after install/start.
- Recommended action: select one Kokoro startup/config contract. All synthesis callers should use the same text/request contract and must not reimplement profile setting resolution.

## `packages/core/src/api/handlers/agency*.ts` and `packages/core/src/voice/*`

- Owner: background agency announcements and an optional live voice-loop subsystem.
- Summary: several agency handlers call `queueTTS()` directly instead of executing the standard output node. The voice-loop API can construct a `TTSIntegration` over `createTTSService`; its response-generation integration is incomplete and no maintained `apps/site` caller of `/api/voice/start` was found in this audit.
- Boundary issues: direct queue calls bypass the one-node rule. The voice loop presents another potential synthesis admission surface.
- Technical debt: background speech, graph speech, browser answer speech, and voice-loop speech do not share one admission contract.
- Security/privacy notes: voice-loop audit events include configuration fields; do not log secrets or private paths when consolidating.
- Test gap: active runtime callers and product ownership of the voice-loop endpoints need confirmation before merge or deletion.
- Recommended action: route graph/LLM announcements through the standard TTS output node. Route non-graph system announcements through the same canonical request owner with an explicit system source. Characterize the voice loop, then merge it into the owner or remove it only after caller/runtime evidence confirms it is unused.

## MetaHuman environment bridge and Ainekio environment adapter

- Owner: correlated environment actions, adapter transport, robot gateway speaker framing, and robot playback completion.
- Summary: MetaHuman supports `sendText` as an environment action. Ainekio translates it to text, publishes a transcript, and acknowledges `text_received`. `GatewayService.tts_speak()` already owns protocol-v1 speaker delivery. An untracked, paused `Master/gateway/tts_client.py` can read Kokoro SSE WAV chunks and convert them to robot PCM frames, but nothing constructs or calls it.
- Boundary issues: text acknowledgement is not a speech contract. A robot speech request needs its own correlated environment message while still originating from the one standard MetaHuman TTS node.
- Technical debt: the gateway currently sends speaker frames without the final planned pacing change, and the paused client is not wired, tested, configured, or documented.
- Security/privacy notes: the Ainekio TTS URL must remain runtime configuration, contain no embedded credentials, and be bounded to HTTP(S). Audio and transcripts must remain out of source control.
- Test gap: no end-to-end test covers TTS node request, target selection, one Kokoro call, WAV normalization, 20 ms frame pacing, robot completion, and browser non-playback.
- Recommended action: introduce a correlated speech-delivery action consumed only when output target is robot. Ainekio may call the canonical Kokoro stream directly, but it must be the only renderer that claims that request.

## Confirmed findings

| ID | Severity | Finding | Consequence |
|---|---|---|---|
| TTS-F01 | Critical | Final chat answers auto-trigger browser speech outside the graph TTS node. | Environment Mode speaks without a TTS node; LLM speech is not fully node-owned. |
| TTS-F02 | Critical | Graph TTS queue items and final answer events both reach `speakAssistantResponse()`. | One response can enter two admission paths; correctness depends on a ten-second text dedupe guard. |
| TTS-F03 | High | Kokoro batch and streaming routes have separate configuration and request implementations. | Voice, speed, custom voicepack, normalization, and failure behavior can drift. |
| TTS-F04 | High | Agency handlers call `queueTTS()` directly. | Background/LLM speech can bypass the standard output node. |
| TTS-F05 | High | No saved output-target setting prevents browser rendering when robot output is selected. | Muting hides sound but does not prevent duplicate synthesis or playback work. |
| TTS-F06 | High | `sendText` is being repurposed as “Environment Speech Out” in the paused graph edit even though Ainekio only acknowledges text. | The graph misrepresents delivery and risks duplicate browser plus robot speech. |
| TTS-F07 | Critical | The paused tracked Kokoro server imports `server_defaults.py`, but that new helper and its test are ignored by the repository's `external/` rule. | A clean checkout/commit of the visible tracked changes would fail at server import time. |
| TTS-F08 | High | The paused Ainekio Kokoro client is a third synthesis integration and is not wired to configuration, adapter action handling, or tests. | The worktree contains a half-finished path with no executable end-to-end owner. |
| TTS-F09 | Medium | Native Web Speech and the maintained voice-loop API are alternate synthesis/admission surfaces. | “One pipeline” cannot be proven until these are explicitly integrated, disabled, or classified as test/deferred surfaces. |
| TTS-F10 | Medium | Robot speaker framing exists, but long-stream pacing and correlated completion are not yet connected to a speech request. | Fast frame bursts can overflow the bounded robot queue; success could be reported before audible completion. |
| TTS-F11 | Critical | `ChatInterface.svelte` contains a raw-answer auto-play function plus a ten-second text deduplication mechanism. | Interface code bypasses graph configuration and attempts to reconcile duplicate admissions after they occur. This function and its deduplication state must be deleted. |
| TTS-F12 | High | Both global and Ainekio saved voice configurations currently select Piper, while the service factory stops every running server that does not match the selected provider. | A manually started Kokoro server is gracefully terminated by the next Piper synthesis request and appears to have crashed. |
| TTS-F13 | High | `bin/start-voice-server` resolves the default user only through a repo-local `profiles/<name>/etc/voice.json` path and falls back to global configuration when the active profile lives elsewhere. | Startup can announce and launch the global provider instead of the default user's saved provider. |

## Paused uncommitted work inventory

These changes predate this audit document. They are frozen pending the cleanup decision.

### MetaHuman

- `etc/cognitive-graphs/environment-mode.json`
  - Adds node `14`, labelled “Environment Speech Out,” using `environment_send_text`.
  - Connects parsed response and session ID to that node.
- `external/kokoro/kokoro_server.py`
  - Adds text-only default synthesis endpoints and server-start default loading.
- `external/kokoro/server_defaults.py`
  - New local helper for merged voice settings; currently ignored by Git.
- `external/kokoro/test_server_defaults.py`
  - New local tests; currently ignored by Git.
- `packages/core/src/tts/providers/kokoro-service.ts`
  - Adds `KOKORO_DEFAULT_CONFIG_JSON` to one server-start path.
- `bin/start-voice-server`
  - Adds `KOKORO_VOICE_CONFIGS` to the other server-start path.
- `packages/cli/src/commands/kokoro.ts`
  - Makes the CLI language override optional.
- `bin/install-kokoro.sh`
  - Removes the stale embedded duplicate server body and expects the tracked server file.

### Ainekio

- `Master/gateway/tts_client.py`
  - New untracked Kokoro SSE/WAV/PCM client.
  - Not imported or constructed by the gateway.
  - Not connected to `sendText`, another speech action, configuration, or tests.
- Concurrent microphone work remains in `Master/gateway/environment_adapter/server.py`; it is not part of this TTS cleanup and must be preserved.

No partial robot-TTS integration should be committed as a standalone batch. Before implementation resumes, each hunk above must be classified as keep, reshape, or revert against the target contract.

## Target architecture

```text
LLM response
  -> one standard graph TTS Output node
  -> one correlated SpeechRequest
  -> output target from saved Voice Settings
       -> browser renderer, or
       -> robot/environment renderer
  -> one canonical Kokoro streaming contract
  -> one selected speaker
  -> one correlated completion/failure result
```

### Canonical request

The exact type will be finalized before implementation, but it must minimally carry:

```text
requestId
text
source
mode
outputTarget
username/profile identity where required
environment session ID when target is robot
createdAt
```

Voice name, speed, language, custom voicepack, normalization, and provider-specific filesystem paths must not be copied into Ainekio. They remain owned by the existing saved MetaHuman voice configuration and the canonical synthesis service.

### Output target setting

Add one saved, profile-aware setting through the existing Voice Settings owner. Initial accepted values:

- `browser`
- `robot`

Do not add `both` during this cleanup. Browser mute/volume remains an operator convenience, not routing state.

Conversation/continuous microphone mode must not silently override a saved robot output target and turn browser playback back on.

### Robot target

When the request target is `robot`:

- the browser renderer must not claim or synthesize it;
- the standard TTS node must deliver one correlated speech request through the environment bridge;
- `sendText` must remain a text action, not double as speech;
- Ainekio may call the canonical text-only Kokoro stream address;
- Ainekio converts audio to 16 kHz mono s16le, sends paced 640-byte frames, and reports completion only after robot playback completes.

If browser support requires a MetaHuman proxy for authentication or CORS, that proxy must remain thin over the same canonical synthesis owner. It must not reimplement voice-profile resolution.

## Cleanup implementation plan

### Phase 0 - Contain and characterize the partial work

- [x] Preserve this audit as the authority before changing TTS code.
- [ ] Review the paused MetaHuman and Ainekio diffs by hunk and mark each keep, reshape, or revert.
- [ ] Prevent any commit where tracked `kokoro_server.py` imports an ignored helper.
- [ ] Add characterization tests for the existing direct-answer trigger, graph queue trigger, and ten-second dedupe behavior.
- [ ] Confirm whether any maintained client actively uses `/api/voice/start` and the live voice-loop APIs.

Exit gate: the baseline behavior and every partial hunk are accounted for; no half-wired TTS path remains ambiguous.

### Phase 1 - Define one request owner and one node contract

- [ ] Define the canonical `SpeechRequest` and playback completion result in `packages/core`.
- [ ] Extend the existing standard `tts` node to admit that request exactly once.
- [ ] Add the saved `browser | robot` output-target setting through the existing voice-settings handler and UI.
- [ ] Add a stable request ID/correlation ID used by graph result, renderer, synthesis, and completion feedback.
- [x] Add an architecture test that rejects new response-to-speech admission outside the canonical owner.

Exit gate: one graph node and one core request owner are the only accepted LLM speech admission path.

### Phase 2 - Remove duplicate response triggers

- [x] Put the standard `tts` node in Environment Mode.
- [x] Remove the paused `environment_send_text` speech wiring while preserving genuine text-delivery behavior.
- [x] **Delete the node-bypassing ChatInterface auto-play system.** Remove `speakAssistantResponse()` as an admission function and remove every call that passes it raw final-answer, offline-answer, queued-answer, or response-pipeline text.
- [x] Delete the ten-second `lastAutoSpoken` text deduplication state and comparison logic. Do not replace it with another timer, text comparison, or interface-side duplicate guard; request identity and single node admission must make it unnecessary.
- [x] Ensure final persona-chat `answer` events display text only. They must not initiate synthesis unless accompanied by a canonical request that was admitted by the executed graph's standard TTS node.
- [x] Ensure offline and response-pipeline paths remain silent until their workflows explicitly contain and execute the standard TTS node. Do not preserve speech with a UI fallback.
- [ ] Make the browser renderer consume only canonical TTS requests targeted to browser.
- [ ] Replace direct agency `queueTTS()` admissions with the graph node or the same explicitly classified system-speech request owner.
- [x] Add a guardrail test that fails if `ChatInterface` or another interface component calls TTS from raw assistant response text.

Exit gate: a response without a TTS-node request is silent; a response with one request is admitted once.

### Phase 3 - Consolidate synthesis and configuration ownership

- [ ] Add streaming synthesis to the canonical TTS provider/service interface.
- [ ] Move Kokoro stream option resolution under `KokoroService` or the selected single synthesis owner.
- [ ] Make `/api/tts` and `/api/tts-stream` thin adapters over that owner, or retire the redundant route after caller migration.
- [ ] Select one Kokoro process-start configuration mechanism; remove the second environment-variable injection path.
- [ ] Preserve all existing saved voice behavior: provider, voice, language, speed, custom voicepack, normalization, fallback, device, and startup policy.
- [ ] Decide and test multi-user behavior before relying on one process-global Kokoro default profile.
- [ ] Treat native Web Speech as an explicit configured provider or remove it from automatic assistant-response routing.

Exit gate: batch and streaming requests resolve identical saved settings through one owner, and one response produces one provider call.

### Phase 4 - Implement the selected output renderer

- [ ] Browser target: render the canonical request through the existing audio client without any fallback response trigger.
- [ ] Robot target: add a dedicated correlated speech action to the environment contract.
- [ ] Wire Ainekio to the configured canonical Kokoro stream address without copying MetaHuman voice settings.
- [ ] Prebuffer the first audio data before opening robot TTS playback.
- [ ] Convert to 16 kHz mono s16le and pace 640-byte frames at 20 ms intervals.
- [ ] Send one TTS start and one TTS end per request, including cancellation/error cleanup.
- [ ] Wait for correlated robot completion before returning successful speech delivery.
- [ ] Ensure the browser performs zero synthesis/playback work for robot-targeted requests.

Exit gate: Environment Mode speaks through the robot once, the browser stays silent, and completion represents actual robot playback.

### Phase 5 - Remove orphaned compatibility paths

- [ ] Remove obsolete queue helpers, handlers, server defaults, direct calls, and client branches only after static references and runtime entrypoints are checked.
- [ ] Merge or remove the incomplete voice-loop TTS surface after active-caller characterization.
- [ ] Update architecture and user documentation to name the single owner and target setting.
- [ ] Add a guardrail preventing a new TTS output node type or direct LLM-answer playback trigger.

Exit gate: no maintained source contains a second LLM TTS admission path, duplicated Kokoro profile resolver, or orphaned partial integration.

## Acceptance matrix

| Scenario | Required result |
|---|---|
| Dual Mode, browser target | One TTS node request, one synthesis call, one browser playback. |
| Environment Mode, browser target | One standard TTS node request, one synthesis call, one browser playback. |
| Environment Mode, robot target | One standard TTS node request, zero browser synthesis calls, one Kokoro stream, one robot playback completion. |
| TTS disabled/no TTS node request | Response displays but no synthesis request occurs. |
| Long Kokoro response | Ordered streaming continues with bounded buffering and no robot speaker overflow. |
| Kokoro failure | One correlated failure; no false “played” or “queued successfully” result. |
| Robot disconnect during speech | TTS is cancelled/ended safely and the request reports failure or cancellation. |
| Browser volume muted | Routing and synthesis counts remain correct; mute does not affect ownership logic. |
| Saved custom voice | Browser and robot targets use the same saved voice, speed, language, voicepack, and normalization behavior. |
| Concurrent mic/listening | Selected playback target remains authoritative; microphone turn-taking resumes only after the selected sink completes. |

## Validation gates

MetaHuman focused gates:

- `pnpm validate:graphs`
- focused TTS node, graph-runtime, persona-chat, TTS-handler, and voice-settings tests
- a client test proving final answers do not auto-speak without a canonical browser-target request
- a one-request/one-synthesis integration test for browser and robot targets
- `pnpm -s check:architecture`
- `./bin/audit check`
- `pnpm --dir apps/site build`
- `git diff --check`

Ainekio focused gates:

- TTS client SSE/WAV/PCM conversion tests
- environment adapter speech-action and completion tests
- gateway pacing, start/frame/end, cancellation, overflow, and disconnect tests
- `PYTHONPATH=Emulator:Master:Slave/software:. python3 -m unittest Emulator.tests.test_environment_adapter Emulator.tests.test_gateway_service Emulator.tests.test_media Emulator.tests.test_session`
- `python3 -m compileall -q Master Slave Emulator`
- hardware playback validation when the ESP32-S3 robot is available

## Progress checklist

- [x] Paused implementation after duplicate-pipeline concern was raised.
- [x] Traced the hidden Environment Mode browser speech trigger.
- [x] Inventoried graph, direct-answer, agency, voice-loop, synthesis, and output-sink paths.
- [x] Inventoried paused MetaHuman and Ainekio changes.
- [x] Recorded the ignored Kokoro helper clean-checkout blocker.
- [x] Defined the one-node/one-request/one-synthesis/one-sink target contract.
- [x] Created this audit and cleanup plan.
- [x] Recorded the strict node-only speech policy and the required deletion of ChatInterface auto-play/deduplication.
- [x] Added the standard graph TTS output node to Environment Mode.
- [x] Deleted raw-answer automatic playback and ten-second text deduplication from `ChatInterface`.
- [x] Added and passed the node-owned automatic TTS regression guard.
- [ ] Approve the target request and output-target contract.
- [ ] Complete Phase 0 containment.
- [ ] Complete Phase 1 request/node ownership.
- [ ] Complete Phase 2 trigger consolidation.
- [ ] Complete Phase 3 synthesis consolidation.
- [ ] Complete Phase 4 robot renderer.
- [ ] Complete Phase 5 orphan cleanup and final validation.

## Work log

Append new entries in chronological order. Include changed files, validation evidence, unresolved risks, and the next permitted step.

### TTS-000 - 2026-07-17 - Implementation paused

- Trigger: owner identified a possible duplicate TTS/audio pipeline and required one pipeline and one audio output node.
- Action: stopped further MetaHuman/Ainekio implementation.
- Result: no additional integration wiring was added after the pause.
- Next: audit current speech admission, synthesis, and playback paths.

### TTS-001 - 2026-07-17 - Existing Environment Mode speech traced

- Inspected: `environment-mode.json`, `persona-chat.ts`, `graph-runtime.ts`, `ChatInterface.svelte`, and `useTTS.ts`.
- Finding: Environment Mode was spoken by `ChatInterface` automatically speaking the final `answer`; it did not require a graph TTS node.
- Finding: Dual Mode graph TTS queue items and final answer events both call the same browser speech helper.
- Result: duplicate admission confirmed; ten-second text dedupe is the current suppression mechanism.
- Next: inventory synthesis/config owners and non-browser sinks.

### TTS-002 - 2026-07-17 - Synthesis and configuration ownership audited

- Inspected: `tts.node.ts`, `tts.ts`, `kokoro-service.ts`, `tts.ts`/`tts-stream.ts` handlers, voice settings, startup scripts, and Kokoro server.
- Finding: batch and streaming Kokoro paths resolve and send settings independently.
- Finding: paused work adds two different server-default injection mechanisms.
- Finding: tracked `kokoro_server.py` currently imports a new ignored helper, which is unsafe for a clean checkout.
- Next: inventory Ainekio boundary and record the partial worktree.

### TTS-003 - 2026-07-17 - Ainekio output boundary audited

- Inspected: environment translation/adapter, gateway `tts_speak`, dashboard speaker test, firmware/emulator speaker framing, and paused `tts_client.py`.
- Finding: `sendText` does not play audio; the gateway speaker protocol is real but not connected to environment speech.
- Finding: the paused Ainekio Kokoro client is present but unwired and untested.
- Result: no executable robot TTS path currently exists from Environment Mode.
- Next: document one-pipeline target and ordered cleanup phases.

### TTS-004 - 2026-07-17 - Audit authority created

- Changed: added `docs/audits/tts-pipleine-work.md` only.
- Recorded: current system map, owner-group findings, severity table, partial work inventory, target contract, phased cleanup plan, acceptance matrix, and validation gates.
- Implementation status: TTS code remains paused.
- Next: owner review and approval of the target request/output contract before Phase 0 changes.

### TTS-005 - 2026-07-17 - Node-only speech policy recorded

- Owner decision: all LLM response-to-TTS behavior must be configured by graph nodes only.
- Required deletion: `ChatInterface.speakAssistantResponse()` as a raw-answer admission path, all raw-answer call sites, and the ten-second `lastAutoSpoken` deduplication mechanism.
- Required behavior: a graph without an executed standard TTS node produces no speech, even if the response is displayed in chat.
- Prohibited replacement: no interface-side timer, text comparison, automatic fallback, or implicit conversation-mode speech trigger.
- Implementation status: task added to Phase 2; code remains unchanged and paused.
- Next: complete Phase 0 characterization, then implement this deletion as part of the node-ownership consolidation.

### TTS-006 - 2026-07-17 - Raw-answer playback removed and Environment Mode made node-owned

- Changed: `etc/cognitive-graphs/environment-mode.json` now routes the parser response to one standard `outputNode` with `nodeType: "tts"`; the paused `environment_send_text` speech node is no longer used.
- Changed: `ChatInterface.svelte` no longer turns final-answer, offline-answer, queued-answer, or response-pipeline text into automatic speech. It only automatically plays items received from the graph TTS queue.
- Deleted: the `speakAssistantResponse()` admission helper, `lastAutoSpoken`, and the ten-second text-comparison workaround. No replacement timer or text dedupe was added.
- Preserved intentionally: the explicit user-triggered message Speak action remains a manual control; it is not an automatic LLM response admission path.
- Added: `packages/core/src/tts-node-ownership.spec.ts` and root `validate:tts-node-ownership` build gate. The guard rejects restoration of the deleted helper/dedupe, constrains automatic browser playback to the admitted queue path, and requires Environment Mode to use the standard TTS node.
- Validation: `pnpm validate:tts-node-ownership` passed; `pnpm validate:graphs` passed all 21 graphs; `pnpm -s check:architecture` passed with zero violations; `pnpm --dir apps/site build` completed; scoped `git diff --check` passed.
- Existing warnings: the site build still reports pre-existing Svelte accessibility, stale browser-data, export, and chunking warnings; it exits successfully and no warning was introduced as a TTS validation failure.
- Remaining gap: the current graph queue is the admitted browser transport, but the canonical correlated `SpeechRequest`, saved `browser | robot` target, unified Kokoro synthesis owner, and robot completion path are not implemented yet.
- Next: complete the canonical request/output-target contract before adding any direct Ainekio Kokoro client or robot renderer.

### TTS-007 - 2026-07-17 - Live Environment Mode queue smoke and concurrent-build failure characterized

- Runtime result: Environment Mode executed one standard `tts` node for each tested response and wrote one conversation item to the active profile's TTS queue.
- Runtime result: the connected `tts-queue-stream` popped and sent the fresh Ainekio queue item, confirming the node-to-browser admission handoff.
- Playback blocker: the subsequent browser synthesis request reached a live Astro server while another `astro build` was replacing `apps/site/dist`; lazy route imports for `unified-queue`, `activity-ping`, and later `tts` were temporarily absent and raised `ERR_MODULE_NOT_FOUND`.
- Evidence: the replacement route files were created at 15:49:02 and the new manifest completed at 15:49:12, after the `/api/tts` failure at 15:49:00. This was a live-build race, not a second TTS admission path or a failure of the graph TTS node.
- Diagnostic note: the logged GET-method warning for `/api/activity-ping` came from a read-only probe; the maintained route intentionally exposes POST only.
- Recovery check: after the build completed, method-correct localhost probes reached `/api/tts`, `/api/activity-ping`, and `/api/unified-queue` and returned the expected unauthenticated `401` responses instead of module-load failures.
- Remaining validation: retry one Environment Mode response after all site builds have stopped, then confirm one queue item, one synthesis request, and one audible browser playback. Restart the foreground server after any build before treating the result as production-coherent.

### TTS-008 - 2026-07-17 - Kokoro shutdown and Piper selection diagnosed

- Observed state: no Kokoro process is currently running. Both `etc/voice.json` and `profiles/Ainekio/etc/voice.json` explicitly select `tts.provider: "piper"`.
- Startup behavior: `bin/start-voice-server` cannot find the default user's voice file at its assumed repo-local path, falls back to `etc/voice.json`, reads Piper, and correctly skips starting a Kokoro service.
- Runtime cause: each Ainekio synthesis creates a Piper service. `createTTSService()` classifies the manually running Kokoro process as an inactive provider and calls `stopServer('kokoro')` to avoid competing TTS servers.
- Evidence: `logs/server.log` records three repetitions of `Stopping inactive servers: kokoro`, followed by `kokoro server stopped gracefully`, immediately after graph queue delivery. `logs/run/kokoro-server.log` shows healthy startup, successful health checks, and orderly Uvicorn shutdown with no exception or crash traceback.
- Piper interpretation: the observed speech is not evidence that Kokoro failed and fell back. Piper is the saved primary provider for these requests. Kokoro's separate `autoFallbackToPiper` option is enabled, but the observed requests never selected Kokoro synthesis in the first place.
- Required correction before further playback validation: select Kokoro in the intended active profile through the canonical voice-settings owner, then make startup resolve that same profile path. Do not keep manually restarting a server while the saved provider remains Piper.

### TTS-009 - 2026-07-17 - Voice startup now uses the canonical external profile resolver

- Owner change: the user selected Kokoro again in the intended voice profiles; this implementation did not rewrite provider settings.
- Changed: `mh profile path --voice-config [username]` now prints one machine-readable path obtained from the existing core `getProfilePaths()` owner and exits with an explicit success/failure status.
- Changed: `bin/start-voice-server` consumes that command instead of constructing `profiles/$PROFILE/etc/voice.json`. A configured external/encrypted path resolution failure now stops voice startup visibly instead of silently selecting global Piper.
- Preserved: when no resolved profile voice file exists, the existing global `etc/voice.json` fallback remains. The prior Kokoro voice-default environment wiring is unchanged.
- Regression guard: added `packages/core/src/tts-startup-profile.spec.ts` and the root `validate:tts-startup-profile` build gate to reject a return to hard-coded repo-local profile paths or silent resolution failure.
- Runtime validation: the machine command returned `/media/greggles/STACK/metahuman-profiles/greggles/etc/voice.json`, whose selected provider is Kokoro. The currently running server remained healthy on port 9882 with voice `af_heart`, speed `1.0`, and CPU device.
- Passed: `pnpm validate:tts-startup-profile`, `pnpm -s check:architecture` with zero violations, `bash -n`, `shellcheck`, and scoped `git diff --check`.
- Existing validation debt: `pnpm typecheck:cli` remains blocked before checking this change because the workspace cannot find existing `diff` and `minimatch` type-definition packages. The changed CLI path was executed directly and returned successfully.
- Build note: no Astro build was run while the production site was live, avoiding the already characterized `dist` replacement race.
