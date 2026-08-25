# Voice Features

MetaHuman provides speech recognition, speech synthesis, voice chat, and profile-owned voice assets. Configure the active provider from the Voice page.

## Provider roles

- **Whisper** transcribes microphone audio.
- **Piper** provides local synthesis from installed ONNX voices.
- **Kokoro** provides local synthesis from built-in or imported voicepacks.
- **GPT-SoVITS** synthesizes with profile reference audio through its service.
- **RVC** converts Piper-generated speech with a trained profile model through Applio's maintained command-line interface.

Each role has one lifecycle owner. Whisper and Kokoro use the shared voice-service manager; GPT-SoVITS has its own service lifecycle; RVC conversion runs on demand and has no separate MetaHuman RVC server.

## Configure speech

1. Open **Voice Settings**.
2. Select a TTS provider and its voice or speaker.
3. Select the Whisper model and device for STT.
4. Save, then use the provider test control.

Provider settings are stored in the active profile's `etc/voice.json`. Prefer the UI or API over editing that file directly because the handler validates values and maintains profile paths.

## Voice chat

Voice chat records microphone input, sends it to Whisper, submits the transcript through the normal chat path, and plays the resulting TTS audio. If a stage fails, verify it independently:

1. microphone permission and input level;
2. Whisper service health;
3. chat backend health;
4. selected TTS provider and its required artifacts;
5. browser audio permission and output device.

## Provider requirements

### Piper

Requires an installed Piper binary, an `.onnx` voice model, and its JSON configuration. It is also the base and fallback synthesizer for RVC.

### Kokoro

Requires the Kokoro addon and shared service. The repository supports synthesis and imported voicepack selection, not custom Kokoro training.

```bash
./bin/mh kokoro status
./bin/mh kokoro voices
./bin/mh kokoro test --text "Hello"
```

### GPT-SoVITS

Requires the addon, a running service, and reference audio for the selected speaker. The Voice page can record, select, and export the reference.

### RVC

Requires Applio, an RVC model, and Piper. Device and quality settings apply to each conversion process. Use Voice Clone Training or the canonical CLI training command to create models.

```bash
./bin/mh rvc status --name default
```

## Runtime data

Voice recordings, models, references, caches, and logs are user/runtime data. They must remain outside maintained source and must not be committed.

See [Voice Training](../training-personalization/voice-training.md) for dataset and model workflows.
