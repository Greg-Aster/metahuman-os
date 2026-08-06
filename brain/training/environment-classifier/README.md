# Environment Classifier Gold Corpus

This directory owns synthetic system-routing training and evaluation material for the Environment Context Router. It is deliberately separate from profile, persona, conversation-memory, and user LoRA datasets.

## Contents

- `corpus.json`: 64 reviewed cases: 48 development and 16 held out.
- `held-out.lock.json`: the held-out case ids and digest. A changed id, input, or expected route makes validation fail.
- `benchmark.ts`: one provider-neutral sequential harness for Ollama and vLLM classifiers.
- `benchmark.spec.ts`: offline corpus, lock, coverage, and safety-gate checks.

Expected outputs are validated through `@metahuman/core/environment-classifier`. This lane does not define another routing schema, and the benchmark reads the active Context Router prompt from `etc/cognitive-graphs/environment-mode.json`.

## Commands

```bash
pnpm validate:environment-classifier
pnpm generate:environment-classifier-training
pnpm train:environment-classifier:0.8b -- --dry-run --fold 0
pnpm train:environment-classifier:0.8b -- --fold 0 --output out/environment-classifier/training/qwen3.5-0.8b-cv-001
pnpm evaluate:environment-classifier:checkpoint -- --root out/environment-classifier/training/qwen3.5-0.8b-cv-001 --fold 0 --checkpoint checkpoint-326
pnpm score:environment-classifier:development -- --root out/environment-classifier/training/qwen3.5-0.8b-cv-001 --fold 0 --predictions out/environment-classifier/training/qwen3.5-0.8b-cv-001/fold-0/checkpoint-326-validation-predictions.jsonl
pnpm score:environment-classifier:development -- --root out/environment-classifier/training/qwen3.5-0.8b-cv-002 --checkpoint-policy final-epoch
pnpm train:environment-classifier:0.8b -- --final --selection-report out/environment-classifier/training/qwen3.5-0.8b-cv-002/development-validation-final-epoch.json --output out/environment-classifier/training/qwen3.5-0.8b-final-001
pnpm evaluate:environment-classifier:final -- --dry-run --root out/environment-classifier/training/qwen3.5-0.8b-final-001
pnpm evaluate:environment-classifier:final -- --root out/environment-classifier/training/qwen3.5-0.8b-final-001
pnpm benchmark:environment-classifier -- --split held_out
pnpm benchmark:environment-classifier -- --split all
```

The dry run checks repository ownership, the generated development data, the
locked split, the compact system prompt, and source-case fold isolation without
loading a model. The maintained candidate is the Apache-2.0
`unsloth/Qwen3.5-0.8B` trainable weight set, adapted with the repository's
existing Unsloth LoRA owner. Training targets the complete 14-field JSON
decision; `@metahuman/core/environment-classifier` remains the only runtime
contract and scoring authority.

`buildEnvironmentClassifierMessages` in that same Core owner is the single
compact input formatter for generated training rows, live Environment Router
inference, and compact benchmark requests. The provider-neutral benchmark keeps
its ordinary graph format for historical baselines and uses
`--message-format compact` for specialized adapters.

The 48 development cases may be used for training and checkpoint selection.
Never run the locked 16-case held-out split until one model and checkpoint have
been selected from development validation.

Use `--fold 0` to inspect the pilot without requiring unfinished fold outputs.
After all four folds finish, omit `--fold` to produce the aggregate
cross-validation report. When the selection rule is the last retained epoch,
use `--checkpoint-policy final-epoch`; the scorer selects the highest evaluated
checkpoint inside each fold and records every selected prediction filename in
the report. It does not copy predictions or change the routing contract.

Final training requires `--final` and the selected four-fold development report.
It trains one adapter on all 48 development source cases, writes no synthetic
validation split, and records the report digest plus its safety metrics in final
artifact provenance. The held-out lock is verified but no held-out model input
is read during training.

The final evaluator validates that provenance and adapter shape, starts the
adapter through the existing Core vLLM owner, and calls the provider-neutral
benchmark on the locked split. Immediately before the first held-out request it
writes `locked-evaluation-receipt.json`; completed and failed receipts both
prevent reruns, so a disappointing final result cannot become tuning data.

Training uses the fold's validation records for epoch loss and checkpoint
retention, but does not generate route responses inside the long-lived training
process. Checkpoint evaluation runs in a fresh process so training compilation
state cannot affect inference. It accepts only one retained adapter under the
selected development fold and rejects held-out source ids before loading the
model. Use the resulting prediction path with `--predictions` to keep a separate
report for each checkpoint.

Ollama remains the default provider for the historical Qwen baselines. vLLM
remains the native development-serving candidate for safetensors LoRA artifacts.
Override the model list without changing the corpus or scoring contract:

```bash
pnpm benchmark:environment-classifier -- --models qwen3.5:2b,environment_classifier:latest --split held_out
pnpm benchmark:environment-classifier -- --provider vllm --models environment-classifier-2b-checkpoint-120,environment-classifier-2b-final --split held_out
```

Machine-readable JSON and a short Markdown comparison are written to `out/environment-classifier/`. Models run sequentially so one model's generation does not distort the other's timing. One warm-up per model is reported separately and excluded from case latency. Wall-clock latency is the cross-provider comparison metric; provider-native timing is retained when the provider supplies it.

Exact route parity compares the routing decisions that alter graph behavior: memory admission, environment admission, vision admission, action authority/type, continuation policy, and required completion basis. The Core validator independently checks every field in the complete 14-field response. A model fails the gate for any invalid JSON, invalid Core contract, route mismatch, false-positive action authorization, or unnecessary vision admission.

Never use `held_out` cases for prompt tuning, adapter training, or development decisions. Change the lock only as an explicit corpus-versioning decision.
