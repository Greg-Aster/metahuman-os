# Continuous Learning System

**Model versioning and iterative fine-tuning architecture**

---

## Overview

The MetaHuman fine-tuning pipeline supports **continuous learning** - each training run builds on the previous one, creating an evolving personality model.

### Concept

```
Original Base Model (Qwen/Qwen3-14B from HuggingFace)
        ↓
    [Train on memories 1-1000]
        ↓
    Version 1 Model
        ↓
    [Train on memories 1001-2000]
        ↓
    Version 2 Model
        ↓
    [Continue indefinitely...]
```

Each version learns from new experiences while retaining knowledge from previous training.

---

## Model Registry

### Configuration File: `etc/model-registry.json`

Tracks:
- **Original base model**: Starting point (never changes)
- **Current base model**: Model to use for next training
- **Training history**: All previous runs with metadata
- **Auto-update behavior**: Whether to use latest trained model

### Example Registry After 2 Training Runs:

```json
{
  "original_base_model": "Qwen/Qwen3-14B",
  "current_base_model": "profiles/greggles/out/fine-tuned-models/2025-11-21/.../model",
  "model_type": "local",

  "training_history": [
    {
      "version": 1,
      "run_id": "abc123",
      "timestamp": "2025-11-21T10:00:00Z",
      "base_model_used": "Qwen/Qwen3-14B",
      "output_model_path": "profiles/greggles/out/.../v1/model",
      "gguf_path": "profiles/greggles/out/.../v1/model.gguf",
      "samples_trained": 3247,
      "training_success": true
    },
    {
      "version": 2,
      "run_id": "def456",
      "timestamp": "2025-11-22T14:30:00Z",
      "base_model_used": "profiles/greggles/out/.../v1/model",
      "output_model_path": "profiles/greggles/out/.../v2/model",
      "gguf_path": "profiles/greggles/out/.../v2/model.gguf",
      "samples_trained": 1834,
      "training_success": true
    }
  ],

  "versioning": {
    "enabled": true,
    "auto_update_base": true,
    "keep_all_versions": true
  }
}
```

---

## Dual Output Formats

After each training run, **two versions** of the model are saved:

### 1. **Unquantized Model** (Safetensors)
- **Format**: PyTorch Safetensors
- **Size**: ~28 GB (for 14B model)
- **Purpose**: Base for next fine-tuning run
- **Location**: `profiles/{user}/out/fine-tuned-models/{date}/{run-id}/model/`
- **Files**:
  - `model.safetensors`
  - `config.json`
  - `tokenizer.json`

**Why needed**: Fine-tuning requires full-precision weights. You can't fine-tune a quantized model.

### 2. **Quantized GGUF** (Q8_0)
- **Format**: GGUF (llama.cpp format)
- **Size**: ~8-10 GB (for 14B model)
- **Purpose**: Fast local inference with Ollama
- **Location**: `profiles/{user}/out/fine-tuned-models/{date}/{run-id}/model.gguf`

**Why needed**: Ollama uses GGUF for efficient inference on consumer hardware.

---

## How It Works

### First Training Run

**Command**:
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles
```

**Process**:
1. Checks `model-registry.json`
2. Sees `current_base_model: "unsloth/Qwen3-14B-Instruct"`
3. Downloads `Qwen/Qwen3-14B` model from HuggingFace
4. Trains on your memories
5. Saves:
   - Unquantized model → `/out/.../model/`
   - Quantized GGUF → `/out/.../model.gguf`
6. Updates registry:
   - `current_base_model` → `/out/.../model/` (unquantized path)
   - `model_type` → `"local"`

### Second Training Run

**Command** (same as before):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles
```

**Process**:
1. Checks `model-registry.json`
2. Sees `current_base_model: "/out/v1/model"` (local path)
3. **Loads your previous fine-tuned model** (no download needed!)
4. Trains on new memories
5. Saves version 2
6. Updates registry to point to version 2

### Continuous Learning Loop

Each run builds on the last:
```
Run 1: HuggingFace base → v1 (memories 1-3000)
Run 2: v1 → v2 (memories 3001-5000)
Run 3: v2 → v3 (memories 5001-7000)
...
```

---

## Model Selection Priority

When you run fine-tuning, the base model is determined by:

1. **User Override** (`--base-model` flag) ← Highest priority
   ```bash
   tsx brain/agents/fine-tune-cycle.ts --username greggles --base-model Qwen/Qwen3-14B
   ```
   Use this to:
   - Switch to a different base model
   - Reset to original
   - Test different architectures

2. **Model Registry** (`current_base_model`) ← Default
   ```bash
   tsx brain/agents/fine-tune-cycle.ts --username greggles
   ```
   Uses latest trained model automatically

