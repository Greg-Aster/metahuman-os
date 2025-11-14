# MetaHuman OS — Technical Architecture

## System Overview
MetaHuman OS is a local-first digital companion that mirrors a person's identity, memory, and workflows. The system is built around TypeScript packages that run entirely on the user's machine, persist data as human-readable JSON, and orchestrate background agents, a command-line interface, and a web dashboard. Local LLMs (via Ollama) and optional audio tooling (Whisper, Piper) provide intelligence while keeping private data on disk. Core principles:

- **Local and inspectable** — All state lives under the repository root (`persona/`, `memory/`, `logs/`, `out/`) as JSON/Markdown that the user owns.
- **Composable runtime surfaces** — A CLI, long-running agents, and an Astro/Svelte UI share the same core library.
- **Auditability and safety** — Every meaningful action is logged, policy-checked, and tied to an explicit trust level.

## High-Level Runtime
```
┌────────────────────────────┐
│        User Surfaces       │
│  • bin/mh CLI              │
│  • apps/site web UI        │
└─────────────┬──────────────┘
              │ imports @metahuman/core
┌─────────────▼──────────────┐
│     @metahuman/core        │
│  Paths • Identity • Memory │
│  LLM • Skills • Policies   │
│  Vector Index • Logging    │
└─────────────┬──────────────┘
              │ file APIs + child processes
┌─────────────▼──────────────┐
│      Runtime Data          │
│ persona/ • memory/ • logs/ │
│ etc/ • vendor/             │
└────────────────────────────┘
              │ spawns
┌─────────────▼──────────────┐
│      brain/agents          │
│  Background automation     │
└────────────────────────────┘
```

## Core Packages and Entry Points
### `@metahuman/core` (`packages/core/src`)
The core ESM library supplies shared capabilities:
- **Path discovery** (`paths.ts`) — Finds the repository root and centralizes folders for persona, memory, logs, skills, etc., so every surface reads/writes the same data layout.【F:packages/core/src/paths.ts†L1-L63】
- **Identity management** (`identity.ts`) — Loads and saves persona profiles and decision rules, exposes `getIdentitySummary()` for CLI/UI status panes, and supports adjusting trust levels safely.【F:packages/core/src/identity.ts†L1-L82】【F:packages/core/src/identity.ts†L100-L124】
- **Memory operations** (`memory.ts`) — Captures episodic events, CRUDs task files, and hydrates search helpers using JSON storage under `memory/` while updating sync logs and the optional embedding index.【F:packages/core/src/memory.ts†L1-L104】【F:packages/core/src/memory.ts†L126-L206】
- **LLM + embeddings** (`ollama.ts`, `llm.ts`, `embeddings.ts`) — Wraps the Ollama HTTP API for chat/generation/model management and exposes embedding helpers with a mock fallback when Ollama is offline.【F:packages/core/src/ollama.ts†L1-L110】【F:packages/core/src/embeddings.ts†L1-L24】
- **Vector index** (`vector-index.ts`) — Builds and queries semantic indexes over episodic memories, tasks, and curated notes stored under `memory/index/` to power RAG prompts.【F:packages/core/src/vector-index.ts†L1-L104】
- **Skills & policy enforcement** (`skills.ts`, `policy.ts`) — Registers executable skills, queues approvals, and evaluates whether an action is allowed at the current trust level, auditing every registration and execution.【F:packages/core/src/skills.ts†L1-L86】【F:packages/core/src/policy.ts†L1-L83】
- **Audit & logging** (`audit.ts`, `logging.ts`, `agent-monitor.ts`) — Writes append-only NDJSON audit trails, streams agent logs, and surfaces run metrics for the UI and CLI dashboards.【F:packages/core/src/audit.ts†L1-L48】【F:packages/core/src/agent-monitor.ts†L1-L61】
- **Autonomy & configuration** (`autonomy.ts`, `locks.ts`, `adapters.ts`, etc.) — Reads runtime guardrails, coordinates file locks for agents, and adapts third-party integrations.
- **Audio pipeline** (`transcription.ts`, `tts.ts`, `voice-training.ts`, `stt.ts`) — Provides transcription, text-to-speech, and dataset tooling that wrap local binaries (whisper.cpp, piper) with mock fallbacks for development.【F:packages/core/src/transcription.ts†L1-L64】

Every runtime surface imports from this package (published locally via `pnpm link` during dev) so logic lives in one place.

### CLI (`packages/cli` + `bin/mh`)
The CLI command (`packages/cli/src/mh-new.ts`) is the user-facing entry point. It bootstraps directory structures during `mh init`, surfaces persona/memory status, manages tasks and events, drives Ollama interactions, monitors agents, and exposes subcommands defined in `commands/` (e.g., persona and adapter utilities). All operations go through `@metahuman/core`, so CLI actions reuse the same audit, policy, and storage layers.【F:packages/cli/src/mh-new.ts†L1-L120】

