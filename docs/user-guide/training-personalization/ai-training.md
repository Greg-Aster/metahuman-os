# AI Training

MetaHuman saves conversations and inner dialogue as profile memories. Training uses reviewed examples derived from those memories. A completed run creates a **candidate**; it does not change model assignments.

## Choose the learning objective

Open **Training → Training Wizard** and review **Training Data**.

- **Human continuation** is the default for personal voice. Its prompt is an actual earlier assistant turn and its target is the next recorded human reply. It requires a chronological conversation with stable session identity.
- **Assistant continuation** learns the recorded assistant/persona response to its actual user prompt. Cognitive mode does not reverse an exchange.
- **Include persona** adds the current persona summary as frozen context.
- **Source weights** control relative sampling. Zero excludes the source. Conversation starts at 100; other sources start at zero.
- **Synthetic limit** caps model-generated targets within each split. It defaults to zero and cannot exceed 50 percent. Generated inner-dialogue, dream and reflection examples require the assistant objective, an enabled source weight and a nonzero synthetic limit.
- **Evaluation percentage** reserves complete sessions for evaluation. Previous manifests preserve train/evaluation assignments even if you change the seed or percentage later.

Preview displays usable training/evaluation counts and exclusions. Legacy records without verifiable identity need another Curator review. Isolated, reversed or unrelated turns are excluded instead of paired by guessing. Invalid records are reported individually; locked profile storage blocks processing.

## Supported workflows

The wizard and these CLI entrypoints share the Core launcher and saved profile settings:

| Workflow | CLI | Output target |
| --- | --- | --- |
| Local LoRA | `pnpm exec tsx brain/training/personalization/full-cycle-local.ts --username NAME` | Ollama GGUF or vLLM adapter |
| Remote LoRA | `pnpm exec tsx brain/training/personalization/full-cycle.ts --username NAME` | Ollama GGUF or vLLM adapter |
| Remote full fine-tune | `pnpm exec tsx brain/training/personalization/fine-tune-cycle.ts --username NAME` | Ollama GGUF or native full model |

Use `--help` for CLI overrides. **Save training settings** makes wizard values available to the CLI. **Apply recommended preset** is an explicit action. A custom training base must be compatible native Hugging Face weights or a local weight directory. An Ollama inference tag is not a training base. Selecting a training backend does not change conversation or specialist model roles.

The profile's `etc/training.json` owns data, manual settings and automatic policy. Root `etc/training.json` supplies initial defaults. Each launch freezes configuration before starting its worker. Later edits cannot change that run. `max_samples: null` means all eligible examples; a rolling window can retain recent examples plus a deterministic sample of older history. Every run starts from the selected base and replays selected examples; it does not implicitly advance to the last trained model.

For local training, run `bin/setup-local-training` to install and check the pinned environment. The wizard checks the actual training venv and current GPU memory. The starting LoRA configuration uses a 4B model and 16-bit weights. Available memory, context, batch size, optimizer and concurrent inference determine whether it fits. Full fine-tuning needs substantially more memory.

Remote jobs require the profile's RunPod key, template, GPU type and an existing SSH key pair. `RUNPOD_SSH_KEY_PATH` selects the private key; its `.pub` file must exist. The template must provide the pinned environment from `docker/runpod-trainer`. The worker checks that environment before uploading private inputs. Review provider rates before launching.

## Capture, curation and datasets

The four maintained conversation graphs save the admitted user turn before model execution and save the final assistant turn before delivery. Model failure does not remove the saved input. Inner-dialogue producers retain their existing buffer and memory saver owners. Exact retries reuse persisted identity; changed messages cannot silently reuse that identity.

`episodic memories → Organizer → Curator → verified review store → Core selection → frozen dataset → shared trainer`

Curator saves a decision before marking sources. Reviews retain source hashes, session identity and model provenance. Recorded exchanges retain exact text; feedback cannot silently become a positive demonstration. Manifests bind source hashes, groups, sample IDs, selection settings and dataset files.

