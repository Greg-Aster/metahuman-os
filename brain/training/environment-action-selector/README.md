# Environment specialist training

This existing lane trains two independent Qwen3.5 0.8B LoRA adapters:

- **Intent** reads only the current request and returns the nine independently selected routes, with optional memory search fields.
- **Task** receives the runtime Context Builder's selected evidence and capability catalog. It returns `taskDecision`, an ordered `program`, and execution handoff fields when applicable. It can also return the approved `{"delegatePlanning":true}` branch to ask the configured larger model for a plan. Both paths use Core task validation and the same active executor. It does not produce conversational speech.

The conversation model remains independent. Training reads the approved prompts from `etc/cognitive-graphs/environment-mode.json` without changing them. Core owns context construction, intent parsing, task validation, and capability admission. The shared trainer is `docker/runpod-trainer/train_unsloth.py`; this directory owns synthetic task data and the specialist training/evaluation lifecycle.

`intent-cases.ts` and `task-cases.ts` contain sanitized source families. Intent families have four phrasings; task families also vary catalog order and command identifiers. Every variant of a family stays in the same development fold. `specialist-evaluation.jsonl` is frozen separately before fitting and is excluded from checkpoint selection. The manifest records both dataset digests. Personal profiles and real user memories are not inputs. The retired Context Router's 16 closed cases remain untouched; only their existing lock and receipt are read for provenance.

This is an initial **text-only training corpus**, covering routes, capability-grounded commands, ordered actions, motion descriptions, non-action requests, and execution handoffs. It does not qualify image understanding, arbitrary autonomous activity selection, or every possible task state. The export preserves an unchanged base vision projector; that does not constitute visual evaluation.

Generate and validate:

```bash
pnpm generate:environment-action-selector-training
pnpm validate:environment-action-selector
```

Use distinct run directories for each specialist. Commands below use `intent`; repeat with `task` and its own directories. All GPU jobs within these commands run sequentially. The existing environment must be installed through the repository's training setup; the merged exporter uses the installed Unsloth llama.cpp converter and quantizer. LoRA export uses `convert_lora_to_gguf.py` from the adjacent `llama.cpp-source` checkout. Provision those tools before export; the exporter does not install packages. `HF_HUB_OFFLINE=1` can be set when the exact base is already cached.

```bash
pnpm train:environment-action-selector:0.8b -- --specialist intent --output out/environment-action-selector/training/intent-cv-001 --dry-run
pnpm train:environment-action-selector:0.8b -- --specialist intent --output out/environment-action-selector/training/intent-cv-001
pnpm evaluate:environment-action-selector:folds -- --root out/environment-action-selector/training/intent-cv-001 --checkpoint-policy final-epoch
pnpm score:environment-action-selector:development -- --root out/environment-action-selector/training/intent-cv-001 --checkpoint-policy final-epoch
pnpm train:environment-action-selector:0.8b -- --specialist intent --final-from out/environment-action-selector/training/intent-cv-001 --selection-report out/environment-action-selector/training/intent-cv-001/development-validation-final-epoch.json --output out/environment-action-selector/training/intent-final-001
pnpm export:environment-action-selector:merged -- --root out/environment-action-selector/training/intent-final-001
```

`--fold 0` runs one development rotation. Three epochs are the initial recipe; select a fixed epoch policy from development results, then fit one final adapter to all development records. Fold adapters are never merged together. `best-loss` identifies a per-fold selected checkpoint; final fitting should use an explicit epoch policy so it does not confuse different folds' best epochs.

For final evaluation, filter the frozen evaluation records by `metadata.specialist` into the run directory. Run `evaluate_qwen_checkpoint.py` with `--split evaluation --data <filtered-jsonl> --adapter <final/adapter> --config <final/training-config.json> --output <predictions-jsonl>`. Add `--base` for the unchanged base comparison. Reports record the device and batch size. Score each with `score-development.ts --root <run-root> --predictions <predictions-jsonl> --records <filtered-jsonl> --output <report-json>`.

Evaluation uses the same native tokenizer template and disabled thinking as training, with unconstrained greedy generation. Scoring checks strict JSON, the live Core contract, all ordered program steps, task-state fields, execution targets, missed/wrong physical selections, and false completion declarations. Intent scoring reports missed/extra routes; its optional query wording and memory types receive only structural validation. Free-text task objectives and reasons need separate review. Exact gold matches can penalize a reasonable alternative selection or equivalent motion wording; they are not a complete measure of semantic correctness.

Transformers evaluation latency is **not** llama.cpp/Ollama serving latency. Benchmark merged exports and shared adapters through the configured backend separately before claiming a speed improvement. Preserve PEFT adapters, GGUF LoRA adapters, training provenance, and quantized merged exports under ignored `out/environment-action-selector/training/`. Export receipts hash the merged language, GGUF adapter, and projector files. Training and export do not activate a model or execute robot actions.

Scoring verifies every expected record ID and provenance against the frozen input file (or each archived fold's `validation.jsonl`) before writing a report. Missing, duplicate, unexpected or changed reference records fail scoring. `typedDecisionMatch` measures the program and typed fields, not semantic correctness. The report includes a `semanticReview.pending` list with the input, reference, actual output and prediction digest; no unreviewed prediction counts as confirmed correct. A human review JSON array can be supplied with `--reviews <json>`; each entry contains `recordId`, `predictionDigest`, `semantic` and `grounding` (`pass` or `fail`), and a nonempty `reason`. This separates format/action measurements from reviewed interpretation and grounding without a new grader prompt.

Conversation uses finite Coordinator work and the `environment-conversation` delivery workflow under the same durable execution; slow generation does not hold the active program's execution lease. Task selection and conversation retain the same selected capability facts. The larger planner receives the original task context and schema; only the small planner sees the approved delegation option. Delegation training targets follow explicit requests to use that planner, with separate discussion, quotation, and direct-selection cases. These examples do not calibrate when the specialist should independently seek help or impose a complexity threshold.

Archived runs retain their exact training/validation files and hashes. Updating the current corpus for the delegation contract does not update an in-progress adapter's training inputs or qualify it against the new prompt. Keep those run directories intact and evaluate the served candidate against the current contract before activation; do not relabel old prompt results as current-contract results.
