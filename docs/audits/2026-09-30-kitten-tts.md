# Kitten Micro integration

The Installation Owner requested Kitten Micro with all eight voices as the active
local speech engine. This is an explicit provider addition, not a replacement of
the Kokoro source or profile voicepack support.

## Baseline and owners

- A Kitten-only profile fell through the factory to Piper and failed as
  unconfigured. Three focused tests reproduced unsupported batch synthesis,
  empty streaming completion, and incorrect unknown-voice errors before editing.
- `tts.ts` still constructs profile-resolved providers. `KittenService` owns its
  batch HTTP requests and engine-specific cache identity. The existing generic
  stream handler owns Kitten prefetch and SSE; `speech-chunks.ts` owns boundaries
  and the shared browser player owns playback.
- `voice-service-manager.ts` still owns processes, ports and installation state.
  Kitten joins that owner's CLI, boot configuration, settings and status routes.
  Startup now serializes through the existing service mutation tails; device
  updates use the internal start operation to avoid re-entering that same lock.
- Python performs batch inference only, serializing phonemizer/model/NPZ access
  in a worker while health stays responsive. No additional speech queue,
  scheduler, stream endpoint, process manager or fallback was introduced.

## Changes and removal

- Added eight voice choices, saved voice/speed preferences and shared-player
  previews. Kitten is selected for boot; Kokoro remains manually available.
- Removed the generic stream's conversion of inference failures into empty
  buffers followed by apparent completion. Failure emits an error; cancellation
  stops prefetch without completion, and outstanding requests are aborted.
- Kitten 0.8.1 and Micro 0.8 assets are pinned and checksum-verified. There is one
  local model/voice bundle and no runtime model download. The upstream wheel's
  unused Misaki transformer extra pulls PyTorch/CUDA; the installer explicitly
  installs the dependencies actually imported by its espeak inference path.
- The pinned model constructor does not accept ONNX SessionOptions. Its initial
  session is replaced before serving with one bounded CPU session; no concurrent
  alternative inference path remains active.
- Kokoro source, saved preferences and imported personal voices are retained.
  Its downloaded installation assets were not deleted while the Owner evaluates
  alternatives. Robot speech remains explicitly limited to its existing Kokoro
  renderer; this change adds local browser and batch Kitten speech.

## Acceptance evidence

- All eight bundled voices generated valid nonempty audio during installation;
  dependency checks passed without PyTorch. Live managed health reports ready,
  CPUExecutionProvider and all eight names.
- Eleven profile/synthesis tests cover standalone configuration, ordered streams,
  voice overrides, generation ahead of delivery, visible inference failure and
  cancellation. Shared-player tests confirm Kitten selects streaming automatically
  and event-based completion remains intact.
- Five Python HTTP tests pass, including decodable 24 kHz PCM WAV, invalid input,
  inference failure, and responsive health during blocked synthesis. The FastAPI
  test client required execution outside sandbox socket restrictions.
- Core, CLI and Site type checks, synthesis/playback/service ownership checks,
  architecture/remote-safety check, Site production build and diff whitespace
  checks passed. Architecture validation required an unrestricted Git subprocess.
- The Owner reports improved but still noticeable pauses and unsatisfactory voice
  quality, and requests a Chatterbox Nano comparison. No claim is made that Kitten
  eliminates pauses. Controlled latency, speaker acoustics and physical robot
  delivery were not proven by these checks.
