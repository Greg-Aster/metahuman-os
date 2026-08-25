# Frequently Asked Questions

## Where should I start?

Follow [Installation](../getting-started/02-installation.md), then [Setup and Login](../getting-started/03-setup-and-login.md). Use `./bin/mh help` for the current CLI surface.

## Where does my data live?

Persona, profile, memory, voice, logs, and generated outputs are user/runtime data resolved through the storage system. They are not maintained source and should not be committed. See [Multi-User Profiles](../advanced-features/multi-user-profiles.md).

## Does MetaHuman require the cloud?

No. Ollama, vLLM, Whisper, Piper, Kokoro, and supported training workflows can run locally. Remote model and sync features require a configured server and network access.

## How do I check system health?

```bash
./bin/mh status
./bin/audit check
```

For a specific subsystem, use its status command, such as `./bin/mh ollama status`, `./bin/mh rvc status`, or `./bin/mh kokoro status`.

## Which LLM backend should I use?

Use Ollama for the simplest local setup, vLLM when its GPU-serving features are needed, or a remote backend when compute is hosted elsewhere. Keep routing in the backend and model-router owners. See [LLM Backend Configuration](../configuration-admin/llm-backend.md).

## Why is a model unavailable?

Confirm the selected backend is running, the configured model identity exists there, and the active profile can read its configuration. A running provider does not prove the requested model is loaded.

## Can I use multiple users?

Yes. Profiles isolate user-owned configuration and content. Administrative actions are owner-guarded. See [Accounts and Security](../configuration-admin/accounts-security.md) and [Authentication](../configuration-admin/authentication.md).

## How does memory work?

Memory is profile-owned and accessed through the core memory/storage owners. The UI and agents should use public core exports rather than reading profile directories directly. See [Memory System](../using-metahuman/memory-system.md).

## Can MetaHuman act autonomously?

Agents operate within explicit trust, security, and lifecycle boundaries. Enabling an agent does not bypass action authorization. See [Autonomous Agents](../advanced-features/autonomous-agents.md) and [Security and Trust](../configuration-admin/security-trust.md).

## Can I train an AI model?

Yes. The maintained training workflow creates profile-owned artifacts through the canonical training process owner. See [AI Training](../training-personalization/ai-training.md).

## Can I train a voice?

RVC model training and GPT-SoVITS reference preparation are maintained. Piper and Kokoro synthesis are supported, but this repository does not expose verified custom trainers for them. See [Voice Training](../training-personalization/voice-training.md).

## Why did voice output fall back to Piper?

The selected provider was unavailable or lacked its required profile artifact. Check addon/service status, speaker selection, model/reference paths, and provider logs. See [Voice Features](../using-metahuman/voice-features.md).

## How do I run headless?

Use the maintained startup and service owners described in [Headless Mode](../advanced-features/headless-mode.md). Avoid adding a second process manager or startup script for an existing service.

## Where should configuration changes go?

Use the relevant UI, CLI, or public core configuration owner. Root `etc` files are stable system defaults; profile settings belong to the active profile. See [Configuration Files](../configuration-admin/configuration-files.md).

## What should I include in a bug report?

Include the exact command or UI action, active subsystem, relevant error text, expected behavior, and focused logs. Separate source validation from live runtime or hardware proof.

## Where can I troubleshoot further?

Use the [Troubleshooting Guide](./troubleshooting.md). Architecture contributors should also read the repository's maintained-surface and audit documents before changing ownership boundaries.
