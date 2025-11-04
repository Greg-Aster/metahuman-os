# Project Progress — 2025-10-28

This document captures the recent fixes, improvements, and guardrails added across the CLI, core, web UI, STT pipeline, and the operator/skills system.

## Highlights
- STT reliability and portability greatly improved
- Operator can now actually write/read files from the UI
- Web routing to operator stabilized; chat streaming fixed
- Skills registry unified (no more “Skill not found” due to module split)
- Paths validated against repo root (consistent in SSR/CLI)

## Changes

### Core + Build
- ESM interop: removed stray `require` in TS files; unified extensionless imports.
- Core exports: switched to extensionless re-exports for stable tsx resolution.
- Added `packages/core/tsconfig.json` for strict type-checking.
- Docs: updated `docs/README.md` tips and voice links.

### STT (Speech-to-Text)
- Added safe fallback logic to avoid 500s:
  - If Python (faster-whisper) venv not present, try whisper.cpp; else mock.
  - If whisper.cpp fails, fall back to mock cleanly.
- whisper.cpp integration:
  - Auto-detect binary (vendor/whisper.cpp/build/bin/whisper-cli) and model.
  - Transcode WEBM→WAV via `ffmpeg` when needed.
  - Reject placeholder “for-tests” models and surface instructive error.
  - Fixed output detection for `<input>.wav.txt/.json`.
- Python path (faster-whisper): clarified minimal deps; avoid pulling LoRA stack.
- Avoid saving voice training samples when transcript is mock.

### Web UI — Operator routing & API
- `/api/persona_chat`:
  - Fixed decision parsing (use LLM response content instead of `[object Object]`).
  - Removed `request` usage in stream handler; pass `origin` explicitly.
  - Added `forceOperator` query param to override router.
  - When using operator, send `autoApprove: true` so writes execute.
- `/api/operator`:
  - Fixed imports; returns structured results `{ success, plan, results, critique }`.
  - Ensures skills are initialized in the same module instance.
- Chat UI (Svelte):
  - Added “Use Operator” toggle; sends `forceOperator=true` in chat requests.
  - Fixed script/markup structure to avoid Svelte parse errors.

### Operator + Skills
- Unified imports so registration and execution share the same skills registry.
- One-time init guard: operator initializes skills & trust level at run.
- Planner prompt:
  - List valid skill IDs; require `fs_write` for writing.
  - Do NOT add `fs_read` before `fs_write`; only read-after-write if explicitly requested.
  - Default path for unspecified writes: `out/`.
- Executor robustness:
  - Skip any `fs_read` that precedes a later `fs_write`.
  - Map write-like invented skills (create_file/write_file) to `fs_write` safely.
  - Treat `fs_read` “file not found” as non-fatal.
  - Track `lastFilePath`; if a plan omits a file path for `fs_read`, use last written path.
- Path normalization & policy:
  - All paths are resolved relative to repo root (`paths.root`).
  - Write allowed only under `memory/*`, `out/`, `logs/`; denies code/Persona paths.

## Validation
- Operator can now write from the UI (Use Operator) and confirm reads.
- STT (mic) now returns 200 consistently; uses Python or whisper.cpp if available.
- Chat streaming stable for operator results; session persistence intact.

## Next Steps (Optional)
- Add an approval queue UI (Approve/Reject) instead of auto-approval for `fs_write`.
- Persist “Use Operator” in localStorage; show an “Operator ON” badge.
- Add `/api/voice/doctor` endpoint to surface readiness for STT (venv, ffmpeg, model).
- Split Python requirements files: `requirements/voice.txt` vs `requirements/lora.txt`.

## Next Steps (Planned + Implemented)
- New skills (initial set):
  - `fs_list`: list files/dirs (glob) under allowed roots
  - `json_update`: set/merge JSON keys in-place with validation
  - `http_get`: GET JSON from allowlisted hosts
  - `summarize_file`: summarize a text/markdown file (LLM-backed)
- Operator improvements:
  - Plan validator: map common synonyms to real skills; fill missing inputs
  - Path synthesis: default project-relative paths against repo root
  - Last-file recall: fs_read uses last written path when reasonable
- UI
  - Persist "Use Operator" toggle across sessions
  - Operator doctor (API): `/api/operator?action=doctor` returns status

## Latest: Autonomy Wiring
- Autonomy helper: `packages/core/src/autonomy.ts` with `readAutonomyConfig()`
- Config scaffold: `etc/autonomy.json` (mode+schedules+risk guards)
- Boredom service:
  - Logs capability banner (trust, skills, autonomy)
  - Periodic maintenance schedule (uses autonomy.schedules)
  - Maintenance tasks:
    - Refresh embeddings index
    - Summarize docs (README.md, PROGRESS.md) to `out/summaries/`
    - Preview cleanup of temp files in `out/` (dry-run only)

---
Last updated: 2025-10-28
