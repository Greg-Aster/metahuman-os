# MetaHuman OS — Autonomy Roadmap

## Vision
- Grounded Self: Behavior and outputs derive primarily from Greg’s memories, preferences, routines, and goals.
- Operator, Not Just Chat: The model plans and executes skills to ingest, organize, and act — within trust boundaries.
- Multimodal Sensing + Acting: Listens (audio/streams), speaks (TTS), and safely manipulates files/CLI in a sandbox.
- Always Audited: Every decision/action is auditable, reversible, and tied to trust levels and policy.

## Architecture
- Core Loop: Stimuli → Perception → Context Assembly → Planner (Ego) → Skills (Actuator) → Critic (Superego) → Memory
- Layers:
  - Identity/Preferences: Persona, decision rules, routines, priorities.
  - Memory: Episodic, semantic, procedural; embeddings; task graph.
  - Perception: Audio → ASR; file/event watchers; calendar/email connectors.
  - Operator (Ego): Planner/executor using a tool/skills registry (bounded).
  - Guardians (Superego): Policy/guardrails + approvals; risk scoring; locks.
  - Lizard Brain: Low‑level triggers (boredom, circadian, watchdogs).
- Event Bus: Use existing audit NDJSON under `logs/audit/*.ndjson` for stimuli, decisions, actions, reflections; fan‑out via SSE.

## Milestones

### Phase 1 — Grounding + IO Foundations [Complete]
- Data schema: Strengthen memory envelopes (source, consent, provenance, confidence).
- Ingestion framework: Bulk importers (files, notes, photos, voice memos), resumable backfills, de‑duplication.
- Audio I/O:
  - ASR: Local transcription service (whisper.cpp or similar) via an agent; `POST /api/audio/ingest`.
  - TTS: Local TTS (e.g., piper/mimic3); `POST /api/tts` + UI playback.
- UI: Mic button and “Live Reflections” feed; monitor shows audio/ingestor activity.

### Phase 2 — Operator Model (Ego/Superego/Lizard Brain) [Complete]
- Skills system:
  - ✅ Skill manifests (inputs/outputs, cost/risk), sandboxed execution (allowed dirs: `memory/`, `persona/`, `out/`, `logs/`).
  - ✅ Core skills: `fs_read`, `fs_write` (scoped), `search_index`, `task_list`, `task_create`, `task_update`, `web_search`, `conversational_response`.
  - ✅ Skill bootstrap at system startup with cost estimation for budget tracking.
- Planner/Executor/Critic loop:
  - ✅ Active Operator decision engine (LLM-based task selection).
  - ✅ Task executor calling existing agents.
  - ✅ Critic loop for reviewing diffs/artifacts (risk assessment, policy enforcement).
  - ✅ Approval flows for elevated operations (queue + API).
- Trust policies:
  - ✅ `observe`/`suggest`/`supervised_auto`/`bounded_auto` mapped to skill permissions.
  - ✅ Directory permission enforcement in skill execution.
- Triggers (Lizard Brain):
  - ✅ Idle detection (15/30 min thresholds).
  - ✅ Circadian windows (night/morning/afternoon with task recommendations).
  - ✅ Inbox file monitoring.
  - ✅ Memory staleness detection.
  - ✅ Index staleness detection.
  - ✅ Failed agent retry trigger.
  - ✅ Calendar "focus window" trigger (detects meetings and prep time).
- Active Operator Infrastructure:
  - ✅ Unified priority queue with persistence.
  - ✅ Mode controller (passive/active switching).
  - ✅ Cost tracker and energy budget.
  - ✅ Self-healing code analysis (TypeScript error detection).
  - ✅ Active Operator Dashboard UI.
  - ✅ Scratchpad for decision history.
  - ✅ Service manager for API control (start/stop/toggle decision loop).
  - ✅ Trigger integration in decision loop (evaluateTriggers called each cycle).
  - ✅ Focus constraints (calendar pause/wrap-up handled as constraints, not tasks).

### Phase 3 — Massive Greg-Centric Grounding [Complete]
- Connectors (with explicit consent):
  - ✅ Photo/media connector with EXIF metadata extraction (date, GPS, camera info).
  - ✅ Photo ingestion API (`POST /api/photos/ingest`, `/api/photos/ingest-directory`, `/api/photos/metadata`).
  - ✅ Document connector for PDF, DOCX, TXT, MD (text extraction + metadata).
  - ✅ Document ingestion API (`POST /api/documents/ingest`, `/api/documents/ingest-directory`, `/api/documents/extract`).
  - ✅ Calendar connector with ICS/iCal parsing and focus window detection.
  - ✅ Calendar API (`GET/POST /api/calendar/events`, `/api/calendar/focus-window`, `/api/calendar/sources`).
  - ✅ Chat export connector (WhatsApp, Telegram, Discord, Signal, generic formats).
  - ✅ Chat ingestion API (`POST /api/chats/ingest`, `/api/chats/ingest-directory`, `/api/chats/parse`).
  - ✅ Voice memo connector with whisper.cpp transcription integration.
  - ✅ Voice memo API (`POST /api/voice-memos/ingest`, `/api/voice-memos/ingest-directory`, `/api/voice-memos/metadata`).
  - ✅ CLIP image tagging with Python backend (torch + transformers).
  - ✅ Image tagging API (`POST /api/images/tag`, `/api/images/tag-directory`, `/api/images/clip-status`).
- Backfill: Rate‑limited backfill services with progress tracking; semantic indexing and cross‑linking.
- Persona deepening: Derive preferences/heuristics from memory (e.g., "Greg tends to X when Y"); store as procedural knowledge.