### Background Agents (`brain/agents`)
Agents are Node scripts (ESM) that import `@metahuman/core` to perform autonomous routines such as enriching episodic memories, processing inbox files, or running nightly reflections. For example, `organizer.ts` scans the episodic store, calls local LLMs for metadata, and logs outcomes through the audit helpers.【F:brain/agents/organizer.ts†L18-L78】 Agent lifecycle (registration, status, logs) is surfaced via the CLI and UI using the agent monitor utilities.

### Web Interface (`apps/site`)
The Astro + Svelte dashboard consumes `@metahuman/core` directly inside API routes and server components. API endpoints (e.g., `pages/api/tasks.ts`) delegate to memory helpers to list/create/update tasks while auditing mutations, and UI components pull persona summaries, logs, and embedding status for real-time monitoring.【F:apps/site/src/pages/api/tasks.ts†L1-L65】 Voice input/output routes also reuse the shared audio modules.

### Startup Scripts & Tooling
Cross-platform scripts (`start.sh`, `start.py`, `start.bat`) orchestrate dependency checks, virtualenv creation, and launch the UI/agents. Helper binaries under `bin/` wrap the CLI for convenience, while `scripts/` hosts automation utilities.

## Data & Storage Layout
`@metahuman/core/paths` defines the canonical on-disk structure:

- **Persona** (`persona/core.json`, `persona/decision-rules.json`, etc.) — Identity, values, routines, and trust configuration that drive autonomy decisions.【F:packages/core/src/paths.ts†L23-L41】
- **Memory** (`memory/episodic/`, `memory/tasks/`, `memory/semantic/`, `memory/index/`) — Time-stamped events, task JSON, curated knowledge, and embedding artifacts. Helpers ensure directories exist, generate IDs, and consolidate metadata.【F:packages/core/src/memory.ts†L1-L74】
- **Brain** (`brain/agents/`, `brain/skills/`, `brain/policies/`) — Source-controlled automation and capabilities invoked by agents or the operator.【F:packages/core/src/paths.ts†L44-L55】
- **Logs** (`logs/audit/*.ndjson`, `logs/run/agents/`) — Append-only audit trail, agent run histories, and sync logs consumed by monitors.【F:packages/core/src/paths.ts†L56-L63】
- **Etc / Out** (`etc/*.json`, `out/`) — Runtime configs (autonomy, audio, ingestion) and generated artifacts (briefs, plans, exports).

All state is plain text so users can inspect, version, or sync selectively.

## Intelligence Stack
### Language + Reasoning
LLM access flows through the Ollama client. Agents and UI components request completions or JSON outputs with local models; the client handles health checks, streaming pulls, and fallbacks when models are missing. Embedding support uses the same endpoint to produce dense vectors for retrieval, with a deterministic mock for environments without Ollama.【F:packages/core/src/ollama.ts†L1-L92】【F:packages/core/src/embeddings.ts†L1-L24】

### Persona Generation System
The persona generation system uses an LLM-powered interview process to build and refine user personality profiles through structured conversations. It introduces a dedicated **psychotherapist role** that uses motivational interviewing techniques to extract authentic personality traits, values, goals, and communication styles.

**Core Modules** (`packages/core/src/persona/`):
- **session-manager.ts** — Creates, loads, updates, and finalizes interview sessions with multi-user isolation and ownership validation.【F:packages/core/src/persona/session-manager.ts†L1-L400】
- **question-generator.ts** — Generates adaptive follow-up questions using the psychotherapist role, tracks category coverage (values, goals, style, biography, current_focus), and determines interview completion.【F:packages/core/src/persona/question-generator.ts†L1-L300】
- **extractor.ts** — Converts conversational interview transcripts into structured persona data using LLM-powered extraction with confidence scoring.【F:packages/core/src/persona/extractor.ts†L1-L200】
- **merger.ts** — Intelligently merges new persona data with existing profiles using three strategies: replace (full override), merge (deduplicated combination), or append (additive accumulation). Creates backups before applying changes.【F:packages/core/src/persona/merger.ts†L1-L250】
- **cleanup.ts** — Archives old interview sessions based on age and status, with dry-run support and configurable retention policies.【F:packages/core/src/persona/cleanup.ts†L1-L150】

**Psychotherapist Role**:
The psychotherapist is a specialized LLM role configured in `etc/models.json` and `persona/profiles/psychotherapist.json` that:
- Uses motivational interviewing methodology (open-ended questions, reflective listening, empathic exploration)
- Generates adaptive follow-up questions based on previous answers and category coverage gaps
- Maintains professional boundaries and avoids requesting sensitive personal identifiers
- Routes through the model registry for cognitive-mode-aware model selection

