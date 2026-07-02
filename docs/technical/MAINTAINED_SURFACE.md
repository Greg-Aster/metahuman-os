# Maintained Source Surface

This document defines what belongs to the remote-safe MetaHuman source tree.
It is the input for architecture checks, audits, and refactor planning.

## Maintained Source

- `packages/core`: engine/domain logic, storage abstractions, auth, policy, model routing, graph/nodes, and shared API handlers.
- `packages/agent-runtime`: shared agent execution interfaces and runtime adapters.
- `packages/cli`: the `mh` command interface. It should dispatch to core or agent APIs, not own domain behavior.
- `packages/server` and `packages/local-model-service`: deployment/model-service packages when actively referenced by maintained scripts or apps.
- `apps/site`: Astro/Svelte interface and thin server transport for the web app.
- `apps/react-native`: mobile interface shell, when it is actively maintained.
- `brain/agents`, `brain/services`, `brain/training`, and `brain/scripts`: worker implementations and pipelines that sit above the engine.
- `etc`, `scripts`, `bin`, `docker`, `plugins/examples`, `tests`, and focused docs that describe maintained behavior.

## Not Maintained Source

These paths must not be treated as architecture refactor targets unless a user explicitly asks for that subsystem.

- `apps/code-oss`: legacy Studio/Code OSS bulk. Preserve externally if needed; do not include in normal audits.
- `apps/mobile`: deprecated Capacitor-era mobile app.
- `vendor`, `external`, virtual environments, model folders, generated builds, browser caches, and downloaded tools.
- `persona`, `profiles`, `memory`, `logs`, `out`, `data/user-data`, `metahuman-runs`, root logs, audit coordination state, and generated reports.
- Local agent/tool instructions such as `AGENTS.md`, `CLAUDE.md`, `.codex`, and `.claude`.

## Remote Safety

Tracked remote content must not include personal profile data, private memories, local browser state, local audit scratchpads, tokens, model weights, generated logs, or local agent configuration.

If a runtime example is needed, add a sanitized template or fixture. Do not commit a live user profile, memory, or local cache.
