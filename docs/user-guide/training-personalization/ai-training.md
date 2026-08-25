# AI Training

MetaHuman can train one personalized model artifact from the accepted records in
your profile. Training is an explicit, resource-intensive operation; collecting
memories does not by itself change the active model.

## Supported Workflows

| Workflow | Command | Runtime artifact |
| --- | --- | --- |
| Remote LoRA | `pnpm exec tsx brain/training/full-cycle.ts --username <name>` | One vLLM safetensors adapter or one merged Ollama GGUF model |
| Local LoRA | `pnpm exec tsx brain/training/full-cycle-local.ts --username <name>` | One local Ollama GGUF model plus its source adapter |
| Full fine-tune | `pnpm exec tsx brain/training/fine-tune-cycle.ts --username <name>` | One fine-tuned model produced by the configured training backend |

The Training Wizard exposes the same workflows in the web app. It checks local
GPU and RunPod availability, edits `etc/training.json`, launches the selected
job, and displays its status and logs.

There is no dual-adapter or adapter-merging runtime. Each completed run has one
activation artifact. Historical learning is retained by building the next
dataset from the canonical accepted conversation store; a full fine-tune may
optionally use a bounded recent-data window plus older samples.

## Dataset Ownership

The default full-cycle path is:

```text
profile episodic memories
  -> Curator accept/reject records
  -> memory/curated/conversations
  -> Curated Aggregator
  -> cognitive-mode formatting
  -> model-family schema
  -> run-scoped training dataset
```

The Curator saves a decision before marking a source record processed. Model or
write failures therefore leave that source retryable. A training run normally
drains available uncurated memories first; set
`METAHUMAN_SKIP_PREPROCESSING=1` only when you intentionally want to use the
already accepted store without a new curation pass.

`METAHUMAN_MAX_SAMPLES` bounds the aggregated dataset. Set
`METAHUMAN_MODE_FILTER` to `dual`, `agent`, or `emulation` only when a run should
use one mode; the default includes accepted records from every conversational
mode.

## Configuration

`etc/training.json` owns the shared training parameters, including:

- base model and runtime target;
- epoch, rank, learning-rate, batch, and sequence settings;
- GGUF conversion and quantization settings;
- Curator and dataset-composition settings when present.

Remote jobs also require `etc/runpod.json`. Treat provider credentials as local
secrets and do not commit them.

The selected model, available GPU memory, sequence length, precision, optimizer,
and dataset size all affect resource needs. Do not rely on a fixed VRAM, time, or
cost estimate; use the wizard's current capability checks and the provider's
current pricing before launch.

## Output And Activation

Run artifacts are profile-owned under:

```text
profiles/<username>/out/adapters/<date>/<run-label>/
```

Remote training follows the requested training target:

- **vLLM:** preserves and registers one safetensors adapter artifact. Backend
  Settings owns loading and unloading it; training does not silently change the
  serving backend.
- **Ollama:** uses the single merged GGUF artifact, writes a Modelfile, records
  it as active, and makes a best-effort `ollama create` call.

Local LoRA follows the Ollama path. Activation metadata is stored through the
Core adapter owner; do not hand-edit it. Backend Settings is the canonical UI
for inspecting and changing active Ollama or vLLM adapters.

## Optional S3 transfer

Remote training can upload completed model files to RunPod-compatible S3 before
the GPU pod is released. Configure `RUNPOD_S3_ACCESS_KEY`,
`RUNPOD_S3_SECRET_KEY`, `RUNPOD_S3_ENDPOINT`, and `RUNPOD_S3_BUCKET` in the
local environment. If credentials are absent, or S3 is disabled for the run,
the trainer uses the direct transfer path. Never commit these credentials.

## Before Launching

1. Confirm the intended profile and backend.
2. Review `etc/training.json` and the Training Wizard summary.
3. Ensure the Curator has enough accepted, representative records.
4. Confirm disk space, local GPU support, or remote-provider credentials.
5. Preserve the currently working model until the new artifact is validated.

## Troubleshooting

- If curation fails, resolve that failure first; the full cycle will not claim a
  valid dataset from an incomplete pass.
- If local training cannot start, inspect CUDA/GPU availability and the run log
  under `logs/run/`.
- If remote training fails, inspect the run summary and RunPod configuration;
  failed jobs do not activate a new artifact.
- If Ollama model creation fails after training, the artifact remains recorded
  as ready for loading. Inspect the generated Modelfile and load it from the
  canonical backend controls.
- If vLLM does not serve the new adapter, verify its compatible base model and
  enable it from Backend Settings.

Training completion proves that files were produced and registered. Evaluate
the model's responses separately before treating the new artifact as a quality
improvement.
