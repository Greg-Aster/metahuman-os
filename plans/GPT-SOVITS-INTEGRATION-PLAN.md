# GPT-SoVITS Integration with Existing Voice Training System

**Date:** 2025-11-12
**Status:** Approved - Implementation In Progress

## Overview

Integrate GPT-SoVITS with the existing voice recording and training system to provide a unified interface for both Piper and GPT-SoVITS voice cloning, reusing UI components and leveraging the existing profile-based audio collection infrastructure.

## Current System Analysis

### Existing Voice Recording Infrastructure

1. **Recording Sources:**
   - AudioRecorder component (manual 30-second segments)
   - Voice WebSocket conversations (automatic passive collection)
   - STT API with `?collect=1` flag

2. **Storage Locations:**
   - `profiles/{user}/memory/audio/inbox/` - AudioRecorder uploads
   - `profiles/{user}/out/voice-training/recordings/` - Training samples
   - Each recording has `.wav`, `.txt` (transcript), and `.meta.json` files

3. **Existing UI:**
   - VoiceTrainingWidget - Shows progress, manages samples, exports to Piper
   - VoiceSettings - Provider selection, voice configuration
   - AudioRecorder - Manual recording interface

4. **Profile-Based:**
   - Each user has isolated voice training data
   - Configuration per profile in `etc/voice.json`
   - 196 recordings already exist for greggles profile

### Current Issues with GPT-SoVITS

1. **No Integration:** GPT-SoVITS requires manual placement of reference audio
2. **Separate UI:** Different interface patterns causing confusion
3. **No Training Workflow:** Can't train from collected samples
4. **Missing Reference Management:** No UI to select/manage reference audio

## Implementation Plan

### Phase 1: Audio Infrastructure (Week 1)

#### 1.1 Update Paths Configuration ✅ COMPLETED
**File:** `packages/core/src/paths.ts`

Added profile-specific paths:
```typescript
// GPT-SoVITS reference audio (profile-specific)
sovitsReference: path.join(profileRoot, 'out', 'voices', 'sovits'),
sovitsModels: path.join(profileRoot, 'out', 'voices', 'sovits-models'),
```

#### 1.2 Add GPT-SoVITS Export Functions
**File:** `packages/core/src/voice-training.ts`

New functions to add:
- `exportSoVITSDataset(speakerId)` - Export recordings as GPT-SoVITS reference audio
- `getReferenceSamples(speakerId, minQuality = 0.8)` - Get best quality samples
- `selectReferenceAudio(sampleIds, speakerId)` - Mark samples as reference
- `copyToSoVITS(sampleIds, speakerId)` - Copy WAV files to SoVITS directory

Expected behavior:
- Select highest quality samples (quality ≥ 0.8)
- Total duration 5-10 seconds (GPT-SoVITS recommendation)
- Copy to `profiles/{user}/out/voices/sovits/{speakerId}/`
- Create metadata file with sample info

#### 1.3 Create Audio Manager Service
**File:** `packages/core/src/audio-manager.ts` (new)

Centralized service for managing audio across providers:

```typescript
export async function copyToReference(
  sampleIds: string[],
  provider: 'piper' | 'gpt-sovits',
  speakerId: string
): Promise<void>

export async function listReferenceSamples(
  provider: 'piper' | 'gpt-sovits',
  speakerId: string
): Promise<AudioSample[]>

export async function deleteReference(
  provider: 'piper' | 'gpt-sovits',
  speakerId: string,
  filename: string
): Promise<void>

export async function validateReferenceAudio(
  filePath: string
): Promise<ValidationResult>
```

### Phase 2: API Layer (Week 2)

#### 2.1 Create GPT-SoVITS Training API
**File:** `apps/site/src/pages/api/sovits-training.ts` (new)

Endpoints:
- `GET /api/sovits-training?action=progress` - Get training readiness
- `GET /api/sovits-training?action=references&speakerId=X` - List reference audio
- `GET /api/sovits-training?action=samples&quality=0.8` - Get suitable samples
- `POST /api/sovits-training` with actions:
  - `select-reference` - Choose samples as reference audio
  - `copy-to-sovits` - Copy samples to SoVITS directory
  - `prepare-dataset` - Prepare complete training dataset

Response formats:
```json
// Progress
{
  "ready": true,
  "sampleCount": 45,
  "totalDuration": 120.5,
  "qualitySamples": 12,
  "recommendedForReference": ["audio-123", "audio-456"]
}

// References
{
  "speakerId": "default",
  "references": [
    {
      "filename": "audio-123.wav",
      "duration": 3.5,
      "quality": 0.92,
      "transcript": "Hello, this is a test."
    }
  ]
}
```

### Phase 3: UI Components (Week 3)

#### 3.1 Refactor VoiceTrainingWidget
**File:** `apps/site/src/components/VoiceTrainingWidget.svelte`

