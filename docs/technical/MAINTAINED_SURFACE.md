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
    "GEMINI.md",
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
- `external/kokoro`, `external/kitten`, and `external/whisper`: tracked integration entrypoints maintained by this repository. Their virtual environments, downloaded dependencies, models, caches, and generated outputs are not maintained source.
- `etc`, `scripts`, `bin`, `docker`, `tests`, and remote-safe documentation and fixtures that describe or validate maintained behavior.
- Tracked interface assets such as icons and images are maintained when they are not generated or otherwise excluded by the policy.

## Critical Runtime Ownership Boundaries

These are the high-risk single-owner constraints that refactor work must preserve. They are not an inventory of every runtime component.

The active-task nodes' version 2 contract separates desired, pending and
acknowledged steering controls in the existing checkpoint. Steering v1 receipts
correlate to the original motion, command, revision and session; acceptance does
not establish physical movement. Failed, unsupported and uncertain outcomes
remain model-visible, and uncertainty must be reconciled before another update
or replacement motion. A capture receipt establishes only the capture step:
the correlated image goes through the existing model router/provider bridge in
an asynchronous Coordinator job with explicit remote placement. Positive target
and completion-criteria evidence advances the phase; negative, ambiguous, stale
and failed perception leaves the objective unfinished for the existing LLM-led
loop. Generated motion uses that same finite-job path and the existing movement
generator. No heavy inference blocks the active task's event step. Existing
durable executable-version checks reject incompatible old checkpoints instead
of interpreting their pre-acknowledgement steering state as a fresh motion.

