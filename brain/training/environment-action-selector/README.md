# Environment Action Selector Training

This lane trains a small system model for the current typed Environment output:
`response`, `actions`, `movementRequest`, and `taskDecision`. It does not revive
the retired 14-field Context Router, create action aliases, generate servo
commands, or replace deterministic capability and task-state validation.

Ownership:

- `@metahuman/core` owns the compact request,
  strict output validation, and semantic decision view used by training and
  evaluation.
- This directory owns sanitized source cases, controlled development
  variations, LoRA training, and benchmark tooling.
- Profile, persona, memory, and user LoRA data are not inputs.
- `out/environment-action-selector/` owns generated checkpoints and reports.

The corpus contains 129 development source cases. Each case produces twelve
controlled records from four reviewed instruction surfaces and three context
conditions. A source case and all its variants remain in one fold. Training
reads the retired classifier's completed lock and one-shot receipt only as
provenance; it never imports or reruns those 16 closed cases.

Commands:

```bash
pnpm validate:environment-action-selector
pnpm generate:environment-action-selector-training
pnpm train:environment-action-selector:0.8b -- --dry-run
pnpm train:environment-action-selector:0.8b
pnpm evaluate:environment-action-selector:folds -- --root out/environment-action-selector/training/<run>
pnpm score:environment-action-selector:development -- --root out/environment-action-selector/training/<run>
pnpm evaluate:environment-action-selector:folds -- --root out/environment-action-selector/training/<run> --checkpoint-policy epoch-2
pnpm score:environment-action-selector:development -- --root out/environment-action-selector/training/<run> --checkpoint-policy epoch-2
pnpm evaluate:environment-action-selector:folds -- --root out/environment-action-selector/training/<run> --checkpoint-policy final-epoch
pnpm score:environment-action-selector:development -- --root out/environment-action-selector/training/<run> --checkpoint-policy final-epoch
pnpm train:environment-action-selector:0.8b -- --final-from out/environment-action-selector/training/<selected-cv-run> --selection-report out/environment-action-selector/training/<selected-cv-run>/development-validation-epoch-2.json --output out/environment-action-selector/training/<final-run>
pnpm export:environment-action-selector:merged -- --root out/environment-action-selector/training/<final-run>
```

Omitting `--fold` launches all four independent development folds in two
successive pairs so normal system testing retains GPU headroom.
Use `--fold 0` for a single pilot. Fold adapters are validation rotations, not
models to merge together. After development scoring selects one recipe, train
one final adapter on all 129 development cases and run one separately frozen,
system-owned deployment evaluation. The retired 16-case set remains closed and
must not be used for training, prompt tuning, checkpoint selection, or another
evaluation pass.

Deployment remains conditional on strict JSON, Core-contract validity, semantic
selection accuracy, false-positive and missed actions, unnecessary captures,
and latency. The model is not the safety boundary: Core capability admission
and Environment Task State remain authoritative.

Current development status: `qwen3.5-0.8b-cv-004` completed in two trainer
pairs but was rejected. Its better epoch-two checkpoint reached 87.0% exact
routing with 28 unsafe authorizations, 94 missed actions, 59 wrong actions, and
96.9% strict JSON. `qwen3.5-0.8b-cv-003` epoch two remains the strongest
development recipe at 89.7% exact routing, but it is also not deployment-ready.

Final training reconstructs the selected development corpus from the four
archived validation rotations, verifies it against the reviewed source cases
and Core prompt, and trains one adapter on the complete selected corpus. Fold
adapters are never merged. The shared training exporter merges that final LoRA
into its exact base and emits one text-only Q4_K_M GGUF for Ollama.