Changes:
1. Add provider tabs: "Piper Training" | "GPT-SoVITS Training"
2. Share sample list between both providers
3. Provider-specific export buttons
4. Reference audio selection for GPT-SoVITS

Structure:
```svelte
<div class="training-tabs">
  <button class:active={activeTab === 'piper'}>Piper Training</button>
  <button class:active={activeTab === 'sovits'}>GPT-SoVITS Training</button>
</div>

{#if activeTab === 'piper'}
  <PiperTrainingPanel {samples} {progress} />
{:else}
  <SoVITSTrainingPanel {samples} {progress} />
{/if}
```

#### 3.2 Create Shared Components

**ServerStatusIndicator.svelte** (extracted from VoiceSettings):
- Reusable status dots with pulse animation
- Start/Stop/Refresh buttons
- Running/Stopped/Error states
- Used by both Piper and GPT-SoVITS sections

**VoiceTestPanel.svelte:**
- Test text input
- Play button
- Audio player with waveform (optional)
- Error handling

**TrainingBadge.svelte:**
- Shows "X samples ready for training"
- Color-coded: Green (ready), Orange (collecting), Gray (not started)
- Links to training tab

**ReferenceAudioSelector.svelte:**
- Lists available training samples
- Checkboxes for multi-select
- Quality score indicator
- Play button for preview
- "Set as Reference" action button
- Shows total selected duration

#### 3.3 Update Voice Settings Layout
**File:** `apps/site/src/components/VoiceSettings.svelte`

Add to both provider sections:
- Training badge showing collected samples
- Link to training tab
- Standardized layout using shared components

Example for Piper section:
```svelte
<!-- Add after voice selection -->
<TrainingBadge provider="piper" />

<!-- Existing Piper settings -->
<div class="setting-group">
  <label>Voice</label>
  <select bind:value={currentVoice}>
    {#each voices as voice}
      <option value={voice.id}>{voice.name}</option>
    {/each}
  </select>
</div>
```

Example for GPT-SoVITS section (add reference management):
```svelte
<div class="setting-group">
  <label>Reference Audio</label>
  {#if referenceAudioCount > 0}
    <div class="reference-status">
      ✓ {referenceAudioCount} reference samples ({totalDuration}s)
      <button on:click={manageReference}>Manage</button>
    </div>
  {:else}
    <div class="reference-warning">
      ⚠ No reference audio. Go to Training tab to select samples.
      <button on:click={openTraining}>Select Reference</button>
    </div>
  {/if}
</div>
```

### Phase 4: Training Automation (Week 4)

#### 4.1 Training Readiness Checker
**File:** `packages/core/src/voice-training.ts`

```typescript
export interface TrainingReadiness {
  provider: 'piper' | 'gpt-sovits';
  ready: boolean;
  reason?: string;
  sampleCount: number;
  totalDuration: number;
  qualitySamples: number;
  recommendations: string[];
}

export async function getTrainingReadiness(
  provider: 'piper' | 'gpt-sovits'
): Promise<TrainingReadiness>
```

Logic:
- **Piper:** Requires >80% of target hours (from `voice.json`)
- **GPT-SoVITS:** Requires 5-10 seconds of quality audio (≥0.8 quality score)

#### 4.2 GPT-SoVITS Integration
**File:** `packages/core/src/sovits-trainer.ts` (new)

Functions:
```typescript
export async function prepareTrainingData(
  speakerId: string
): Promise<PreparationResult>

export async function copyReferenceAudio(
  sampleIds: string[],
  speakerId: string
): Promise<CopyResult>

export async function getTrainingStatus(): Promise<TrainingStatus>
```

Implementation:
- Copy selected samples to `profiles/{user}/out/voices/sovits/{speakerId}/`
- Create reference audio manifest
- Validate total duration and quality
- Support multiple speakers per profile

#### 4.3 Training UI Updates
**File:** `apps/site/src/components/VoiceTrainingWidget.svelte`

Add to GPT-SoVITS tab:
```svelte
{#if sovitsReady}
  <div class="training-ready-panel">
    <h4>✓ Ready for Voice Cloning</h4>
    <p>{qualitySamples} high-quality samples selected ({totalDuration}s)</p>

    <button class="primary-button" on:click={selectReference}>
      Copy to Reference Audio
    </button>

    <div class="info-box">
      Selected samples will be copied to:
      <code>out/voices/sovits/{speakerId}/</code>
    </div>
  </div>
{:else}
  <div class="training-progress-panel">
    <p>Collecting voice samples...</p>
    <p>Need: 5-10 seconds of clear speech</p>
    <p>Current: {totalDuration}s ({qualitySamples} quality samples)</p>
  </div>
{/if}
```

### Phase 5: Documentation (Week 5)

#### 5.1 Create Unified Documentation
**File:** `docs/VOICE-TRAINING-GUIDE.md`

Sections:
1. **Introduction**
   - What is voice training?
   - Piper vs GPT-SoVITS comparison

