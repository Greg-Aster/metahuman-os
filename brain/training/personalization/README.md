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
