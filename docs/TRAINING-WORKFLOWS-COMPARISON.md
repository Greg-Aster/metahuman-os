# Training Workflows Comparison

## Overview

MetaHuman OS has **two distinct training workflows** for fine-tuning models on your personality data:

1. **full-cycle.ts** - LoRA adapter training (lightweight, merged models)
2. **fine-tune-cycle.ts** - Full fine-tuning (complete model replacement)

Both use the **same training parameters** from [etc/training.json](../etc/training.json), but differ significantly in data curation, workflow structure, and output.

---

## 🔄 Workflow Structure

### full-cycle.ts (LoRA Merged Models)
**Location:** [brain/agents/full-cycle.ts](../brain/agents/full-cycle.ts)

**Pipeline:**
```
1. Curate dataset (inline, simple deduplication)
2. Upload to RunPod
3. Train LoRA adapter
4. Merge adapter with base model (on RunPod)
5. Download merged GGUF (quantized Q4_K_M)
6. Load to Ollama
7. Auto-cleanup old runs
```

**Single-file agent:** All logic in one file (~750 lines)

### fine-tune-cycle.ts (Full Fine-Tuning)
**Location:** [brain/agents/fine-tune-cycle.ts](../brain/agents/fine-tune-cycle.ts)

**Pipeline:**
```
1. Curate memories (memory-curator agent - advanced)
2. Format samples (mode-formatter agent - add cognitive mode tags)
3. Apply schema (schema-manager - model-family wrappers)
4. Export JSONL
5. Validate dataset
6. Upload to RunPod
7. Train full model (all layers)
8. Download full model (Q6_K quantization)
9. Load to Ollama
10. Auto-cleanup old runs
```

**Orchestrator pattern:** Calls specialized sub-agents (~400 lines + 3 agents)

---

## 📊 Data Curation

### full-cycle.ts - Advanced Curation (UPDATED!)
**Default:** Now uses the same advanced pipeline as fine-tune-cycle.ts!

**Approach:**
- **Step 1:** Curate memories via `memory-curator` agent (quality filtering)
- **Step 2:** Format samples via `mode-formatter` agent (add cognitive mode tags)
- **Step 3:** Apply schema wrappers via `schema-manager` (model-specific)
- **Step 4:** Export to JSONL
- **Filler removal, response trimming, cognitive modes** - all included!

**Legacy mode:** Set `METAHUMAN_DATASET_BUILDER=classic` for old behavior

**Pros:** Same quality as fine-tune-cycle, concise responses, mode awareness
**Cons:** Slightly slower than old simple deduplication (but worth it!)

---

### fine-tune-cycle.ts - Advanced Curation
**Agent:** `memory-curator.ts` ([brain/agents/memory-curator.ts](../brain/agents/memory-curator.ts))

**Approach:**
- Loads raw episodic memories (conversation, observation, inner_dialogue, etc.)
- **Cognitive mode assignment** (dual/emulation/agent based on memory type)
- **Response cleaning:**
  - Removes filler phrases (`"Okay, let me start by..."`, `"As an AI..."`)
  - Normalizes whitespace
  - Trims to word limits (40 words short, 300 words long)
  - Randomly allows 7.5% long-form responses
- **Monthly training strategy** - Mix recent + historical samples
- **Quality metrics** - Validates before training

