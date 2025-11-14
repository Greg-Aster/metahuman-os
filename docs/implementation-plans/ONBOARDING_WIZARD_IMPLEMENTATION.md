# Onboarding Wizard Implementation Plan

**Date:** 2025-11-06
**Status:** 🚧 In Progress
**Priority:** High - Core User Experience Feature

---

## Executive Summary

Implement a comprehensive step-by-step onboarding wizard that guides new users through inputting their personal data for the dual consciousness emulation AI. The wizard appears after account creation and can be declined with helpful guidance about alternative data input methods.

---

## Architecture Overview

### Core Components

1. **Backend Infrastructure**
   - `packages/core/src/onboarding.ts` - State management
   - `apps/site/src/pages/api/onboarding/*.ts` - API endpoints
   - User schema updated with `onboardingState` metadata

2. **Frontend Components**
   - `OnboardingWizard.svelte` - Main orchestrator
   - 6 step components (Welcome, Identity, Personality, Context, Goals, Complete)
   - Integration with `AuthGate.svelte`

3. **Data Flow**
   - Conversation-based personality extraction
   - File ingestion for bulk context import
   - Memory capture for structured data
   - Task creation for goals/aspirations

---

## Implementation Steps

### Phase 1: Backend Foundation ✅ COMPLETED

1. **Core State Management** (`packages/core/src/onboarding.ts`)
   - OnboardingState interface with step tracking
   - Functions: getOnboardingState, updateOnboardingState, completeStep
   - Data collection counters (memories, tasks, files)
   - Skip/complete onboarding handlers
   - Audit logging for all state changes

2. **User Schema Update** (`packages/core/src/users.ts`)
   - Added `onboardingState?: OnboardingState` to User metadata
   - Updated SafeUser interface
   - Import OnboardingState type

3. **Package Export** (`packages/core/package.json`)
   - Added `"./onboarding": "./src/onboarding.ts"` export

### Phase 2: API Endpoints 🚧 IN PROGRESS

**Directory:** `apps/site/src/pages/api/onboarding/`

1. **state.ts** - GET/POST onboarding state
   - GET: Return current onboarding progress
   - POST: Update step completion, data counters

2. **complete.ts** - POST mark onboarding complete
   - Finalizes onboarding process
   - Sets completion timestamp
   - Audit logging

3. **skip.ts** - POST skip onboarding
   - Records skip reason
   - Shows alternative input methods
   - Audit logging

4. **extract-persona.ts** - POST LLM-based personality extraction
   - Takes conversation history
   - Extracts Big Five traits, values, communication style
   - Updates `persona/core.json`
   - Uses Model Router with "curator" role

### Phase 3: Wizard UI Components ⏳ PENDING

**Directory:** `apps/site/src/components/onboarding/`

1. **OnboardingWizard.svelte** - Main container
   - Step navigation (1-6)
   - Progress bar
   - Skip modal with utility locations
   - State persistence (resumable)

2. **Step1_Welcome.svelte**
   - Explain dual consciousness concept
   - Overview of data collection
   - Privacy assurances
   - Start/Skip buttons

3. **Step2_Identity.svelte**
   - Basic identity questions (form or chat)
   - Display name, self-description, core values
   - Communication style preferences
   - Auto-capture to episodic memory

4. **Step3_Personality.svelte**
   - Interactive chat questionnaire
   - Big Five personality questions
   - Conversational tone
   - Background LLM extraction

5. **Step4_Context.svelte**
   - Drag-and-drop file upload
   - Accepts: .txt, .md, .json, .docx, PDFs
   - Real-time AI Ingestor processing
   - Progress feedback

6. **Step5_Goals.svelte**
   - Task/goal creation form
   - Title, description, priority
   - Multiple task support
   - Preview created tasks

7. **Step6_Complete.svelte**
   - Summary of collected data
   - Memory preview (cards)
   - Review/edit option
   - "Start using MetaHuman OS" button

### Phase 4: Integration ⏳ PENDING

1. **AuthGate.svelte** - Onboarding trigger
   - After registration → redirect to wizard
   - After login → check needsOnboarding()
   - Skip modal with utility reference

2. **Profile Initialization** - Auto-start
   - Set onboardingState.startedAt on profile creation
   - Initialize default state

---

## Onboarding Flow

