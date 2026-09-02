# Maintained Source Surface

This document is the remote-safe source boundary for MetaHuman architecture
checks, audits, and refactor planning. Its policy and owner descriptions were
last reconciled with the current worktree and validation entrypoints on
2026-08-31.

The executable policy below is authoritative. Both `scripts/check-architecture.ts` and `scripts/create-audit-inventory.ts` load this JSON block through `scripts/maintained-source-policy.ts`; they do not maintain separate path lists.

## Enforced Source Policy

The default is intentionally simple: an existing file returned by `git ls-files` is maintained unless this policy excludes it. `includePaths` is evaluated first and provides narrow sanitized exceptions to excluded prefixes.

<!-- maintained-source-policy:start -->
```json
{
  "version": 1,
  "default": "include-tracked-existing",
  "includePaths": [
    "profiles/README.md"
  ],
  "excludePaths": [
    "AGENTS.md",
    "CLAUDE.md",
    "apps/react-native/scripts/.handlers_built",
    "audit-state.json",
    "docs/audit-scratchpad.md",
    "docs/audits/maintained-source-inventory.json",
    "docs/audits/maintained-source-inventory.md",
    "report.json"
  ],
  "excludePrefixes": [
    ".agents/",
    ".claude/",
    ".codex/",
    ".obsidian/",
    "apps/code-oss/",
    "apps/mobile/",
    "backups/",
    "brain/journal/",
    "brain/state/",
    "data/user-data/",
    "docs/archive/",
    "downloads/",
    "logs/",
    "memory/",
    "metahuman-runs/",
    "models/",
    "out/",
    "persona/",
    "profiles/",
    "tmp/",
    "vendor/"
  ],
  "excludeDirectoryNames": [
    ".astro",
    ".cache",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "venv"
  ],
  "excludeFilenameMarkers": [
    ".backup-",
    ".tmp-",
    "-backup."
  ],
  "excludeExtensions": [
    ".apk",
    ".ggml",
    ".gguf",
    ".log",
    ".onnx",
    ".pid",
    ".pt",
    ".pth",
    ".safetensors",
    ".tsbuildinfo"
  ]
}
```
<!-- maintained-source-policy:end -->

## Maintained Source Areas

- `packages/core`: engine and domain logic, storage abstractions, auth, policy, model routing, graph nodes, shared API handlers, and the work coordinator.
- `packages/agent-runtime`: shared agent execution interfaces and runtime adapters.
- `packages/cli`: the `mh` command interface. It dispatches to core or agent APIs instead of owning domain behavior.
- `packages/local-model-service`: maintained local-model inference service package.
- `apps/site`: Astro/Svelte interface and thin server transport for the web app.
- `apps/react-native`: maintained React Native interface shell and its bundled mobile runtime entrypoints.
- `brain/*`: workers, services, training, and the React Native bridge entrypoints above the engine. `brain/journal` and `brain/state` are runtime/history areas excluded by the policy.
- `external/kokoro`, `external/whisper`, and `external/open-interpreter`: tracked integration entrypoints maintained by this repository. Their virtual environments, downloaded dependencies, models, caches, and generated outputs are not maintained source.
- `etc`, `scripts`, `bin`, `docker`, `tests`, and remote-safe documentation and fixtures that describe or validate maintained behavior.
- Tracked interface assets such as icons and images are maintained when they are not generated or otherwise excluded by the policy.

## Critical Runtime Ownership Boundaries

These are the high-risk single-owner constraints that refactor work must preserve. They are not an inventory of every runtime component.

