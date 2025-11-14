# Persona Generation System - Phased Rollout Plan

**Based on**: [persona-generation-utility.md](./persona-generation-utility.md)
**Status**: Planning
**Last Updated**: 2025-11-14

## Overview

This phased rollout plan breaks the personality analyzer and persona generation system into **6 incremental milestones**, each independently deliverable and testable. The system allows authenticated users to complete guided personality interviews that generate high-fidelity persona profiles using LLM analysis.

---

## Phase 0: Foundation & Configuration (Week 1)

**Objective**: Set up data structures, configuration files, and core path utilities without touching LLM or UI code.

### Deliverables

1. **Session Schema Definition**
   - Create `profiles/<user>/persona/interviews/` directory structure
   - Define session JSON schema in documentation
   - **Update `packages/core/src/paths.ts`** ([paths.ts:34-96](../../packages/core/src/paths.ts#L34-L96)):
     - Add to `getProfilePaths()` function (after line 54):
       ```typescript
       personaInterviews: path.join(profileRoot, 'persona', 'interviews'),
       personaInterviewsIndex: path.join(profileRoot, 'persona', 'interviews', 'index.json')
       ```
     - Add to `rootPaths` fallback object ([paths.ts:179-220](../../packages/core/src/paths.ts#L179-L220)) after `personaFacetsDir`:
       ```typescript
       personaInterviews: path.join(ROOT, 'persona', 'interviews'),
       personaInterviewsIndex: path.join(ROOT, 'persona', 'interviews', 'index.json')
       ```
     - TypeScript typing via `tryResolveProfilePath` will automatically pick up these new keys from `getProfilePaths` return type

2. **Configuration File**
   - Create `etc/persona-generator.json` with baseline questions:
     ```json
     {
       "baselineQuestions": [
         {
           "id": "q1",
           "category": "values",
           "prompt": "What core values guide your life decisions?"
         },
         // ... 6-8 initial questions
       ],
       "maxQuestionsPerSession": 15,
       "requireMinimumAnswers": 7,
       "categories": ["values", "goals", "style", "biography", "current_focus"]
     }
     ```

3. **Psychotherapist Role Registration**
   - **Update `packages/core/src/model-resolver.ts`** ([model-resolver.ts:12](../../packages/core/src/model-resolver.ts#L12)):
     - Extend `ModelRole` union type:
       ```typescript
       export type ModelRole = 'orchestrator' | 'persona' | 'curator' | 'coder' | 'planner' | 'summarizer' | 'psychotherapist' | 'fallback';
       ```
   - **Update `etc/models.json`** ([models.json:4-210](../../etc/models.json#L4-L210)):
     - Add to `defaults` object (line 10-17):
       ```json
       "psychotherapist": "default.psychotherapist"
       ```
     - Add to `models` object (after existing entries):
       ```json
       "default.psychotherapist": {
         "provider": "ollama",
         "model": "qwen3:14b",
         "adapters": [],
         "roles": ["psychotherapist", "interviewer", "analyzer"],
         "description": "Specialized interviewer for persona analysis using motivational interviewing techniques",
         "options": {
           "contextWindow": 8192,
           "temperature": 0.7,
           "topP": 0.9,
           "repeatPenalty": 1.1
         },
         "metadata": {
           "priority": "medium",
           "alwaysLoaded": false,
           "estimatedLatency": "medium",
           "purpose": "Persona generation and psychological analysis"
         }
       }
       ```
     - Add to `roleHierarchy` (if it exists):
       ```json
       "psychotherapist": ["default.psychotherapist", "default.persona", "default.fallback"]
       ```
     - Add to each cognitive mode in `cognitiveModeMappings`:
       ```json
       "psychotherapist": "default.psychotherapist"
       ```
   - **Verify `packages/core/src/model-router.ts`** doesn't hardcode role assumptions (e.g., should handle unknown roles gracefully)
   - Create `persona/profiles/psychotherapist.json` with detailed role description (privacy guidelines, interviewing techniques)

4. **Audit Event Definitions**
   - Add `persona_generation` category to audit system
   - Define event types: `session_started`, `question_asked`, `answer_recorded`, `session_finalized`, `persona_applied`

### Validation Criteria

- [ ] `etc/persona-generator.json` loads successfully
- [ ] `psychotherapist` role resolves via `resolveModel('psychotherapist')`
- [ ] `tryResolveProfilePath('personaInterviews')` returns valid path for authenticated users
- [ ] `tryResolveProfilePath('personaInterviewsIndex')` returns valid path for authenticated users
- [ ] Session directory created on first init
- [ ] Audit events logged to `logs/audit/`
- [ ] `psychotherapist` appears in `/api/status` `modelRoles` object
- [ ] TypeScript compilation succeeds with new ModelRole union member

### Dependencies

None (pure foundation work)

---

## Phase 1: Session Storage & Management (Week 1-2)

**Objective**: Build session CRUD operations without LLM integration. Use mock questions/answers for testing.

### Deliverables

1. **Core Session Manager** (`packages/core/src/persona/session-manager.ts`)
   ```typescript
   export async function startSession(userId: string): Promise<Session>
   export async function loadSession(userId: string, sessionId: string): Promise<Session | null>
   export async function saveSession(userId: string, session: Session): Promise<void>
   export async function listSessions(userId: string): Promise<SessionMetadata[]>
   export async function discardSession(userId: string, sessionId: string): Promise<void>
   ```

2. **Session Index Management**
   - Auto-update `interviews/index.json` on session create/update
   - Track `latestSessionId`, `totalSessions`, `completedCount`

3. **Basic API Routes** (`apps/site/src/pages/api/persona/generator/`)
   - `start.ts` - POST: Create new session, return sessionId + first static question
   - `load.ts` - GET: Retrieve existing session by ID
   - `discard.ts` - DELETE: Mark session as aborted
   - All routes use `withUserContext` + `requireWriteMode` guards

4. **Path Safety Integration**
   - Use `tryResolveProfilePath('personaInterviews')` in all API routes
   - Return 401 for anonymous users
   - Validate session ownership (userId must match session creator)

### Validation Criteria

- [ ] Can create session via `POST /api/persona/generator/start`
- [ ] Session files written to correct profile directory
- [ ] `index.json` updated with new sessions
- [ ] Cannot load another user's session
- [ ] Anonymous users receive 401 errors

### Dependencies

Phase 0 complete

---

## Phase 2: Question Engine & LLM Integration (Week 2-3)

**Objective**: Replace static questions with dynamic LLM-generated follow-ups using the psychotherapist role.

### Deliverables

1. **Question Generator** (`packages/core/src/persona/question-generator.ts`)
   ```typescript
   export async function generateNextQuestion(
     session: Session,
     previousAnswers: Answer[]
   ): Promise<{ question: Question; reasoning: string } | null>
   ```
   - Calls `callLLM({ role: 'psychotherapist', messages: [...] })`
   - Analyzes previous answers to identify gaps
   - Returns structured question with category tag
   - Returns `null` when sufficient coverage achieved

2. **Answer Recording & Analysis**
   - Update `packages/core/src/persona/session-manager.ts`:
     ```typescript
     export async function recordAnswer(
       userId: string,
       sessionId: string,
       questionId: string,
       content: string
     ): Promise<{ nextQuestion?: Question; isComplete: boolean }>
     ```
   - After recording answer, invoke question generator
   - Track category coverage progress

3. **Psychotherapist Prompt Engineering**
   - Create `packages/core/src/reasoning/prompts/psychotherapist.ts`
   - System prompt emphasizes:
     - Motivational interviewing techniques
     - Open-ended questions
     - No judgment or leading questions
     - Privacy awareness (don't ask for sensitive identifiers)
     - Category-aware question selection

4. **API Enhancement**
   - Update `apps/site/src/pages/api/persona/generator/answer.ts`:
     - POST: `{ sessionId, questionId, answer }`
     - Returns: `{ nextQuestion?, progress: { values: 80%, goals: 60%, ... }, isComplete: boolean }`

5. **Reasoning Integration** (Optional, if reactive architecture is ready)
   - **Update `packages/core/src/reasoning/config.ts`** ([reasoning/config.ts:33-60](../../packages/core/src/reasoning/config.ts#L33-L60)):
     - Currently hardcodes `planningModel: 'orchestrator'` and `responseModel: 'persona'` (lines 39-40)
     - Make these configurable via overrides parameter so psychotherapist can be used:
       ```typescript
       planningModel: overrides.planningModel || 'orchestrator',
       responseModel: overrides.responseModel || 'persona',
       ```
     - Consider adding `interviewModel` option for persona generation use case
   - Create `packages/core/src/reasoning/prompts/psychotherapist.ts`:
     - System prompt enforcing motivational interviewing techniques
     - Chain-of-thought structure for question generation
     - Privacy and ethics guidelines (don't ask for SSN, medical details, etc.)
     - Tool invocation rules for therapist-specific skills
   - Register therapist-specific skills in skill catalog:
     - `detect_contradictions` - Find inconsistencies in answers
     - `identify_gaps` - Detect missing persona categories
     - `suggest_followup` - Generate probing questions
   - Add configuration in reasoning engine to support `psychotherapist` role with `allowTools` and `allowReasoning` flags
   - Ensure audit trail captures reasoning steps for psychotherapist role

### Validation Criteria

- [ ] LLM generates relevant follow-up questions based on previous answers
- [ ] Questions tagged with appropriate categories
- [ ] Session completes after 7-15 questions based on coverage
- [ ] Psychotherapist role visible in audit logs
- [ ] No generic/repetitive questions (verify via manual testing)

### Dependencies

Phase 1 complete

---

## Phase 3: Persona Extraction & Merging (Week 3-4)

**Objective**: Summarize interview transcripts into structured persona data and merge with existing profiles.

### Deliverables

1. **Persona Extractor** (`packages/core/src/persona/extractor.ts`)
   - **Consolidate logic from `apps/site/src/pages/api/onboarding/extract-persona.ts`** ([extract-persona.ts:1-200](../../apps/site/src/pages/api/onboarding/extract-persona.ts#L1-L200))
   - Extract the LLM extraction logic (lines 67-100+) into reusable function
   - Make reusable for both onboarding and persona generator
   ```typescript
   export async function extractPersonaFromTranscript(
     messages: { role: string; content: string }[]
   ): Promise<PersonaDraft>
   ```
   - Returns structured output:
     ```typescript
     interface PersonaDraft {
       values: { core: string[]; priorities: string[] }
       personality: {
         bigFive: { trait: string; score: number }[]
         communicationStyle: string
       }
       goals: { short_term: string[]; long_term: string[] }
       background?: string
       currentFocus?: string[]
       confidence: { overall: number; categories: Record<string, number> }
     }
     ```

2. **Refactor Onboarding Endpoint** (CRITICAL - Avoid Code Duplication)
   - **Update `apps/site/src/pages/api/onboarding/extract-persona.ts`**:
     - Replace inline extraction logic (lines 67-onwards) with call to new `extractPersonaFromTranscript()` function
     - Keep API contract the same (backward compatibility)
     - Delete duplicated parsing code after verifying new extractor works
     - This ensures one canonical extractor for both onboarding and persona generation

3. **Persona Merger** (`packages/core/src/persona/merger.ts`)
   ```typescript
   export async function mergePersonaDraft(
     currentPersona: PersonaCore,
     draft: PersonaDraft,
     strategy: 'replace' | 'merge' | 'append'
   ): Promise<{ updated: PersonaCore; diff: PersonaDiff }>
   ```
   - Generates human-readable diff for review
   - Supports multiple merge strategies

3. **Session Finalization**
   - Update `session-manager.ts`:
     ```typescript
     export async function finalizeSession(
       userId: string,
       sessionId: string
     ): Promise<{ draft: PersonaDraft; diff: PersonaDiff }>
     ```
   - Invokes extractor with full transcript
   - Saves draft to `interviews/<sessionId>/summary.json`
   - Marks session as `completed`

4. **Apply Persona API**
   - `apps/site/src/pages/api/persona/generator/apply.ts`:
     - POST: `{ sessionId, strategy: 'replace' | 'merge' }`
     - Loads draft, merges with current persona, saves to `persona/core.json`
     - Optionally updates `persona/cache.json`

5. **Training Data Export**
   - Copy finalized transcripts to `profiles/<user>/memory/training/persona/<sessionId>.json`
   - Include both user answers and psychotherapist analysis in export
   - Tag for future LoRA adapter training

### Validation Criteria

- [ ] Extractor produces valid `PersonaDraft` JSON
- [ ] Diff shows clear before/after comparison
- [ ] Applying persona updates `persona/core.json` correctly
- [ ] Training data exported to training directory
- [ ] Audit logs capture full finalization chain
- [ ] Onboarding endpoint refactored to use new extractor (no duplicated code)
- [ ] Existing onboarding flow still works (backward compatibility verified)

### Dependencies

Phase 2 complete

---

## Phase 4: UI Integration - System Tab (Week 4-5)

**Objective**: Build user-facing persona generator interface in the System → Persona tab.

### Deliverables

1. **PersonaGenerator Component** (`apps/site/src/components/PersonaGenerator.svelte`)
   - Chat-style interface similar to `onboarding/Step3_Personality.svelte`
   - Features:
     - "Start Interview" button
     - Conversation log with assistant/user bubbles
     - Dynamic question streaming
     - Progress meter showing category coverage (values: 80%, goals: 60%, etc.)
     - "Pause & Resume" button (stores sessionId in localStorage)
     - "Discard Session" button with confirmation

2. **Progress Indicator**
   - Visual category coverage bars:
     ```
     Values:        ████████░░ 80%
     Goals:         ██████░░░░ 60%
     Style:         ██████████ 100%
     Biography:     ████░░░░░░ 40%
     Current Focus: ██████░░░░ 60%
     ```

3. **Review & Apply Dialog**
   - After finalization, show modal with:
     - Full transcript (collapsible)
     - Persona diff (side-by-side old vs new)
     - Merge strategy selector (replace/merge/append)
     - "Apply Changes" and "Discard" buttons

4. **Session History**
   - List previous sessions with metadata:
     - Date, question count, completion status
     - Link to view transcript/summary
   - Stored in collapsible section below main generator

5. **Integration into CenterContent**
   - Add "Persona Generator" section to existing persona tab
   - Update `apps/site/src/components/CenterContent.svelte` to include `<PersonaGenerator />`

6. **Status API Enhancement**
   - **Update `apps/site/src/pages/api/status.ts`** ([status.ts:69-423](../../apps/site/src/pages/api/status.ts#L69-L423)):
     - Currently exposes orchestrator, persona, planner models in `modelRoles` object (lines 146-201)
     - The psychotherapist role will automatically appear in `modelRoles` once registered in `etc/models.json`
     - Verify the `modelRoles` object includes `psychotherapist` entry after Phase 0 completion
     - If needed, add explicit handling to ensure psychotherapist is included in status response
     - Status widget will consume this data to display "Psychotherapist LLM: <model>"

7. **Status Widget Update**
   - Update `LeftSidebar.svelte` status widget to show:
     ```
     Psychotherapist LLM: qwen2.5-coder:7b
     ```
   - Fetch from `/api/status` response's `modelRoles.psychotherapist.model` field

### Validation Criteria

- [ ] Can start/resume/pause sessions from UI
- [ ] Questions and answers display in real-time
- [ ] Progress meter updates dynamically
- [ ] Diff dialog shows accurate before/after comparison
- [ ] Applying persona refreshes all persona-dependent UI elements
- [ ] Session history loads and displays correctly
- [ ] `/api/status` response includes `modelRoles.psychotherapist` field
- [ ] Status widget displays psychotherapist model name correctly

### Dependencies

Phase 3 complete

---

## Phase 5: CLI & Advanced Features (Week 5-6)

**Objective**: Add CLI commands and advanced workflows for power users.

### Deliverables

1. **CLI Commands** (`packages/cli/src/commands/persona.ts`)
   ```bash
   ./bin/mh persona generate           # Start interactive session
   ./bin/mh persona generate --resume  # Resume latest session
   ./bin/mh persona sessions           # List all sessions
   ./bin/mh persona view <sessionId>   # View transcript
   ./bin/mh persona apply <sessionId>  # Apply persona without UI
   ./bin/mh persona discard <sessionId> # Delete session
   ```

2. **Batch Interview Mode** (Optional Enhancement)
   - Support uploading pre-written answers:
     ```bash
     ./bin/mh persona import answers.json
     ```
   - Useful for migrating from other systems

3. **Persona Diff Utility**
   - Standalone function to compare any two persona files:
     ```bash
     ./bin/mh persona diff current.json draft.json
     ```

4. **Auto-Resume on Login**
   - If user has incomplete session, show notification in UI
   - "You have an unfinished persona interview. Resume?"

5. **Expiration & Cleanup**
   - Add cron-style cleanup for sessions older than 30 days
   - Mark as expired in index, optionally auto-archive

### Validation Criteria

- [ ] All CLI commands work without errors
- [ ] Can complete full interview via terminal
- [ ] Auto-resume notification appears for incomplete sessions
- [ ] Diff output is readable and accurate

### Dependencies

Phase 4 complete

---

## Phase 6: Testing, Documentation & Polish (Week 6)

**Objective**: Comprehensive testing, user documentation, and final refinements.

### Deliverables

1. **Unit Tests** (`packages/core/src/persona/__tests__/`)
   - `session-manager.spec.ts` - CRUD operations, index updates
   - `question-generator.spec.ts` - Mock LLM responses, category coverage
   - `extractor.spec.ts` - Transcript parsing, persona structure validation
   - `merger.spec.ts` - Diff generation, merge strategies

2. **Integration Tests** (`tests/persona-generation-flow.mjs`)
   - End-to-end flow: start → answer 7 questions → finalize → apply
   - Multi-user isolation (verify user A cannot access user B's sessions)
   - Anonymous user rejection (401 errors)

3. **User Documentation**
   - `docs/USER_GUIDE.md` - Add "Persona Generation Utility" section
   - `profiles/README.md` - Explain interview storage and training data export
   - `docs/MULTI_USER_PLAN.md` - Mention persona interviews live inside profiles

4. **Architecture Documentation**
   - `docs/ARCHITECTURE.md` - Document psychotherapist role
   - Update LLM roles table with psychotherapist entry
   - Add persona generation flow diagram

5. **Audit Event Specification**
   - `brain/policies/README.md` - Document all persona generation audit events
   - Include sample audit log entries for each event type

6. **Performance & Telemetry**
   - Add metrics tracking:
     - Average session completion time
     - Questions per session histogram
     - Category coverage distribution
   - Dashboard widget showing persona generation stats (optional)

7. **Regression Testing**
   - Verify existing onboarding flow still works
   - Ensure persona updates propagate to chat immediately
   - Test with different LLM models (ensure psychotherapist role works with multiple backends)

### Validation Criteria

- [ ] All unit tests pass
- [ ] Integration test completes without errors
- [ ] Documentation complete and reviewed
- [ ] No regression in existing persona/onboarding features
- [ ] Metrics visible in audit logs

### Dependencies

Phase 5 complete

---

## Risk Mitigation & Contingencies

### High-Risk Items

1. **LLM Quality Issues**
   - **Risk**: Psychotherapist generates poor/repetitive questions
   - **Mitigation**: Extensive prompt engineering, add question quality scorer, fallback to curated questions
   - **Contingency**: Phase 2 can fall back to semi-dynamic (choose from question bank) if full dynamic fails

2. **Persona Merge Conflicts**
   - **Risk**: User has heavily customized persona, merge overwrites important data
   - **Mitigation**: Require explicit diff review, support merge strategies, allow undo
   - **Contingency**: Always back up current persona to `persona/backups/<timestamp>.json` before applying

3. **Multi-User Path Safety**
   - **Risk**: Session file access bypasses user isolation
   - **Mitigation**: All routes use `tryResolveProfilePath`, validate session ownership
   - **Contingency**: Add secondary check in session-manager to verify userId matches

4. **Performance with Long Sessions**
   - **Risk**: 15+ question sessions create large transcripts, slow extraction
   - **Mitigation**: Implement max questions limit, chunked extraction
   - **Contingency**: Add "express mode" with fewer questions

### Low-Risk Items

- UI polish (can iterate post-launch)
- CLI commands (nice-to-have, not blocking)
- Advanced merge strategies (can start with simple replace-only)

---

## Success Metrics

### Phase Completion Criteria

Each phase considered complete when:
- All deliverables implemented
- Validation criteria pass
- No critical bugs
- Code reviewed and merged

### Overall Launch Readiness

- [ ] At least 3 successful end-to-end tests with different users
- [ ] No anonymous user can access persona sessions
- [ ] Psychotherapist role working with default model
- [ ] Documentation complete
- [ ] Audit trail verified

### Post-Launch Metrics (30 days)

- Sessions created per active user: Target > 0.5
- Session completion rate: Target > 70%
- Persona apply rate (of completed sessions): Target > 80%
- User-reported quality score: Target > 4/5
- Zero cross-user data leaks

---

## Timeline Summary

| Phase | Duration | Key Milestone |
|-------|----------|---------------|
| 0 - Foundation | 3-5 days | Config files, role registration |
| 1 - Session Storage | 5-7 days | CRUD APIs working |
| 2 - LLM Integration | 7-10 days | Dynamic questions generated |
| 3 - Persona Extraction | 7-10 days | Persona draft + diff working |
| 4 - UI Integration | 7-10 days | Full UX in System tab |
| 5 - CLI & Advanced | 5-7 days | Power user features |
| 6 - Testing & Docs | 5 days | Launch-ready |

**Total Estimated Time**: 5-6 weeks with 1 developer

**Parallelization Opportunities**:
- Phase 1 & 2 (session storage and question engine) can partially overlap
- Phase 4 & 5 (UI and CLI) can be built concurrently
- Testing (Phase 6) should start earlier with incremental unit tests

---

## Open Questions for Planning

1. **Question Limit**: Should we cap sessions at 15 questions, or allow unlimited with warning?
2. **Auto-Apply**: Should finalized sessions auto-apply persona, or always require manual review?
3. **Privacy**: Should transcripts be encrypted at rest given they contain personal reflections?
4. **Multi-Session Merge**: If user completes multiple sessions, how to reconcile conflicting data?
5. **Export Format**: What format should training data exports use for LoRA training? (JSON? JSONL? Chat format?)

---

## Changes from Original Plan

This phased rollout plan includes **concrete implementation details** that were not specified in the original [persona-generation-utility.md](./persona-generation-utility.md):

### Phase 0 Enhancements

1. **Path Resolution Details**:
   - Explicit instructions to update both `getProfilePaths()` function (lines 34-96) and `rootPaths` fallback object (lines 179-220) in [paths.ts](../../packages/core/src/paths.ts)
   - Added TypeScript typing note about `tryResolveProfilePath` automatic inference
   - Prevents "unknown path key" errors when calling `tryResolveProfilePath('personaInterviews')`

2. **Complete Model Registry Updates**:
   - Extended `ModelRole` union type in [model-resolver.ts:12](../../packages/core/src/model-resolver.ts#L12)
   - Updated `defaults`, `models`, `roleHierarchy`, and `cognitiveModeMappings` in [etc/models.json](../../etc/models.json)
   - Verification step for `model-router.ts` to ensure no hardcoded role assumptions
   - Prevents "unknown role" errors when calling `callLLM({ role: 'psychotherapist' })`

### Phase 2 Enhancements

3. **Reasoning Engine Configuration**:
   - Explicit update to [reasoning/config.ts:39-40](../../packages/core/src/reasoning/config.ts#L39-L40) to make `planningModel` and `responseModel` configurable
   - Added prompt file creation for psychotherapist role
   - Registered therapist-specific skills in reasoning catalog
   - Ensures psychotherapist can be used in reactive reasoning loops

### Phase 3 Enhancements

4. **Onboarding Refactor**:
   - **CRITICAL**: Added explicit deliverable to refactor [extract-persona.ts](../../apps/site/src/pages/api/onboarding/extract-persona.ts)
   - Prevents code duplication between onboarding and persona generator
   - Ensures one canonical extractor function in `@metahuman/core`
   - Added backward compatibility validation criteria

### Phase 4 Enhancements

5. **Status API Integration**:
   - Added deliverable to verify [/api/status](../../apps/site/src/pages/api/status.ts) exposes psychotherapist model
   - Currently only shows orchestrator/persona/planner (lines 146-201)
   - Psychotherapist will auto-appear in `modelRoles` once registered in models.json
   - Enables status widget to display "Psychotherapist LLM: <model>" correctly

### Additional Validation Criteria

- Added TypeScript compilation check for new ModelRole union member
- Added verification that psychotherapist appears in status API response
- Added onboarding backward compatibility test
- Added path resolution success checks for new interview paths

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Resolve open questions** above
3. **Create GitHub issues/tasks** for each phase
4. **Set up project board** to track progress
5. **Begin Phase 0** after approval

---

## References

- Original Plan: [persona-generation-utility.md](./persona-generation-utility.md)
- Onboarding Implementation: [apps/site/src/components/onboarding/Step3_Personality.svelte](../../apps/site/src/components/onboarding/Step3_Personality.svelte)
- Authentication System: [docs/AUTHENTICATION_STREAMLINED.md](../AUTHENTICATION_STREAMLINED.md)
- Multi-User Plan: [docs/MULTI_USER_PLAN.md](../MULTI_USER_PLAN.md)
