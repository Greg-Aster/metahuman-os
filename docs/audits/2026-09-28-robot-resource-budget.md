# Robot resource budget: MetaHuman findings

The later [distributed foundation review](2026-09-28-distributed-robot-foundation.md)
records the owner's wireless, interchangeable-host and shared coordination
requirements. It extends deployment planning without changing these measurements.

Read-only source audit at `b57d205895d785d96194b9b9893f7c0b07838447`.
The owner's requested system budget lives in the sibling Ainekio repository:
[complete budget](https://github.com/Greg-Aster/Ainekio-bot/blob/main/docs/v2-12servo/RESOURCE_BUDGET.md) and
[measurement/source evidence](https://github.com/Greg-Aster/Ainekio-bot/blob/main/docs/v2-12servo/BUDGET_AUDIT_EVIDENCE.md).

| Maintained owner | Audited behavior | Budget consequence |
| --- | --- | --- |
| [robot-speech.ts](../../packages/core/src/tts/robot-speech.ts), constants and `collectKokoroWavChunks` / `prepareRobotSpeech` | Up to 3 MiB / 64 chunks; collects speech before preparing and enqueueing its environment action | First robot delivery waits for preparation of the entire accepted utterance; receiving chunks does not establish streaming playback latency |
| [robot-audio.ts](../../packages/core/src/tts/robot-audio.ts), format constants and conversion/staging | 16 kHz mono 16-bit PCM, 640-byte frames, 480,000-byte PCM limit, 2 MiB per WAV, four staged artifacts | Codec-quality changes also require changes here and in the gateway; model output rate alone does not determine robot audio quality |
| [Kokoro server](../../external/kokoro/kokoro_server.py) and [voice configuration](../../etc/voice-servers.json) | Installed CPU synthesis path; 24 kHz output | The separate offline host measurement produced 5 seconds of speech in 15.068–15.904 seconds, with 1,537.797 MiB process peak RSS; this is one phrase on the current Q6A, not a universal timing ceiling |
| [Voice configuration](../../etc/voice-servers.json), Whisper entry | base.en / int8 / CPU selected; configured environment absent on this host | Configuration is not evidence of a running STT service or its concurrent working set |

The final host budget includes OS, gateway/MetaHuman, concurrent TTS/STT/vision,
buffers and any selected local model. Exact concurrent demand cannot be derived
by treating installed model-file sizes as RAM or summing shared RSS pages.
Heavy reasoning remains owned by the planned remote machine.

No production code, service state, model location, configuration, firmware or
body state was changed. The pre-existing `etc/voice-servers.json` modification
was preserved. The source and measurement audit does not certify the final
robot's full-load operation. Validation is document-link/arithmetic review;
application builds and movement tests are outside this documentation change.