- `packages/core/src/big-brother-session.ts` owns the visible shared process, terminal, stream, and cancellation protocol for Claude Code and Codex escalation. `big-brother-session-worker.ts` runs the selected provider invocation inside that session, while `big-brother-cli.ts` adapts provider events. API handlers and `TerminalManager.svelte` may control or display the session but must not spawn a provider directly. Closing the tab cancels the process group; disabling Big Brother or changing provider stops the shared session. There is no detached fallback execution path.
- `packages/core/src/agent-catalog.ts` owns the merged installed/runtime Agent Catalog; `agent-catalog-definitions.ts` owns built-in identity, aliases, risk, workflow relations, and safe registration defaults. Registration only adds or removes finite Trigger Manager membership and never deletes executable source, logs, history, or admitted work.
- `packages/core/src/queue/queue-system.ts` owns the server Work Coordinator and its observable TriggerManager runtime. Non-owner processes submit through `packages/core/src/queue/work-submission.ts`; they do not start private coordinators.
- `packages/core/src/queue/trigger-config-service.ts` owns validated, atomic, live-applied scheduling configuration in system `etc/agents.json`. TriggerManager owns clocks and finite admission, not direct execution or persistent-process supervision.
- `packages/core/src/active-operator/mode-controller.ts` owns Reactive, Semi, and Full mode transitions. `operator-policy-service.ts` runs only in Full and owns bounded completion/cooldown-driven proposals. Semi owns scheduled and idle-triggered awake work; scheduled awake work must not run in both Semi and Full.
- `packages/core/src/queue/sleep-workflow.ts` is the sole automatic owner for its nine ordered maintenance and reflection stages. `sleep-runtime.ts` owns durable phase/review state, and user activity cancels the remaining chain before awake automation resumes. Robot Operator children, awake TriggerManager schedules, and Full policy remain dormant while Sleep is active.
- `brain/services/robot-operator.ts` owns Robot Status plus Boredom Observer, Movement, and Reflection timing and admission. `packages/core/src/robot-status.ts` owns the profile-resolved Robot Status snapshot; its editable graph derives one bounded semantic update from Environment Bridge facts, Robot and Conversation buffers, active Agency desires, and prior status, then publishes through the existing System Buffer. Environment Mode and Boredom Autonomy may read that snapshot as supporting context, but fresh correlated observations and action results remain authoritative. The boredom planners author high-level intentions for the editable Boredom Autonomy executor, which reuses Environment Task State, capability admission, bridge transport, and correlated feedback rather than adding a scheduler, queue, or hidden action path. Robot Operator remains dormant in Reactive mode or while Sleep is active.
- `brain/agents/environment-bridge` owns the singleton external-environment connection and transport lifecycle. `packages/core/src/nodes/environment/task-state.node.ts` owns each Environment objective's lifecycle, correlation, action lineage, and completion decision. It serializes correlated decisions but imposes no fixed action count or deterministic autonomy stop.
- Agent Monitor plus `packages/core/src/agent-process-runner.ts` own persistent services and `etc/services.json`. Agent Monitor and agent-control authorization consume the Agent Catalog instead of a second allowlist. Maintenance Service is maintenance-only and does not own scheduling.
- Software updates are explicit Installation Owner actions, not agent or scheduler work. `packages/core/src/mobile-release.ts` owns strict mobile release metadata and APK resolution from the generated system `out/releases/mobile` store; the maintained React Native release script is its sole producer. `packages/core/src/api/handlers/server-update.ts` owns owner-guarded, single-flight Git update, dependency installation, production validation, and restart admission. Profile Sync must not trigger or execute software updates.
- `packages/core/src/model-resolver.ts` and `model-router.ts` own role-aware model selection, while `packages/core/src/llm-backend.ts` owns deployment-backend selection and `packages/core/src/providers/bridge.ts` owns provider transport and input validation. Image parts remain content on that same path; they do not select a separate vision backend or configuration. The router may use its established orchestrator-role fallback when a role-selected model explicitly lacks image capability, and the provider bridge must reject image input when the final selected model or adapter cannot preserve it.
- Whisper and Kokoro inference-server lifecycle belongs to `packages/core/src/voice-service-manager.ts`, `etc/voice-servers.json`, and the Server status/control surface. `packages/core/src/stt.ts` and its managed `WhisperService` are the sole speech-to-text request path; there is no Transcriber agent or direct whisper.cpp/OpenAI file-transcription path. User `voice.json` files own request preferences. Voice lifecycle must remain independent from Agent Monitor; `validate:voice-service-ownership` enforces that separation.
- `packages/core/src/tts/delivery-queue.ts` owns durable TTS delivery, leases, retry limits, acknowledgement, and interruption generations. `TTSQueueConsumer.svelte` is the browser playback actuator, not a second queue or admission owner.
- `apps/site/src/pages/api/trigger-manager` is thin transport. Shared handler logic belongs under `packages/core/src/api/handlers`, and browser surfaces use the shared TriggerManager store.
- `packages/core/src/persona-facets.ts` owns profile-aware facet reads, validated atomic full-config writes, and active-facet changes. App routes and graph nodes must not write `facets.json` directly.
- `packages/core/src/persona-learning.ts` owns validation and application of learned persona changes; `identity.ts` owns atomic persona persistence and archives. `brain/agents/psychoanalyzer` selects deterministic evidence, makes the single model call, and records provenance. Sleep Workflow owns automatic admission. Preference Learner remains the separate owner for user-confirmed interaction preferences; there is no Digest agent or persona cache execution path.
- Organizer is finite coordinator work: `brain/agents/organizer` selects bounded profile-resolved episodic records and executes `etc/cognitive-graphs/organizer-agent.json` once per record. Core memory scanning, validation, encryption, and atomic metadata persistence remain owned by `packages/core/src/memory.ts`; the graph must not scan or write profile files directly. Sleep Workflow owns automatic admission, while manual CLI, UI, and mobile adapters call the same agent contract.
- Profile personalization has one launch path: `packages/core/src/training-launch.ts` owns validation, single-flight process admission, lifecycle history, and dispatch to `brain/training/personalization`; manual API/UI callers delegate to it. `training-automation.ts` owns the profile's automatic admission policy, explicit launch preferences, readiness decision, and translation into that same launch contract, stored under `automatic` in the profile's `etc/training.json`. It is not a scheduler or second launcher. Sleep Workflow remains the sole owner allowed to admit automatic training, and no automatic trigger exists until that explicit stage is added there.
- Profile Sync is finite coordinator work: `brain/agents/profile-sync` authenticates and pages one remote profile pull. `packages/core/src/profile-sync.ts` exclusively owns the bounded bundle contract, profile-resolved sync-server configuration, checkpoints, and credential application; `packages/core/src/memory.ts` owns encrypted/idempotent episodic persistence. Trigger Manager and Work Coordinator own admission and terminal state. The Site may perform the pre-authentication bootstrap needed to create a missing local profile, but authenticated sync surfaces must queue the same agent and must not maintain a browser profile replica, credential store, or execution path.
- Mood is finite coordinator work: `conversation-buffer.ts` publishes persisted message-count events, TriggerManager owns count/cooldown admission, `brain/agents/mood` runs the graph, and `etc/cognitive-graphs/mood-review.json` owns the editable decision flow. Mood must not gain a service registration or parallel interval loop.
- Train of Thought is finite coordinator work: `brain/agents/train-of-thought` owns one seeded associative chain, while `agent_trigger` only admits follow-on work through the server Work Coordinator. Reflector and Inner Curiosity may each admit it after durable persistence using their editable 20% probability nodes; the exact persisted result becomes the seed. The node must not spawn agents, wait on the occupied LLM lane, or create a private scheduler.

