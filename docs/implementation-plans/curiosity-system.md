# Curiosity System Implementation Guide

Last updated: 2025-??-??  
Owner: Curiosity Feature Working Group  
Scope: Curiosity Service agent, conversation linking, UI controls, autonomy policies.

## 1. Goals & Outcomes

- Introduce an idle **Curiosity Service** agent that asks thoughtful questions when the user is inactive, stores both prompts and responses, and keeps the conversation flowing.
- Provide a **configurable curiosity level** so users can tune how often the agent nudges them. This setting controls the maximum number of unanswered curiosity questions per profile.
- Let users **reply directly to a specific curiosity question** by selecting it in chat history; the next message is explicitly tied to that question ID.
- Respect **trust/autonomy policies** so curiosity research (filesystem scans or web search) only runs when the profile’s trust level allows it.

## 2. System Overview

| Layer | Responsibilities | Code Touchpoints |
| --- | --- | --- |
| Scheduler & Agents | Activity-based trigger, multi-user loop, storing curiosity Q&A, optional research sister agent | `etc/agents.json`, new `brain/agents/curiosity-service.ts`, optional `curiosity-researcher.ts`, reuse patterns from `brain/agents/reflector.ts` & `brain/agents/dreamer.ts` |
| Memory Storage | Persist questions, facts, research notes, and episodic events | `packages/core/src/paths.ts`, `memory/README.md`, `packages/core/src/memory.ts` |
| Web UI | Surface curiosity data in Memory tab, add settings slider in System tab, enable question selection in Chat | `apps/site/src/components/CenterContent.svelte`, `SystemSettings.svelte`, `ChatInterface.svelte`, `/api/memories_all`, `/api/status`, `/api/persona_chat`, `/api/chat/history` |
| Policy & Trust | Gate research actions by trust/autonomy level | `persona/.../autonomy.json`, trust values from `/api/status` (shown in left sidebar), skill manifests (e.g., `brain/skills/web_search.ts`) |

## 3. Curiosity Level Setting (Controls Outstanding Questions)

1. **Config File**
   - Add a per-profile file: `profiles/<user>/etc/curiosity.json`.
   - Schema: `{ "maxOpenQuestions": number, "researchMode": "off" | "local" | "web" }`.
   - Default: `maxOpenQuestions = 1`, `researchMode = "local"` if trust permits.
   - Extend `paths.ts` with `curiosityConfig`, `curiosityQuestions`, `curiosityFacts`, `curiosityResearch` directories.

2. **System Tab UI**
   - In `apps/site/src/components/CenterContent.svelte`, the “System” tab renders `<SystemSettings />`. Add a “Curiosity Level” slider/segmented control inside `SystemSettings.svelte`.
   - Control values (example):
     - 0 = Off (no curiosity prompts).
     - 1 = Gentle (max 1 open question).
     - 3 = Chatty (max 3 open questions, shorter inactivity threshold).
   - Persist via new API route `/api/curiosity-config` (GET/PUT) that reads/writes the per-profile config file (`withUserContext` to scope paths). Follow the pattern used by `/api/persona-core` or `/api/memory-content`.

3. **Scheduler Integration**
   - Curiosity agent reads `maxOpenQuestions`. If the current unanswered count ≥ limit, skip asking.
   - When the user changes the slider, emit an audit event so other services (e.g., running agent) can reload configuration. Optionally watch `profiles/<user>/etc/curiosity.json` for changes inside the agent.

## 4. Conversation Linking (Click-to-Reply)

1. **Question Metadata**
   - When the Curiosity Service emits a question, create an episodic event via `captureEvent`:
     - `type: "curiosity_question"`
     - `metadata.curiosity = { questionId, topic, seedMemories, askedAt }`
   - Also append a `chat_assistant` audit event containing `questionId` so `/api/chat/history` can surface it.

