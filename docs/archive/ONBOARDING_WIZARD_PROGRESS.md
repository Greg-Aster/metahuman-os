# Onboarding Wizard - Implementation Progress

**Last Updated:** 2025-11-06 (Session Start)
**Overall Status:** 🚧 In Progress (25% Complete)

---

## Progress Overview

```
Phase 1: Backend Foundation        ████████████████████ 100% ✅
Phase 2: API Endpoints             ████░░░░░░░░░░░░░░░░  20% 🚧
Phase 3: Wizard UI Components      ░░░░░░░░░░░░░░░░░░░░   0% ⏳
Phase 4: Integration               ░░░░░░░░░░░░░░░░░░░░   0% ⏳
Phase 5: Testing & Polish          ░░░░░░░░░░░░░░░░░░░░   0% ⏳
```

---

## Completed Work ✅

### Phase 1: Backend Foundation (100%)

**1. Core State Management** ✅
- **File:** `packages/core/src/onboarding.ts`
- **Created:** 2025-11-06
- **Status:** Complete and functional
- **Features:**
  - `OnboardingState` interface with step tracking
  - `DEFAULT_ONBOARDING_STATE` constant
  - `getOnboardingState(userId)` - Retrieve user's progress
  - `updateOnboardingState(userId, updates, actor)` - Update progress
  - `completeStep(step, userId, actor)` - Mark step as done
  - `completeOnboarding(userId, actor)` - Finalize onboarding
  - `skipOnboarding(userId, reason, actor)` - Skip wizard
  - `incrementDataCounter(userId, counter, amount)` - Track data collected
  - `needsOnboarding(userId)` - Check if user needs wizard
  - `resetOnboarding(userId, actor)` - Reset for re-onboarding
- **Audit Integration:** All state changes logged
- **Lines of Code:** 287

**2. User Schema Update** ✅
- **File:** `packages/core/src/users.ts`
- **Modified:** Added `onboardingState?: OnboardingState` to User/SafeUser metadata
- **Import:** Added `import type { OnboardingState } from './onboarding.js';`
- **Status:** Complete

**3. Package Export** ✅
- **File:** `packages/core/package.json`
- **Modified:** Added `"./onboarding": "./src/onboarding.ts"` to exports
- **Status:** Complete

---

## Current Work 🚧

### Phase 2: API Endpoints (20%)

**1. Directory Structure** ✅
- **Created:** `apps/site/src/pages/api/onboarding/`
- **Status:** Directory ready for endpoint files

**Next Steps:**
- Create `state.ts` endpoint (GET/POST)
- Create `complete.ts` endpoint (POST)
- Create `skip.ts` endpoint (POST)
- Create `extract-persona.ts` endpoint (POST)

---

## Pending Work ⏳

### Phase 2: API Endpoints (Remaining 80%)

**Files to Create:**

1. **state.ts** - Onboarding state management
   - GET: Return current progress
   - POST: Update step completion and counters
   - Auth: User context required
   - Middleware: withUserContext

2. **complete.ts** - Mark onboarding complete
   - POST: Finalize onboarding
   - Sets completedAt timestamp
   - Redirects to main app
   - Audit logging

3. **skip.ts** - Skip onboarding wizard
   - POST: Record skip reason
   - Shows alternative utility locations
   - Audit logging

4. **extract-persona.ts** - LLM personality extraction
   - POST: Takes conversation messages
   - Uses Model Router (curator role)
   - Extracts Big Five traits, values, style
   - Updates `persona/core.json`

**Estimated Time:** 1.5 hours

---

### Phase 3: Wizard UI Components (0%)

**Directory to Create:** `apps/site/src/components/onboarding/`

**Files to Create:**

1. **OnboardingWizard.svelte** (Main orchestrator)
   - 6-step wizard container
   - Progress bar
   - Step navigation (back/next/skip)
   - Skip modal with utility locations
   - State persistence (localStorage)
   - API integration for state updates

2. **Step1_Welcome.svelte**
   - Welcome message
   - Explain dual consciousness
   - Overview of 6 steps
   - Privacy assurances (local-first)
   - Start/Skip buttons

3. **Step2_Identity.svelte**
   - Basic identity questions
   - Form or chat-style input
   - Questions: display name, self-description, core values, communication style
   - Auto-capture to episodic memory
   - Real-time validation

4. **Step3_Personality.svelte**
   - Interactive chat questionnaire
   - Big Five personality questions (10-15 questions)
   - Conversational tone
   - Progress indicator
   - Background LLM extraction

5. **Step4_Context.svelte**
   - Drag-and-drop file upload zone
   - File type filters: .txt, .md, .json, .docx, .pdf
   - Real-time processing feedback
   - AI Ingestor integration
   - Memory extraction progress
   - File list with status (processing/complete)

6. **Step5_Goals.svelte**
   - Task/goal creation form
   - Fields: title, description, priority, due date
   - Multiple task support (add/remove)
   - Task preview list
   - Validation