**Interview Flow**:
1. User starts session via web UI (`PersonaGenerator.svelte`) or CLI (`mh persona generate`)
2. System presents baseline question from `etc/persona-generator.json`
3. User provides answer, triggering LLM-generated follow-up based on response content and category gaps
4. Category coverage tracked across 5 dimensions; interview completes when all reach 80% or max questions reached
5. Finalization extracts structured persona data from full transcript with confidence scoring
6. User reviews diff preview showing additions/updates/removals
7. Changes applied using selected merge strategy, with automatic backup creation
8. Optional: Training data exported to `memory/training/persona-interviews/` for LoRA fine-tuning

**Security & Isolation**:
All session operations verify user authentication and ownership. Anonymous users receive 401 errors. Sessions are stored per-user in `profiles/<username>/persona/interviews/` with audit logging for all actions (start, answer, finalize, apply, discard). See [docs/PERSONA-GENERATOR-AUDIT-EVENTS.md](PERSONA-GENERATOR-AUDIT-EVENTS.md) for complete event specifications.

**Configuration**:
- `etc/persona-generator.json` — Baseline questions and category definitions
- `etc/models.json` — Psychotherapist role model mappings for each cognitive mode
- `persona/profiles/psychotherapist.json` — Role profile with methodology and guidelines

All persona generation modules are exported from `@metahuman/core` for use across CLI, web UI, and future automation.【F:packages/core/src/index.ts†L50-L54】

### Memory Retrieval & RAG
`vector-index.ts` walks episodic and task stores, embeds their content, and persists an index file. Queries compute cosine similarity locally to retrieve relevant context for prompts or dashboards, enabling RAG workflows without external services.【F:packages/core/src/vector-index.ts†L1-L97】

### Skills, Policies, and Trust
Skills declare risk, required trust, and allowed resources. When an action is attempted, the policy engine checks trust hierarchy, risk level, and category-specific rules (e.g., file writes, shell commands) to decide whether to allow, require approval, or block. Every evaluation and registration feeds the audit trail, enabling review from the UI or CLI.【F:packages/core/src/skills.ts†L25-L86】【F:packages/core/src/policy.ts†L24-L83】

## Audio & Voice Pipeline
The audio subsystem can ingest voice notes and synthesize speech. `transcription.ts` orchestrates whisper.cpp (with ffmpeg conversion) or OpenAI for speech-to-text, falling back to mock output during setup; complementary modules handle text-to-speech (Piper) and manage voice training datasets. All paths and binaries resolve relative to the repo so users can drop in local builds under `vendor/`.【F:packages/core/src/transcription.ts†L1-L79】

## Observability & Logging
The audit module appends structured events (system, decision, action, security) to daily NDJSON files, and helper utilities summarize issues or stream logs for dashboards. The agent monitor surfaces available agent scripts, recent activity, and run statistics by reading these logs, empowering the UI to display status without a separate service.【F:packages/core/src/audit.ts†L1-L48】【F:packages/core/src/agent-monitor.ts†L1-L78】

## Autonomy & Persona Controls
Persona files capture identity, values, routines, and decision heuristics. CLI commands expose summaries, while helpers adjust trust levels with validation against the available modes in `decision-rules.json`. Additional configs in `etc/autonomy.json` tune reflection cadence, maintenance windows, and risk guards, allowing users to ratchet autonomy gradually.【F:packages/core/src/identity.ts†L1-L43】【F:packages/core/src/autonomy.ts†L1-L24】

## Extensibility
- **Add a skill** — Create a manifest under `brain/skills`, register it via `registerSkill`, and implement logic that consumes `@metahuman/core` helpers. Policies enforce trust and audit automatically.
- **Add an agent** — Place an ESM script in `brain/agents`, import the necessary modules (memory, llm, audit, locks), and register it so the CLI/UI can manage lifecycle and logs.【F:brain/agents/organizer.ts†L18-L78】
- **Extend the UI** — Astro routes can import any core helper to expose new data or controls, ensuring feature parity across surfaces.【F:apps/site/src/pages/api/tasks.ts†L1-L65】

## Technology Stack (Current)
- **Runtime** — Node.js 18+, TypeScript 5+, ESM modules, pnpm workspace linking packages together.
- **Data** — JSON/Markdown files on disk plus optional embedding index JSON; no database server required.
- **Web UI** — Astro + Svelte with Tailwind CSS, leveraging Astro API routes for server-side operations.
- **LLM & Embeddings** — Ollama models (`phi3`, `dolphin-mistral`, `nomic-embed-text`) with HTTP streaming; deterministic mock fallback for dev/offline.
- **Audio** — whisper.cpp, Piper, and ffmpeg invoked via child processes with graceful degradation to mock output.
- **Automation** — Node-based agents executed via CLI or process managers; logs captured under `logs/` for inspection.

This document reflects the current repository structure and code paths so contributors can navigate the system without relying on outdated diagrams.
