# Profile TTS configuration repair

## Baseline and owner

- Authenticated `POST /api/tts-stream` returned HTTP 500 with `Voice configuration
  not found at etc/voice.json`. The selected profile had complete Kokoro/cache
  preferences and the managed Kokoro service was healthy.
- `packages/core/src/tts.ts` loaded a mandatory global file before considering
  profile preferences. It also cached global configuration and silently replaced
  malformed profile preferences with global defaults. The stream handler returned
  the asynchronous factory result without awaiting it inside its error handler.
- TTS owns profile-resolved service construction; KokoroService remains the
  shared batch/browser/robot synthesis owner and Voice Service Manager retains
  process/device ownership. No extra service or configuration store is needed.

## Repair and removals

- Read current profile preferences with optional existing installation defaults.
  A complete profile works without the global file. Keep path resolution through
  the existing profile/storage owners. Do not rewrite or invent preferences.
- Remove the mandatory global preload, stale singleton cache, repeated provider
  merge branches and silent malformed-profile fallback. Invalid/missing settings
  fail visibly before synthesis; the HTTP handler catches factory failures.
- The synthesis ownership check now examines the tracked voice template rather
  than requiring an ignored machine-local file. Added behavioral regressions to
  the standard synthesis validation command; the ownership assertions remain.

## Validation

- Before repair, three of five new regressions failed; after repair all pass.
  They cover global-file absence, batch/stream construction, preference updates,
  optional defaults, concurrent profile/cache isolation, and invalid configuration.
- All 11 synthesis tests and synthesis ownership checks pass. Voice service
  ownership/device checks (seven tests), TTS node ownership and browser playback
  tests, Core typecheck and architecture checks pass.
- Real synthesis using the active profile's configured voice returned a nonempty
  24 kHz WAV through the existing Kokoro service.
- Production Site build and compiled-runtime verification pass (38 workflows).
  The existing launcher restarted the application; llama.cpp remains selected.
- Authenticated Chromium requested the real `/api/tts-stream` route and received
  HTTP 200 with three ordered WAV phrases, the final-phrase flag and a matching
  completion count. Web Audio decoded all three to non-silent 24 kHz audio
  (8.275, 5.625 and 4.7 seconds). First audio arrived at 38.1 seconds and the
  complete stream at 79.8 seconds. CPU synthesis performance remains a limitation;
  these timings do not establish acceptable conversational latency.
- `git diff --check` passes. No global voice file, alternate service, dependency,
  profile rewrite or new polling loop was added. Full workspace validation and
  physical robot tests were not run.
- No physical robot command was issued. Acoustic playback through the user's
  speakers is not established by a generated WAV.

## Kokoro responsiveness follow-up

- A final live health check timed out while another speech request was running.
  `external/kokoro/kokoro_server.py` invoked blocking CPU inference inside async
  endpoints, preventing the server from answering its own health checks.
- Kept both synthesis endpoints and the existing render owner. FastAPI now runs
  synchronous synthesis handlers in its existing worker pool; a lock around the
  shared pipeline prevents overlapping inference. Health remains asynchronous.
  No extra executor, service, endpoint or dependency was introduced.
- Added two Python HTTP regressions using a synthetic pipeline and no model
  download. The busy-health regression timed out before repair; both tests pass
  after repair. Run with the installed Kokoro environment:
  `external/kokoro/venv/bin/python3 -m unittest discover -s external/kokoro -p 'test_kokoro_server.py'`.
- Restarted only Kokoro through Voice Service Manager. During real synthesis,
  `/health` returned HTTP 200 in 10 ms while generation remained in progress.
  The MetaHuman stream then completed successfully with WAV audio in 17.1 seconds.
  Synthesis/ownership and architecture validations pass after the Python change.
- CPU inference speed is still separate from this responsiveness fix. No NPU
  runtime or model conversion was installed or enabled during this repair.

## CPU load and thermal follow-up

- The operator reported roughly a minute for one sentence and confirmed that the
  board has no heatsink or fan. Read-only sysfs snapshots showed CPU temperatures
  around 88–93 C and active cpufreq cooling states. The prime core was capped near
  1.06 GHz against its 2.707 GHz hardware maximum. Later snapshots recovered full
  frequency caps as the board cooled; this is a changing thermal condition.
- The installed PyTorch uses OpenMP with eight intra-operation threads by default.
  Two native threads with passive waiting were tested through the existing managed
  service launcher using standard `OMP_NUM_THREADS` and `OMP_WAIT_POLICY` variables.
  No new runtime, model, dependency, service setting, or profile preference was
  introduced. These defaults are persisted only in ignored local `.env`, inherited
  by OpenMP workloads launched through `start.sh` unless explicitly overridden.
- A direct, uncached request for the same synthetic five-word phrase and unchanged
  voice/speed produced 1.975 seconds of WAV audio. Before: 5.650 seconds elapsed,
  1,871 process CPU ticks. With two threads and passive waiting: 5.533 seconds and
  870 ticks. This is about 54 percent less measured CPU work, not an established
  improvement in conversational latency. The second request was first synthesis
  after a restart, and temperature/scheduling were not controlled.
- A brief two-thread fast-core-only trial returned the same-duration WAV in 5.121
  seconds with 840 CPU ticks. The small difference did not justify retaining a
  machine-specific affinity setting. The subsequent managed restart restores the
  normal CPU affinity; only the two standard environment defaults are retained.
- No NPU benchmark or conversion was performed. The current Kokoro integration has
  CPU/CUDA selection and no smaller-model or inference-quality setting. No thermal
  limits, governor settings, or cooling protections were changed. Cooling remains
  unresolved, and the short test still generated speech slower than real time.
- The Python HTTP regression file is explicitly allowed by the existing narrow
  Kokoro `.gitignore` list so the responsiveness tests are available to future
  checkouts without admitting virtual environments or model assets.
- After the final launcher restart, MetaHuman and Kokoro returned HTTP 200,
  Kokoro reported CPU operation, and llama.cpp remained healthy. The actual speech
  process inherited the two OpenMP defaults and normal CPU affinity (0–7). The
  installed PyTorch reports two native threads with that same environment.
  Architecture validation and `git diff --check` pass after the documentation and
  regression-file inclusion changes.
