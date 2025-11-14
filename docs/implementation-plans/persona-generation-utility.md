# Persona Generation Utility Implementation Plan

## Problem
The platform relies on `persona/core.json` (and related persona files) to steer the LLM while longer-term training data is still accumulating. Today, the only structured way to seed that persona is through onboarding or manual edits in System → Persona. There is no reusable “tell me about you” utility once onboarding is finished, nor is there a workflow that stores the captured interview data for later LoRA fine-tuning per profile. We need a repeatable, multi-user-safe flow that can interrogate the operator, assemble a high-fidelity persona summary, and persist both the transcript and generated persona artifacts inside each user’s profile.

## Goals
- Let any authenticated profile opt into a guided persona interview from System → Persona and capture a full transcript.
- Use the LLM to adaptively ask follow-up questions, then summarize responses into `persona/core.json` (and optionally cache snippets for other persona files).
- Store all interview sessions under `profiles/<user>/persona/` for future LoRA/adapter training.
- Respect multi-user isolation via `withUserContext` and `paths.persona*` lookups; no shared global persona state leaks.
- Provide operators with controls to start/pause/resume/discard sessions plus a clear diff before overwriting persona files.

## Non-Goals
- Training LoRA adapters immediately. This plan only prepares data + persona scaffolds.
- Replacing existing onboarding screens (they can call the same backend but no UI merge is required now).
- Editing persona facets or decision rules beyond updating the base persona snapshot.

## Architecture Overview
1. **Session Store** – Each interview lives in `profiles/<user>/persona/interviews/<timestamp>-session.json`, containing status, prompts asked, and answers. Sessions can be resumed until finalized.
2. **Generator Service (Core)** – New module in `packages/core` orchestrates question creation, answer evaluation, and summarization using `callLLM` roles (`planner` for questioning, `curator/persona` for summarization).
3. **API Layer** – Astro API routes under `/api/persona/generator/*` wrap the core service with `withUserContext` + `requireWriteMode`.
4. **UI** – System tab → Persona gains a “Persona Generation Utility” panel. Operators toggle “Interrogation Mode” to start/resume a session with chat-style UI + progress indicator and final review dialog.
5. **Persistence** – On completion, the service writes the updated persona snapshot (and optional cache updates) through the existing `packages/core/src/identity.ts` helpers, plus it emits audit events for traceability.

## Implementation Steps

### 1. Data Model & Storage
- Create `profiles/<user>/persona/interviews/` (mkdir on demand). Each session file structure:
  ```json
  {
    "sessionId": "2025-11-10T02-15-00Z",
    "status": "active|completed|aborted",
    "createdAt": "...",
    "updatedAt": "...",
    "questions": [
      { "id": "q1", "prompt": "...", "category": "values" }
    ],
    "answers": [
      { "questionId": "q1", "content": "...", "capturedAt": "..." }
    ],
    "personaDraft": { /* optional summary */ }
  }
  ```
- Maintain a lightweight index at `persona/interviews/index.json` for quick lookup of latest session per user.
- Store final persona summary diff at `persona/interviews/<session>/summary.json` to keep immutable history for training.

### 2. Core Service (`packages/core`)
- Add `packages/core/src/persona/generator.ts` with functions:
  - `startSession(userMessageOverrides?)` – seeds baseline question plan (pull from config file like `etc/persona-generator.json` to keep default prompts editable).
  - `recordAnswer(session, answer)` – appends answer, calls `callLLM` with `planner` role to produce next tailored question plus reasoning tags (values, goals, style, biography).
  - `finalizeSession(session)` – aggregates transcript, invokes summarizer (reuse logic from `apps/site/src/pages/api/onboarding/extract-persona.ts`, but move parsing code into `packages/core/src/persona/extractor.ts` so both features call the same helper). Returns structured persona draft + confidence metrics.
- Introduce a dedicated **psychotherapist** LLM role/profile:
  - Update `etc/models.json` (and `packages/core/src/model-router.ts`) to register a new role id `psychotherapist` that points to the desired base model and temperature defaults. This role must have read/write permissions because it will store intermediate analysis to session files and later persona data.
  - Create `persona/profiles/psychotherapist.json` (or similar config) describing its specialization (motivational interviewing tone, probing questions, privacy guardrails) so multiple features can reuse it.
  - Extend `LeftSidebar.svelte` status widget (System status section) to display an additional line such as “Psychotherapist LLM: <model name>” using `/api/status` so operators can verify it is configured.
- Update the generator service to **default to the psychotherapist role** for questioning and analysis:
  - `startSession` and `recordAnswer` should call `callLLM({ role: 'psychotherapist', ... })` to craft dynamic questions and interpret answers before they are distilled into persona traits.
  - Keep curator/summarizer roles for the final persona synthesis, but route all raw “interviewing” traffic through the psychotherapist profile to maintain consistent tone and cross-feature reuse.