### Phase 4 — Autonomy Upgrades [Complete]
- Task graph + projects: **COMPLETE** ✅
  - ✅ Project schema with status, priority, progress tracking.
  - ✅ Task dependencies with cycle detection and blocking validation.
  - ✅ Project API (`GET/POST /api/projects`, `/api/projects/:id/tasks`, `/api/projects/:id/graph`).
  - ✅ Dependency API (`/api/tasks/:id/dependencies`, `/api/tasks/actionable`, `/api/tasks/blocked`).
  - ✅ Reflection-to-task converter with LLM extraction.
  - ✅ Task suggestions API (`/api/task-suggestions/extract`, approve, reject, bulk-approve).
  - ✅ Project Dashboard UI with tabs for projects, actionable tasks, blocked tasks, suggestions.
- Continual learning: **COMPLETE** ✅
  - ✅ Preference learner with LLM-based extraction from conversations.
  - ✅ Confidence tracking and evidence collection.
  - ✅ User validation workflow (confirm, reject, modify preferences).
  - ✅ Contradiction detection between preferences.
  - ✅ Preference API (`/api/preferences/learn`, `/api/preferences/active`, confirm, reject, modify).
- Long-running goals: **COMPLETE** ✅
  - ✅ Weekly goal review generation with progress tracking.
  - ✅ Project-level progress calculation (tasks completed, blocked, in-progress).
  - ✅ LLM-powered insights, recommendations, and focus areas.
  - ✅ Goal review API (`/api/goal-reviews/generate`, `/api/goal-reviews/latest`, `/api/goal-reviews/summary`).

### Phase 5 — Voice Agent + System Operator [Complete]
- Live voice loop: **COMPLETE** ✅
  - ✅ Voice loop state machine (idle, listening, processing, thinking, speaking, interrupted).
  - ✅ Turn-taking with session management.
  - ✅ Barge-in support (user interrupt detection).
  - ✅ Voice API endpoints (`/api/voice/start`, `/api/voice/stop`, `/api/voice/status`, etc.).
  - ✅ ASR integration (whisper-based transcription with VAD).
  - ✅ TTS integration (multi-provider: Piper, Kokoro, GPT-SoVITS, RVC).
  - ✅ Audio utilities (volume, speed adjustment, duration calculation).
- System operator: **MOSTLY COMPLETE** ✅
  - ✅ Backup skill: Profile backup with compression, retention policies, restore preview.
  - ✅ Housekeeping skill: Log rotation, temp cleanup, cache clear, stale lock removal.
  - ✅ Index maintenance skill: Health checks, orphan removal, rebuild triggers.
  - ✅ System operator API (`/api/system-operator/backup`, `/api/system-operator/housekeeping`, etc.).
  - ✅ Ingestion QA: Memory quality checks, contamination detection, duplicate cleanup, auto-repair.
- Safety invariants: **COMPLETE** ✅
  - ✅ Diff-preview for mutations (show changes before executing).
  - ✅ Rollback capability (undo recent operations with 24h retention).
  - ✅ Rate limiting (prevent runaway operations per operation type).
  - ✅ Anomaly detection (flag unusual activity patterns).
  - ✅ Safety summary API (`/api/system-operator/safety-summary`).

## Key Deliverables
- `docs/`: ROADMAP.md (this), ARCHITECTURE-OPERATOR.md, SKILLS.md, TRUST.md
- `apps/site/`: Audio record component, TTS playback, operator dashboard (skills, approvals)
- `packages/core/`: skills registry, planner/executor/critic, event-bus, safer fs ops, policy enforcement
- `brain/agents/`: audio-ingestor, media-tagging, operator (planner), watchdogs, backfills

## Safety + Privacy
- Local‑first; explicit consent per connector.
- Strict directory caps; no network by default; all actions audited.
- Dry‑run/diff modes; kill‑switches; rate limits.

## Success Metrics
- % outputs grounded by Greg memories (with citations).
- Backfill coverage and ingestion error rates.
- Operator precision: planned vs executed vs reverted.
- User approvals: prompt rate and acceptance.

## Next Steps (Short‑Term)
- Phase 2: **COMPLETE** ✅
  - All triggers implemented including calendar focus window.
- Phase 3: **COMPLETE** ✅
  - ✅ Photo/media ingestion with EXIF metadata - COMPLETE.
  - ✅ Document ingestion (PDF, DOCX, TXT, MD) - COMPLETE.
  - ✅ Calendar integration for scheduling awareness - COMPLETE.
  - ✅ Chat export ingestion (WhatsApp, Telegram, Discord, Signal) - COMPLETE.
  - ✅ Voice memo ingestion with whisper.cpp transcription - COMPLETE.
  - ✅ CLIP tagging for image content analysis - COMPLETE.
- Phase 4: **COMPLETE** ✅
  - ✅ Task graph + projects: Schema, dependencies, APIs - COMPLETE.
  - ✅ Reflection-to-task conversion with LLM extraction - COMPLETE.
  - ✅ Project Dashboard UI - COMPLETE.
  - ✅ Continual learning: Preference learner with validation workflow - COMPLETE.
  - ✅ Long-running goals: Weekly reviews with LLM insights - COMPLETE.
- Phase 5: **COMPLETE** ✅
  - ✅ System operator: Backup, housekeeping, index maintenance skills - COMPLETE.
  - ✅ Ingestion QA: Memory quality checks, contamination detection, auto-repair - COMPLETE.
  - ✅ Safety invariants: Diff-preview, rollback, rate limits, anomaly detection - COMPLETE.
  - ✅ Live voice loop: Complete (state machine, turn-taking, barge-in, ASR/TTS integration).
