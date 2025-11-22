# Cognitive Mode Fine-Tuning Pipeline - Implementation Plan

**Based on**: [model-fine-tune-overview.md](model-fine-tune-overview.md)
**Created**: 2025-11-21
**Status**: Implementation in progress

---

## Overview

This document outlines the implementation plan for a **full fine-tuning pipeline** that trains models with three distinct cognitive modes, replacing the current LoRA-based approach for deep personality training.

### Three Cognitive Modes

1. **Dual Mode**: AI is the "thinker," user is the "internal monologue" (role inversion)
2. **Emulation Mode**: Standard LLM chatbot (user → assistant)
3. **Agent Mode**: Tool-using agent receiving instructions

---

## Architecture Comparison

### Current System (LoRA)
```
full-cycle.ts → ai-dataset-builder.ts → RunPod LoRA training → merge adapters → Ollama
```

### New System (Full Fine-Tuning)
```
fine-tune-cycle.ts →
  ├─ memory-curator.ts (clean & assign metadata)
  ├─ mode-formatter.ts (dual/emulation/agent formatting)
  ├─ schema-manager.ts (model-family wrappers)
  └─ training-exporter.ts (JSONL output)
     → RunPod full fine-tune → Ollama
```

---

## Core Components

### 1. Memory Curator (`brain/agents/memory-curator.ts`)

**Purpose**: Clean raw memories and assign cognitive mode metadata

**Input**: Raw episodic memories from `profiles/{user}/memory/episodic/`

**Processing**:
- Assign mode tags based on memory type:
  - `inner_dialogue`, `reflection`, `dream` → **dual** mode
  - `conversation`, `chat`, `observation` → **emulation** mode
  - `action`, `task`, `tool_use` → **agent** mode
- Trim assistant responses (1-3 sentences default, 5-10% long-form)
- Preserve user input exactly (no rewriting)
- Remove filler phrases ("As an AI...", "Certainly!", "Let me think...")
- Break multi-turn conversations into single pairs
- Remove context leakage (ensure each pair is self-contained)

**Output**: `{runDir}/curated_memories.json`

```json
{
  "mode": "dual" | "emulation" | "agent",
  "user_text": "...",
  "assistant_text": "...",
  "metadata": {
    "original_id": "...",
    "multi_turn": false,
    "long_output": false,
    "source_type": "inner_dialogue"
  }
}
```

**Curation Rules**:
- **User text**: Preserve 100% (teaches personality)
- **Assistant text**: Trim to 1-3 sentences (90%), allow 5-10% long-form
- **Filler removal**: Strip all boilerplate phrases
- **Multi-turn**: Split by default unless `metadata.multi_turn === true`
- **Max assistant length**: 120 words default, 300 words for long-form

---

### 2. Mode Formatter (`brain/agents/mode-formatter.ts`)

**Purpose**: Apply mode-specific formatting rules

**Input**: `{runDir}/curated_memories.json`

**Processing by Mode**:

**Dual Mode** (role inversion):
```
<thought>: {user_text}
<world>: {assistant_text}
```

**Emulation Mode** (standard):
```
<user>: {user_text}
<assistant>: {assistant_text}
```

**Agent Mode** (task-oriented):
```
<instruction>: {user_text}
<action>: {assistant_text}
```

**Output**: `{runDir}/formatted_samples.json`

**Critical Rule**: Mode tags are literal strings, NOT placeholder tokens. They will be wrapped by schema manager.

---

### 3. Schema Manager (`packages/core/src/schema-manager.ts`)

**Purpose**: Apply model-family-specific wrappers

**Responsibilities**:
- Detect base model family (Qwen, LLaMA, Phi, GPT-J)
- Load schema from `etc/schemas/{family}.json`
- Wrap formatted content with model-specific tokens
- **CRITICAL**: Only wrap, never modify content

**Model Family Detection**:
```typescript
function detectModelFamily(baseModel: string): string {
  if (baseModel.includes('qwen')) return 'qwen';
  if (baseModel.includes('llama')) return 'llama';
  if (baseModel.includes('phi')) return 'phi';
  if (baseModel.includes('gpt-j')) return 'gptj';
  return 'generic';
}
```

**Schema Application Examples**:

**Qwen**:
```
<|user|><thought>: I need to solve this problem<|assistant|><world>: The solution appears
```

**LLaMA3**:
```
[INST] <user>: What is the answer? [/INST] <assistant>: The answer is 42.
```

