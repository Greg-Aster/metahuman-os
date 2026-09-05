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
- `packages/agent-runtime`: shared finite-agent execution interfaces. Core owns
  admission and execution; this package does not load, register, or execute agents.
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
- `packages/core/src/active-operator/mode-controller.ts` owns Reactive, Semi, and Full mode transitions. Semi owns configured scheduled and idle-triggered awake work. In Full, Robot Operator admits the Robot Autonomy Controller only after the current correlated execution/result chain finishes; the retired general Operator Policy loop must not be reintroduced as a competing producer.
- `packages/core/src/queue/sleep-workflow.ts` is the sole automatic owner for its nine ordered maintenance and reflection stages. `sleep-runtime.ts` owns durable phase/review state, and user activity cancels the remaining chain before awake automation resumes. Robot Operator children and awake TriggerManager schedules remain dormant while Sleep is active.
- `brain/services/robot-operator.ts` owns Robot Operator timing, mutual exclusion, and admission. Semi owns the configured timers for Robot Status, Robot Goal Review, and the three boredom planners. Full admits only `robot-autonomy-controller-mode.json` after the current correlated execution chain settles; that finite graph receives Robot Status, bounded conversation, inner dialogue, verified robot outcomes, current Environment Bridge facts, active desires, active persona, and a configurable task catalog backed by the canonical Agent Catalog. Its one LLM decision may speak, select one currently executable finite agent, or delegate one high-level embodied intention to Robot Autonomy Executor through Work Coordinator. It does not rotate tasks, schedule itself, or directly run an agent. `packages/core/src/robot-status.ts` owns the one profile-resolved Robot Status snapshot. Environment Mode and Robot Autonomy Executor each choose at most one action and end; `robot-action-result-mode.json` interprets the later correlated result once and records it through `robot_status_out`. `robot-goal-review-mode.json` may complete, continue, wait, request the user, abandon, speak, or delegate one high-level intention before ending. No action executor, result-review graph, or autonomy-controller graph re-enters itself. The stable executor key remains `boredom-autonomy`. Robot Operator remains dormant in Reactive mode or while Sleep is active.
- `brain/agents/environment-bridge` owns the singleton external-environment connection and transport lifecycle. Environment graph data enters through specialized owners: `environment_bridge_input` exposes only adapter observations plus bridge session and diagnostic state and identifies whether an observation triggered the current run or came from saved bridge state; the environment store resolves robot-reported action IDs against Work Coordinator records and `environment_action_context_input` strictly verifies and exposes that pre-resolved context; `robot_operator_input` exposes Robot Operator handoffs; `environment_feedback` correlates terminal results; and `environment_image_input` validates and selects current or comparison frames. Graph edges select the outputs each workflow consumes. In interactive Environment Mode, `orchestrator_llm` owns only the route switches for response, dialogue history, memory, Robot Status, bridge data, vision, and action context; it does not rewrite the instruction or choose an action. Robot Autonomy Executor reuses that route contract for an unchanged internally authored intention and applies only its selected context before making a self-directed decision. The `environmentActionSelector` model role remains the sole owner of conversation, advertised-action, or off-script movement selection for the chosen routes. `environment_send_action` owns transport only. Robot Action Result owns semantic result interpretation; Robot Goal Review owns the later continuation decision. `robot_status_out` only persists validated outputs and never calls a model, chooses an action, or schedules work.
- Agent Monitor plus `packages/core/src/agent-process-runner.ts` own persistent services and `etc/services.json`. Agent Monitor and agent-control authorization consume the Agent Catalog instead of a second allowlist. Maintenance Service is maintenance-only and does not own scheduling.
- Software updates are explicit Installation Owner actions, not agent or scheduler work. `packages/core/src/mobile-release.ts` owns strict mobile release metadata and APK resolution from the generated system `out/releases/mobile` store; the maintained React Native release script is its sole producer. `packages/core/src/api/handlers/server-update.ts` owns owner-guarded, single-flight Git update, dependency installation, production validation, and restart admission. Profile Sync must not trigger or execute software updates.
- `packages/core/src/model-resolver.ts` and `model-router.ts` own role-aware model selection, while `packages/core/src/llm-backend.ts` owns deployment-backend selection and `packages/core/src/providers/bridge.ts` owns provider transport and input validation. Image parts remain content on that same path; they do not select a separate vision backend or configuration. The router may use its established orchestrator-role fallback when a role-selected model explicitly lacks image capability, and the provider bridge must reject image input when the final selected model or adapter cannot preserve it.
- Whisper and Kokoro inference-server lifecycle belongs to `packages/core/src/voice-service-manager.ts`, `etc/voice-servers.json`, and the Server status/control surface. The owner-authorized Voice Settings surface may change CPU/CUDA selection only by delegating the atomic configuration update and managed restart to `voice-service-manager.ts`; it must not persist service device state in a user profile. `packages/core/src/stt.ts` and its managed `WhisperService` are the sole speech-to-text request path; there is no Transcriber agent or direct whisper.cpp/OpenAI file-transcription path. `KokoroService` is the sole Kokoro request/configuration owner for batch, phrase-streamed browser, and robot rendering, while `packages/core/src/tts/speech-chunks.ts` owns ordered phrase boundaries. User `voice.json` files own request preferences, not service device, process, URL, or port configuration. Voice lifecycle must remain independent from Agent Monitor; `validate:voice-service-ownership` and `validate:tts-synthesis` enforce those boundaries.
- `packages/core/src/tts/delivery-queue.ts` owns durable TTS delivery, leases, retry limits, acknowledgement, and interruption generations. `TTSQueueConsumer.svelte` is the browser playback actuator, not a second queue or admission owner.
- `apps/site/src/pages/api/trigger-manager` is thin transport. Shared handler logic belongs under `packages/core/src/api/handlers`, and browser surfaces use the shared TriggerManager store.
- `packages/core/src/persona-facets.ts` owns profile-aware facet reads, validated atomic full-config writes, and active-facet changes. App routes and graph nodes must not write `facets.json` directly.
- `packages/core/src/persona-learning.ts` owns validation and application of learned persona changes; `identity.ts` owns persona persistence and archives, and `persona-insights.ts` owns the bounded insight history. Identity and Persona Insights persist through the encryption-aware storage client. `brain/agents/psychoanalyzer` selects bounded deterministic evidence and runs `etc/cognitive-graphs/psychoanalyzer.json`; the graph owns the single model-backed evidence-to-proposal analysis before Persona Learning validates and applies it. The Agent Catalog entry is the sole enable switch: manual execution and the Sleep Workflow consume that same state, and Sleep records a disabled review as skipped. Manual-edit protection is an optional profile setting, off by default, that limits mutation to values retaining Psychoanalyzer provenance. There is no Digest agent, separate preference-learning system, or persona cache execution path.
- Organizer is finite coordinator work: `brain/agents/organizer` selects bounded profile-resolved episodic records and executes `etc/cognitive-graphs/organizer-agent.json` once per record. Core memory scanning, validation, encryption, and atomic metadata persistence remain owned by `packages/core/src/memory.ts`; the graph must not scan or write profile files directly. Sleep Workflow owns automatic admission, while manual CLI, UI, and mobile adapters call the same agent contract.
- Profile personalization has one launch path: `packages/core/src/training-launch.ts` owns validation, single-flight process admission, lifecycle history, and dispatch to `brain/training/personalization`; manual API/UI callers delegate to it. `training-automation.ts` owns the profile's automatic admission policy, explicit launch preferences, readiness decision, and translation into that same launch contract, stored under `automatic` in the profile's `etc/training.json`. It is not a scheduler or second launcher. Sleep Workflow remains the sole owner allowed to admit automatic training, and no automatic trigger exists until that explicit stage is added there.
- Profile Sync is finite coordinator work: `brain/agents/profile-sync` authenticates and pages one remote profile pull. `packages/core/src/profile-sync.ts` exclusively owns the bounded bundle contract, profile-resolved sync-server configuration, checkpoints, and credential application; `packages/core/src/memory.ts` owns encrypted/idempotent episodic persistence. Trigger Manager and Work Coordinator own admission and terminal state. The Site may perform the pre-authentication bootstrap needed to create a missing local profile, but authenticated sync surfaces must queue the same agent and must not maintain a browser profile replica, credential store, or execution path.
- Inner Curiosity is finite coordinator work: `brain/agents/inner-curiosity` resolves authenticated execution identity and runs `etc/cognitive-graphs/inner-curiosity.json`. That graph owns memory sampling, persona context, private question and answer generation, related-memory retrieval, durable Inner Dialogue Buffer and Persona Memory writes, and optional Train of Thought admission. The Brain adapter must not call model transport or reproduce those stages outside the graph.
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