7. **Step6_Complete.svelte**
   - Summary statistics (X memories, Y tasks, Z files)
   - Memory preview cards (recent memories)
   - Review/edit option (link to Memory Browser)
   - Completion celebration
   - "Start using MetaHuman OS" CTA button

**Estimated Time:** 4-5 hours

---

### Phase 4: Integration (0%)

**Files to Modify:**

1. **AuthGate.svelte**
   - After registration → check needsOnboarding() → show wizard
   - After login → check needsOnboarding() → show wizard if incomplete
   - Skip button shows modal with utility locations
   - Redirect logic to wizard or main app

2. **Profile Initialization** (`packages/core/src/profile.ts`)
   - Add onboarding state initialization
   - Set `startedAt` timestamp on profile creation
   - Default state: `{ ...DEFAULT_ONBOARDING_STATE, startedAt: new Date().toISOString() }`

**Estimated Time:** 1 hour

---

### Phase 5: Testing & Polish (0%)

**Testing Checklist:**

- [ ] New user creates account → sees wizard
- [ ] Wizard steps navigate correctly (1→2→3→4→5→6)
- [ ] Back button works
- [ ] Skip modal displays utility locations
- [ ] Skip button exits to main app
- [ ] State persistence across page refresh
- [ ] Identity questions save to memory
- [ ] Personality extraction updates persona/core.json
- [ ] File upload processes correctly
- [ ] Task creation saves to memory/tasks/
- [ ] Completion summary shows correct counts
- [ ] Complete button redirects to main app
- [ ] onboardingState.completed = true after finish
- [ ] Re-login doesn't show wizard if completed
- [ ] Audit logs all onboarding actions

**Polish Items:**

- [ ] Loading states for API calls
- [ ] Error handling and user feedback
- [ ] Responsive design (mobile-friendly)
- [ ] Smooth transitions between steps
- [ ] Progress bar animation
- [ ] Success animations (confetti on complete?)
- [ ] Dark mode styling
- [ ] Accessibility (keyboard navigation, ARIA labels)

**Estimated Time:** 1-2 hours

---

## File Inventory

### Created Files ✅

1. `packages/core/src/onboarding.ts` (287 lines)
2. `ONBOARDING_WIZARD_IMPLEMENTATION.md` (plan document)
3. `ONBOARDING_WIZARD_PROGRESS.md` (this file)

### Modified Files ✅

1. `packages/core/src/users.ts` (added onboardingState to metadata)
2. `packages/core/package.json` (added onboarding export)

### Pending Files ⏳

**API Endpoints (4 files):**
1. `apps/site/src/pages/api/onboarding/state.ts`
2. `apps/site/src/pages/api/onboarding/complete.ts`
3. `apps/site/src/pages/api/onboarding/skip.ts`
4. `apps/site/src/pages/api/onboarding/extract-persona.ts`

**UI Components (7 files):**
1. `apps/site/src/components/OnboardingWizard.svelte`
2. `apps/site/src/components/onboarding/Step1_Welcome.svelte`
3. `apps/site/src/components/onboarding/Step2_Identity.svelte`
4. `apps/site/src/components/onboarding/Step3_Personality.svelte`
5. `apps/site/src/components/onboarding/Step4_Context.svelte`
6. `apps/site/src/components/onboarding/Step5_Goals.svelte`
7. `apps/site/src/components/onboarding/Step6_Complete.svelte`

**Integration (2 files):**
1. `apps/site/src/components/AuthGate.svelte` (modify)
2. `packages/core/src/profile.ts` (modify)

**Total:** 3 created, 2 modified, 13 pending

---

## Next Actions (Priority Order)

1. **Create API endpoint: state.ts** (GET/POST onboarding state)
2. **Create API endpoint: complete.ts** (mark complete)
3. **Create API endpoint: skip.ts** (skip wizard)
4. **Create API endpoint: extract-persona.ts** (LLM extraction)
5. **Create OnboardingWizard.svelte** (main container)
6. **Create Step1_Welcome.svelte**
7. **Create Step2_Identity.svelte**
8. **Create Step3_Personality.svelte**
9. **Create Step4_Context.svelte**
10. **Create Step5_Goals.svelte**
11. **Create Step6_Complete.svelte**
12. **Integrate with AuthGate.svelte**
13. **Update profile.ts initialization**
14. **End-to-end testing**

---

## Blockers & Issues

**None currently identified.**

---

## Notes & Decisions

- **Approach:** Progressive implementation (backend → API → UI → integration)
- **State Management:** Using User metadata (persisted to persona/users.json)
- **LLM Integration:** Model Router with "curator" role for personality extraction
- **File Processing:** Leveraging existing AI Ingestor agent
- **Skip Flow:** Modal with comprehensive utility location guide
- **Resumability:** State saved after each step completion

---

## Session Log

**2025-11-06 - Session 1**
- Created core onboarding state management system
- Updated User schema with onboardingState
- Added package export for onboarding module
- Created implementation plan document
- Created this progress tracking document
- **Next:** Continue with API endpoint creation