```
User creates account
  ↓
AuthGate → OnboardingWizard
  ↓
Step 1: Welcome → Explain process
  ↓
Step 2: Identity → Basic questions (3-5 min)
  ↓
Step 3: Personality → Chat questionnaire (5-10 min)
  ↓
Step 4: Context → File import (optional, 2-15 min)
  ↓
Step 5: Goals → Task creation (3-5 min)
  ↓
Step 6: Complete → Review & confirm
  ↓
Main App (Dashboard or Chat)
```

**Alternative Path:**
```
Skip button (any step)
  ↓
Skip Modal
  ↓
Shows utility locations:
  - Memory Capture (Chat, CLI, API)
  - File Ingestion (Memory view, CLI)
  - Audio Upload (Audio view, CLI)
  - Manual Persona Editing (Settings)
  - User Guide link
  ↓
[Continue Onboarding] or [Skip to App]
```

---

## Data Ingestion Utilities Reference

### Primary Methods (Built into Wizard)

1. **Memory Capture** - Text observations
   - Chat interface (main view)
   - CLI: `./bin/mh capture "text"`
   - API: `POST /api/capture`

2. **File Ingestion** - Bulk document import
   - Memory view → Upload tab
   - CLI: `./bin/mh ingest <file>`
   - Drop files: `memory/inbox/`

3. **Conversation History** - Natural dialogue
   - Chat view (auto-captured)
   - Inner dialogue mode

### Alternative Methods (Post-Onboarding)

4. **Audio Upload** - Voice recordings
   - Audio view → Upload tab
   - CLI: `./bin/mh audio ingest <file>`

5. **Task Creation** - Structured goals
   - Task Manager component
   - CLI: `./bin/mh task add "title"`

6. **Manual Editing** - Direct JSON
   - System settings → Persona Editor
   - Files: `profiles/{username}/persona/core.json`

7. **Voice Training** - Custom TTS (passive)
   - Enabled during conversations
   - Requires 3+ hours of speech data

---

## Technical Specifications

### API Endpoints

**GET /api/onboarding/state**
- Returns: `{ state: OnboardingState, needsOnboarding: boolean }`
- Auth: Required (user context)

**POST /api/onboarding/state**
- Body: `{ updates: Partial<OnboardingState> }`
- Returns: `{ success: boolean, state: OnboardingState }`

**POST /api/onboarding/complete**
- Body: None
- Returns: `{ success: boolean }`

**POST /api/onboarding/skip**
- Body: `{ reason?: string }`
- Returns: `{ success: boolean }`

**POST /api/onboarding/extract-persona**
- Body: `{ messages: ChatMessage[] }`
- Returns: `{ success: boolean, extracted: PersonaData }`

### State Schema

```typescript
interface OnboardingState {
  completed: boolean;
  currentStep: number; // 1-6
  stepsCompleted: {
    welcome: boolean;
    identity: boolean;
    personality: boolean;
    context: boolean;
    goals: boolean;
    review: boolean;
  };
  dataCollected: {
    identityQuestions: number;
    personalityQuestions: number;
    filesIngested: number;
    tasksCreated: number;
    memoriesCreated: number;
  };
  startedAt?: string;
  completedAt?: string;
  skipped: boolean;
  skipReason?: string;
}
```

---

## Success Criteria

✅ Core backend infrastructure complete
⏳ API endpoints functional
⏳ Wizard UI implemented
⏳ AuthGate integration complete
⏳ Skip modal with utility locations
⏳ Personality extraction working
⏳ File ingestion processing
⏳ State persistence/resumption
⏳ End-to-end testing passed

---

## Estimated Timeline

- **Backend Foundation:** ✅ 1 hour (DONE)
- **API Endpoints:** 🚧 1.5 hours (IN PROGRESS)
- **Wizard Shell:** ⏳ 1 hour
- **Step Components:** ⏳ 3-4 hours
- **Integration:** ⏳ 1 hour
- **Testing & Polish:** ⏳ 1 hour

**Total:** ~8-9 hours

---

## Dependencies

**Existing Systems Used:**
- Memory capture API (`POST /api/capture`)
- File ingestion (AI Ingestor agent)
- Task creation API (`POST /api/tasks`)
- Model Router (curator role for extraction)
- Audit system (all actions logged)
- Profile paths (multi-user context)

**New Dependencies:**
- None (uses existing infrastructure)

---

## Future Enhancements (Out of Scope)

- Voice-based onboarding (audio Q&A)
- Social media import (Twitter, Facebook)
- Calendar/email integration
- Personality test gamification
- Progress sharing/export
- Profile templates (quick start)
