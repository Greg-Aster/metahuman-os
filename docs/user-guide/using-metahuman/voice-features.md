# Voice Features

MetaHuman OS supports microphone transcription, conversational speech synthesis, voice-asset collection, and selected voice-cloning workflows. These are separate stages with separate owners.

## Open Voice

Select **Voice** in the left sidebar. The page has:

- **Voice Settings** for speech-to-text, text-to-speech, provider, device, voice, speed, and voice-activity settings.
- **Voice Clone Training** for supported dataset, reference, export, and training workflows.

Save settings before testing a provider.

## Providers and Roles

- **Whisper** transcribes microphone audio for the Site. The maintained React
  Native shell may use device-native speech recognition instead.
- **Piper** synthesizes speech from an installed ONNX voice.
- **Kokoro** synthesizes speech with installed or imported voicepacks.
- **GPT-SoVITS** synthesizes speech using its service and reference audio.
- **RVC** converts Piper-generated speech with a trained profile model.

Whisper and Kokoro use the shared voice-service lifecycle. GPT-SoVITS has its own server lifecycle. RVC conversion runs on demand and does not have a second MetaHuman RVC server.

## Start and Check Shared Voice Services

```bash
./bin/mh voice-server status --all
./bin/mh voice-server start whisper
./bin/mh voice-server start kokoro
./bin/mh voice-server stop --all
```

The optional `--boot` flag on `voice-server start` starts only services enabled for system boot in `etc/voice-servers.json`.

## Use Voice Chat

In Chat:

- tap the microphone for a single recording and review its transcript before sending;
- long-press or right-click to toggle continuous conversation listening;
- enable the speaker control to request TTS for conversational replies.

The complete path is:

1. Site browser microphone capture;
2. managed Whisper transcription;
3. normal chat submission and model response;
4. TTS synthesis;
5. TTS queue delivery;
6. authenticated browser playback.

Check each stage independently. HTTP success from a speech provider proves synthesis only; it does not prove queue consumption or audible playback.

On the maintained React Native shell, the input side may use native device
speech recognition. The normal chat and response paths remain separate from
that platform-specific transcription step.

## Configure and Test a Provider

### Piper

Piper requires its executable, an `.onnx` model, and the matching model configuration. It is also the base synthesizer used by the RVC conversion path.

### Kokoro

```bash
./bin/mh kokoro status
./bin/mh kokoro voices
./bin/mh kokoro test --text "Hello"
```

MetaHuman OS supports Kokoro synthesis and voice selection. It does not provide a maintained custom Kokoro voicepack trainer.

### GPT-SoVITS

```bash
./bin/mh sovits status
./bin/mh sovits start
./bin/mh sovits test "Hello"
```

GPT-SoVITS requires its installed addon, a healthy service, and valid reference audio or speaker settings.

### RVC

```bash
./bin/mh rvc status --name MODEL_NAME
./bin/mh rvc train --name MODEL_NAME --device cuda
```

RVC requires Applio, Piper, an exported dataset, and enough local compute and storage for training. Choose the appropriate device for the installation.

## Voice Samples and Exports

The profile-owned sample commands are:

```bash
./bin/mh voice status
./bin/mh voice list
./bin/mh voice delete SAMPLE_ID
./bin/mh voice export
```

`voice export` prepares a dataset; it is not proof that a model was trained. Use the maintained RVC or GPT-SoVITS workflow described in [Voice Training](/user-guide#voice-training).

## Diagnose Failures

### No transcript

Check browser microphone permission, input device, audio level, and Whisper status.

### Text response but no sound

Check the selected TTS provider, its required artifacts, Queue state, browser autoplay/audio permission, and the active output device.

### Wrong voice

Confirm the active profile, selected provider, selected voice or model, and whether a provider-specific fallback is enabled. Fallbacks should be visible in configuration; do not assume the requested provider produced the audio.

### Training does not start

Confirm that the selected training path is supported, its addon is installed, the dataset exists, and the device has sufficient resources. Kokoro and Piper synthesis support must not be read as built-in custom training support.

## Runtime Data

Recordings, transcripts, datasets, reference audio, model weights, caches, logs, and generated audio are private runtime data. Keep them outside maintained source and do not commit them.

## Related Guides

- [Chat](/user-guide#chat-interface)
- [Voice Training](/user-guide#voice-training)
- [AI Training and Audio Data](/user-guide#ai-training)
- [Troubleshooting](/user-guide#troubleshooting)
