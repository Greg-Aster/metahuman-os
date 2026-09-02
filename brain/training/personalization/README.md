# Personalization training

This folder owns finite, user-triggered profile/persona training. All three
launchers use `dataset-pipeline.ts` for the canonical Curator store aggregation,
mode formatting, schema application, and dataset export stages:

- `full-cycle-local.ts`: local LoRA training.
- `full-cycle.ts`: remote LoRA training.
- `fine-tune-cycle.ts`: remote full-model fine-tuning.

`packages/core/src/training-launch.ts` resolves the authenticated profile and is
the only process-admission path used by the Training Wizard's
`/api/training/launch` endpoint. `training-automation.ts` prepares the same launch
contract from a profile policy. That shared contract carries the sample cap,
preprocessing and transport switches, persona inclusion, model and optimizer
settings, output target, and remote-runner selection into the finite launcher.
Full fine-tuning additionally applies the configured recent/older-history
window through `dataset-pipeline.ts` and `curated-aggregator.ts`.

Nothing here is a timer, persistent worker, or sleep-cycle task. Sleep-cycle
admission is intentionally a later phase.