3. **Hardcoded Fallback** (if registry missing)
   - `Qwen/Qwen3-14B`

---

## Registry Management Commands

### View Current Base Model

```typescript
import { getCurrentBaseModel } from '@metahuman/core';

const { model, type } = getCurrentBaseModel();
console.log(`Current base: ${model}`);
console.log(`Type: ${type}`); // 'local' or 'huggingface'
```

### View Training History

```typescript
import { getTrainingHistory } from '@metahuman/core';

const history = getTrainingHistory();
history.forEach((run) => {
  console.log(`v${run.version}: ${run.samples_trained} samples`);
});
```

### Reset to Original

```typescript
import { resetToOriginalBase } from '@metahuman/core';

resetToOriginalBase();
// Next run will use Qwen/Qwen3-14B again
```

Or via CLI:
```bash
tsx -e "import { resetToOriginalBase } from './packages/core/src/model-registry.js'; resetToOriginalBase()"
```

---

## Use Cases

### 1. **Incremental Personality Development**

Train monthly as you accumulate new memories:
```bash
# January
tsx brain/agents/fine-tune-cycle.ts --username greggles
# → v1 with Jan memories

# February
tsx brain/agents/fine-tune-cycle.ts --username greggles
# → v2 builds on v1, adds Feb memories

# March
tsx brain/agents/fine-tune-cycle.ts --username greggles
# → v3 builds on v2, adds Mar memories
```

### 2. **Mode-Specific Evolution**

Train each mode separately, building expertise:
```bash
# Week 1: Train dual mode
tsx brain/agents/fine-tune-cycle.ts --username greggles --mode dual
# → v1 (dual consciousness)

# Week 2: Train more dual examples
tsx brain/agents/fine-tune-cycle.ts --username greggles --mode dual
# → v2 (deeper dual consciousness, builds on v1)
```

### 3. **Fresh Start with New Memories**

Reset to original, train on curated subset:
```bash
# Reset to base
tsx -e "import { resetToOriginalBase } from './packages/core/src/model-registry.js'; resetToOriginalBase()"

# Train fresh
tsx brain/agents/fine-tune-cycle.ts --username greggles --max 5000
```

---

## Storage Considerations

### Disk Space Usage

Each training run creates:
- **Unquantized model**: ~28 GB
- **Quantized GGUF**: ~8 GB
- **Total per run**: ~36 GB

After 5 training runs: **~180 GB**

### Cleanup Strategies

**Keep all versions** (default):
```json
{
  "versioning": {
    "keep_all_versions": true
  }
}
```
- Allows rollback to any version
- Full lineage preserved
- High disk usage

**Keep only latest** (manual cleanup):
1. Archive old versions to cold storage
2. Delete unquantized models you won't retrain from
3. Keep only GGUF for inference

**Recommended**: Keep last 3 versions, archive older ones

---

## Technical Details

### Why Two Formats?

**Can't you just quantize the GGUF back to full precision?**
❌ **No** - Quantization is lossy. You lose information.

**Flow**:
```
Full Model (28GB)
    ↓ [Quantize to Q8_0]
GGUF (8GB) ← Information loss here
    ↓ [Can't reverse!]
    ❌ Can't get back to full precision
```

**Solution**: Keep both
- **Unquantized**: For next training (needs full precision)
- **Quantized**: For inference (faster, smaller)

### Model Loading

**HuggingFace model** (first run):
```python
model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-14B",  # Downloads from internet
    torch_dtype=torch.bfloat16,
)
```

**Local model** (subsequent runs):
```python
model = AutoModelForCausalLM.from_pretrained(
    "/profiles/greggles/out/.../model",  # Loads from disk
    torch_dtype=torch.bfloat16,
)
```

---

## Benefits

✅ **Continuous Improvement**: Each training builds on the last
✅ **No Forgetting**: Previous knowledge retained
✅ **Fast Iteration**: No need to retrain from scratch
✅ **Version Control**: Full lineage tracked
✅ **Flexible**: Can reset or branch at any time

---

## Limitations

⚠️ **Disk Space**: Each version requires ~36 GB
⚠️ **Training Time**: Still 1.5-3 hours per run (can't compress)
⚠️ **Cost**: Each run costs $2-4 on RunPod

---

## Next Steps

1. **Run first training**: Creates version 1
2. **Accumulate more memories**: Capture new experiences
3. **Run second training**: Automatically builds on version 1
4. **Monitor registry**: Check `etc/model-registry.json` to see lineage
5. **Load to Ollama**: Use latest GGUF for inference

---

## References

- [Model Registry Source](../packages/core/src/model-registry.ts)
- [Fine-Tune Cycle](../brain/agents/fine-tune-cycle.ts)
- [RunPod Deployment Guide](fine-tune-runpod-deployment.md)