The Python trainer applies the model's native template once. Only the final continuation is supervised; prompt and padding tokens are masked. Overlong examples fail visibly instead of being silently truncated. Independent evaluation compares the base and candidate and reloads serialized weights in a fresh process. Personalization holdouts do not select checkpoints.

## Automatic training during Sleep

**Training → Automatic Training** is disabled by default. Enabling it authorizes one finite attempt in an eligible Sleep session, after Organizer and Curator succeed.

The policy includes minimum selected training examples, minimum new example IDs, cooldown, model settings, output target and maximum runtime. It uses Sleep's start time as the source cutoff. Failed attempts count toward cooldown.

Sleep owns the schedule. Manual and automatic runs share the admission lock. New user activity, a changed or ended Sleep session, cancellation, or the deadline stops the job. Automatic training leaves candidates for human review. Sleep records skipped admission and its reason visibly.

## Review, assignment and rollback

Open **Training → Training History** and choose a candidate.

1. Review status, independent losses, sample counts and artifact path. A failed quality gate cannot be accepted.
2. Click **Prepare exact artifact**. Ollama imports the verified merged GGUF. vLLM LoRA needs the exact training base running with runtime adapter loading enabled. For a full vLLM model, use **Backend setup** to serve the displayed artifact path first. Preparation does not assign a role.
3. Select a baseline model and backend. A baseline may use another configured backend; for example, compare a full vLLM candidate with an Ollama baseline. Enter three to eight representative prompts and run the comparison.
4. Review every response, add notes, and accept or reject. Acceptance checks the artifacts and serving identity again.
5. Open **Model Settings and rollback** to assign the accepted model to the intended role. Select a previous model there to roll back. Other roles remain unchanged.

A changed artifact or serving template blocks normal use and new assignment. Use **Suspend approval and start a new serving review** to prepare and compare the candidate again. Normal model dispatch checks the actual served artifact, including backend aliases. A lower held-out loss alone does not prove a better personal assistant. Representative task and persona review remains necessary.

## History, monitoring and cancellation

Training History and Training Monitor read the same profile-owned run and terminal receipts. The wizard does not treat a disappeared process as success. Console access is limited to the current profile's runs.

Cancellation stops worker and trainer/converter children, then waits for provider cleanup. Unconfirmed cleanup remains visible in Training History and blocks another launch. Use **Terminate remaining pod and verify cleanup** for explicit recovery. Provider inventory must confirm absence; a termination acknowledgement is insufficient. Ambiguous allocation is looked up by its exact saved run name and is not retried.

Artifacts resolve through the profile owner under `out/adapters/DATE/RUN_LABEL/`. Each run retains `run.json`, frozen configuration, datasets and manifest, plus an `adapter/` or `model/` directory containing weights, tokenizer files and evaluation receipts. Review lives beside the run. Custom or encrypted profile paths may resolve outside the repository. Personal data, outputs, credentials and weights must not be committed.

Optional S3 backup is off by default. When enabled, the verified candidate is downloaded, the GPU pod is terminated, and the existing S3 owner uploads the local artifact. Missing credentials or a failed requested backup are reported as failures.

## Troubleshooting and validation limits

- Unlock a locked profile. Capture cannot fall back to plaintext. Repair invalid records or exclude their source type.
- Insufficient independent examples require more representative sessions or adjusted selection settings. More epochs cannot fix missing data.
- Local dependency failures appear in the wizard's venv check. Working inference does not prove training dependencies are installed.
- Remote failures retain run and cleanup receipts. Inspect RunPod when recovery reports uncertainty.
- Changed hashes, model paths or templates require preparation and review again. The system cannot silently substitute another artifact.

Source and synthetic optimizer/reload tests do not establish useful personalization, remote-image deployment or production serving. Validate the selected model and backend on your task suite before relying on it.

## Environment Action Selector

The maintainer workflow under `brain/training/environment-action-selector` trains a typed action specialist. It is separate from personalization and retains development-fold evaluation while sharing the Python engine. It does not consume personal conversations and is not launched by this wizard.

Use `pnpm validate:environment-action-selector` and its documented dry-run and evaluation commands. Training does not authorize physical actions or change Core capability and Robot Status ownership.
