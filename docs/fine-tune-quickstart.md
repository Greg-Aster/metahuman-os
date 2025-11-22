# Fine-Tune Pipeline - Quick Start Guide

**Quick guide to using the cognitive mode fine-tuning pipeline**

---

## What is This?

The fine-tuning pipeline trains models with **three distinct cognitive modes**:

1. **Dual Mode** - Internal monologue (`<thought>` → `<world>`)
2. **Emulation Mode** - Standard chatbot (`<user>` → `<assistant>`)
3. **Agent Mode** - Tool-using agent (`<instruction>` → `<action>`)

This produces **better personality modeling** than LoRA adapters by training all model weights, not just adapter layers.

---

## Quick Test (Recommended First Step)

Test the pipeline on 100 memories to validate everything works:

```bash
# Test with small sample
tsx scripts/test-fine-tune-pipeline.ts --username greggles --max 100
```

This will:
- ✅ Curate 100 memories
- ✅ Format them with mode tags
- ✅ Apply Qwen schema
- ✅ Export JSONL dataset
- ✅ Validate no mode contamination
- ✅ Show quality metrics

**Output**: `test-fine-tune-output/` directory with all intermediate files

---

## Full Pipeline Run

Once the test passes, run the full pipeline:

```bash
# Full fine-tune with all modes
tsx brain/agents/fine-tune-cycle.ts --username greggles --base-model qwen3-coder:30b
```

**What happens**:
1. Loads ALL your episodic memories
2. Curates them (assigns modes, cleans responses)
3. Formats with mode-specific tags
4. Applies model-family schema (Qwen/LLaMA/Phi)
5. Exports training JSONL
6. Validates dataset quality

**Output**: `profiles/greggles/out/fine-tuned-models/{date}/{run-label}/`
- `curated_memories.json` - Cleaned memories
- `formatted_samples.json` - Mode-tagged samples
- `schema_applied.json` - Schema-wrapped samples
- `fine_tune_dataset.jsonl` - Final training dataset
- `run-summary.json` - Metrics and metadata

---

## Mode-Specific Training

Train only one cognitive mode:

```bash
# Train only dual mode (personality deepening)
tsx brain/agents/fine-tune-cycle.ts --username greggles --mode dual --max 3000

# Train only emulation mode (chatbot behavior)
tsx brain/agents/fine-tune-cycle.ts --username greggles --mode emulation

# Train only agent mode (tool usage)
tsx brain/agents/fine-tune-cycle.ts --username greggles --mode agent
```

---

## Configuration

### Model Selection

Supported model families:
- **Qwen** (qwen3-coder, qwen3-instruct) - Default
- **LLaMA** (llama3-70b, llama3-8b)
- **Phi** (phi-3-medium, phi-3-mini)
- **GPT-J** (gpt-j-6b)

```bash
# Use different base model
tsx brain/agents/fine-tune-cycle.ts --username greggles --base-model llama3-70b
```

### Fine-Tune Settings

Edit `etc/fine-tune-config.json`:

```json
{
  "base_model": "unsloth/Qwen3-Coder-30B-A3B-Instruct",
  "training_mode": "full_finetune",
  "learning_rate": 5e-6,
  "num_train_epochs": 3,
  "max_seq_length": 2048
}
```

**Key differences from LoRA**:
| Setting | LoRA | Full Fine-Tune |
|---------|------|----------------|
| Learning rate | 2e-4 | 5e-6 |
| Training time | 15-30 min | 2-6 hours |
| GPU required | 16GB (A10G) | 40GB+ (A100) |
| Data needed | 1000+ samples | 5000+ samples |

---

## Understanding the Output

### Quality Metrics

