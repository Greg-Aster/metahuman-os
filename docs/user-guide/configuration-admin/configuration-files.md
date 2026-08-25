# Configuration Ownership

MetaHuman configuration has two owners:

- `etc/` contains machine-wide service configuration and templates used when a
  profile is created.
- `profiles/<username>/etc/` contains settings owned by one authenticated
  profile.

Use the web Settings panels and Trigger Manager when a setting is exposed there.
Those interfaces validate and apply changes through Core. Edit JSON directly
only while the system is stopped, keep the existing schema, and do not copy
credentials between profiles.

## Machine-wide configuration

The main system-owned files are:

| File | Owner |
| --- | --- |
| `active-operator.json` | Robot Operator mode state |
| `agents.json` | Trigger Manager registrations for finite work |
| `services.json` | Persistent service boot and restart policy |
| `queue.json` | Work Coordinator lane concurrency |
| `llm-backend.json` | Active local inference backend |
| `models.json` | Initial model registry for new profiles |
| `voice-servers.json` | Shared voice-service ports and lifecycle |
| `cloudflare.json` | Cloudflare tunnel settings |
| `deployment.json` | Remote provider deployment defaults |
| `logging.json` | System logging policy |
| `tool-executor.json` | External tool-executor policy |

Training defaults live in `training.json`, `training-local.json`, and
`fine-tune-config.json`. A training run reads the authenticated profile's
`training.json` when present. RunPod credentials belong in the authenticated
profile's `runpod.json`; do not commit real credentials.

`agents.json` and `services.json` are deliberately separate. Trigger Manager
owns schedules and event admission for bounded work. The service lifecycle owner
controls long-running processes. Do not register the same responsibility in
both files.

## Profile configuration

New profiles receive their own configuration under
`profiles/<username>/etc/`. Common files include:

| File | Responsibility |
| --- | --- |
| `models.json` | Provider and model assignments by role |
| `runtime.json` | Headless state and graph-runtime selection |
| `operator.json` | Operator scratchpad, execution, and Big Brother settings |
| `chat-settings.json` | Context, history, temperature, and buffer limits |
| `training.json` | Dataset and training parameters |
| `voice.json` | Profile TTS, STT, cache, and voice-training settings |
| `audio.json` | Audio ingestion and transcription defaults |
| `autonomy.json` | Permitted autonomous actions and approvals |
| `agency.json` | Desire generation, risk, and execution limits |
| `agents.json` | Profile-specific Trigger Manager overrides |
| `boredom.json` | Reflection presentation and compatibility settings |
| `sleep.json` | Sleep workflow schedule and limits |
| `curiosity.json` | User-facing and private curiosity controls |
| `trust-coupling.json` | Cognitive-mode to trust-level mapping |
| `ingestor.json` | Inbox ingestion settings |
| `logging.json` | Profile logging preferences |

Profile creation copies supported templates and generates missing required
files. Core's configuration owner resolves the authenticated profile; business
logic should not assemble `profiles/<username>/etc` paths independently.

## Runtime and cognitive graphs

`runtime.json` records headless mode and the active graph-runtime choice:

```json
{
  "headless": false,
  "lastChangedBy": "local",
  "changedAt": "2026-08-24T00:00:00.000Z",
  "claimedBy": null,
  "cognitive": {
    "useNodePipeline": true
  }
}
```

Cognitive behavior is defined by the registered graphs for Dual, Agent,
Emulation, and Environment modes. There is no separate cognitive-layer
configuration stack and no legacy Operator V1/V2 switch.

See [Headless Runtime Mode](../advanced-features/headless-mode.md) for lifecycle
behavior and [Architecture](../advanced-features/architecture.md) for graph
ownership.

## Models and training

`models.json` assigns public model roles to provider/model records. Use Backend
Settings to change assignments and load an artifact. Do not hand-edit generated
adapter state.

Training has one target artifact per run:

- an Ollama-targeted run produces a merged GGUF-backed model;
- a remote LoRA vLLM-targeted run preserves one safetensors adapter.

See [LLM Backend](llm-backend.md) and [AI Training](../training-personalization/ai-training.md).

## Voice configuration

Profile `voice.json` selects Kokoro, Piper, GPT-SoVITS, or RVC and stores
profile-specific voice, cache, and training values. Machine ports, commands, and
auto-start policy belong in `etc/voice-servers.json`. This separation prevents
one profile from redefining a shared process.

See [Voice Features](../using-metahuman/voice-features.md).

## Environment variables

The root `.env` is local and must not be committed. Current system-state flags
include:

- `HIGH_SECURITY=true`: restricts selectable cognitive modes to Emulation.
- `WETWARE_DECEASED=true`: disables Dual mode.
- `HEADLESS_RUNTIME=true`: starts in headless operation where supported by the
  startup owner.

Provider tokens and credentials also remain local. Prefer the corresponding
Settings interface or `.env.example` naming; never add live values to examples.

## Recovery

Core writes supported profile JSON atomically and retains bounded backups in a
local `.backups/` directory. If a file becomes invalid, stop the process that
owns it and restore through the Core configuration recovery utilities or the
latest valid backup. Do not paper over invalid configuration with a second file
or an undocumented fallback.