- `packages/core/src/terminal/` owns shell sessions, bounded screen state, Claude Code/Codex provider execution, and verified process-session cleanup. `brain/services/terminal.ts` exposes this owner as the on-demand `terminal` Agent Monitor service; its registration defaults disable boot startup and automatic restart. `terminal/client.ts` is the sole cross-process control interface over a private Unix socket, and owner-guarded Core API handlers expose same-origin transport. `apps/site/src/components/terminal/` owns only the mounted display and its connection; hiding it retains sessions, while closing a session or stopping the agent terminates owned work. Provider admission is single-flight before asynchronous initialization. Disabling Big Brother or changing provider must stop the prior session before saving the change. Receipts retain Linux process-session identities until cleanup is confirmed; recovery terminates saved work and never replays commands. There is no ttyd listener, browser-owned shell, detached provider fallback, or terminal-specific subscription while the panel is hidden.
- `packages/core/src/agent-catalog.ts` owns the merged installed/runtime Agent Catalog; `agent-catalog-definitions.ts` owns built-in identity, aliases, risk, workflow relations, and safe registration defaults. Registration only adds or removes finite Trigger Manager membership and never deletes executable source, logs, history, or admitted work.
- `packages/core/src/queue/queue-system.ts` owns the server Work Coordinator and its observable TriggerManager runtime. Non-owner processes submit through `packages/core/src/queue/work-submission.ts`; they do not start private coordinators.
- `packages/core/src/sessions.ts` owns authenticated profile selection for the current Coordinator lifetime, shared with Brain through its system-level transactional session database. Login, storage-ready authenticated requests, and explicit unlock select the profile; logout, expiry, locking, and server restart revoke selection. An ordinary authenticated request can restore a surviving login after restart, but cannot override an explicit selection or revocation. Selection changes notify existing background owners after commit. Persisted cookies and activity history alone are not recovery authority. Durable recovery, old outbox delivery, and restored queue claims use that selection without scanning other profiles. Fresh explicit work and incoming result evidence retain their existing owners. Legacy session JSON is imported once and retired; callers must use Session APIs, not write session snapshots.
- `packages/core/src/agency` owns Desire identity, evidence, strength, lifecycle transitions, profile-scoped storage, trust/risk policy, and explicit data migration. `desire-agent` is the sole public Desire System controller. It may be run manually or selected by Sleep Workflow or Robot Autonomy; no conversation event, timer, or task mutation independently admits Desire work. When the agent runs, its existing Brain generator reads bounded persisted conversation history and other enabled profile sources, applies unchanged evidence once through the editable Desire Generator graph, and admits only the internal planning, execution, outcome-review, or check-in stages that are needed through `packages/core/src/queue/work-submission.ts` and the Work Coordinator. Brain Desire Planner and Core execution/outcome handlers are internal stages, not catalog agents. New candidates need a finite observable outcome and a semantic outcome key; moods and indefinite behavior styles are not executable goals. Reduced inhibition remains intentional: strong or mature desires may lower trust requirements under the configured Agency policy. Every executing plan still needs completion criteria, explicit step targets, and its matching review receipt. `desire-executor.json` advances the persisted plan one step at a time; native robot steps share the durable parent and retain Desire, plan-version, step, and action identity through returned evidence. Its final checkpoint admits outcome review through the existing Desire Agent contract. General Robot Goal Review does not continue Agency-owned steps. Robot Status exposes only bounded pending-work references, titles, statuses, next actions, and update times; full motivation and plans belong to the selected Agency workflow. Automatic Agency reports remain in storage but do not enter later conversational model history.
- `packages/core/src/queue/trigger-config-service.ts` owns validated, atomic, live-applied scheduling configuration in system `etc/agents.json`. TriggerManager owns clocks and finite admission, not direct execution or persistent-process supervision.
- `packages/core/src/active-operator/mode-controller.ts` owns Reactive, Semi, and Full mode transitions and the direct emergency-stop path. Semi owns configured timed and idle-triggered admissions; Full continues active graph executions from their saved event waits and admits a new Robot Autonomy Controller only after the current execution settles. The retired general Operator Policy loop must not become a competing producer.
- `packages/core/src/queue/sleep-workflow.ts` is the sole automatic owner for its seven ordered stages: Organizer, Curator, eligible personalization training, Desire Agent, Dreamer, persona review, and index refresh. `sleep-runtime.ts` owns durable phase/review state. User activity cancels the remaining chain and the bounded training job before awake automation resumes. Robot Operator children and awake TriggerManager schedules remain dormant while Sleep is active.
- `brain/services/robot-operator.ts` owns Robot Operator timing and admission, not objective reconstruction. Semi timers signal an existing execution or admit their configured task. Full responds to Coordinator state changes: it signals a mode-eligible saved wait or admits one new Robot Autonomy Controller when no execution is active. The controller receives persona, conversation including the latest user turn, inner dialogue, robot outcomes, Bridge facts, Robot Status, optional desires, and the canonical Agent Catalog. The model chooses speech, a finite agent, or a high-level embodied intention. Child robot workflows share their parent's execution; finite agents remain Coordinator work with correlated returns. There is no task rotation, independent Full-mode Goal Review poll, or feedback-driven fresh graph entry. Robot Operator remains dormant in Reactive mode or while Sleep is active.
- `packages/core/src/graph-runtime.ts` enters the profile-resolved durable execution owner in `durable-execution`; `graph-executor.ts` is the one LangGraph-backed scheduler for all saved SvelteFlow graphs and direct graph calls. SQLite owns ordered events, immutable saved node outputs, versioned checkpoints, objective identity, and pending dispatch intent. Work Coordinator alone owns finite-job admission, recovery and body ownership. Its durable receipts bridge the separate SQLite/JSON commits. Robot Status is a readable projection, buffers are bounded narrative, memory owns recall, and Agency retains optional Desire lifecycle ownership. Neither Robot Status nor a later conversation reconstructs or replaces the execution thread.
- `brain/agents/environment-bridge` owns the singleton external connection and transport lifecycle. Specialized input nodes expose Bridge observations, Coordinator action context, operator handoffs, correlated feedback, and selected images. `orchestrator_llm` selects needed context/routes and whether an input starts, steers, or cancels an execution; it does not rewrite that input or select a body command. The configured `environmentActionSelector` model authors conversation or one complete ordered task program: semantic actions, generated body-local motion, and ongoing behaviors. Environment Mode and the autonomy executor both delegate physical work to `environment_active_task` / `robot-active-task-mode.json` inside the same execution. This executor advances phases from physical receipts, updates the original ongoing gait from perception, and dispatches asynchronous image-identification jobs through the existing Coordinator. Forward and turning combine through the existing Bridge/gateway update contract. A target match completes a behavior phase; the whole task completes only after its remaining phases. User input returns through existing intent routing, preserving active-program continuity. There is no per-movement Action Result workflow or separate local-task executor. Task-level Goal Review remains for unfinished cognitive objectives. Robot Status projects these decisions and never owns a continuation. Host adapter receipts enforce immutable action identity and current fencing at the wire boundary; unknown physical outcomes are not blindly retried. Emergency stop remains independent of model interpretation.
- Agent Monitor plus `packages/core/src/agent-process-runner.ts` own persistent services and `etc/services.json`. Agent Monitor and agent-control authorization consume the Agent Catalog instead of a second allowlist; leased coordinator work carrying an explicit monitor owner is displayed under that public finite agent, including internal Desire stages under Desire Agent. Maintenance Service is maintenance-only and does not own scheduling.
- Software updates are explicit Installation Owner actions, not agent or scheduler work. `packages/core/src/mobile-release.ts` owns strict mobile release metadata and APK resolution from the generated system `out/releases/mobile` store; the maintained React Native release script is its sole producer. `packages/core/src/api/handlers/server-update.ts` owns owner-guarded, single-flight Git update, dependency installation, production validation, and restart admission. Profile Sync must not trigger or execute software updates.
- `packages/core/src/model-resolver.ts` and `model-router.ts` own role-aware model selection, while `packages/core/src/llm-backend.ts` owns deployment-backend selection and `packages/core/src/providers/bridge.ts` owns provider transport and input validation. Image parts remain content on that same path; they do not select a separate vision backend or configuration. The router may use its established orchestrator-role fallback when a role-selected model explicitly lacks image capability, and the provider bridge must reject image input when the final selected model or adapter cannot preserve it.
- Whisper, Kokoro and Kitten inference-server lifecycle belongs to `packages/core/src/voice-service-manager.ts`, `etc/voice-servers.json`, and the Server status/control surface. The owner-authorized Voice Settings surface may change CPU/CUDA selection only by delegating the atomic configuration update and managed restart to `voice-service-manager.ts`; it must not persist service device state in a user profile. Kitten Micro is CPU-only. `packages/core/src/stt.ts` and its managed `WhisperService` are the sole speech-to-text request path; there is no Transcriber agent or direct whisper.cpp/OpenAI file-transcription path. `KokoroService` is the sole Kokoro request/configuration owner for batch, phrase-streamed browser, and robot rendering. `KittenService` owns Kitten batch requests and delegates ordered browser streaming to the existing generic TTS stream handler. `packages/core/src/tts/speech-chunks.ts` owns ordered phrase boundaries for both engines. User `voice.json` files own request preferences, not service device, process, URL, or port configuration. Voice lifecycle must remain independent from Agent Monitor; `validate:voice-service-ownership` and `validate:tts-synthesis` enforce those boundaries.
- `packages/core/src/tts/delivery-queue.ts` owns durable TTS delivery, leases, retry limits, acknowledgement, and interruption generations. `TTSQueueConsumer.svelte` is the browser playback actuator, not a second queue or admission owner.
- `apps/site/src/pages/api/trigger-manager` is thin transport. Shared handler logic belongs under `packages/core/src/api/handlers`, and browser surfaces use the shared TriggerManager store.
- `packages/core/src/persona-facets.ts` owns profile-aware facet reads, validated atomic full-config writes, and active-facet changes. App routes and graph nodes must not write `facets.json` directly.
- `packages/core/src/persona-learning.ts` owns validation and application of learned persona changes; `identity.ts` owns persona persistence and archives, and `persona-insights.ts` owns the bounded insight history. Identity and Persona Insights persist through the encryption-aware storage client. `brain/agents/psychoanalyzer` selects bounded deterministic evidence and runs `etc/cognitive-graphs/psychoanalyzer.json`; the graph owns the single model-backed evidence-to-proposal analysis before Persona Learning validates and applies it. The Agent Catalog entry is the sole enable switch: manual execution and the Sleep Workflow consume that same state, and Sleep records a disabled review as skipped. Manual-edit protection is an optional profile setting, off by default, that limits mutation to values retaining Psychoanalyzer provenance. There is no Digest agent, separate preference-learning system, or persona cache execution path.
- Organizer is finite coordinator work: `brain/agents/organizer` selects bounded profile-resolved episodic records and executes `etc/cognitive-graphs/organizer-agent.json` once per record. Core memory scanning, validation, encryption, and atomic metadata persistence remain owned by `packages/core/src/memory.ts`; the graph must not scan or write profile files directly. Sleep Workflow owns automatic admission, while manual CLI, UI, and mobile adapters call the same agent contract.
- Profile personalization has one launch path: `packages/core/src/training-launch.ts` validates and freezes settings, admits one process, and dispatches to the shared `brain/training/personalization/full-cycle.ts` worker. UI, API, CLI and Sleep delegate to it. `training-process.ts` owns process identity, terminal history, profile-scoped log/monitor projections, and recovery from saved provider cleanup receipts. Core's RunPod provider confirms resource cleanup; Brain owns finite SSH transfer and training orchestration. `training-automation.ts` owns the disabled-by-default policy under `automatic` in the profile's `etc/training.json`, selected-data readiness, example-ID novelty, cooldown and the finite Sleep-stage contract. Sleep is the only automatic admission owner; the worker's session/deadline watchdog cannot schedule new jobs.
- `training-config.ts` owns the profile's training settings. `training-schema.ts` is the browser-safe data/receipt contract; `training-dataset.ts` owns objective-aware selection, encrypted source/review inspection, deterministic replay and historical split protection. The Brain dataset pipeline freezes messages and manifests. The shared `docker/runpod-trainer/train_unsloth.py` applies native templates, final-continuation supervision and independent serialized-artifact evaluation for personalization; the Action Selector retains its separate development-fold policy. `adapters.ts` verifies candidates and owns persisted serving reviews. Training History exposes preparation, comparison, decisions, approval suspension and cleanup recovery. Existing model-role assignment owns activation/rollback, and the provider bridge checks approval for the artifact actually dispatched, including backend aliases. The Model Resolver node and persona controls use profile model settings; legacy global adapter flags cannot select a model. No training worker advances a base-model registry, changes roles, or writes an active-adapter pointer.
- Profile Sync is finite coordinator work: `brain/agents/profile-sync` authenticates and pages one remote profile pull. `packages/core/src/profile-sync.ts` exclusively owns the bounded bundle contract, profile-resolved sync-server configuration, checkpoints, and credential application; `packages/core/src/memory.ts` owns encrypted/idempotent episodic persistence. Trigger Manager and Work Coordinator own admission and terminal state. The Site may perform the pre-authentication bootstrap needed to create a missing local profile, but authenticated sync surfaces must queue the same agent and must not maintain a browser profile replica, credential store, or execution path.
- Inner Curiosity is finite coordinator work: `brain/agents/inner-curiosity` resolves authenticated execution identity and runs `etc/cognitive-graphs/inner-curiosity.json`. That graph owns memory sampling, persona context, private question and answer generation, related-memory retrieval, durable Inner Dialogue Buffer and Persona Memory writes, and optional Train of Thought admission. The Brain adapter must not call model transport or reproduce those stages outside the graph.
- Mood is finite coordinator work: `conversation-buffer.ts` publishes persisted message-count events, TriggerManager owns count/cooldown admission, `brain/agents/mood` runs the graph, and `etc/cognitive-graphs/mood-review.json` owns the editable decision flow. Mood must not gain a service registration or parallel interval loop.
- Train of Thought is finite coordinator work: `brain/agents/train-of-thought` owns one seeded associative chain, while `agent_trigger` only admits follow-on work through the server Work Coordinator. Reflector and Inner Curiosity may each admit it after durable persistence using their editable 20% probability nodes; the exact persisted result becomes the seed. The node must not spawn agents, wait on the occupied LLM lane, or create a private scheduler.

