# Voice Training

MetaHuman keeps recordings and trained artifacts in the active user profile. The maintained workflow is available from the Voice page in the web application.

## Supported workflows

- **Piper:** select an installed voice. MetaHuman has no in-app Piper model
  trainer and does not require source audio for selection.
- **Kokoro:** select a built-in or imported voicepack. MetaHuman has no custom
  Kokoro trainer and does not require source audio for selection.
- **GPT-SoVITS:** record or select one clean reference clip for zero-shot
  synthesis. This does not train a new model.
- **RVC:** curate a dataset, train a model, and use it for voice conversion. The
  maintained readiness gate requires at least 50 exported samples, at least 600
  seconds of audio, and average sample quality of at least `0.7`.

The application does not claim to train Piper or Kokoro models. Importing an existing Kokoro voicepack is different from training one.

## Record useful samples

1. Open **Voice** and choose **Voice Clone Training**.
2. Record in a quiet room with one speaker and a consistent microphone position.
3. Keep speech natural and avoid music, echo, clipping, or long silences.
4. Review the saved samples before exporting them.

Recordings remain profile-owned data. Do not move them into maintained source directories or commit them.

## GPT-SoVITS reference audio

Choose GPT-SoVITS, record or select a clean clip, then copy the selected sample or use **Export best samples**. The reference is consumed at synthesis time; this workflow does not train a new model.

After preparing the reference, enable GPT-SoVITS under Voice Settings and use the test control to verify synthesis.

## RVC model training

1. Choose RVC in Voice Clone Training.
2. Collect at least 50 samples totaling at least 10 minutes, with average sample
   quality of at least `0.7`.
3. Copy selected samples or use **Export best samples**.
4. Select the epoch count, checkpoint interval, batch size, and device.
5. Start training and follow the status and logs shown in the same panel.

RVC training uses Applio and does not stop unrelated model servers. If GPU memory is insufficient, stop other GPU workloads yourself or choose CPU before starting training.

The CLI delegates to the same training owner:

```bash
./bin/mh rvc status --name default
./bin/mh rvc train --name default --device cuda
```

Run `./bin/mh rvc` for all supported options.

## Storage ownership

The storage router resolves these logical profile locations:

- collected recordings: the profile voice-training area;
- RVC exported samples: `out/voices/rvc/SPEAKER`;
- RVC models: `out/voices/rvc-models/SPEAKER`;
- GPT-SoVITS references: `out/voices/sovits/SPEAKER`;
- status and logs: machine runtime files under
  `logs/run/rvc-training-SPEAKER.json` and
  `logs/run/rvc-training-SPEAKER.log`.

Use the UI and public core/CLI operations to manage these artifacts. Avoid hand-maintained parallel datasets.

## Troubleshooting

- **Training will not start:** confirm the exported RVC dataset, not only the recording pool, satisfies the count and duration requirements.
- **Applio is unavailable:** run `./bin/mh rvc status`; install it with `./bin/mh rvc install` if needed.
- **GPU allocation fails:** free GPU memory or use `--device cpu`.
- **Voice quality is poor:** replace noisy samples instead of compensating with more epochs.
- **Synthesis falls back to Piper:** verify the selected model or reference artifact exists for the active profile.

See [Voice Features](/user-guide#voice-features) for runtime configuration and [Troubleshooting](/user-guide#troubleshooting) for system diagnostics.
