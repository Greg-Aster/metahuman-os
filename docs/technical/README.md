# MetaHuman OS — Documentation Index

- Quick Start and Overview: README.md
- Architecture: ARCHITECTURE.md
- Design and Roadmap: DESIGN.md
- Cross‑Platform Roadmap: docs/CROSS_PLATFORM_ROADMAP.md
- Implementation Plan: docs/IMPLEMENTATION_PLAN.md
- Implementation Addendum: docs/IMPLEMENTATION_PLAN_ADDENDUM.md
- Audio Ingestion Plan: docs/audio-ingestion-plan.md
- LoRA Quickstart: docs/LORA_QUICKSTART.md
- Voice Conversations Roadmap: docs/VOICE_CONVERSATIONS_ROADMAP.md
- Memory Schema: memory/README.md

Voice
- Continuous Mode: docs/VOICE_CONTINUOUS_MODE.md
- Conversations: docs/VOICE_CONVERSATIONS_COMPLETE.md
- Cloning (passive): docs/VOICE_CLONING_PASSIVE.md

Tips
- Use `./bin/mh help` for current CLI.
- Initialize runtime data: `./bin/mh init`
- Check repo hygiene: `./bin/audit check` (full: `./bin/audit all`)
- Agents live under `brain/agents`; core APIs under `packages/core`.
- All logs and audits stream to `logs/` (NDJSON).
