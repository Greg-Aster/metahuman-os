# TTS Integration Plan: Piper & GPT-SoVITS

## 1. Current System Analysis
* **TTS Location:** `packages/core/src/tts.ts` currently hard-codes the Piper pipeline (config loading, caching, process spawn, multi-voice utilities) and is invoked by `/api/tts`.
* **API Surface:** `apps/site/src/pages/api/tts.ts` proxies browser requests to `generateSpeech` / `generateMultiVoiceSpeech`, while `apps/site/src/pages/api/voice-settings.ts` and `apps/site/src/pages/api/voice-models.ts` read/write `etc/voice.json` defaults for the UI.
* **UI Location:** `apps/site/src/components/VoiceSettings.svelte` provides the voice picker + test button, and `apps/site/src/components/ChatInterface.svelte` requests `/api/tts` when the user clicks "Speak".
* **Config Source:** `etc/voice.json` (templated by `etc/voice.json.template`) only models Piper (`tts.provider === 'piper'`) plus cache settings.

## 2. Proposed Architecture
* **Interface:** Introduce `ITextToSpeechService` (methods: `synthesize(text, options)`, `getStatus()`, `clearCache?`) plus a `createTTSService(provider, cfg)` factory. Piper and GPT-SoVITS classes implement this in `packages/core/src/tts/`.
* **Config Evolution:** Extend `voice.json` schema to allow `tts.provider: 'piper' | 'gpt-sovits'` with sibling configs (`tts.piper`, `tts.sovits`). Update `packages/core/src/profile.ts` + validators so new fields round-trip across profile provisioning and UI save flows.
* **Switching Logic:** `generateSpeech` becomes provider-agnostic—detect override in request (`provider` payload or user preference) and delegate to the matching service. Shared cache utilities stay in `packages/core/src/tts/cache.ts` and are re-used by both.
* **API Contract:** `/api/tts` accepts optional `provider` and passes it through. `/api/voice-settings` exposes + persists the provider choice alongside `voiceId` & `speakingRate`, returning it to the UI so toggles stay in sync.
* **Extensibility:** New providers can be registered by adding another class & config block; the UI toggle simply enumerates available providers from `/api/voice-settings`.

## 3. GPT-SoVITS Implementation
* **API Endpoint:** Default to `http://127.0.0.1:9880` (configurable host/port). POST payload includes `{ text, prompt_audio, speaker_id, temperature, speed, format }` depending on the deployed SoVITS build.
* **Input Requirements:** Accept text, optional reference audio file(s) or speaker embeddings (path under `out/voices/sovits/<profile>`), plus style parameters (emotion, speed). Provide validation + friendly errors when reference assets are missing.
* **Output Handling:** Expect WAV/PCM or Base64. Convert to `Buffer`, normalize sample rate (ffmpeg) to match Piper output (22.05k) so downstream playback is consistent, then run through existing cache writer when caching enabled.
* **Provider Class:** `packages/core/src/tts/providers/gpt-sovits.ts` handles HTTP requests (using `fetch`/`undici`), abort signals, retries/backoff, and logging via `audit`. It should memoize active requests to avoid duplicate GPU jobs.
* **Security & Errors:** Enforce local-only URLs by default, timeouts (config-driven), and sanitized file paths. Add fallback to Piper if SoVITS server is offline and the user toggled "auto fallback" in config.

## 4. UI Changes
* **Voice Provider Toggle:** In `VoiceSettings.svelte`, add a segmented control labeled "Voice Provider" with `Piper` / `GPT-SoVITS`. Bind to `provider` returned by `/api/voice-settings` and save via POST.
* **Provider-Specific Fields:** When SoVITS is selected, reveal inputs for reference clip, speaker, style, and server URL; hide Piper-only controls. Reuse the `selectedVoice` panel for Piper.
* **Chat Controls:** Ensure `ChatInterface.svelte` includes the chosen provider (and, if necessary, SoVITS speaker metadata) when requesting `/api/tts`, so ad-hoc speech respects the toggle.
* **Persistence:** Store provider preference in `etc/voice.json` (system default) plus optionally in session/localStorage for per-browser overrides; the backend remains source of truth to keep headless agents consistent.

## 5. VRAM & Resource Management
* Document GPU memory demands for GPT-SoVITS and add safeguards: (1) allow users to cap concurrent SoVITS jobs, (2) expose `/api/tts` status reporting GPU busy signals so UI can display "rendering…", (3) add config flag to automatically pause LLM high-VRAM prompts while SoVITS runs, or route SoVITS to CPU fallback.
* Provide operational notes in docs (e.g., recommend 12 GB VRAM, instructions for running `ollama serve` + SoVITS together). Encourage running SoVITS on a separate GPU when available.

## 6. New File Structure
* `packages/core/src/tts/interface.ts` – `ITextToSpeechService`, common option types.
* `packages/core/src/tts/providers/piper-service.ts` – current logic migrated & refactored.
* `packages/core/src/tts/providers/gpt-sovits-service.ts` – new provider.
* `packages/core/src/tts/cache.ts` – shared cache helpers.
* `docs/implementation-plans/tts-gpt-sovits.md` (optional deep dive) and updates to `docs/user-guide/14-configuration-files.md` to document new config keys.

## 7. Implementation Steps
1. **Schema & Config:** Update `etc/voice.json.template`, zod/TS types (`TTSConfig` in `packages/core/src/tts.ts`, profile bootstrap, API validators) to understand the new provider and config knobs.
2. **Refactor Core TTS:** Move Piper-specific code into a provider class, add the interface + factory, and adapt `generateSpeech`, `generateMultiVoiceSpeech`, `getTTSStatus`, and cache utilities to use the abstraction.
3. **Implement GPT-SoVITS Provider:** Build REST client, input validation, error handling, caching compatibility, and status reporting. Add unit/integration harness (CLI command or script) to ping the SoVITS server.
4. **API Adjustments:** Extend `/api/tts`, `/api/voice-settings`, `/api/voice-models` to surface provider info, receive overrides, and persist UI selections. Ensure multi-voice/mutant flows either stay Piper-only or describe how SoVITS handles multi-speaker mixing.
5. **UI Enhancements:** Update `VoiceSettings.svelte` (new toggle, conditional fields, improved error states) and `ChatInterface.svelte` (include provider in POST body, expose fallback messages). Add a small badge in `AgentMonitor`/`ChatInterface` showing the active provider for transparency.
6. **Docs & Ops:** Refresh ROADMAP/user guide, add troubleshooting section (SoVITS service not running, VRAM exhaustion), and describe how to prepare reference audio.
7. **Testing:** Smoke test both providers: `./bin/mh status` (ensures config loads), `/api/tts` POSTs for each provider, UI test voice button, and concurrency/abort scenarios. Capture logs in `logs/audit/` for regression evidence.
