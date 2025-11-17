# Kokoro TTS Add-on Integration Plan

## Objectives
- Ship a first-class Kokoro text-to-speech provider that can be installed and toggled via the existing add-on manager.
- Provide completely isolated Kokoro controls inside the Voice tab: one section under Voice Settings and one under Voice Clone Training.
- Allow users to install/start a Kokoro runtime, pick from bundled voices, train custom voice packs, and flip providers without affecting the existing Piper/GPT-SoVITS/RVC flows.
- Produce a handoff that another agent can follow to implement the feature safely.

## Research Findings

### Existing add-on and voice architecture
- Add-ons are declared in `etc/addons.json` and rendered in `apps/site/src/components/AddonsManager.svelte`. API routes in `apps/site/src/pages/api/addons/*.ts` call shell scripts such as `bin/install-sovits.sh`/`bin/install-rvc.sh` to mutate `etc/addons.json`.
- Voice configuration lives in `etc/voice.json` and is surfaced by `apps/site/src/pages/api/voice-settings.ts`. The UI (`apps/site/src/components/VoiceSettings.svelte`) currently hard-codes providers `piper`, `sovits`, and `rvc` with dedicated forms.
- Voice clone training uses `VoiceTrainingWidget.svelte`, which switches behavior based on the provider prop and calls provider-specific endpoints such as `/api/rvc-training`.
- Back-end synthesis is centralized in `packages/core/src/tts.ts` with provider classes under `packages/core/src/tts/providers`. Caching, path templates (`{METAHUMAN_ROOT}`, `{PROFILE_DIR}`), and Piper fallbacks already exist.

### Kokoro TTS at a glance
- Upstream repo: <https://github.com/hexgrad/kokoro>. Package `kokoro>=0.9.4` exposes `KPipeline` and the CLI `python -m kokoro ...`.
- Model card: <https://huggingface.co/hexgrad/Kokoro-82M>. Highlights: 82M parameters (StyleTTS2 + ISTFTNet), Apache 2.0 weights, ~54 voices across 8 languages (`VOICES.md` enumerates voices and language codes). Requires `espeak-ng` for English fallback and optional `misaki[ja]` / `misaki[zh]`.
- Voices are stored as `.pt` “packs” that map token lengths to 256‑D style vectors (`KPipeline.load_voice` loads them lazily). Custom voices can be created by supplying a different `voice.pt` tensor.
- Kokoro already supports CPU, CUDA, and Apple MPS. It expects ~24 kHz output and accepts a `speed` scalar.

## Architecture Overview

### Add-on assets and installation
1. **Add entry in `etc/addons.json`:**
   - `id`: `kokoro`
   - Category: `tts`
   - Requirements: `python>=3.9`, optional GPU, `espeak-ng`, `ffmpeg`.
   - Dependencies: pip packages (`kokoro>=0.9.4`, `soundfile`, `misaki[en]`, `misaki[ja]`, `misaki[zh]`, `espeakng` python bindings) plus system `espeak-ng`.
   - Installation commands reference new script `bin/install-kokoro.sh`.
2. **New install script (`bin/install-kokoro.sh`):**
   - Creates `external/kokoro`.
   - Sets up `venv`, installs dependencies above, downloads `VOICES.md`, `config.json`, base `voices/*.pt`, and `kokoro-v1_0.pth` into the external directory for offline use.
   - Generates helper scripts: `kokoro_server.py` (FastAPI runner), `build_voicepack.py`.
3. **CLI support:**
   - Add `packages/cli/src/commands/kokoro.ts` with subcommands `install`, `status`, `serve`, `voices`, `train-voicepack`, `test`.
   - Register under `mh kokoro ...` in `packages/cli/src/mh-new.ts`.

