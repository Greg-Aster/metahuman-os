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

### Phase 2 — Operator Model (Ego/Superego/Lizard Brain) [In Progress]
- Skills system:
  - Skill manifests (inputs/outputs, cost/risk), sandboxed execution (allowed dirs: `memory/`, `persona/`, `out/`, `logs/`).
  - Core skills: `fs_read`, `fs_write` (scoped), `search_index`, `run_agent`, `shell_safe` (whitelist).
- Planner/Executor/Critic loop:
  - Planner composes steps using skills; executor runs; critic reviews diffs/artifacts; approvals for elevated ops.
- Trust policies:
  - `observe`/`suggest`/`supervised_auto`/`bounded_auto` mapped to skill and directory permissions.
- Triggers:
  - Lizard brain signals: idle, circadian, new inbox files, failed agent retry, calendar “focus window”.

### Phase 3 — Massive Greg-Centric Grounding
- Connectors (with explicit consent): photos/media (EXIF + CLIP tags), documents, calendar, selected chat exports, voice memos.
- Backfill: Rate‑limited backfill services with progress tracking; semantic indexing and cross‑linking.
- Persona deepening: Derive preferences/heuristics from memory (e.g., “Greg tends to X when Y”); store as procedural knowledge.

### Phase 4 — Autonomy Upgrades
- Task graph + projects: Convert reflections into suggestions/tasks; chain to projects with dependencies.
- Continual learning (local): Preference updates, routing improvements, index refresh (no remote fine‑tuning).
- Long‑running goals: Weekly reviews; “goals status” using only Greg data; propose actions.

### Phase 5 — Voice Agent + System Operator
- Live voice loop: Streaming ASR + TTS; barge‑in; turn‑taking; device presence.
- System operator: High‑confidence skills for backups, housekeeping, index maintenance, ingestion QA — within sandbox.
- Safety invariants: Diff‑preview for mutations; rollback; rate limits; anomaly detection on actions/audit.

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
- Continue development on Phase 2: Operator Model (Ego/Superego/Lizard Brain).
- Focus on skills system, planner/executor/critic loop, and trust policies.
