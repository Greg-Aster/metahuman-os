# MetaHuman OS — Documentation Index

## Current Authority

- Maintained source surface: [MAINTAINED_SURFACE.md](MAINTAINED_SURFACE.md)
- Refactor blueprint: [REFACTOR_BLUEPRINT.md](REFACTOR_BLUEPRINT.md)
- Audit protocol: [AUDIT_PROTOCOL.md](AUDIT_PROTOCOL.md)
- Architecture boundary contract: [ARCHITECTURE.md](ARCHITECTURE.md)
- Consolidation progress: [../audits/consolidation-progress.md](../audits/consolidation-progress.md)
- Maintained-source inventory: [../audits/maintained-source-inventory.md](../audits/maintained-source-inventory.md)

## Public Orientation

- Project overview: [../../README.md](../../README.md)
- Startup guide: [../../STARTUP.md](../../STARTUP.md)
- CLI reference: [../user-guide/reference/cli-reference.md](../user-guide/reference/cli-reference.md)
- User guide: [../user-guide/index.md](../user-guide/index.md)

## Historical Material

Older design, roadmap, migration, mobile, voice, and implementation-plan documents may describe retired owners or stale status. Treat them as archive/context unless a current authority document above explicitly references them.

Archived voice notes
- Continuous Mode: [../archive/VOICE_CONTINUOUS_MODE.md](../archive/VOICE_CONTINUOUS_MODE.md)
- Conversations: [../archive/VOICE_CONVERSATIONS_COMPLETE.md](../archive/VOICE_CONVERSATIONS_COMPLETE.md)
- Cloning (passive): [../archive/VOICE_CLONING_PASSIVE.md](../archive/VOICE_CLONING_PASSIVE.md)

Tips
- Use `./bin/mh help` for current CLI.
- Initialize runtime data: `./bin/mh init`
- Check repo hygiene: `./bin/audit check` (full: `./bin/audit all`)
- `apps/*` are interface shells, `packages/core` is the engine, and `brain/*` sits above the engine.
- Runtime logs, memories, persona, profiles, and local agent data are user-owned data, not maintained source.
