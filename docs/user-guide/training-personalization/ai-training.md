# AI Training

MetaHuman can train one personalized model artifact from the accepted records in
your profile. Training is an explicit, resource-intensive operation; collecting
memories does not by itself change the active model.

## Supported Personalization Workflows

- **Remote LoRA:** run
  `pnpm exec tsx brain/training/personalization/full-cycle.ts --username NAME`.
  It produces one vLLM safetensors adapter or one merged Ollama GGUF model.
- **Local LoRA:** run
  `pnpm exec tsx brain/training/personalization/full-cycle-local.ts --username NAME`.
  It produces one local Ollama GGUF model plus its source adapter.
- **Full fine-tune:** run
  `pnpm exec tsx brain/training/personalization/fine-tune-cycle.ts --username NAME`.
  It produces one fine-tuned model through the configured training backend.

The Training Wizard exposes the same workflows in the web app. It checks local
GPU and RunPod availability, edits the authenticated profile's
`etc/training.json`, launches the selected job, and displays its status and
logs. Root-level `etc/training.json` and `etc/runpod.json` files are installation
seeds; they are not a shared mutable profile configuration.

The **Automatic Training** tab stores a disabled-by-default admission and launch
policy in the same profile configuration. Its controls include:

- minimum total and newly curated sample counts plus the cooldown;
- local LoRA, remote LoRA, or remote full fine-tune and the output target;
- base model, epochs, learning rate, batch size, gradient accumulation, context
  length, and per-run sample cap;
- LoRA rank and alpha, or the full-fine-tune recent/older-history window;
- GGUF quantization, RunPod template and GPU type, preprocessing, and optional
  S3 transfer; and
- the same persona and memory-type composition used by the manual wizard.

The RunPod API key remains in the profile's canonical RunPod configuration and
is not copied into or returned with the automatic policy. The readiness view is
computed from the real Organizer and Curator state and profile-scoped
completed-run history. The policy does not schedule or launch itself: Sleep
Workflow admission is a separate next stage and is not currently installed.

There is no dual-adapter or adapter-merging runtime. Each completed run has one
activation artifact. Historical learning is retained by building the next
dataset from the canonical accepted conversation store. A full fine-tune may
optionally retain every record inside a recent-day window plus an evenly
distributed, bounded sample of older history. The per-run sample cap is applied
after that selection and the configured memory-type composition.

## Dataset Ownership

The default full-cycle path is:

```text
profile episodic user/assistant and inner-dialogue memories
  -> Organizer metadata refinement
  -> Curator accept/reject records
  -> memory/curated/conversations
  -> Curated Aggregator
  -> cognitive-mode formatting
  -> model-family schema
  -> run-scoped training dataset
```

The conversation saver persists user and assistant messages separately. Curator
pairs their durable turn identities, evaluates the exact exchange without
rewriting it, saves one decision, and only then marks both source records.
Standalone inner dialogue and other eligible memory types remain individual
review units. Model or write failures therefore leave their sources retryable.
A training run normally drains available uncurated memories first; set
`METAHUMAN_SKIP_PREPROCESSING=1` only when you intentionally want to use the
already accepted store without a new curation pass.

`METAHUMAN_MAX_SAMPLES` bounds the aggregated dataset. Set
`METAHUMAN_MODE_FILTER` to `dual`, `agent`, `emulation`, or `environment` only when a run should
use one mode; the default includes accepted records from every conversational
mode.

## Configuration

The authenticated profile's `etc/training.json` owns that profile's training
parameters, including:

- base model and runtime target;
- epoch, rank, learning-rate, batch, and sequence settings;
- GGUF conversion and quantization settings;
- Curator and dataset-composition settings when present;
- the automatic-training policy when saved from the Automatic Training tab.

Primary user-authored memory types are included at 100%. The composition
sliders control the amount of secondary model-generated material relative to
that primary set. Persona inclusion controls whether the profile persona is
provided as training context to runners that support it.

Remote jobs also require the authenticated profile's `etc/runpod.json`. Treat
provider credentials as local secrets and do not commit them.

The selected model, available GPU memory, sequence length, precision, optimizer,
and dataset size all affect resource needs. Do not rely on a fixed VRAM, time, or
cost estimate; use the wizard's current capability checks and the provider's
current pricing before launch.

## Output And Activation

Run artifacts are profile-owned. A default internal profile commonly resolves
LoRA artifacts under:

```text
profiles/USERNAME/out/adapters/DATE/RUN_LABEL/
```

Full fine-tune artifacts instead resolve under:

```text
profiles/USERNAME/out/fine-tuned-models/DATE/RUN_LABEL/
```

Custom and encrypted profiles resolve this logical output location elsewhere;
use the profile storage owner rather than constructing the path yourself.

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

## Environment Action Selector Training

The repository also contains a separate maintainer workflow under
`brain/training/environment-action-selector`. It trains a small system model to
produce typed Environment actions. It is not profile personalization, does not
consume personal profile data, and is not launched by the Training Wizard.

Use its maintained validation and generation commands before considering a
training run:

```bash
pnpm validate:environment-action-selector
pnpm generate:environment-action-selector-training
pnpm train:environment-action-selector:0.8b -- --dry-run
```

The current candidates are evaluation artifacts, not automatically deployable
models. Deployment is a deliberate maintainer action only after evaluation;
Core capability validation and environment task state remain the safety
boundary even when a candidate is accepted.

## Before Launching

1. Confirm the intended profile and backend.
2. Review the authenticated profile's `etc/training.json` and the Training
   Wizard summary.
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