### Runtime server model
- Similar to RVC/Sovits: provide `/api/kokoro-server` to start/stop a background FastAPI server (`python kokoro_server.py --port 9882 --lang a --voices-dir ...`).
- Server responsibilities:
  - `/health` – returns version, installed voices, device.
  - `/synthesize` – text, lang_code, voice id (or custom `.pt` path), speed, streaming toggle. Returns WAV bytes.
  - `/voices` – returns cached metadata parsed from `VOICES.md`.
  - `/train` – optional endpoint that runs `build_voicepack.py` for a staged dataset and streams logs (Training can also be invoked via CLI to avoid long HTTP calls).
- `apps/site/src/lib/kokoro-server.ts` mirrors `rvc-server.ts`: track PID/log file, auto-start if `tts.kokoro.server.autoStart` is true, expose `getKokoroServerStatus`, `startKokoroServer`, `stopKokoroServer`.

### Configuration & paths
- Extend `etc/voice.json` (and template) with a `kokoro` block:
  ```json
  "kokoro": {
    "langCode": "a",
    "voice": "af_heart",
    "speed": 1.0,
    "splitPattern": "\\n+",
    "useCustomVoicepack": false,
    "customVoicepackPath": "{PROFILE_DIR}/out/voices/kokoro-voicepacks/default.pt",
    "server": {
      "useServer": true,
      "url": "http://127.0.0.1:9882",
      "autoStart": true,
      "port": 9882
    },
    "autoFallbackToPiper": true
  }
  ```
- Update `packages/core/src/paths.ts` to add `kokoroReference`, `kokoroVoicepacks`, and `kokoroDatasets`.
- Update `packages/core/src/tts/interface.ts` with `KokoroConfig`, extend provider union types (`'kokoro'`), and make cache aware of Kokoro keys.
- `createTTSService` instantiates `KokoroService` when provider is `kokoro`, ensuring Piper fallback remains optional.

## UI / UX Changes

### Add-ons Manager
- New Kokoro card with install/uninstall buttons, disk footprint, GPU hint, and a “View voices” action that opens documentation or the new `/api/kokoro-voices`.

### Voice Settings tab
- Provider grid now includes “Kokoro TTS (🫀)” card.
- Kokoro-specific panel:
  - Server status indicator bound to `/api/kokoro-server`.
  - Language dropdown (populated via `/api/kokoro-voices`).
  - Voice dropdown filtered by language, showing quality grade / gender badges.
  - Speed slider, split pattern textbox, toggle for “Use custom voicepack” with file selector listing user-trained packs.
  - “Refresh voice catalog” button (hits `/api/kokoro-voices?action=sync` to re-download VOICES.md).
  - “Generate test audio” button calling `/api/tts` with `provider: 'kokoro'`.
  - Clear messaging that clicking “Save Settings” switches the active provider.

### Voice Clone Training tab
- When `currentVoiceProvider === 'kokoro'`, `VoiceTrainingWidget` should:
  - Display Kokoro-specific requirements (≥5 minutes curated speech, matching language transcripts).
  - Show dataset metrics for `profiles/{user}/out/voices/kokoro-datasets/{speaker}` separate from RVC/Sovits data to avoid cross-contamination.
  - Offer actions:
    - “Stage best samples for Kokoro” (calls `/api/kokoro-training?action=stage` to copy filtered recordings into Kokoro dataset structure).
    - “Build Voicepack” (POST `/api/kokoro-training` with `action: 'start-training'`, `langCode`, `baseVoice`, `epochs`, `learningRate`).
    - Download/export resulting `.pt`.
    - View live logs and cancel training.
  - Provide clarity when RVC/Sovits data exists but Kokoro dataset is empty.

## Backend Implementation Tasks

### Configuration & schemas
- Update `apps/site/src/pages/api/voice-settings.ts` to serialize/deserialize `kokoro` settings, ensure defaults exist, and expose available Kokoro voices via the response body when provider is Kokoro (optional).
- Extend `apps/site/src/pages/api/voice-training.ts` to accept `provider=kokoro` or add a dedicated `kokoro-training.ts` route similar to `rvc-training.ts`.
- Add JSON schema updates if validation is enforced anywhere (e.g., `etc/addons-schema.json`, `voice-schema.json` if present).

