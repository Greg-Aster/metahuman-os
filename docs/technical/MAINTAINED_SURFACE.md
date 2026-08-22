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

## Runtime Ownership Boundaries

- `packages/core/src/big-brother-session.ts` is the single process, stream,
  cancellation, and in-app terminal owner for Claude Code and Codex escalation.
  Provider backends may describe invocation differences, but they must not
  spawn a second CLI process or own a second session protocol.
- `packages/core/src/agent-catalog.ts` owns the merged installed/runtime Agent
  Catalog, while `agent-catalog-definitions.ts` owns built-in identity, aliases,
  risk, workflow relations, and safe registration defaults.
- Agent Catalog registration adds or removes finite Trigger Manager membership;
  it never deletes executable source, logs, history, or already admitted work.
- `packages/core/src/queue/queue-system.ts` owns the one Work Coordinator and
  the one observable TriggerManager runtime.
- `packages/core/src/queue/trigger-config-service.ts` owns validated, atomic,
  live-applied scheduling configuration in system `etc/agents.json`.
- TriggerManager may admit finite work to the coordinator; it may not execute
  an agent directly or supervise a persistent process.
- Semi autonomy owns timer- and idle-triggered awake work. Full autonomy owns
  completion/cooldown-driven awake proposals through Active Operator policy;
  scheduled awake triggers must not run in both modes. The scheduled Sleep
  Workflow is the deliberate exception because it is a system-state boundary,
  not an awake action.
- `packages/core/src/queue/sleep-workflow.ts` is the sole automatic owner for
  Organizer, Curator, Desire Generator, Desire Explorer, Desire Planner,
  Desire Executor, Desire Outcome Reviewer, Dreamer, Psychoanalyzer, and Auto
  Indexer. It admits one sequential child at a time. `sleep-runtime.ts` owns the
  durable sleep phase and review state; user activity cancels the remaining
  sleep chain before awake automation resumes.
- Robot Observer, Boredom Movement, TriggerManager awake schedules, and Full
  autonomy policy must remain dormant while Sleep Workflow is active. Sleep
  schedule editing belongs to Trigger Manager; live sleep progress and cycle
  review belong to Dashboard -> Sleep.
- Agent Monitor plus the shared process runner own persistent services and
  `etc/services.json`. Agent Monitor and agent-control authorization consume the
  Agent Catalog rather than a second hard-coded allowlist. Maintenance Service
  is maintenance-only and does not own scheduling.
- Whisper and Kokoro are shared system inference servers owned exclusively by
  `packages/core/src/voice-service-manager.ts`, `etc/voice-servers.json`, and
  the Server status/control surface. User `voice.json` files own request
  preferences such as provider, voice, language, speed, and output.
- Voice server lifecycle, configuration, and status must never be registered in,
  imported by, or exposed through Agent Monitor. Conversely, voice server owners
  must never import or control Agent Monitor. The build-time
  `validate:voice-service-ownership` check enforces this boundary.
- `apps/site/src/pages/api/trigger-manager` is thin transport. Shared handler
  logic belongs under `packages/core/src/api/handlers` and browser surfaces use
  the shared TriggerManager store.
- `packages/core/src/persona-facets.ts` is the profile-aware owner for persona
  facet reads, atomic full-config writes, and active-facet changes. App routes
  and graph nodes must not write `facets.json` directly.
- Mood is finite coordinator work: `conversation-buffer.ts` publishes the
  persisted message-count event, TriggerManager owns count/cooldown admission,
  `brain/agents/mood` runs the graph, and `etc/cognitive-graphs/mood-review.json`
  owns the editable decision flow. Do not add Mood to `etc/services.json` or
  create a parallel interval loop.

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
