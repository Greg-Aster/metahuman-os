# Training Wizard Implementation Plan

## Overview
Create an intelligent Training Wizard UI in the LeftSidebar's "AI Training" section that guides users through selecting and configuring one of three training pipelines based on their hardware capabilities and training goals.

---

## 1. Architecture

### Components to Create/Modify

#### New Component
- **`TrainingWizard.svelte`** - Main wizard component with multi-step workflow

#### Modified Components
- **`CenterContent.svelte`** - Update `trainingTab` to include 'wizard' option
- **`LeftSidebar.svelte`** - Update training section navigation (if needed)

### Supporting Infrastructure
- **API Endpoint**: `/api/training/launch` - Trigger training pipeline with chosen config
- **API Endpoint**: `/api/training/validate-config` - Pre-flight check for RunPod credentials, dataset size, etc.

---

## 2. Training Pipeline Comparison

### Option 1: Local LoRA Training (`full-cycle-local.ts`)
**Best for**: Users with powerful local GPUs (24GB+ VRAM)

**Requirements**:
- NVIDIA GPU with 24GB+ VRAM (for 30B models) or 10GB+ (for 14B models)
- Python 3.10+ with unsloth installed
- Local environment setup via `./bin/setup-local-training`

**Advantages**:
- No cloud costs
- Full control over training process
- Faster iteration for debugging

**Training Output**: LoRA adapter (`.gguf` file)

**CLI Command**:
```bash
npx tsx brain/agents/full-cycle-local.ts --username <username>
```

---

### Option 2: Remote LoRA Training (`full-cycle.ts`)
**Best for**: Users without local GPU or training larger models remotely

**Requirements**:
- RunPod account with API access
- RunPod API key (`RUNPOD_API_KEY`)
- RunPod template ID (`RUNPOD_TEMPLATE_ID`)
- Sufficient RunPod credits

**Advantages**:
- Access to high-end GPUs (A100, H100)
- No local hardware requirements
- Can train while computer is off

**Training Output**: LoRA adapter (`.gguf` file) downloaded from RunPod

**CLI Command**:
```bash
npx tsx brain/agents/full-cycle.ts --username <username>
```

---

### Option 3: Full Fine-Tuning (`fine-tune-cycle.ts`)
**Best for**: Creating production-quality models with continuous learning

**Requirements**:
- RunPod account with API access (same as Option 2)
- Previous fine-tuned model OR base model
- Larger dataset recommended (1000+ samples)

**Advantages**:
- Full model fine-tuning (not just adapter)
- Continuous learning - builds on previous training runs
- Higher quality outputs for specialized tasks
- Registered in model registry for progressive training

**Training Output**: Full fine-tuned model (HuggingFace format) + GGUF quantized version

**CLI Command**:
```bash
npx tsx brain/agents/fine-tune-cycle.ts --username <username> --base-model <model>
```

---

## 3. Wizard UI Flow

### Step 1: Welcome & Method Selection
**Layout**: Card-based selection with visual icons

**Content**:
- **Title**: "Choose Your Training Method"
- **Description**: Brief explanation of when memories trigger training

**Three Cards**:
1. **🏠 Local LoRA Training**
   - Icon: GPU emoji + house
   - Label: "Train on Your Machine"
   - Requirements checklist:
     - ✅ NVIDIA GPU (24GB+ VRAM for 30B, 10GB+ for 14B)
     - ✅ Python 3.10+ with unsloth
     - ✅ Local storage space
   - **Button**: "Use Local Training"
   - **System Check**: Auto-detect if `venv/bin/python3` exists and has unsloth

2. **☁️ Remote LoRA Training**
   - Icon: Cloud + GPU
   - Label: "Train on RunPod"
   - Requirements checklist:
     - ✅ RunPod account
     - ✅ RunPod API key
     - ✅ RunPod credits (~$2-10/training)
   - **Button**: "Use Remote Training"
   - **System Check**: Check if `RUNPOD_API_KEY` is set in environment