2. **Chat History Rendering**
   - Update `apps/site/src/pages/api/chat/history.ts` to include `metadata` (if present) for each assistant entry. Add a `questionId` field when the audit event or episodic content provides it.
   - In `ChatInterface.svelte`, render curiosity questions with a “Reply” button/badge. Clicking sets `focusedQuestionId` in component state and visually highlights the selection. Show the active target near the composer (“Replying to Curiosity Question #... [Cancel]”).

3. **Persona Chat Hook**
   - Extend `/api/persona_chat` to accept an optional `questionId` in the POST body.
   - If provided, include `metadata.curiosity.answerTo = questionId` when capturing the user message (`captureEvent` call around line `875`).
   - Curiosity agent watches for new memories with `metadata.curiosity.answerTo`. When detected, mark the corresponding question as answered (move JSON file from `questions/pending` to `facts/answered`, or update state file).
   - UI: when a question is answered, remove highlight in chat history and update Memory tab counts.

4. **Conversation Selector Reuse**
   - The same click-to-reply pattern can be reused for other conversation items later (design the state store generically, e.g., `selectedPrompt` store in `apps/site/src/stores/chat.ts`).

## 5. Trust & Autonomy Enforcement

1. **Source of Truth**
   - The trust level shown in the left sidebar is derived from `/api/status` (see `apps/site/src/components/Dashboard.svelte` for fetching logic). Use the same status payload for curiosity decisions.
   - Autonomy config exists per profile (`profiles/<user>/etc/autonomy.json`). The Curiosity Service should load this via `readAutonomyConfig` similar to `boredom-service.ts:41-86`.

2. **Policy Matrix**
   - Define required trust for each action:
     - Asking questions: trust ≥ `observe` (default).
     - Reading local files / scanning memories: trust ≥ `trusted`.
     - Launching web searches: trust ≥ `supervised_auto` and `researchMode !== "off"`.
   - Record the current trust/autonomy mode per user at agent runtime (log via `audit` for traceability).

3. **Runtime Checks**
   - Before running file or web research, verify trust level. If insufficient, downgrade behavior (e.g., skip research or stick to already-indexed memories).
   - Store the trust snapshot in the question metadata (`metadata.curiosity.trustLevelAtAsk`) so analysts know under which conditions the question was generated.

## 6. Data Model & Storage

- Directories (per profile):
  - `memory/curiosity/questions/pending/*.json`
  - `memory/curiosity/questions/answered/*.json`
  - `memory/curiosity/facts/*.json` (stores question + answer pairs, linked to episodic IDs)
  - `memory/curiosity/research/*.md` (optional, for sister agent outputs)
- Each question JSON should include:
  ```json
  {
    "id": "cur-q-20251031-001",
    "question": "...",
    "askedAt": "ISO",
    "seedMemories": ["memory/episodic/..."],
    "status": "pending",
    "conversationId": "chat-session-id",
    "trustLevel": "trusted",
    "autonomyMode": "normal"
  }
  ```
- Fact files capture the first response and any follow-up reasoning.

## 7. API & UI Extensions

1. **/api/memories_all**
   - Add two collections to the response: `curiosityQuestions` (pending and answered) and `curiosityFacts`.
   - Update `CenterContent.svelte` tab bar to include “Curiosity”. Inside the tab, list questions with edit/delete controls reusing `MemoryEditor`.

2. **/api/status**
   - Attach curiosity stats (open question count, last asked timestamp) so the dashboard/left sidebar can show current pressure.

3. **Audit Stream**
   - Emit events (`event: "curiosity_question"`, `event: "curiosity_answered"`) so `apps/site/src/components/AuditStreamEnhanced.svelte` automatically groups them. No extra UI work besides the event description.

## 8. Implementation Steps for Execution Agents

1. **Scaffold storage & config**
   - Update `paths.ts` and `memory/README.md`.
   - Create `/api/curiosity-config` routes + System Settings UI slider.
2. **Curiosity Service agent**
   - Clone structure from `reflector.ts`: lock, iterate users, run `withUserContext`.
   - Query inactivity via scheduler, respect `maxOpenQuestions`, ask via LLM prompt template, store outputs, emit events.
3. **Conversation linking**
   - Modify `/api/chat/history` and `ChatInterface.svelte` for clickable questions, extend `/api/persona_chat` request body + capture logic.
   - Add watcher (maybe within Curiosity Service or a small helper) that listens for answered questions.
4. **Research sister agent (optional)**
   - After base loop works, add agent that samples a memory topic, runs local or web research per trust, writes results under `curiosity/research`, optionally schedules follow-up questions.
5. **UI polish + QA**
   - Memory tab for curiosity, dashboard indicators, highlight states, cancellation button for question focus.
   - Smoke test: adjust slider → config file updates → agent respects limit; click question → message tagged → question marked answered.

## 9. Open Decisions

- Do we auto-expire unanswered questions after N days? (Add cron cleanup.)
- Should multiple users share global curiosity level or keep per-profile? (Plan assumes per-profile.)
- How to handle multi-step conversations (e.g., question answered over several turns)? Option: keep question “active” until explicit mark or a tool verifying keywords.

Document updates go here whenever new behaviors are added. Agents implementing these tasks should reference the sections above for file locations and required guardrails.
