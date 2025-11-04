# MetaHuman OS — System Design

## Purpose
This document explains how MetaHuman OS is structured in code, how data flows through the system, and what guardrails keep the local-first assistant safe to operate. It complements the architecture overview with deeper detail on design goals, primary components, and end-to-end behaviors so contributors can modify or extend the system confidently.

## Design Goals
- **Own your data** — All persistent state lives inside the repository tree (persona, memory, logs, outbox) using plain-text formats that can be inspected, versioned, or selectively synced.【F:packages/core/src/paths.ts†L24-L66】
- **Single source of truth** — Runtime surfaces (CLI, agents, web UI) share the `@metahuman/core` library so that capabilities, validations, and persistence logic only live in one place.【F:packages/cli/src/mh-new.ts†L8-L42】
- **Composable autonomy** — Persona profiles, trust levels, and policy evaluation determine what background skills or agents can do without human oversight, allowing operators to graduate autonomy gradually.【F:packages/core/src/identity.ts†L30-L93】【F:packages/core/src/policy.ts†L18-L127】
- **Observable by default** — Every meaningful action is logged, auditable, and tied to an actor, enabling the CLI and UI to surface status, metrics, and safety signals without external services.【F:packages/core/src/audit.ts†L24-L188】【F:packages/core/src/agent-monitor.ts†L55-L200】

## Component Model
### `@metahuman/core`
The core package hosts shared services:
- **Path discovery & file layout** — Resolves the repo root, canonical folder paths, and ID/timestamp utilities so every caller reads and writes the same tree.【F:packages/core/src/paths.ts†L5-L82】
- **Identity & persona** — Loads/saves persona documents, exposes summaries, and lets trusted operators adjust modes safely.【F:packages/core/src/identity.ts†L30-L93】
- **Memory system** — Captures episodic events, manages task JSON, triggers sync logs, and hooks into the vector index to keep retrieval fresh.【F:packages/core/src/memory.ts†L32-L188】
- **LLM & embeddings** — Wraps the Ollama HTTP API with deterministic fallbacks so local and offline environments behave predictably.【F:packages/core/src/ollama.ts†L1-L149】【F:packages/core/src/embeddings.ts†L3-L26】
- **Retrieval layer** — Builds, persists, and queries semantic indexes spanning episodic memories, tasks, and curated knowledge.【F:packages/core/src/vector-index.ts†L55-L181】
- **Skills & policy** — Registers skill manifests, queues approvals, checks trust, and coordinates policy enforcement and audit trails.【F:packages/core/src/skills.ts†L87-L189】【F:packages/core/src/policy.ts†L18-L200】
- **Observability** — Centralized audit logging, agent monitors, and file locks keep long-running automation coordinated and reviewable.【F:packages/core/src/audit.ts†L24-L188】【F:packages/core/src/agent-monitor.ts†L55-L200】【F:packages/core/src/locks.ts†L15-L63】
- **Audio pipeline** — Normalizes audio ingestion and transcription with whisper.cpp/OpenAI backends while preserving local fallbacks.【F:packages/core/src/transcription.ts†L1-L200】

### Command Line Interface (`bin/mh`, `packages/cli`)
The CLI bootstraps a workspace (`mh init`), surfaces persona and memory status, manages tasks, orchestrates background agents, and exposes adapters and skills management. All operations route through `@metahuman/core`, guaranteeing consistent storage, auditing, and policy checks.【F:packages/cli/src/mh-new.ts†L46-L200】

### Background Agents (`brain/agents`)
Agents are Node-based scripts that import shared helpers to enrich memories, maintain indexes, or perform autonomous workflows. They rely on locks, audit trails, and policy-aware primitives to operate safely without races.【F:brain/agents/organizer.ts†L1-L200】【F:packages/core/src/locks.ts†L15-L63】

### Web Interface (`apps/site`)
The Astro + Svelte dashboard consumes the same core library inside API routes and components to list tasks, mutate state, and audit human interactions, yielding parity with the CLI without duplicating business logic.【F:apps/site/src/pages/api/tasks.ts†L1-L145】

### Startup & Tooling Scripts
Cross-platform launchers under `start.*` and `scripts/` wrap the CLI to start agents, serve the UI, and enforce prerequisite checks. Because they ultimately delegate to CLI commands, they inherit the same storage and auditing behavior.【F:packages/cli/src/mh-new.ts†L184-L200】

## Data Layout & Persistence
`paths.ts` defines canonical directories for persona, memory, audio inboxes, task queues, logs, and runtime locks. This layout ensures predictable organization and enables external tooling (git, sync, backup) without specialized exports.【F:packages/core/src/paths.ts†L24-L66】

Within that structure:
- **Persona** — JSON files describing identity, relationships, routines, and decision rules load through the identity helpers.【F:packages/core/src/identity.ts†L30-L93】
- **Memory** — Episodic entries are timestamped JSON files per year; tasks live under `memory/tasks/active|completed`; semantic/procedural knowledge and audio artifacts have dedicated folders to keep ingestion organized.【F:packages/core/src/memory.ts†L32-L188】
- **Logs & audit** — Daily NDJSON files capture actions, decisions, and security events, while run logs track agent status and locks guard concurrent access.【F:packages/core/src/audit.ts†L24-L188】【F:packages/core/src/agent-monitor.ts†L55-L200】【F:packages/core/src/locks.ts†L15-L63】
- **Indexes** — Embedding JSON stores sit under `memory/index/`, enabling rebuilds or manual inspection when debugging retrieval behaviors.【F:packages/core/src/vector-index.ts†L27-L136】