## Excluded and Local Areas

- `apps/code-oss` is legacy Studio/Code OSS bulk and `apps/mobile` is the deprecated Capacitor-era app. Neither belongs in normal MetaHuman architecture audits unless explicitly reopened.
- `vendor` contains upstream submodules or third-party source. Preserve it as a dependency, but do not treat it as a MetaHuman refactor target.
- Runtime profiles, persona data, memory, logs, outputs, state, caches, virtual environments, model weights, downloaded tools, generated builds, backups, and generated audit inventories are outside the maintained source surface.
- The tracked root `AGENTS.md` is repository governance. It is deliberately
  excluded from executable maintained-source scanning because it instructs
  development agents rather than defining runtime behavior; that exclusion does
  not make it local, optional, or untracked. Machine-local agent and editor data
  remains outside the remote-safe source contract.
- Archived documentation is historical context, not current architecture authority.

## Validation

- `node --import tsx scripts/create-audit-inventory.ts --dry-run` parses this policy and reports the maintained inventory without rewriting generated reports.
- `pnpm check:architecture` applies architecture rules to the maintained source set while still applying remote-safety checks to the complete tracked tree.

## Remote Safety

Exclusion from architecture refactoring is not permission to track unsafe data. Remote-safety checks still inspect the complete tracked tree, including excluded areas.

Tracked remote content must not include personal profile data, private memories, local browser state, local audit scratchpads, tokens, model weights, generated logs, or local agent configuration. Use sanitized templates, fixtures, and examples when runtime shape must be documented.
