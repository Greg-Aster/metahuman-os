# Fine-Tuning Mode Configurations

**Complete guide to cognitive mode-specific training configurations**

---

## Overview

Each cognitive mode has different training characteristics and requirements. Mode-specific configs optimize hyperparameters for the unique patterns of each mode.

### Configuration Priority

When running fine-tuning with a mode filter, configs are loaded in this order:

1. **Mode-Specific** (`etc/modes/{mode}-config.json`) - Used if `--mode` flag is provided
2. **General** (`etc/fine-tune-config.json`) - Fallback if no mode specified
3. **Hardcoded Defaults** - Final fallback

---

## Mode Configurations

### Dual Consciousness Mode (`dual-config.json`)

**Purpose**: Train the model to maintain coherent internal thought chains with `<thought>` → `<world>` structure.

**Key Characteristics**:
- Complex structured outputs (thought + world tags)
- Requires careful tuning to maintain coherence
- Higher warmup steps to learn format
- Slightly higher learning rate to adapt thought patterns

**Hyperparameters**:
```json
{
  "learning_rate": 6e-6,         // Slightly higher than base
  "warmup_steps": 150,            // More warmup for structure
  "save_total_limit": 3,          // Keep more checkpoints
  "min_samples": 3000,            // Lower min (quality > quantity)
  "recommended_samples": 8000
}
```

**Use When**:
- Training personality with internal monologue
- Creating dual-consciousness agents
- Need thought transparency and reasoning chains

**Example Command**:
```bash
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --base-model qwen3-coder:30b \
  --mode dual
```

---

### Emulation Mode (`emulation-config.json`)

**Purpose**: Train standard conversational chatbot behavior without thought chains.

**Key Characteristics**:
- Standard `<user>` → `<assistant>` format
- Balanced training approach
- Focus on conversational quality
- Creates "frozen snapshot" personality

**Hyperparameters**:
```json
{
  "learning_rate": 5e-6,          // Baseline learning rate
  "warmup_steps": 100,            // Standard warmup
  "save_total_limit": 2,          // Standard checkpoints
  "min_samples": 5000,            // Standard dataset size
  "recommended_samples": 12000    // Large conversational corpus
}
```

**Use When**:
- Creating stable persona snapshot
- Demo/showcase model
- Simple chat without operator overhead
- No tool usage needed

**Example Command**:
```bash
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --base-model qwen3-coder:30b \
  --mode emulation
```

---

### Agent Mode (`agent-config.json`)

**Purpose**: Train tool-using behavior with structured function calls and reasoning.

**Key Characteristics**:
- Structured tool invocation (JSON)
- Step-by-step reasoning
- Precision for function calling format
- Lower learning rate for stability

**Hyperparameters**:
```json
{
  "learning_rate": 4e-6,          // Lower for precision
  "warmup_steps": 120,            // More warmup for structure
  "weight_decay": 0.015,          // Higher regularization
  "max_grad_norm": 0.8,           // Tighter gradient clipping
  "min_samples": 2000,            // Lower min (diverse tools)
  "recommended_samples": 6000
}
```

**Use When**:
- Training tool-using agents
- Function calling behavior
- Structured output generation
- Need reliable JSON outputs

**Example Command**:
```bash
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --base-model qwen3-coder:30b \
  --mode agent
```

---

## Hyperparameter Comparison

| Parameter | Dual | Emulation | Agent | Rationale |
|-----------|------|-----------|-------|-----------|
| **Learning Rate** | 6e-6 | 5e-6 | 4e-6 | Dual needs higher to adapt thoughts; Agent needs lower for precision |
| **Warmup Steps** | 150 | 100 | 120 | Dual/Agent need more warmup for structured formats |
| **Weight Decay** | 0.01 | 0.01 | 0.015 | Agent needs more regularization for stability |
| **Max Grad Norm** | 1.0 | 1.0 | 0.8 | Agent uses tighter clipping for stable training |
| **Min Samples** | 3000 | 5000 | 2000 | Quality matters more than quantity for Dual/Agent |
| **Recommended** | 8000 | 12000 | 6000 | Emulation benefits from large conversational corpus |