**Phi-3**:
```
<|prompt|><instruction>: Run the task<|answer|><action>: Task executed successfully.
```

**Output**: `{runDir}/schema_applied.json`

---

### 4. Training Exporter (`brain/agents/training-exporter.ts`)

**Purpose**: Generate final JSONL for training

**Input**: `{runDir}/schema_applied.json`

**Processing**:
- Convert to JSONL format
- Validate proper JSON escaping
- Ensure no malformed records
- Check each record is standalone
- Validate no mode contamination

**Output**: `{runDir}/fine_tune_dataset.jsonl`

```jsonl
{"input": "<|user|><user>: Hello", "output": "<|assistant|><assistant>: Hi there!"}
{"input": "<|user|><thought>: I wonder", "output": "<|assistant|><world>: Reality shifts"}
```

**Validation Checks**:
- All JSON properly escaped
- No special characters breaking format
- Each line is valid JSON object
- No mode mixing (dual samples don't contain `<user>` tags, etc.)

---

### 5. Fine-Tune Orchestrator (`brain/agents/fine-tune-cycle.ts`)

**Purpose**: Coordinate the entire pipeline (analogous to full-cycle.ts)

**Pipeline Flow**:

```typescript
async function fineTuneCycle(username: string, options: FineTuneOptions) {
  // 1. Setup
  const runId = randomBytes(8).toString('hex');
  const runDir = createRunDirectory(username, runId);

  // 2. Data preparation
  await runMemoryCurator(username, runDir, options);
  await runModeFormatter(runDir);
  await runSchemaManager(runDir, options.baseModel);
  await runTrainingExporter(runDir);

  // 3. Validation
  await validateDataset(runDir);

  // 4. Training
  const result = await runRemoteFineTune({
    datasetPath: path.join(runDir, 'fine_tune_dataset.jsonl'),
    baseModel: options.baseModel,
    runId,
  });

  // 5. Model loading
  if (result.success) {
    await downloadFineTunedModel(runDir);
    await createModelfile(runDir, username);
    await loadToOllama(runDir, username);
  }

  // 6. Cleanup
  await writeRunSummary(runDir, result);
}
```

**CLI Interface**:
```bash
# Full fine-tune for all modes
./bin/mh fine-tune --username greggles --base-model qwen3-coder:30b

# Fine-tune only dual mode
./bin/mh fine-tune --username greggles --mode dual --min-samples 3000

# Fine-tune with custom schema
./bin/mh fine-tune --username greggles --schema etc/schemas/llama.json
```

---

## File Structure

```
metahuman/
├── brain/agents/
│   ├── fine-tune-cycle.ts          # Main orchestrator
│   ├── memory-curator.ts            # Step 1: Clean & tag
│   ├── mode-formatter.ts            # Step 2: Apply mode formatting
│   ├── training-exporter.ts         # Step 3: Generate JSONL
│   └── fine-tune-trainer.ts         # RunPod fine-tune executor
│
├── packages/core/src/
│   ├── schema-manager.ts            # Model-family schema application
│   └── mode-validator.ts            # Validate no mode contamination
│
├── etc/
│   ├── schemas/
│   │   ├── qwen.json                # Qwen family schema
│   │   ├── llama.json               # LLaMA family schema
│   │   ├── phi.json                 # Phi family schema
│   │   └── gptj.json                # GPT-J family schema
│   └── fine-tune-config.json        # Full fine-tune hyperparameters
│
└── profiles/{user}/
    ├── memory/episodic/             # Source data
    └── out/fine-tuned-models/       # Output models
        └── {date}/
            ├── curated_memories.json
            ├── formatted_samples.json
            ├── schema_applied.json
            ├── fine_tune_dataset.jsonl
            ├── run-summary.json
            └── model/                # Final fine-tuned model
```

---

## Schema Files

### Qwen Schema (`etc/schemas/qwen.json`)

```json
{
  "family": "qwen",
  "description": "Qwen3 model family (Coder, Instruct, etc.)",
  "user_prefix": "<|user|>",
  "user_suffix": "",
  "assistant_prefix": "<|assistant|>",
  "assistant_suffix": "",
  "separator": "",
  "eos_token": "<|endoftext|>"
}
```

### LLaMA Schema (`etc/schemas/llama.json`)

```json
{
  "family": "llama",
  "description": "LLaMA3 model family",
  "user_prefix": "[INST] ",
  "user_suffix": " [/INST]",
  "assistant_prefix": " ",
  "assistant_suffix": "",
  "separator": "\n",
  "eos_token": "</s>"
}
```

### Phi Schema (`etc/schemas/phi.json`)

```json
{
  "family": "phi",
  "description": "Phi-3 model family",
  "user_prefix": "<|prompt|>",
  "user_suffix": "",
  "assistant_prefix": "<|answer|>",
  "assistant_suffix": "",
  "separator": "\n",
  "eos_token": "<|endoftext|>"
}
```

---

## Mode Assignment Strategy

```typescript
const MODE_MAPPING: Record<string, CognitiveMode> = {
  'inner_dialogue': 'dual',
  'reflection': 'dual',
  'dream': 'dual',
  'conversation': 'emulation',
  'chat': 'emulation',
  'observation': 'emulation',
  'journal': 'emulation',
  'action': 'agent',
  'task': 'agent',
  'tool_use': 'agent',
};
```

---

## Full Fine-Tune vs LoRA Comparison

| Aspect | LoRA (Current) | Full Fine-Tune (New) |
|--------|----------------|---------------------|
| **Training** | Adapter weights only | All model weights |
| **Data size** | 1000-2000 samples | 5000+ samples recommended |
| **Training time** | 15-30 min | 2-6 hours |
| **GPU memory** | 16GB (A10G) | 40-80GB (A100 required) |
| **Merging** | Required | Not needed |
| **Quality** | Good for style | Better for deep personality |
| **Cost per run** | $0.50-$1.00 | $5.00-$15.00 |
| **Use case** | Daily updates | Weekly/monthly deep training |

---

## Validation Strategy

### Mode Contamination Checks

```typescript
function validateNoModeContamination(samples: FormattedSample[]): ValidationResult {
  const errors: string[] = [];

  for (const sample of samples) {
    if (sample.mode === 'dual') {
      if (!sample.input.includes('<thought>')) {
        errors.push(`Dual mode sample missing <thought> tag: ${sample.id}`);
      }
      if (!sample.output.includes('<world>')) {
        errors.push(`Dual mode sample missing <world> tag: ${sample.id}`);
      }
      if (sample.input.includes('<user>') || sample.input.includes('<instruction>')) {
        errors.push(`Dual mode contaminated with other mode tags: ${sample.id}`);
      }
    }

    if (sample.mode === 'emulation') {
      if (!sample.input.includes('<user>')) {
        errors.push(`Emulation mode sample missing <user> tag: ${sample.id}`);
      }
      if (!sample.output.includes('<assistant>')) {
        errors.push(`Emulation mode sample missing <assistant> tag: ${sample.id}`);
      }
      if (sample.input.includes('<thought>') || sample.input.includes('<instruction>')) {
        errors.push(`Emulation mode contaminated with other mode tags: ${sample.id}`);
      }
    }

    if (sample.mode === 'agent') {
      if (!sample.input.includes('<instruction>')) {
        errors.push(`Agent mode sample missing <instruction> tag: ${sample.id}`);
      }
      if (!sample.output.includes('<action>')) {
        errors.push(`Agent mode sample missing <action> tag: ${sample.id}`);
      }
      if (sample.input.includes('<user>') || sample.input.includes('<thought>')) {
        errors.push(`Agent mode contaminated with other mode tags: ${sample.id}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

### Output Quality Checks

```typescript
function validateOutputQuality(samples: CuratedSample[]): QualityReport {
  const lengths: number[] = [];
  const fillerPhrases = ['as an ai', 'certainly', 'let me think', 'i\'m just'];
  let fillerCount = 0;

  for (const sample of samples) {
    const wordCount = sample.assistant_text.split(/\s+/).length;
    lengths.push(wordCount);

    const lowerText = sample.assistant_text.toLowerCase();
    if (fillerPhrases.some(phrase => lowerText.includes(phrase))) {
      fillerCount++;
    }
  }

  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const shortSamples = lengths.filter(l => l <= 40).length;
  const longSamples = lengths.filter(l => l > 100).length;

  return {
    avgAssistantLength: avgLength,
    shortSamplesPercent: (shortSamples / lengths.length) * 100,
    longSamplesPercent: (longSamples / lengths.length) * 100,
    fillerDetectedPercent: (fillerCount / lengths.length) * 100,
  };
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [x] Create implementation plan document
- [ ] Create schema files (`etc/schemas/*.json`)
- [ ] Implement `schema-manager.ts`
- [ ] Implement `mode-validator.ts`
- [ ] Unit tests for schema application

### Phase 2: Data Pipeline (Week 2)
- [ ] Implement `memory-curator.ts`
- [ ] Implement `mode-formatter.ts`
- [ ] Implement `training-exporter.ts`
- [ ] Integration tests for pipeline

### Phase 3: Orchestration (Week 3)
- [ ] Implement `fine-tune-cycle.ts`
- [ ] Create `fine-tune-config.json`
- [ ] Implement `fine-tune-trainer.ts` (RunPod integration)
- [ ] Create `scripts/train_full_finetune.py`

### Phase 4: UI & Polish (Week 4)
- [ ] Add fine-tune tab to Adapter Dashboard
- [ ] Mode distribution visualization
- [ ] Sample preview by mode
- [ ] Training progress monitoring
- [ ] Documentation and examples

---

## RunPod Training Configuration

### Training Script (`scripts/train_full_finetune.py`)

**Key Differences from LoRA**:
- Uses Hugging Face `Trainer` (not Unsloth LoRA)
- Full model fine-tuning with low learning rate
- Saves entire model checkpoint (no adapter merging)
- Requires 40GB+ VRAM (A100 recommended)

**Hyperparameters** (`etc/fine-tune-config.json`):
```json
{
  "base_model": "unsloth/Qwen3-Coder-30B-A3B-Instruct",
  "learning_rate": 5e-6,
  "num_train_epochs": 3,
  "per_device_train_batch_size": 1,
  "gradient_accumulation_steps": 32,
  "max_seq_length": 2048,
  "warmup_steps": 100,
  "logging_steps": 10,
  "save_steps": 500,
  "fp16": false,
  "bf16": true,
  "optim": "adamw_torch",
  "weight_decay": 0.01
}
```

---

## Integration with Existing System

### Parallel Workflows

Keep both systems operational:

1. **LoRA Pipeline** (`full-cycle.ts`): Fast iteration, daily updates
2. **Fine-Tune Pipeline** (`fine-tune-cycle.ts`): Weekly/monthly deep training

### Shared Components

Reuse existing infrastructure:
- User authentication (`getAuthenticatedUser`)
- Profile paths (`getProfilePaths`)
- Audit system (`audit()`)
- Model registry (`etc/models.json`)
- RunPod API client (refactor `lora-trainer.ts` → `runpod-client.ts`)

### Model Registry Updates

Add fine-tuned models to `etc/models.json`:
```json
{
  "default.persona": {
    "provider": "ollama",
    "model": "greggles-ft-2025-11-21",
    "trainingMethod": "full-finetune",
    "cognitiveModesSupported": ["dual", "emulation", "agent"],
    "baseModel": "qwen3-coder:30b",
    "fineTunedAt": "2025-11-21T00:00:00Z"
  }
}
```

---

## Critical Success Factors

### 1. Data Quality
- **No mode contamination**: Strict separation of dual/emulation/agent samples
- **Concise outputs**: 90% of assistant responses ≤ 40 words
- **Filler removal**: Zero tolerance for boilerplate phrases

### 2. Schema Correctness
- **Model-specific tokens**: Exact match to model family requirements
- **No content modification**: Schema manager only wraps, never edits

### 3. Validation
- **Pre-training checks**: Validate dataset before expensive RunPod run
- **Mode distribution**: Each mode should have ≥20% of total samples
- **JSON integrity**: All records properly escaped and standalone

### 4. Training Stability
- **Low learning rate**: 5e-6 for full fine-tune (vs 2e-4 for LoRA)
- **Sufficient data**: Minimum 5000 samples (vs 1000 for LoRA)
- **Gradient accumulation**: Compensate for small batch size

---

## Next Steps

1. **Create schema files** - Simple JSON configs, easiest to start
2. **Implement schema-manager** - Core reusable component
3. **Build memory-curator** - Most complex logic
4. **Test with 100 samples** - Validate before full pipeline
5. **Build orchestrator** - Tie everything together

---

## References

- [Master Specification](model-fine-tune-overview.md)
- [Full-Cycle LoRA Pipeline](../brain/agents/full-cycle.ts)
- [AI Dataset Builder](../brain/agents/ai-dataset-builder.ts)
- [Model Router](../packages/core/src/model-router.ts)