**Mode mapping:** ([memory-curator.ts:52-63](../brain/agents/memory-curator.ts#L52-L63))
```typescript
const MODE_MAPPING: Record<string, CognitiveMode> = {
  'inner_dialogue': 'dual',    // Internal thoughts → dual consciousness
  'reflection': 'dual',         // Reflections → dual consciousness
  'dream': 'dual',              // Dreams → dual consciousness
  'conversation': 'emulation',  // Chat → emulation mode
  'chat': 'emulation',          // Chat → emulation mode
  'observation': 'emulation',   // Observations → emulation mode
  'journal': 'emulation',       // Journal entries → emulation mode
  'action': 'agent',            // Tool use → agent mode
  'task': 'agent',              // Tasks → agent mode
  'tool_use': 'agent',          // Tool execution → agent mode
};
```

**Filler removal:** ([memory-curator.ts:66-74](../brain/agents/memory-curator.ts#L66-L74))
```typescript
const FILLER_PHRASES: RegExp[] = [
  /^(okay|ok|alright|sure)[,;:\-\s]*/i,
  /^so[,;:\s-]*/i,
  /^let me (?:start|think|figure)[^,.!?]*[,;:\-\s]*/i,
  /^i'm just (?:here to|an ai)[^,.!?]*[,;:\-\s]*/i,
  /^as an? (?:ai|language model)[^,.!?]*[,;:\-\s]*/i,
  /^certainly[,;:\-\s]*/i,
  /^here's what[^,.!?]*[,;:\-\s]*/i,
];
```

**Pros:** High-quality, concise responses; cognitive mode awareness; quality metrics
**Cons:** Slower, more complex, may lose nuance from trimming

---

## 🎯 Training Parameters

**Both workflows use identical parameters from** [etc/training.json](../etc/training.json):

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `base_model` | `unsloth/Qwen3-14B` | HuggingFace model ID |
| `max_seq_length` | 2048 | ~1500 words context |
| `lora_rank` | 8 | LoRA capacity (balanced) |
| `lora_alpha` | 16 | LoRA scaling (2x rank) |
| `lora_dropout` | 0.05 | Regularization |
| `num_train_epochs` | 3 | Training epochs |
| `learning_rate` | 0.0002 | 2e-4 (standard for LoRA) |
| `per_device_train_batch_size` | 1 | Batch size per GPU |
| `gradient_accumulation_steps` | 16 | Effective batch = 16 |
| `optimizer` | `paged_adamw_8bit` | Memory-efficient optimizer |
| `dtype` | `bfloat16` | Training precision |
| `load_in_4bit` | true | 4-bit quantization for training |
| `use_gradient_checkpointing` | true | Save VRAM |

**To change training settings:**
```bash
# Edit shared configuration
nano etc/training.json

# Or override base model via env var
export METAHUMAN_BASE_MODEL="unsloth/Qwen3-Coder-30B"
```

---

## 📁 Output Files

### full-cycle.ts Output
**Directory:** `profiles/<user>/out/adapters/<date>/<run-label>/`

```
adapter/                                  # 208MB (original LoRA weights)
├── adapter_model.safetensors            # For future training
└── checkpoint-*/                        # Training checkpoints
adapter.gguf                             # 8.4GB (Q4_K_M merged model)
Modelfile                                # Ollama configuration
<run-label>.jsonl                        # Training dataset
```

**Model type:** LoRA weights merged with base → single GGUF file
**Quantization:** Q4_K_M (8-9GB, fast inference)
**Retraining:** Requires original safetensors

---

### fine-tune-cycle.ts Output
**Directory:** `profiles/<user>/out/fine-tuned-models/<date>/<run-label>/`

```
model/                                   # 31GB (original full model)
├── model-00001-of-00006.safetensors    # Sharded model files
└── ...
model-Q6_K.gguf                          # 12GB (Q6_K quantized)
Modelfile                                # Ollama configuration
curated_memories.json                    # Curated samples
formatted_samples.json                   # Mode-tagged samples
schema_applied.json                      # Model-specific wrapping
fine_tune_dataset.jsonl                  # Final training data
run-summary.json                         # Training summary
```

**Model type:** Complete model replacement (all layers trained)
**Quantization:** Q6_K (12GB, higher quality)
**Retraining:** Full model available for continued training

---

## ⚖️ Key Differences Summary

| Feature | full-cycle.ts | fine-tune-cycle.ts |
|---------|---------------|-------------------|
| **Training Type** | LoRA adapter (merged) | Full fine-tuning |
| **Data Curation** | ✅ Advanced (same as fine-tune) | ✅ Advanced + quality filtering |
| **Cognitive Modes** | ✅ Assigned automatically | ✅ Assigned automatically |
| **Filler Removal** | ✅ Yes | ✅ Yes |
| **Response Trimming** | ✅ Yes (40-300 words) | ✅ Yes (40-300 words) |
| **Monthly Strategy** | ✅ Yes (via env vars) | ✅ Yes (recent + old mix) |
| **Quality Metrics** | ✅ Calculated and logged | ✅ Calculated and logged |
| **Model Size** | 8.4GB (Q4_K_M) | 12GB (Q6_K) |
| **Training Time** | ~30-45 min | ~45-60 min |
| **VRAM Usage** | ~10-14GB | ~10-14GB (same) |
| **Output Quality** | Verbose, may have fillers | Concise, cleaned |
| **Use Case** | Quick iterations, testing | Production, monthly updates |
| **Retraining** | Requires safetensors | Full model available |

---

## 🎯 When to Use Which?

### Use full-cycle.ts when:
- ✅ Want LoRA adapter training (lighter, faster)
- ✅ Smaller model size is priority (8.4GB vs 12GB)
- ✅ Testing new configurations quickly
- ✅ Same quality as fine-tune but faster inference
- ✅ **Now includes all advanced curation features!**

### Use fine-tune-cycle.ts when:
- ✅ Production monthly training
- ✅ Want high-quality, concise responses
- ✅ Need cognitive mode awareness (dual/emulation/agent)
- ✅ Want to filter out verbose/filler content
- ✅ Need quality validation before training
- ✅ Want to balance recent + historical memories
- ✅ Higher quality model is priority (Q6_K)

---

## 🚀 Usage Examples

### full-cycle.ts
```bash
# LoRA training with advanced curation (default)
pnpm tsx brain/agents/full-cycle.ts --username greggles

# With monthly training strategy
export METAHUMAN_DAYS_RECENT=30
export METAHUMAN_OLD_SAMPLES=3000
pnpm tsx brain/agents/full-cycle.ts --username greggles

# With custom sample limit
export METAHUMAN_MAX_SAMPLES=5000
pnpm tsx brain/agents/full-cycle.ts --username greggles

# Use legacy simple curation (not recommended)
export METAHUMAN_DATASET_BUILDER=classic
pnpm tsx brain/agents/full-cycle.ts --username greggles
```

### fine-tune-cycle.ts
```bash
# Monthly production training (uses advanced curation)
pnpm tsx brain/agents/fine-tune-cycle.ts \\
  --username greggles \\
  --monthly \\
  --base-model unsloth/Qwen3-14B

# With custom parameters
pnpm tsx brain/agents/fine-tune-cycle.ts \\
  --username greggles \\
  --days-recent 30 \\
  --old-samples 3000 \\
  --max 5000 \\
  --mode emulation
```

---

## 🔧 Customization

### Modify Data Curation

**full-cycle.ts:** Edit `buildDatasetFromJsonl()` function ([full-cycle.ts:176](../brain/agents/full-cycle.ts#L176))

**fine-tune-cycle.ts:** Edit:
- [memory-curator.ts](../brain/agents/memory-curator.ts) - Curation logic
- [mode-formatter.ts](../brain/agents/mode-formatter.ts) - Mode tagging
- [schema-manager.ts](../packages/core/src/schema-manager.ts) - Model wrappers

### Modify Training Parameters

Edit [etc/training.json](../etc/training.json) - affects **both workflows**:
```json
{
  "lora_rank": 16,           // Higher capacity (more VRAM)
  "num_train_epochs": 5,     // More training (longer time)
  "learning_rate": 0.0001    // Smaller steps (more stable)
}
```

---

## 📝 Recommendations

**For most users:**
- Start with **full-cycle.ts** to test quickly
- Switch to **fine-tune-cycle.ts** for monthly production training
- Use **monthly strategy** (30 days recent + 3000 old samples) to balance recency with historical knowledge

**For advanced users:**
- Create custom curation pipelines in memory-curator.ts
- Adjust filler patterns to match your style
- Experiment with different mode mappings
- Tune response length limits (40/300 word defaults)

**Storage management:**
- Auto-cleanup runs after each training (keeps latest + previous)
- Manual cleanup: `pnpm tsx scripts/cleanup-old-training-runs.ts --username greggles`
- Keep safetensors for retraining, GGUFs are auto-deleted

---

## 🐛 Troubleshooting

### Issue: "Training failed: Unknown error"
**Solution:** Check if GGUF exists despite error - may still be usable. Workflows now auto-load models even on training failures.

### Issue: "Model outputs verbose/filler responses"
**Solution:** Use **fine-tune-cycle.ts** instead of full-cycle.ts for automatic filler removal.

### Issue: "Not enough training samples"
**Solution:** Adjust `--max`, `--days-recent`, or `--old-samples` parameters.

### Issue: "Model doesn't differentiate cognitive modes"
**Solution:** Use **fine-tune-cycle.ts** which assigns modes automatically.

---

## 📚 Related Documentation

- [etc/training.json](../etc/training.json) - Shared training configuration
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [CLAUDE.md](../CLAUDE.md) - Development guide
- [scripts/cleanup-old-training-runs.ts](../scripts/cleanup-old-training-runs.ts) - Storage cleanup