---

## Mixed-Mode Training

To train on **all modes** without filtering (uses general config):

```bash
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --base-model qwen3-coder:30b
# No --mode flag = uses etc/fine-tune-config.json
```

**Use Cases**:
- Creating multi-modal models
- Initial full personality capture
- When you have balanced data across all modes

---

## Configuration File Structure

All mode configs follow this schema:

```json
{
  "comment": "Mode description",
  "notes": ["Training tips and context"],

  "cognitive_mode": "dual|emulation|agent",
  "base_model": "unsloth/Qwen3-Coder-30B-A3B-Instruct",
  "training_mode": "full_finetune",

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
  "weight_decay": 0.01,
  "max_grad_norm": 1.0,

  "save_total_limit": 2,
  "load_best_model_at_end": true,
  "metric_for_best_model": "loss",

  "dataset_requirements": {
    "min_samples": 5000,
    "recommended_samples": 10000,
    "mode_filter": "dual|emulation|agent"
  },

  "output_format": "gguf",
  "quantization": "Q8_0"
}
```

---

## Customizing Configs

To customize a mode's training:

1. **Edit the mode config** (`etc/modes/{mode}-config.json`)
2. **Adjust hyperparameters** based on your dataset characteristics
3. **Run training** with `--mode` flag

**Common Adjustments**:

- **Small Dataset** (< 3000 samples): Reduce `num_train_epochs` to 2, increase `warmup_steps`
- **Large Dataset** (> 15000 samples): Increase `num_train_epochs` to 4, lower `learning_rate`
- **40GB GPU**: Set `load_in_8bit: true` in config
- **Faster Training**: Increase `gradient_accumulation_steps` to 64 (larger effective batch)

---

## Testing Mode Configs

Test the pipeline with a small sample first:

```bash
# Test dual mode with 100 samples
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --base-model qwen3-coder:30b \
  --mode dual \
  --max 100
```

This validates:
- Config loading works
- Mode-specific hyperparameters applied
- Dataset generation correct
- No errors before committing to full training

---

## Dataset Requirements by Mode

| Mode | Min Samples | Recommended | Notes |
|------|-------------|-------------|-------|
| **Dual** | 3,000 | 8,000 | Quality > quantity; needs coherent thought chains |
| **Emulation** | 5,000 | 12,000 | Benefits from large conversational corpus |
| **Agent** | 2,000 | 6,000 | Needs diverse tool usage examples |
| **Mixed** | 5,000 | 10,000 | Balanced across all modes |

---

## Troubleshooting

### "Config not loading"

**Check**:
1. File exists: `ls etc/modes/dual-config.json`
2. Valid JSON: `cat etc/modes/dual-config.json | jq`
3. Correct mode name: `--mode dual` (not `--mode dual-consciousness`)

### "Training diverging"

**Solutions**:
1. Lower `learning_rate` by 50% (e.g., 6e-6 → 3e-6)
2. Increase `warmup_steps` to 200-300
3. Enable gradient clipping: `max_grad_norm: 0.5`

### "Out of memory"

**Solutions**:
1. Set `load_in_8bit: true`
2. Reduce `max_seq_length` to 1024
3. Use larger GPU (A100-80GB)

---

## Next Steps

1. **Review configs**: Check `etc/modes/*.json` match your needs
2. **Test pipeline**: Run with `--max 100` first
3. **Full training**: Remove `--max` for production run
4. **Monitor**: Watch RunPod logs for training progress

---

## References

- [RunPod Deployment Guide](fine-tune-runpod-deployment.md)
- [Quick Start Guide](fine-tune-quickstart.md)
- [Implementation Plan](fine-tune-implementation-plan.md)
