# Voice Training

MetaHuman keeps recordings and trained artifacts in the active user profile. The maintained workflow is available from the Voice page in the web application.

## Supported workflows

| Provider | Maintained workflow | Source audio |
| --- | --- | --- |
| Piper | Select installed voices; no in-app model trainer | None |
| Kokoro | Select built-in or imported voicepacks; no custom trainer | None |
| GPT-SoVITS | Record or select reference audio for zero-shot synthesis | One clean reference clip |
| RVC | Curate a dataset, train a model, and use it for voice conversion | At least 50 exported samples and 10 minutes |

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
2. Collect at least 50 samples totaling at least 10 minutes.
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
- RVC exported samples: `out/voices/rvc/<speaker>`;
- RVC models: `out/voices/rvc-models/<speaker>`;
- GPT-SoVITS references: `out/voices/sovits/<speaker>`;
- status and logs: profile-aware runtime log paths.

Use the UI and public core/CLI operations to manage these artifacts. Avoid hand-maintained parallel datasets.

## Troubleshooting

- **Training will not start:** confirm the exported RVC dataset, not only the recording pool, satisfies the count and duration requirements.
- **Applio is unavailable:** run `./bin/mh rvc status`; install it with `./bin/mh rvc install` if needed.
- **GPU allocation fails:** free GPU memory or use `--device cpu`.
- **Voice quality is poor:** replace noisy samples instead of compensating with more epochs.
- **Synthesis falls back to Piper:** verify the selected model or reference artifact exists for the active profile.

See [Voice Features](../using-metahuman/voice-features.md) for runtime configuration and [Troubleshooting](../reference/troubleshooting.md) for system diagnostics.