- `packages/core/src/api/handlers/reset-factory.ts` owns the explicitly confirmed, authenticated-profile memory reset through the existing `/api/reset-factory` route. Agency storage supplies its history paths while retaining its configuration; storage owns confined deletion, encryption readiness and exclusion of memory/Agency writes during reset. Work Coordinator owns idle admission, cancellation of inactive saved workflows and retirement of profile receipts; the durable checkpointer owns terminal execution removal; buffer and speech-delivery owners clear their histories. Reset excludes new memory work and validates the whole profile before ending inactive workflows through the existing Coordinator cancellation path. Queued work, live execution writers, unfinished or uncertain effects and training still block deletion. Shared sessions, audit records and process receipts remain. The existing Security Settings control states the retained persona, tasks, configuration and training artifacts; it does not promise model or installation factory defaults. QueuePanel uses its existing stream across application views, and profile-history deletion publishes the existing task-deletion event after persistence.

## Excluded and Local Areas

- `apps/code-oss` is legacy Studio/Code OSS bulk and `apps/mobile` is the deprecated Capacitor-era app. Neither belongs in normal MetaHuman architecture audits unless explicitly reopened.
- `vendor` contains upstream submodules or third-party source. Preserve it as a dependency, but do not treat it as a MetaHuman refactor target.
- Runtime profiles, persona data, memory, logs, outputs, state, caches, virtual environments, model weights, downloaded tools, generated builds, backups, and generated audit inventories are outside the maintained source surface.
- Root `AGENTS.md` is repository governance; `CLAUDE.md` and `GEMINI.md` are
  remote-safe pointers to it. These files belong in version control and are
  excluded from executable maintained-source scanning because they instruct
  development agents rather than define runtime behavior. This exclusion does
  not make the guidance optional or exempt it from remote-safety checks.
  Machine-local agent and editor data remains outside the remote-safe contract.
- Archived documentation is historical context, not current architecture authority.

## Validation

- `node --import tsx scripts/create-audit-inventory.ts --dry-run` parses this policy and reports the maintained inventory without rewriting generated reports.
- `pnpm check:architecture` applies architecture rules to the maintained source set while still applying remote-safety checks to the complete tracked tree.

## Remote Safety

Exclusion from architecture refactoring is not permission to track unsafe data. Remote-safety checks still inspect the complete tracked tree, including excluded areas.

Tracked remote content must not include personal profile data, private memories, local browser state, local audit scratchpads, tokens, model weights, generated logs, or local agent configuration. Use sanitized templates, fixtures, and examples when runtime shape must be documented.