```
📊 CURATION QUALITY METRICS:
  - Total samples: 5247
  - Avg assistant length: 28.3 words      ← Target: 30-40
  - Short samples (≤40 words): 87.2%       ← Target: >80%
  - Long samples (>100 words): 4.1%        ← Target: 5-10%
  - Filler detected: 0.8%                  ← Target: <2%
  - Mode distribution:
    - Dual: 1523 samples (29.0%)           ← Target: >20%
    - Emulation: 2891 samples (55.1%)      ← Target: >20%
    - Agent: 833 samples (15.9%)           ← Target: >10%
```

**Good indicators**:
- ✅ Avg assistant length 25-40 words
- ✅ Short samples >80%
- ✅ Filler detected <2%
- ✅ Each mode has >10% distribution

**Bad indicators**:
- ❌ Avg assistant length >60 words (too verbose)
- ❌ Short samples <60% (not concise enough)
- ❌ Filler detected >5% (cleanup failed)
- ❌ Any mode <5% (imbalanced training)

### Mode Contamination Validation

```
✓ No mode contamination detected
```

**What this checks**:
- Dual samples ONLY have `<thought>` and `<world>` tags
- Emulation samples ONLY have `<user>` and `<assistant>` tags
- Agent samples ONLY have `<instruction>` and `<action>` tags

If contamination is detected, the pipeline will FAIL with specific errors.

---

## Next Steps (After Dataset Ready)

**Current Status**: Pipeline generates dataset ready for training

**TODO** (future implementation):
1. RunPod integration for remote training
2. Full fine-tune training script (`scripts/train_full_finetune.py`)
3. Model download and Ollama loading
4. UI integration in Adapter Dashboard

**For now**, you can:
1. Review the generated JSONL dataset
2. Validate quality metrics
3. Manually train with HuggingFace Trainer
4. Load fine-tuned model to Ollama

---

## Troubleshooting

### "Not enough samples"

```
Dataset has only 847 samples. Recommended: 5000+ for full fine-tuning.
```

**Solution**: Capture more memories, or use `--max` to include more history

### "Mode contamination detected"

```
❌ Dual mode contaminated with <user> tags
```

**Solution**: Check memory curator logic, ensure mode assignment is correct

### "Filler detected >5%"

**Solution**: Update filler phrase list in `memory-curator.ts`

### "One mode has <10% distribution"

**Solution**: Capture more varied memory types (observations, actions, reflections)

---

## Advanced Usage

### Schema Customization

Edit `etc/schemas/{family}.json` to customize model-specific formatting:

```json
{
  "family": "qwen",
  "user_prefix": "<|user|>",
  "assistant_prefix": "<|assistant|>",
  "eos_token": "<|endoftext|>"
}
```

### Custom Mode Mapping

Edit `brain/agents/memory-curator.ts` to change memory type → mode assignment:

```typescript
const MODE_MAPPING: Record<string, CognitiveMode> = {
  'inner_dialogue': 'dual',      // Your internal thoughts
  'reflection': 'dual',          // Self-reflection
  'conversation': 'emulation',   // Chat conversations
  'action': 'agent',             // Tool/action usage
  // Add custom mappings...
};
```

---

## Comparison: LoRA vs Full Fine-Tune

| Aspect | LoRA (Current) | Full Fine-Tune (New) |
|--------|----------------|---------------------|
| **Purpose** | Fast iteration | Deep personality |
| **Training** | Adapter weights only | All model weights |
| **Data size** | 1000-2000 samples | 5000+ samples |
| **Time** | 15-30 minutes | 2-6 hours |
| **GPU** | 16GB A10G | 40-80GB A100 |
| **Cost** | $0.50-$1.00 | $5.00-$15.00 |
| **Quality** | Good for style | Better for personality |
| **Merging** | Required | Not needed |
| **Use case** | Daily updates | Weekly/monthly |

**Recommendation**: Use both
- **LoRA**: Daily quick updates for new memories
- **Fine-Tune**: Weekly deep training for personality evolution

---

## References

- [Full Implementation Plan](fine-tune-implementation-plan.md)
- [Master Specification](model-fine-tune-overview.md)
- [Schema Files](../etc/schemas/)
- [Configuration](../etc/fine-tune-config.json)