### KokoroService (packages/core)
- Create `packages/core/src/tts/providers/kokoro-service.ts` implementing `ITextToSpeechService`.
  - In direct mode: spawn `python3 external/kokoro/kokoro_cli.py --text ...`, pipe WAV back.
  - In server mode: `fetch` the FastAPI endpoint and stream bytes.
  - Handle cache keys: `${lang}:${voice}:${speed}`.
  - Support `useCustomVoicepack` by pointing to a `.pt` in `{PROFILE_DIR}/out/voices/kokoro-voicepacks`.
  - When Piper fallback is enabled and server fails, log via `audit` and call `PiperService`.
- Add helper to list installed Kokoro voices (read `external/kokoro/voices.json`).

### Data staging & training helpers
- Extend `packages/core/src/voice-training.ts` with Kokoro-specific functions:
  - `stageSamplesForKokoro(sampleIds, speakerId, langCode)` → copies `.wav/.txt` pairs into `paths.kokoroDatasets`.
  - `startKokoroVoicepackTraining(options)` → spawns `external/kokoro/build_voicepack.py`.
  - `getKokoroTrainingStatus()` → read JSON from `logs/run/kokoro-training-<speaker>.json`.
  - `listKokoroVoicepacks()` → returns metadata for `.pt` files in `paths.kokoroVoicepacks`.
- Update `apps/site/src/pages/api/kokoro-training.ts` to call these helpers.

### API routes
- `/api/kokoro-addon` – mirrors `/api/rvc-addon`.
- `/api/kokoro-server` – wraps `lib/kokoro-server`.
- `/api/kokoro-voices` – GET returns cached list, optional `sync=true` to refresh from Hugging Face.
- `/api/kokoro-voicepacks` – CRUD operations for user-generated packs (list, rename, delete, set default).
- `/api/kokoro-training` – GET for readiness/status, POST for staging/training/cancel.

### CLI commands
- `mh kokoro install|status|voices|serve|train-voicepack|test`.
- `mh kokoro voices` prints table from `/external/kokoro/voices.json`.
- `mh kokoro train-voicepack --speaker greg --lang a --base-voice af_heart --epochs 600` triggers the same script as the UI uses (with optional `--dataset` override).

### Logging & telemetry
- Mirror the pattern used for Sovits/RVC:
  - Logs under `logs/run/kokoro-server.log` and `kokoro-training-<speaker>.log`.
  - `audit()` events for installing, server start/stop, synthesis errors, fallback usage.

## Testing & Validation
- **Install smoke test:** `./bin/install-kokoro.sh` succeeds on Linux and macOS; espeak-ng instructions documented for Windows.
- **Server:** `curl http://localhost:9882/health` after install, ensure `VoiceSettings` status indicator updates.
- **TTS:** call `/api/tts` with `provider='kokoro'` from the UI and confirm WAV playback.
- **Training:** run staging + build flow on sample data, confirm `.pt` appears in `profiles/<user>/out/voices/kokoro-voicepacks` and selectable in UI.
- **Regression:** verify Piper, GPT-SoVITS, and RVC providers are unaffected (save/switch still works, training widget doesn’t regress).
- **Docs:** Update README/voice system docs to mention Kokoro provider and any new commands.

## Open Questions / Dependencies
1. **Voicepack training algorithm:** Kokoro upstream doesn’t provide an official style encoder CLI. The proposed `build_voicepack.py` must optimize the style tensor using existing StyleTTS modules. Confirm feasibility (may need guidance from upstream or to reuse StyleTTS2 fine-tuning scripts).
2. **License compliance:** Hugging Face terms permit bundling voices, but double-check if redistributing `.pt` packs locally is acceptable.
3. **Resource usage:** Kokoro can run entirely on CPU but is faster with CUDA/MPS. Need to expose device selection in settings and ensure server respects the voice config.
4. **Multi-language transcripts:** Training flow must guarantee transcripts are in the selected language (auto-filter or warn).
5. **Security:** Validate any user-supplied voicepack paths (avoid directory traversal) before handing to Python.

Answering these open items will keep the coding agent unblocked when they implement the add-on.
