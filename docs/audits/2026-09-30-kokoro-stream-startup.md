# Kokoro streaming startup repair

## Baseline and ownership

- The phrase splitter combined a three-sentence response into a single synthesis
  request. A short opening greeting or clause was also merged into the remainder,
  so the browser's existing buffer could receive nothing until all of it was ready.
  Four focused regressions failed before repair, including decimal preservation.
- Voice Settings used a separate HTML Audio/SSE player, swallowed playback and
  stream errors, and appended a timestamp to spoken preview text to bypass caching.
  The shared browser player polled every 50 ms for playback completion.
- `tts/speech-chunks.ts` remains the phrase owner; `KokoroService` remains the
  sole synthesis owner; `useTTS.ts` remains the shared browser playback owner.
  Server lifecycle, durable delivery, and the HTTP contract remain unchanged.

## Repair and removals

- Release the first natural phrase with a 48-character bound, splitting longer
  clauses at words. Keep the existing larger chunk policy for remaining speech.
  Tail merging cannot swallow the opening phrase. Decimal punctuation is retained.
- Reuse the shared Web Audio player for streaming voice previews with explicit
  provider, voice, language, and speed. Remove the duplicate preview parser/player
  and spoken timestamp. Closing Voice Settings interrupts only its own preview.
- Resolve playback completion from audio/stream events and interruption. Remove
  completion polling. Ignore stale request cleanup and reject inconsistent chunk
  ordering/counts, truncated streams, and provider errors visibly.
- Keep the installed PyTorch engine. No new dependency, runtime, service, fallback,
  polling loop, or profile setting was introduced.

## Source validation

- `pnpm validate:tts-synthesis`: all 15 synthesis tests and ownership checks pass.
- `pnpm validate:tts-node-ownership`: ownership and browser playback tests pass,
  including first audio before later generation, contiguous buffered scheduling,
  event completion, interruption, supersession, exact preview text/options, and
  malformed/truncated/error streams. The older success fixture now advertises its
  actual single chunk; missing-chunk behavior is covered separately as a failure.
- Core and Site type checks pass; Site reports zero errors, warnings, or hints.
  Architecture checks pass with zero violations. Site production build passes,
  with Vite notices about existing mixed static/dynamic imports outside this change.
- The existing launcher restarted the application. Its compiled-runtime check
  confirms matching source and validates all 38 workflows.

## Runtime evidence

- Before repair, an authenticated uncached request for the synthetic 76-character
  test reply returned its only audio chunk after 12.607 seconds.
- After rebuild/restart, the same text produced an uncached opening phrase after
  4.311 seconds, with the second phrase at 17.370 seconds and completion at 17.373
  seconds. Startup fell by about 66 percent in this comparison; total generation
  increased. The post-restart measurement includes first-inference effects and is
  not a controlled throughput benchmark. All three WAVs are non-silent mono 24 kHz;
  the two new phrases last 1.100 and 3.925 seconds. This also demonstrates that the
  current CPU cannot fill the next phrase before the first one finishes.
- Authenticated headless Chromium exercised the actual Voice Settings preview
  with a different uncached test sentence. Web Audio scheduled the first non-silent
  phrase at 5.603 seconds while synthesis continued until 19.060 seconds. Both
  phrases decoded and finished playing; the test button returned to its ready
  state. The request contained exactly the synthetic text and selected voice,
  language, and speed. Audio was muted, so speaker acoustics were not tested.
- Browser behavior assertions passed. The diagnostic harness initially counted
  the separate silent autoplay-unlock sample; excluding samples before the speech
  request corrected its measurement. Temporary Chromium profile cleanup raced
  browser shutdown and failed in the harness; after the browser exited, explicit
  cleanup succeeded. No diagnostic browser or credentials were retained.
- Local timing artifacts are retained under ignored
  `out/benchmarks/kokoro-startup-2026-09-30/`. They contain synthetic test speech;
  authentication credentials are not included.

## Limits

- Shorter initial phrases reduce startup wait, not the CPU work needed for all
  speech. If synthesis is slower than playback, later phrases can still arrive
  late. Buffering cannot provide both immediate startup and uninterrupted speech
  under that condition.
- Full workspace validation and physical robot testing are outside this repair.
  Generated audio and browser playback scheduling do not prove speaker acoustics.