## Key Flows
### Workspace Initialization
`mh init` creates required directories, copies template persona/config files, and records an audit event so operators can track setup history.【F:packages/cli/src/mh-new.ts†L62-L151】

### Task Lifecycle
Tasks created via CLI or web UI persist as JSON under `memory/tasks/active`, with updates moving artifacts to completed folders. Vector index routines embed both active and completed tasks so retrieval surfaces current priorities alongside historical decisions.【F:packages/core/src/memory.ts†L99-L186】【F:apps/site/src/pages/api/tasks.ts†L48-L134】【F:packages/core/src/vector-index.ts†L86-L136】

### Memory Enrichment
Background agents (e.g., `organizer`) scan episodic stores for unprocessed events, call local LLMs to extract tags/entities, normalize results, and update files while auditing each action for review.【F:brain/agents/organizer.ts†L48-L199】

### Retrieval Augmentation
When embeddings exist, new events append into the vector index, and query helpers build ranked RAG contexts for prompts or UI displays without leaving the local machine.【F:packages/core/src/memory.ts†L62-L77】【F:packages/core/src/vector-index.ts†L55-L181】

## Autonomy, Trust, and Safety
- **Persona-driven trust** — Decision rule files enumerate available trust modes; setters validate changes and timestamp updates so autonomy changes remain deliberate.【F:packages/core/src/identity.ts†L30-L93】
- **Policy engine** — Skill executions evaluate trust requirements, risk tiers, and resource access rules before running, ensuring dangerous actions either fail or request approval.【F:packages/core/src/policy.ts†L18-L200】
- **Skill approvals** — High-risk or restricted skills enter an approval queue persisted to disk so humans can review, approve, or reject before execution.【F:packages/core/src/skills.ts†L87-L189】
- **Auditing & monitoring** — Central audit logs capture system, data, action, and security events. Agent monitors parse those logs to surface run health, error rates, and outstanding work in both CLI and UI surfaces.【F:packages/core/src/audit.ts†L24-L188】【F:packages/core/src/agent-monitor.ts†L55-L200】
- **Concurrency controls** — File locks for agents ensure only one process manipulates a shared resource at a time, avoiding duplicate work or corruption.【F:packages/core/src/locks.ts†L15-L63】

## Intelligence Stack
- **Language models** — Ollama client utilities check availability, manage model lifecycle, stream chat/completion responses, and gracefully degrade when the daemon is offline.【F:packages/core/src/ollama.ts†L1-L149】
- **Embeddings** — The embedding helper calls Ollama or a deterministic mock to provide consistent vector dimensions for similarity searches.【F:packages/core/src/embeddings.ts†L3-L26】
- **Vector search** — Index builders walk memory/task trees, embed content, and write unified JSON indexes that query helpers slice into context windows for prompts.【F:packages/core/src/vector-index.ts†L55-L181】
- **Audio understanding** — Transcription utilities orchestrate whisper.cpp, ffmpeg transcoding, and mock fallbacks, keeping audio workflows local-first and inspectable.【F:packages/core/src/transcription.ts†L1-L200】

## Observability & Operations
Operator tooling layers on top of the audit and monitoring primitives:
- `mh status` reports persona summary, task counts, and recent event totals so humans can gauge system health quickly.【F:packages/cli/src/mh-new.ts†L154-L182】
- Agent monitors list available scripts, read audit lines, compute run metrics, and report backlog sizes for episodic processing, allowing proactive intervention without external dashboards.【F:packages/core/src/agent-monitor.ts†L55-L200】

## Extensibility Guidelines
- **Add a skill** — Define a manifest under `brain/skills`, register it through `registerSkill`, and rely on policy/approval queues to enforce safety automatically.【F:packages/core/src/skills.ts†L87-L189】
- **Add an agent** — Drop an ESM script in `brain/agents`, import core helpers (memory, audit, locks), and leverage agent monitor APIs for lifecycle visibility.【F:brain/agents/organizer.ts†L1-L200】【F:packages/core/src/agent-monitor.ts†L55-L200】
- **Extend the UI** — Build Astro API routes or Svelte components that call `@metahuman/core` the same way the tasks API does, guaranteeing data consistency and auditing for human-driven changes.【F:apps/site/src/pages/api/tasks.ts†L1-L145】

## Operational Considerations
- **Local-first defaults** mean operators must manage disk usage and backups; the deterministic data layout simplifies selective syncs.
- **Mock fallbacks** for Ollama, embeddings, and audio make development frictionless, but production deployments should verify real models and binaries are installed.
- **Incremental autonomy** encourages running in suggest/supervised modes until persona rules, skills, and policies are tuned for bounded automation.【F:packages/core/src/policy.ts†L18-L127】

This design description mirrors the current repository state and code paths so engineers and operators can evolve MetaHuman OS without reintroducing drift.