2. **Recording Your Voice**
   - Using AudioRecorder
   - Passive collection during conversations
   - Quality tips

3. **Training Workflows**
   - **Piper Workflow:** Collect hours of data → Export dataset → Train externally
   - **GPT-SoVITS Workflow:** Collect 5-10s → Select reference → Use immediately

4. **Managing Training Data**
   - Viewing samples
   - Deleting poor quality recordings
   - Quality scores explained

5. **Troubleshooting**
   - Common issues and solutions
   - Quality improvement tips

#### 5.2 Update UI Documentation
**File:** Update existing help sections in components

Add tooltips:
- Speaker ID field: "Name for your voice clone (e.g., 'my-voice')"
- Reference Audio: "5-10 seconds of clear, natural speech"
- Quality Score: "Higher is better. >0.8 recommended for reference audio"

## Key Design Decisions

### 1. Unified Recording System
**Decision:** Use existing voice training recordings for both Piper and GPT-SoVITS

**Rationale:**
- Avoid duplicate recording infrastructure
- Leverage passive collection already working
- Single source of truth for voice data

### 2. Profile-Based Storage
**Decision:** Keep GPT-SoVITS reference audio in profile directories

**Rationale:**
- Consistent with existing architecture
- Isolates user data
- Easy to backup/restore per user

### 3. Component Reuse
**Decision:** Extract shared UI components for both providers

**Rationale:**
- Consistent user experience
- Less code maintenance
- Faster feature development

### 4. Reference Selection vs Auto-Selection
**Decision:** Allow manual reference selection with smart recommendations

**Rationale:**
- User control over voice quality
- Can exclude poor samples
- Recommendations guide but don't force

### 5. No In-App Training Pipeline
**Decision:** GPT-SoVITS training happens via reference audio, not model fine-tuning

**Rationale:**
- GPT-SoVITS uses few-shot learning (no training needed)
- Reference audio is sufficient for voice cloning
- Avoids complex training infrastructure

## Testing Plan

### Unit Tests
- `voice-training.ts` export functions
- `audio-manager.ts` file operations
- Path resolution for profile-specific directories

### Integration Tests
- API endpoints for GPT-SoVITS training
- Reference audio copy workflow
- Sample selection and validation

### UI Tests
- Tab switching in VoiceTrainingWidget
- Reference audio selection
- Training badge display
- Provider-specific settings

### End-to-End Test Scenario
1. User records voice via AudioRecorder
2. System collects samples passively during conversations
3. User opens Training tab, sees progress
4. User switches to GPT-SoVITS tab
5. System shows recommended samples
6. User selects reference audio
7. User clicks "Copy to Reference"
8. Files copied to `profiles/{user}/out/voices/sovits/default/`
9. User goes to Voice Settings
10. User selects GPT-SoVITS provider
11. User sees "X reference samples available"
12. User tests voice - hears their cloned voice

## Migration Path

### For Existing Users with Training Data

**Greggles profile has 196 recordings:**

1. Run migration script:
```bash
pnpm --filter metahuman-cli mh voice migrate-sovits
```

2. Script analyzes existing samples:
   - Filters quality ≥ 0.8
   - Finds best 5-10 second clips
   - Suggests top 5 samples as reference

3. User reviews suggestions in UI

4. User confirms selection

5. Samples copied to `sovits/default/`

### For New Users

- Fresh start with passive collection
- Training badge appears after first samples collected
- Guided workflow in UI

## Success Metrics

1. **Code Reuse:** >60% of UI components shared between providers
2. **User Confusion:** Zero reports of "where did my recordings go?"
3. **Training Success:** Users can clone voice with <2 minutes of total recordings
4. **Performance:** Reference audio selection <1 second
5. **Storage Efficiency:** No duplicate audio files

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| GPT-SoVITS quality varies | High | Provide quality guidelines, sample recommendations |
| Users delete reference audio | Medium | Confirmation dialog, explain consequences |
| Storage grows large | Medium | Implement cleanup of old/unused samples |
| Server fails to start | High | Robust error handling, fallback to Piper |
| UI confusion between providers | Medium | Clear labeling, consistent patterns |

## Future Enhancements

1. **Automatic Reference Selection:**
   - ML model to pick best reference samples
   - Diversity analysis (different phrases, tones)

2. **Voice Previews:**
   - Generate preview clips during selection
   - A/B comparison of reference choices

3. **Multi-Speaker Support:**
   - Clone multiple voices per profile
   - Speaker switching in UI

4. **Quality Analytics:**
   - Speech clarity scoring
   - Noise detection
   - Recommendation engine

5. **Training Scheduler:**
   - Background training during idle time
   - Progress notifications

## Implementation Timeline

- **Week 1:** ✅ Paths updated, core functions added
- **Week 2:** API endpoints, audio manager service
- **Week 3:** UI refactor, shared components
- **Week 4:** Training automation, reference selection
- **Week 5:** Documentation, testing, polish

**Target Completion:** December 17, 2025