3. **🎯 Full Fine-Tuning**
   - Icon: Target + brain
   - Label: "Advanced Fine-Tuning"
   - Requirements checklist:
     - ✅ RunPod account (same as #2)
     - ✅ 1000+ high-quality samples recommended
     - ✅ Previous model or base model selected
   - **Button**: "Use Fine-Tuning"
   - **System Check**: Check model registry for existing fine-tuned models

**Smart Recommendations**:
- If no local GPU detected → Recommend #2 or #3
- If RunPod not configured → Recommend #1
- If existing fine-tuned model → Recommend #3
- If first time → Recommend #1 (local) or #2 (remote LoRA)

---

### Step 2: RunPod Configuration (Skip for Local)
**Conditional**: Only show if Option 2 or 3 selected

**Layout**: Form with validation

**Fields**:
1. **RunPod API Key**
   - Text input (password field)
   - Validation: Test API key with RunPod GraphQL endpoint
   - Link: "Get your API key from RunPod Dashboard"

2. **RunPod Template ID**
   - Text input
   - Default: Load from `RUNPOD_TEMPLATE_ID` if set
   - Help text: "Your custom training template (leave blank for default)"

3. **GPU Type Preference**
   - Dropdown:
     - NVIDIA GeForce RTX 4090 (affordable)
     - NVIDIA A40 (balanced)
     - NVIDIA A100 80GB (fastest)
     - NVIDIA H100 (overkill, most expensive)
   - Help text: Cost estimate per hour

**Validation**:
- Test API key connectivity
- Save to `.env` file or user config
- Show estimated cost based on GPU type and dataset size

**Buttons**:
- "Save & Continue"
- "Skip for Now" (will prompt later)

---

### Step 3: Dataset Review
**Layout**: Statistics dashboard

**Content**:
1. **Memory Statistics**
   - Total episodic memories available
   - Breakdown by type (conversation, observation, reflection, etc.)
   - Breakdown by cognitive mode (dual, emulation, agent)
   - Date range coverage

2. **Dataset Preview**
   - Sample count estimate based on current filters
   - Quality indicators (validated memories, entities extracted, etc.)

3. **Curation Strategy** (for Fine-Tuning only)
   - **Monthly Training** toggle
     - When enabled: Use last 30 days + 3000 random old samples
     - When disabled: Use all available memories
   - Custom filters:
     - `--days-recent <N>`: Use last N days
     - `--old-samples <N>`: Mix in N random old samples
     - `--mode <dual|emulation|agent>`: Filter by cognitive mode

**API Call**: `GET /api/training/dataset-stats?username=<user>`

**Buttons**:
- "Continue" (proceed to config)
- "Back" (return to method selection)

---

### Step 4: Training Configuration
**Layout**: Form with collapsible advanced section

**Basic Settings**:
1. **Base Model** (Fine-Tuning only)
   - Dropdown populated from model registry
   - Options:
     - Continue from last fine-tuned model (recommended)
     - Start fresh from HuggingFace model
   - Show model details (size, architecture, last trained date)

2. **Training Epochs**
   - Slider: 1-5 epochs
   - Default: 3 for LoRA, 3 for fine-tuning
   - Help text: More epochs = better learning but higher cost/time

3. **Dataset Max Samples**
   - Number input (optional)
   - Help text: "Limit samples for faster testing (leave blank for all)"

**Advanced Settings** (Collapsible):
- LoRA Rank (8, 16, 32)
- Learning Rate (dropdown: 1e-4, 2e-4, 5e-5)
- Batch Size & Gradient Accumulation
- Context Window (2048, 4096, 8192)

**Configuration Source**:
- Load defaults from:
  - `etc/training.json` (for LoRA local)
  - `etc/training.json` (for LoRA remote)
  - `etc/fine-tune-config.json` (for fine-tuning)

**Validation**:
- Estimate VRAM usage based on model + config
- Warn if settings might cause OOM
- Estimate training time and cost (for RunPod)

**Buttons**:
- "Start Training" (final confirmation)
- "Save as Preset" (save config for reuse)
- "Back" (return to dataset review)

---

### Step 5: Training Launch & Monitoring
**Layout**: Progress view with real-time updates

**Confirmation Dialog**:
```
Are you ready to start training?

Method: Remote LoRA Training
Model: qwen3:14b
Dataset: 3,247 samples
Estimated Time: 2-3 hours
Estimated Cost: $8-12

[Cancel] [Start Training]
```

**After Launch**:
1. **Immediately switch to Training Monitor tab**
2. Show real-time progress from `/api/training/status`
3. Display stages:
   - Dataset preparation
   - Model upload
   - Training in progress
   - Model download
   - GGUF conversion
   - Ollama registration

**Success State**:
- Show completion message
- Display model name and path
- Provide button to "Load Model in Chat"
- Offer to "Train Again" or "Return to Dashboard"

---

## 4. Implementation Steps

### Phase 1: Component Structure
1. ✅ Create `apps/site/src/components/TrainingWizard.svelte`
2. ✅ Update `apps/site/src/components/CenterContent.svelte`:
   - Change `trainingTab` type to include 'wizard'
   - Replace "Setup Wizard" button logic
   - Add conditional rendering for `<TrainingWizard />`
3. ✅ Create wizard state machine (step progression)

### Phase 2: Method Selection (Step 1)
1. ✅ Build three selection cards with requirements
2. ✅ Implement system capability detection:
   - Check for local GPU via `/api/system/gpu-info`
   - Check for unsloth via `fs.existsSync(venv/bin/python3)` + import test
   - Check for RunPod env vars
3. ✅ Add recommendation logic based on detected capabilities

### Phase 3: RunPod Configuration (Step 2)
1. ✅ Create form for API key, template ID, GPU preference
2. ✅ Implement validation:
   - Test RunPod API key via GraphQL `query { myself { id } }`
3. ✅ Save configuration to user preferences or `.env`
4. ✅ Create API endpoint: `POST /api/runpod/validate`

### Phase 4: Dataset Review (Step 3)
1. ✅ Create API endpoint: `GET /api/training/dataset-stats`
   - Query episodic memory directory
   - Count by type, mode, date range
   - Return statistics JSON
2. ✅ Build statistics dashboard UI
3. ✅ Add curation strategy options (monthly training toggles)

### Phase 5: Training Configuration (Step 4)
1. ✅ Load training configs from `etc/training.json` and `etc/fine-tune-config.json`
2. ✅ Build form for basic settings (epochs, max samples, base model)
3. ✅ Build collapsible advanced settings panel
4. ✅ Implement VRAM estimation logic
5. ✅ Add cost/time estimation for RunPod

### Phase 6: Training Launch (Step 5)
1. ✅ Create API endpoint: `POST /api/training/launch`
   - Accept: training method, config, username
   - Spawn training agent as background process
   - Return: operation ID for monitoring
2. ✅ Implement confirmation dialog
3. ✅ Connect to existing TrainingMonitor component
4. ✅ Add success/failure handlers

### Phase 7: Polish & Testing
1. ✅ Add loading states and error handling
2. ✅ Implement "Save as Preset" functionality
3. ✅ Add tooltips and help text
4. ✅ Test all three training pipelines end-to-end
5. ✅ Add documentation in CLAUDE.md

---

## 5. API Endpoints Needed

### 5.1 `GET /api/system/gpu-info`
**Purpose**: Detect local GPU capabilities

**Response**:
```json
{
  "hasGPU": true,
  "gpuModel": "NVIDIA GeForce RTX 4080",
  "vramGB": 16,
  "cudaVersion": "12.1",
  "hasUnsloth": true,
  "pythonVersion": "3.10.12"
}
```

---

### 5.2 `GET /api/training/dataset-stats`
**Purpose**: Provide memory statistics for dataset review

**Query Params**: `?username=<user>`

**Response**:
```json
{
  "totalMemories": 3247,
  "byType": {
    "conversation": 1024,
    "observation": 512,
    "reflection": 890,
    "inner_dialogue": 821
  },
  "byCognitiveMode": {
    "dual": 2100,
    "emulation": 500,
    "agent": 647
  },
  "dateRange": {
    "earliest": "2025-01-15",
    "latest": "2025-11-23"
  },
  "estimatedSamples": 3100,
  "qualityScore": 0.85
}
```

---

### 5.3 `POST /api/runpod/validate`
**Purpose**: Validate RunPod API credentials

**Request Body**:
```json
{
  "apiKey": "YOUR_API_KEY"
}
```

**Response**:
```json
{
  "valid": true,
  "userId": "abc123",
  "balance": 50.25
}
```

---

### 5.4 `POST /api/training/launch`
**Purpose**: Start training pipeline

**Request Body**:
```json
{
  "method": "remote-lora" | "local-lora" | "fine-tune",
  "username": "greggles",
  "config": {
    "base_model": "unsloth/Qwen3-14B",
    "num_train_epochs": 3,
    "max_samples": null,
    "monthly_training": true,
    "days_recent": 30,
    "old_samples": 3000
  },
  "runpod": {
    "apiKey": "...",
    "templateId": "...",
    "gpuType": "NVIDIA A40"
  }
}
```

**Response**:
```json
{
  "success": true,
  "operationId": "training-20251123-152030",
  "message": "Training started successfully",
  "monitorUrl": "/api/training/training-20251123-152030"
}
```

---

## 6. State Management

### Wizard State (Svelte Store or Component State)
```typescript
interface WizardState {
  currentStep: 1 | 2 | 3 | 4 | 5;
  selectedMethod: 'local-lora' | 'remote-lora' | 'fine-tune' | null;
  runpodConfig: {
    apiKey: string;
    templateId: string;
    gpuType: string;
  } | null;
  datasetStats: DatasetStats | null;
  trainingConfig: TrainingConfig;
  systemCapabilities: {
    hasLocalGPU: boolean;
    hasUnsloth: boolean;
    hasRunpodKey: boolean;
    hasPreviousModel: boolean;
  };
}
```

---

## 7. User Experience Enhancements

### Smart Defaults
- Pre-fill RunPod config from environment variables
- Load training config from appropriate JSON file based on method
- Auto-select "Continue from last model" if fine-tuned model exists
- Default to monthly training strategy if >5000 memories

### Visual Indicators
- Progress dots showing current step (●●○○○)
- Validation checkmarks (✅) next to completed requirements
- Warning icons (⚠️) for missing dependencies
- Cost estimates with color coding (green=cheap, yellow=moderate, red=expensive)

### Help & Guidance
- Tooltips on all settings explaining technical terms
- "What's This?" buttons linking to documentation
- Contextual recommendations (e.g., "For your dataset size, we recommend...")
- Example values in placeholders

### Error Handling
- Graceful fallbacks if API calls fail
- Clear error messages with actionable steps
- Ability to "Retry" failed validations
- Save progress so user can resume wizard later

---

## 8. Testing Checklist

### Unit Tests
- [ ] Step navigation (forward/back)
- [ ] Method selection logic
- [ ] RunPod API validation
- [ ] Configuration loading from JSON files
- [ ] VRAM/cost estimation calculations

### Integration Tests
- [ ] Full wizard flow for local-lora
- [ ] Full wizard flow for remote-lora
- [ ] Full wizard flow for fine-tune
- [ ] RunPod configuration persistence
- [ ] Training launch with all three methods

### Manual Tests
- [ ] Visual layout on different screen sizes
- [ ] All tooltips and help text display correctly
- [ ] Step transitions are smooth
- [ ] Error states display properly
- [ ] Success flow redirects to Training Monitor

---

## 9. Documentation Updates

### CLAUDE.md Additions
Add section under "## Training Overview":

```markdown
### Training Wizard

The Training Wizard (`/training` tab → Setup Wizard) guides users through selecting and configuring one of three training methods:

1. **Local LoRA Training**: Train on your local machine (requires 24GB+ VRAM)
2. **Remote LoRA Training**: Train on RunPod cloud (requires API key)
3. **Full Fine-Tuning**: Advanced continuous learning (requires RunPod + larger dataset)

**Access**: Web UI → AI Training → Setup Wizard

**CLI Equivalents**:
- Local: `npx tsx brain/agents/full-cycle-local.ts --username <user>`
- Remote: `npx tsx brain/agents/full-cycle.ts --username <user>`
- Fine-Tune: `npx tsx brain/agents/fine-tune-cycle.ts --username <user>`
```

---

## 10. Future Enhancements (Post-MVP)

- **Training Presets**: Save and load common configurations
- **Schedule Training**: Set up recurring training runs (e.g., weekly)
- **Multi-Model Training**: Train multiple models in parallel
- **Training History**: View past training runs and compare metrics
- **Model Comparison**: A/B test different trained models in chat
- **Auto-Training**: Trigger training automatically when N new memories are captured

---

## 11. File Structure

```
apps/site/src/
├── components/
│   ├── TrainingWizard.svelte          [NEW]
│   ├── CenterContent.svelte           [MODIFIED]
│   └── TrainingMonitor.svelte         [EXISTING - no changes]
│
├── stores/
│   └── training-wizard.ts             [NEW - optional if complex state]
│
└── pages/api/
    ├── training/
    │   ├── launch.ts                  [NEW]
    │   ├── dataset-stats.ts           [NEW]
    │   └── status.ts                  [EXISTING - no changes]
    ├── runpod/
    │   └── validate.ts                [NEW]
    └── system/
        └── gpu-info.ts                [NEW]
```

---

## 12. Timeline Estimate

**Total Estimated Time**: 16-24 hours

- **Phase 1** (Component Structure): 2 hours
- **Phase 2** (Method Selection): 3 hours
- **Phase 3** (RunPod Config): 2 hours
- **Phase 4** (Dataset Review): 3 hours
- **Phase 5** (Training Config): 4 hours
- **Phase 6** (Training Launch): 3 hours
- **Phase 7** (Polish & Testing): 3-7 hours

---

## 13. Success Criteria

✅ User can complete training wizard without reading documentation
✅ Smart recommendations guide users to best method for their setup
✅ All three training pipelines work end-to-end from wizard
✅ RunPod credentials are validated before training starts
✅ Training progress is visible in real-time after launch
✅ Error messages are clear and actionable
✅ Training configurations are saved for reuse

---

## 14. Open Questions

1. **Should we persist wizard state** if user navigates away mid-flow?
   - Recommendation: Yes, save to localStorage with `wizard_state_<username>` key

2. **Should RunPod config be per-user or system-wide?**
   - Recommendation: Per-user in `profiles/<username>/training-config.json`

3. **Do we need multi-user support for training queue?**
   - Recommendation: Not MVP, but design API to support future queuing

4. **Should we show live training logs in the wizard?**
   - Recommendation: No, redirect to Training Monitor tab which already handles this

5. **How to handle training failures mid-process?**
   - Recommendation: Show error in wizard with "View Logs" button → Training Monitor

---

## End of Plan

This plan provides a comprehensive roadmap for implementing the Training Wizard. The phased approach allows for incremental development and testing. Priority should be given to Phase 1-6 for MVP, with Phase 7 (Polish) being iterative based on user feedback.
