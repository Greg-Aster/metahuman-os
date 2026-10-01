# Kokoro ONNX migration

## Scope and baseline

- The owner explicitly requested switching this Q6A to Kokoro ONNX after the
  streaming startup repair. The previous managed server loaded a PyTorch speech
  model. An earlier local comparison used Kokoro ONNX 0.6.1, ONNX Runtime 1.30.0,
  the full v1.0 model, and the same Misaki frontend, voice, and speed.
- The existing Python server and installer own inference setup. `KokoroService`
  remains the request/cache owner; Voice Service Manager remains the lifecycle and
  device owner. Phrase splitting, browser buffering, and durable delivery retain
  their existing owners. No second server or fallback inference path is added.
- The existing cache identifier did not distinguish engines. A regression seeded
  old PyTorch audio and demonstrated that the first request skipped new synthesis.
  This regression failed before changing the identifier.

## Implementation and removals

- Replace the Python server's speech model with one ONNX Runtime session and
  `Kokoro.from_session`. CPU execution defaults to two threads, sequential mode,
  and disabled spin-waiting; the existing `OMP_NUM_THREADS` environment default
  can override the positive thread count. A requested unavailable CUDA provider
  fails visibly instead of silently running on CPU.
- Retain `KPipeline(model=False)` only for pronunciation, matching the earlier
  comparison. The Kokoro/PyTorch dependencies remain used by this frontend and by
  safe `weights_only` loading of existing `.pt` voicepack tensors. They no longer
  load or execute a PyTorch speech model. Request language, voice, speed and
  normalization reach the existing render owner. Missing/invalid custom voices
  fail instead of selecting a different voice.
- Rewrite the existing installer to pin tested engine versions, verify immutable
  model/voice downloads with SHA-256, and validate the actual execution provider
  and voice bundle. Remove the generated download script, PyTorch model download,
  misleading GPU auto-selection announcement, and ignored installation failures.
  Assets remain under ignored `external/kokoro/models`; no weights are tracked.
- Separate ONNX audio from old engine cache entries within the existing cache
  owner. Keep profile preferences and existing request endpoints. Health reports
  `engine: onnx`; Voice Settings identifies ONNX and lists actual language codes.
  Correct the previous American-English-as-auto-detection label and unsupported
  language choices. No extra provider, feature flag, or recurring job is introduced.

## Source and installation validation

- Six existing Python tests passed before migration. All 14 current Python tests
  pass, including concurrent health, serialized inference, pronunciation-only
  frontend construction, voice/style options, custom voice normalization, visible
  failures and recovery, provider admission, and bounded non-spinning sessions.
- All 15 synthesis tests and synthesis ownership validation pass. The regression
  now bypasses seeded PyTorch cache data and reuses subsequent ONNX audio.
- Core and Site type checks pass, with no Site errors, warnings or hints.
  Architecture validation reports zero violations. Site production build passes;
  existing mixed static/dynamic import notices remain outside this scope.
- Installer shell syntax and Python dependency checks pass. Installation verifies
  `CPUExecutionProvider`, all 54 voices, and no speech model in the pronunciation
  frontend. Model and voice assets total approximately 338 MiB.
- An edit to the installer while its first dependency installation was running
  interrupted the following shell step. The current script passes syntax checks;
  rerunning it reused installed packages, verified both downloads and exited zero.

## Live runtime and browser evidence

- The existing launcher restarted MetaHuman and Kokoro. Its runtime check verifies
  matching compiled/source code and all 38 workflows. The live Kokoro health route
  reports `engine: onnx`, `device: cpu`. The existing local LLM remains healthy.
- An authenticated, uncached request used the same synthetic reply as the PyTorch
  startup test. First audio arrived in 1.893 seconds and the stream completed in
  8.870 seconds, versus 4.311 and 17.373 seconds respectively on PyTorch after the
  same phrase-splitting repair. Both ONNX WAVs are non-silent mono 24 kHz and have
  the same 1.100/3.925-second durations as the corresponding PyTorch phrases. This
  is a live comparison, not a controlled thermal/throughput benchmark.
- Authenticated Chromium exercised the real preview with the selected
  `im_nicola` voice, 0.9 speed, and American English pronunciation. Its first
  non-silent Web Audio phrase started in 2.247 seconds, with stream completion
  at 7.861 seconds (previous PyTorch preview: 5.603/19.060 seconds). Both chunks
  were uncached and finished playing. Browser assertions and cleanup exited zero.
- A separate GUI check verifies the ONNX heading and nine explicit language
  choices. The captured settings panel shows the existing voice/speed and running
  server. Evidence is under ignored `out/benchmarks/kokoro-onnx-live-2026-09-30/`.
- A public built-in voice was saved as a temporary `.pt` fixture and read back
  through the server's canonical voicepack loader. Its `(510, 1, 256)` styles
  match exactly. Actual HTTP synthesis with built-in and imported styles returns
  valid non-silent audio of equal length. The fixture was deleted afterward.
  A diagnostic assumption of identical WAV samples was rejected: the vocoder
  adds random phase/noise, and repeated built-in requests also differ. The final
  check verifies exact style data and valid audio rather than waveform identity;
  maintained behavioral tests were not weakened.
- Temporary browser profiles and test credentials were removed. No model weights,
  speech samples, screenshots, credentials, or profile data are tracked.

## Verification boundaries

- CUDA hardware, the full language
  matrix, full workspace validation, speaker acoustics, and physical robot behavior
  are not established by the source tests or this CPU installation.
- ONNX does not guarantee real-time speech on an uncooled CPU. The startup repair
  releases a short first phrase; sufficient buffering for uninterrupted speech
  remains dependent on measured generation speed.
