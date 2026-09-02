# Configuration Ownership

MetaHuman configuration has machine and profile owners:

- root `etc/` contains machine-wide service policy and sanitized seeds used
  when profiles are initialized;
- a profile's logical `etc/` area contains configuration owned by that
  authenticated profile. Default internal profiles commonly resolve below
  `profiles/USERNAME/etc/`, while custom or encrypted profiles may not.

Use the web Settings panels and Trigger Manager when a setting is exposed there.
Those interfaces validate changes through Core. Edit JSON directly only while
the owning process is stopped, preserve its schema, and never copy credentials
between profiles.

## Machine-wide configuration

Common system-owned files include:

- `active-operator.json` — Active Operator mode and policy state;
- `agents.json` — Trigger Manager registrations for finite work;
- `services.json` — persistent-service boot and restart policy;
- `queue.json` — Work Coordinator lane concurrency;
- `llm-backend.json` — deployment backend selection and lifecycle settings;
- `models.json` — initial model-registry seed for new profiles;
- `voice-servers.json` — shared voice-service ports and lifecycle;
- `cloudflare.json` — Cloudflare tunnel settings;
- `deployment.json` — deployment mode, storage, and provider endpoints;
- `runtime.json` — the machine-wide headless state flag;
- `logging.json` — system logging policy; and
- `tool-executor.json` — external tool-executor policy.

Training seeds live in `training.json`, `training-local.json`, and
`fine-tune-config.json`. The Training Wizard reads and writes the authenticated
profile's training configuration. RunPod credentials likewise belong to the
authenticated profile's `runpod.json`; never commit real credentials.

`agents.json` and `services.json` are deliberately separate. Trigger Manager
owns schedule and event admission for bounded work. The service lifecycle owner
controls long-running processes. Do not register one responsibility in both.

## Profile configuration

Common logical profile files include:

- `models.json` — provider and model assignments by role;
- `runtime.json` — cognitive graph-runtime selection through
  `cognitive.useNodePipeline`;
- `operator.json` — Operator scratchpad, execution, and Big Brother settings;
- `chat-settings.json` — context, history, temperature, and buffer limits;
- `training.json` — dataset and training parameters;
- `runpod.json` — profile-owned remote-training credentials and settings;
- `voice.json` — profile TTS, STT, cache, and voice-training settings;
- `autonomy.json` — permitted autonomous actions and approvals;
- `agency.json` — desire generation, risk, and execution limits;
- `agents.json` — profile-specific Trigger Manager overrides;
- `boredom.json` — reflection presentation and compatibility settings;
- `sleep.json` — sleep workflow schedule and limits;
- `curiosity.json` — user-facing and private curiosity controls;
- `trust-coupling.json` — cognitive-mode to trust-level mapping; and
- `logging.json` — profile logging preferences.

Profile creation copies supported seeds and generates required state. Core's
configuration and storage owners resolve the authenticated profile; business
logic must not construct a `profiles/USERNAME/etc` path independently.

## Runtime state and cognitive graphs

The same filename has two distinct owners:

- root `etc/runtime.json` records only machine headless state for the maintained
  routed UI/API;
- profile `etc/runtime.json` records cognitive graph-runtime selection.

Cognitive behavior is defined by the registered Dual, Agent, Emulation, and
Environment graphs. There is no legacy Operator V1/V2 switch. See
[Headless Runtime Mode](/user-guide#headless-mode) for the current state-only
contract and [Architecture](/user-guide#architecture) for graph ownership.

## Models, training, and voice

Profile `models.json` assigns public model roles to provider/model records. Use
Backend Settings to change assignments and load artifacts; do not hand-edit
generated adapter state.

Each training run has one target artifact: an Ollama-targeted run produces a
merged GGUF-backed model, while a vLLM-targeted remote LoRA run preserves one
safetensors adapter. See [AI Training](/user-guide#ai-training).

Profile `voice.json` selects Kokoro, Piper, GPT-SoVITS, or RVC and stores
profile-specific values. Machine ports, commands, and auto-start policy remain
in root `etc/voice-servers.json`. See [Voice Features](/user-guide#voice-features).

## Environment variables

The root `.env` is local and must not be committed. Supported configuration
inputs include:

- `HIGH_SECURITY=true` — restrict selectable cognitive modes to Emulation;
- `WETWARE_DECEASED=true` — disable Dual mode;
- `USE_NODE_PIPELINE` — select the maintained node-pipeline default;
- `MH_EXPOSURE_MODE`, `MH_ALLOWED_HOSTS`, and `MH_ALLOWED_ORIGINS` — define
  network exposure and origin policy;
- `DEPLOYMENT_MODE` — select the deployment-mode contract; and
- `METAHUMAN_ROOT` — identify the installation root to supported entrypoints.

Provider tokens and credentials also remain local. Use current `.env.example`
names or the corresponding Settings interface; never add live values to docs.

## Recovery

Only configuration owners that use Core's safe JSON writer receive its atomic
write and bounded `.backups/` behavior. Do not assume that every JSON file under
`etc/` has that recovery contract. If a file becomes invalid, stop its owning
process and use that owner's documented recovery path or a verified valid
backup. Do not hide invalid state behind a second file or fallback.
