# Personalization training

This folder owns finite profile/persona training. All three CLI entrypoints use
Core's single process-admission owner and the shared `full-cycle.ts` worker.
`dataset-pipeline.ts` orchestrates preprocessing and freezes a dataset. Core's
`training-dataset.ts` owns the shared preview/selection rules: source provenance,
chronological targets, deterministic weights, source-group splits, deduplication,
and bounded replay. `training-schema.ts` is the browser-safe contract used by
the controls and validators. Model-family wrapper files have been removed.

- `full-cycle-local.ts`: local LoRA training.
- `full-cycle.ts`: remote LoRA training.
- `fine-tune-cycle.ts`: remote full-model fine-tuning.

`packages/core/src/training-launch.ts` resolves the authenticated profile and is
the only process-admission path used by the Training Wizard's
`/api/training/launch` endpoint and the CLI entrypoints. `training-automation.ts` prepares the same launch
contract from a profile policy. That shared contract carries the sample cap,
preprocessing and transport switches, persona inclusion, model and optimizer
settings, output target, and remote-runner selection into the finite launcher.
The admitted configuration is frozen before spawning a worker, so later settings
edits cannot change an in-flight job. Both training modes use
`docker/runpod-trainer/train_unsloth.py` and the same pinned Python environment.
Datasets contain unwrapped messages, an independent evaluation file, and a manifest
with source hashes, selection settings and dataset hashes. The trainer applies its
tokenizer template once and supervises only the final continuation. Human targets
use the next recorded human reply; cognitive mode never reverses an exchange.
Selection resolves the objective from each record's verified saved mode. The
`data.objectivesByMode` defaults learn human continuations in Dual Consciousness
and assistant continuations in Environment Mode. Agent and Emulation retain the
configured `data.objective`. Records without verified mode attribution remain
excluded. The controls, preview, automatic readiness and finite trainer share
this policy; changing the current UI mode does not relabel historical records.

Explicitly reviewed experiments may supply `reviewedDataset` to the same Core
launcher. Core verifies objective/target author and preserves conversation or
scenario-family splits, including previously frozen assignments. The worker
freezes those complete messages and their per-sample system context in the same
manifest format; it does not replace planner/executor evidence with a generic
conversation pair or rerun preprocessing over reviewed inputs. Reviews retain
their author, timestamp and purpose. This input is not automatic approval of raw
memories and does not change the specialist 0.8B training path.

Remote workers install the uploaded `docker/runpod-trainer/requirements.txt`
into the template's existing training environment before checking its imports
and CUDA. Older templates therefore receive the same pinned dependency contract
as current image builds and local training. Installation failure is reported and
the existing pod cleanup runs. `base_model_revision` pins a run's native snapshot
and is retained in its adapter configuration. Reload evaluation loads that base
revision explicitly before attaching the saved adapter, because the dependency's
adapter-path loader can otherwise discard the revision.

The remote lifecycle mounts mutable job data at `/workspace/data`, with each run
below that directory. It does not mount over `/workspace`: current published
trainer images install their Python environment at `/workspace/unsloth-venv`,
which a fresh volume at `/workspace` would hide. The per-pod mount is explicit
and does not mutate shared provider templates or other running jobs.

The Environment specialist CLI also delegates explicitly approved remote fits to
this same `runRemoteTraining` transport/lifecycle owner. Its `specialistJob` input
carries the specialist identity, configured GPU, disk allocation and approved
hourly/total budget. It accepts the specialist's frozen development-only reused
recipe provenance, uploads no evaluation data, and requires an unactivated
candidate receipt with external serving evaluation still outstanding. Artifact
download verification and provider cleanup are shared with personalization; this
does not change personalization dataset selection or its independent evaluation.

Reviewed experiments can include `generationEvaluation` cases and inference
settings in the launch request. The shared trainer records complete prompts,
continuations, token counts, latency and GPU memory before optimization and after
reloading the saved candidate in a fresh process. These native-backend results
supplement loss; they do not establish behavioral qualification or serving parity.

Frozen manifests retain the mode mapping and `systemPromptsByObjective`. Each
sample records its resolved objective and target author; the Python consumer
checks those objectives and the corresponding existing persona-context text
before applying the native template. Older manifests retain their original
single-objective and single-prompt interpretation. Source-group split history
continues to apply across objective changes.

The Training Wizard and Automatic Training share `/api/training-data` settings for
the target, persona context, source weights, synthetic cap, evaluation split and seed.
Zero weights exclude a source. Legacy reviews remain readable but need current
source provenance before use in a new dataset.

Training produces a candidate and an artifact evaluation receipt. Failed quality
gates remain visible; workers never replace the active adapter or advance the
training base. Core verifies weights, tokenizer, config and reload-evaluation
checksums before candidate review. Serving validation and activation are separate.

Run `python3 -m unittest discover -s docker/runpod-trainer -p 'test_*.py'` for the
CPU contract checks. To run the isolated optimizer/reload checks, set
`METAHUMAN_TRAINING_SMOKE_MODEL` to a cached local model directory and use the
training venv's Python. These tests use synthetic examples and temporary outputs.

Sleep Workflow admits the bounded `training.personalization` stage after
successful Organizer and Curator stages when Automatic Training is enabled and
eligible. It calls the same Core launcher and waits for the terminal receipt.
The worker checks its active Sleep session and runtime deadline; it does not
schedule new work. Wake/cancellation stops children and confirms provider cleanup.

Training History exposes artifact preparation, actual-backend prompt comparison,
accept/reject decisions and recovery of unconfirmed RunPod cleanup. Existing
Model Settings owns role assignment and rollback. History, logs and Monitor share
Core's run/process receipts. No worker advances the base or an active-adapter file.
See [the user workflow](../../../docs/user-guide/training-personalization/ai-training.md).