- Integrate the psychotherapist into the existing reasoning-react architecture:
  - Add the role to the reasoning model registry (`packages/core/src/reasoning/model-config.ts` or equivalent) so operators/planners can target it explicitly when “analysis” or “therapy” tasks are queued.
  - Create a dedicated reasoning prompt (e.g., `packages/core/src/reasoning/prompts/psychotherapist.ts`) that enforces motivational interviewing, explicit chain-of-thought sections, and tool invocation rules.
  - Register any therapist-specific skills (cognitive distortion detector, contradiction mapper, etc.) in the reasoning skill index so the psychotherapist role can call them via the reactive loop.
  - Ensure the psychotherapist role has `allowTools`/`allowReasoning` flags set, so its reasoning steps are audited the same way as the standard planner role.
- Provide helper to merge drafts into current persona using `paths.personaCore` + `savePersonaCore`, including optional updates for `values.core`, `personality.communicationStyle`, `personality.bigFive`, `goals`, and `persona/cache.json`.
- Emit audit logs via `audit()` for session start, question asked, summary generated (category `persona_generation`).

### 3. API Endpoints
- New directory `apps/site/src/pages/api/persona/generator/`:
  - `start.ts` → POST: create/resume session, return first question + sessionId.
  - `answer.ts` → POST: `{ sessionId, answer }` → returns next question or signals completion. Enforce session ownership by verifying the file path via `tryResolveProfilePath`.
  - `discard.ts` → POST: mark session aborted (allows deleting transcript if desired).
  - `finalize.ts` → POST: run summarizer, stage persona diff, save session summary file, and optionally auto-apply to `persona/core.json` when user confirms `apply=true`.
- All routes wrapped with `withUserContext` and `requireWriteMode` to ensure multi-user correctness.
- Reuse `getUserContext()` to scope file paths and block anonymous sessions.
- Ensure these endpoints expose which LLM profile they are using so the UI can warn if the psychotherapist role is missing.

### 4. UI & UX (System Tab → Persona)
- Extend `apps/site/src/components/CenterContent.svelte` persona tab:
  - Add `PersonaGenerator.svelte` component containing:
    - “Persona Generation Utility” card with a toggle (“Start Interrogation”) and description of what will happen.
    - Conversation log similar to `onboarding/Step3_Personality.svelte`, but streaming questions/answers from the new APIs instead of a static list.
    - Progress meter showing required personas aspects (values, goals, tone, background, current focus). Compute from metadata returned by generator service.
    - “Pause & Resume later” button (stores sessionId in local state) and “Discard session” option.
    - After finalization, present persona diff (old vs new) and require explicit confirmation before applying. Use existing `/api/persona-core` POST to persist if user toggles “apply changes”.
- Surface session history (list transcripts) linking to stored summary files for transparency.
- Ensure left sidebar persona badges update after applying a new persona by calling `loadPersonaName(true)`.

### 5. Persona Persistence & Training Hooks
- When applying the generated persona:
  - Update `persona/core.json` (and optionally `persona/cache.json`, `persona/relationships.json` if extractor outputs those sections) via the existing `savePersonaCore`.
  - Append session metadata to `memory/logs/persona-generation.log` (per user) for audit.
  - Copy transcripts to `profiles/<user>/memory/training/persona/<sessionId>.json` (or similar) so future adapter builders (`brain/agents/adapter-builder.ts`) can ingest them automatically.
- Capture the psychotherapist’s intermediate analysis in the session summary as its own artifact so the adapter builder can train against both raw user responses and the therapist’s interpretation.
- Provide CLI hook (`./bin/mh persona generate --session <id>`) in future; log placeholder in plan.

### 6. Documentation & Telemetry
- Document the feature in `docs/USER_GUIDE` (add new section “Persona Generation Utility”) and `profiles/README.md` (explain interview storage).
- Update `docs/MULTI_USER_PLAN.md` to mention persona interviews live inside each profile.
- Document the new psychotherapist role in `docs/ARCHITECTURE.md` (LLM roles table) and `docs/implementation-plans/reactive-operator-refactor.md` if needed so other services know it exists.
- Add audit event specs to `brain/policies/README.md` if required.
- Capture metrics (session count, completion rate) via `logs/audit` so the operator can review performance.

### 7. Testing & Validation
1. Unit-test generator helpers in `packages/core/src/persona/__tests__/generator.spec.ts` (mock `callLLM` to confirm transcripts, summarizer parsing, persona merge).
2. Manual smoke test:
   - Start a session, answer 3+ questions, pause/resume, finalize, apply persona.
   - Inspect `profiles/<user>/persona/interviews/` to confirm transcript + summary files.
   - Ensure persona diff surfaces expected fields and `includePersonaSummary` toggle still works.
3. Regression run: `./bin/mh status`, `./bin/audit check`, and quick chat to ensure persona context updates immediately.

## Open Questions / Follow-Ups
- Should sessions auto-expire after N days? (Add cron cleanup later.)
- Do we auto-generate persona facets based on interview tags? (Out of scope but note for Phase 2.)
- How/when to trigger adapter retraining once enough sessions accumulate? (Coordinate with `brain/agents/adapter-builder.ts` after transcripts exist.)
