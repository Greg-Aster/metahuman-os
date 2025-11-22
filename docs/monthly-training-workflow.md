# Monthly Training Workflow

**Incremental fine-tuning strategy for continuous personality development**

---

## Overview

The monthly training workflow enables you to continuously improve your MetaHuman personality model over time without retraining on your entire memory history every time. This approach:

- **Prevents catastrophic forgetting** by mixing recent + old memories
- **Reduces training time** from 2-6 hours to 1-2 hours per run
- **Lowers costs** from $3-4 to $1.50 per training session
- **Builds on previous models** using continuous learning

---

## Training Strategy Comparison

### Initial Foundation Training (One-Time)

**When**: First training run when you have 3,000-5,000+ samples

**What it does**:
- Trains on your entire memory dataset
- Establishes baseline personality model
- Creates version 1 of your model

**Dataset size**: 5,000-10,000 samples
**Training time**: ~1.5-3 hours
**Cost**: ~$2.25-$4.50

**Command**:
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles
```

---

### Monthly Update Training (Ongoing)

**When**: Every 4 weeks after foundation model

**What it does**:
- Takes all memories from the last 30 days (new experiences)
- Mixes in 3,000 randomly selected older memories (prevent forgetting)
- Trains on combined dataset (~4,000-5,000 samples)
- Builds on previous model version

**Dataset size**: 4,000-5,000 samples
**Training time**: ~1-1.5 hours
**Cost**: ~$1.50-$2.25

**Command**:
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles --monthly
```

---

## How It Works

### Memory Selection Algorithm

When you use `--monthly` or `--days-recent` + `--old-samples`, the curator:

1. **Splits your memories by date**:
   - Recent: Last N days (default: 30)
   - Old: Everything before the cutoff date

2. **Includes all recent memories**:
   - These are your new experiences since last training
   - Typically 500-2,000 new samples per month

3. **Randomly samples old memories**:
   - Shuffles all old memories
   - Selects N samples (default: 3,000)
   - Provides representative coverage of past knowledge

4. **Combines for training**:
   - Total dataset: Recent (all) + Old (sampled)
   - Typical size: 3,500-5,000 samples

### Example Timeline

```
Month 0 (Foundation):
  Command: tsx brain/agents/fine-tune-cycle.ts --username greggles
  Dataset: 5,000 samples (all accumulated memories)
  Output: v1 model
  Time: 2 hours
  Cost: $3.00

Month 1 (First Update):
  Command: tsx brain/agents/fine-tune-cycle.ts --username greggles --monthly
  Dataset:
    - Recent (last 30 days): 1,200 new samples
    - Old (random sample): 3,000 from foundation
    - Total: 4,200 samples
  Output: v2 model (builds on v1)
  Time: 1.5 hours
  Cost: $2.00

Month 2:
  Dataset:
    - Recent: 1,500 new samples
    - Old: 3,000 random (from all 6,500 previous)
    - Total: 4,500 samples
  Output: v3 model (builds on v2)
  Time: 1.5 hours
  Cost: $2.00
```

---

## Sample Size Recommendations

### Initial Foundation (Run Once)

**Minimum**: 3,000 samples
**Recommended**: 5,000-8,000 samples
**Maximum**: 10,000+ samples (diminishing returns)

**Why you need this many**:
- Establishes core personality traits
- Captures writing style diversity
- Provides baseline for all cognitive modes
- Enables accurate continuous learning

### Monthly Updates

**Recent memories**: All from last 30 days (typically 500-2,000)
**Old samples**: 3,000 random from entire history
**Total**: 3,500-5,000 samples per run

**Why this works**:
- Recent memories capture new knowledge
- Old samples prevent forgetting earlier experiences
- 3,000 old samples provides good coverage
- Ratio balances new learning vs. retention

---

## Quality Concerns

### Current Dataset Issues

If your curator shows these metrics:
```
- Short samples (<=40 words): 93%  ⚠️ TOO HIGH
- Filler detected: 8.3%  ⚠️ Acceptable
```

**Problem**: 93% short samples will train the model to give very brief responses.

**Solution**: Capture more substantial conversations and responses.

### Target Quality Metrics

**Good distribution**:
- Short samples (<40 words): <50%
- Medium samples (40-100 words): 30-40%
- Long samples (>100 words): 10-20%
- Filler detected: <10%

**Mode distribution**:
- Dual: 20-40%
- Emulation: 40-60%
- Agent: 10-20%

---

## Command Reference

### Basic Commands

**Foundation training** (all memories):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles
```

**Monthly training** (30 days + 3,000 old):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles --monthly
```

### Custom Strategies

**Bi-weekly updates** (14 days recent):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles \
  --days-recent 14 \
  --old-samples 2000
```

**45-day window** (heavy on recent):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles \
  --days-recent 45 \
  --old-samples 4000
```

**Mode-specific training** (dual mode only):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles \
  --monthly \
  --mode dual
```

**Sample limit** (cap total samples):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles \
  --monthly \
  --max 5000
```

### Command Options

| Flag | Description | Example |
|------|-------------|---------|
| `--monthly` | Use monthly defaults (30 days + 3000 old) | `--monthly` |
| `--days-recent <N>` | Recent window in days | `--days-recent 45` |
| `--old-samples <N>` | Number of old samples to include | `--old-samples 4000` |
| `--max <N>` | Maximum total samples | `--max 6000` |
| `--mode <mode>` | Filter by cognitive mode | `--mode dual` |
| `--base-model <model>` | Override base model | `--base-model Qwen/Qwen3-14B` |

---

## Workflow Guide

### Step 1: Accumulate Memories

**Goal**: Collect 3,000-5,000 quality samples before foundation training.

**How long**: 2-6 weeks depending on activity:
- Active user: 100-200 memories/week → 3 weeks
- Moderate user: 50-100 memories/week → 6 weeks
- Light user: 20-50 memories/week → 10+ weeks

**What counts as quality**:
- Real conversations (not just "ok" / "thanks")
- Observations with meaningful content
- Inner dialogues and reflections
- Mixed length responses (not all 1-liners)

### Step 2: Foundation Training

**When**: You have 3,000+ samples accumulated.

**Before you run**:
1. Check sample count:
   ```bash
   find profiles/greggles/memory/episodic -name "*.json" | wc -l
   ```

2. Review quality metrics:
   ```bash
   tsx brain/agents/memory-curator.ts \
     --username greggles \
     --output /tmp/test.json
   ```

**Run foundation training**:
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles
```

**What happens**:
- Duration: 1.5-3 hours
- Cost: $2.25-$4.50
- Output: v1 model in `profiles/greggles/out/fine-tuned-models/`
- Registry updated: `current_base_model` now points to v1

### Step 3: Monthly Updates

**When**: 4 weeks after foundation (or previous monthly run).

**Before you run**:
1. Verify you have new memories:
   ```bash
   find profiles/greggles/memory/episodic -name "2025-11*.json" | wc -l
   ```

2. Check registry status:
   ```bash
   cat etc/model-registry.json | grep current_base_model
   ```

**Run monthly update**:
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles --monthly
```

**What happens**:
- Duration: 1-1.5 hours
- Cost: $1.50-$2.25
- Output: v2 model (builds on v1)
- Registry updated: `current_base_model` now points to v2

### Step 4: Load to Ollama

After training completes successfully, load the new model:

```bash
# For full fine-tuning (safetensors model)
ollama create greggles-v2 -f profiles/greggles/out/fine-tuned-models/YYYY-MM-DD/RUN-ID/Modelfile

# Test the new model
ollama run greggles-v2 "How are you feeling today?"
```

---

## Cost Analysis

### Per-Run Costs (RunPod A100 80GB)

**Foundation training** (5,000 samples):
- GPU time: ~2 hours @ $1.89/hr = $3.78
- Pod startup/download: ~5 min = $0.16
- **Total**: ~$4.00

**Monthly update** (4,000 samples):
- GPU time: ~1.5 hours @ $1.89/hr = $2.84
- Pod startup/download: ~5 min = $0.16
- **Total**: ~$3.00

**With monthly strategy** (30 days + 3000 old):
- Smaller dataset (less recent memories)
- GPU time: ~1 hour @ $1.89/hr = $1.89
- **Total**: ~$2.00

### Annual Costs

**Monthly training** (12 runs/year):
- Foundation: $4.00 (once)
- 11 monthly updates: 11 × $2.00 = $22.00
- **Annual total**: $26.00

**Bi-weekly training** (26 runs/year):
- Foundation: $4.00 (once)
- 25 bi-weekly updates: 25 × $1.50 = $37.50
- **Annual total**: $41.50

---

## Troubleshooting

### "Only 230 samples - recommended 5000+"

**Cause**: Dataset too small for effective fine-tuning.

**Solution**:
1. Continue accumulating memories
2. Run this test training to verify pipeline works
3. Treat this as a "smoke test" - don't use the resulting model seriously
4. Wait until you have 3,000+ samples for real foundation training

### "Short samples: 93%"

**Cause**: Most memories are brief 1-2 sentence responses.

**Solution**:
1. Capture more substantial conversations
2. Use the chat interface for longer dialogues
3. Write detailed observations and reflections
4. Aim for <50% short samples

### "Training failed: No space left on device"

**Cause**: RunPod container ran out of disk space (fixed in latest version).

**Solution**: The code now saves to `/workspace/` (network volume) instead of `/output/` (container storage). Re-run training.

### "Training uses AdamW instead of Adafactor"

**Cause**: Cached config files from previous runs.

**Solution**:
1. Clear cached work directories:
   ```bash
   rm -rf metahuman-runs/greggles/YYYY-MM-DD/*
   ```
2. Re-run training - will generate fresh configs

### Model quality degraded after monthly update

**Cause**: Not enough old samples to prevent forgetting.

**Solution**:
1. Increase `--old-samples` to 4,000-5,000
2. Or reset to foundation and retrain from scratch:
   ```bash
   tsx -e "import { resetToOriginalBase } from './packages/core/src/model-registry.js'; resetToOriginalBase()"
   tsx brain/agents/fine-tune-cycle.ts --username greggles
   ```

---

## Best Practices

### 1. Quality Over Quantity

Don't rush to 3,000 samples with low-quality data:
- ❌ Capturing every "ok" and "thanks" response
- ✅ Capturing meaningful conversations and observations

### 2. Balanced Mode Distribution

Ensure all cognitive modes are represented:
- **Dual mode**: Inner dialogues, reflections, dreams (20-40%)
- **Emulation mode**: Conversations, observations, journals (40-60%)
- **Agent mode**: Tool usage, task execution (10-20%)

### 3. Regular Schedule

Set a consistent training schedule:
- Monthly: 1st of every month
- Bi-weekly: Every other Friday
- Quarterly: Start of each quarter (if low activity)

### 4. Monitor Quality Metrics

Before each training run:
```bash
tsx brain/agents/memory-curator.ts \
  --username greggles \
  --output /tmp/preview.json
```

Review the quality metrics and only proceed if:
- Short samples: <60%
- Filler detected: <15%
- Total samples: >3,000 (foundation) or >500 new (monthly)

### 5. Version Control

After each successful training:
1. Note the version in your calendar
2. Test the new model before deleting old versions
3. Keep last 2-3 versions for rollback capability

### 6. Backup Strategy

**Before training**:
```bash
# Backup current model registry
cp etc/model-registry.json etc/model-registry.backup.json

# Backup current model (if exists)
cp -r profiles/greggles/out/fine-tuned-models/latest \
     profiles/greggles/out/fine-tuned-models/backup-$(date +%Y%m%d)
```

**After training**:
```bash
# Test new model
ollama run greggles-v2 "Tell me about yourself"

# If satisfied, remove backup
rm etc/model-registry.backup.json
```

---

## Advanced Usage

### Mode-Specific Training

Train separate models for each cognitive mode:

**Dual mode specialist**:
```bash
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --mode dual \
  --days-recent 30 \
  --old-samples 3000
```

**Emulation mode specialist**:
```bash
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --mode emulation \
  --days-recent 30 \
  --old-samples 4000
```

### Continuous Learning Lineage

Track your model evolution:

```bash
# View training history
cat etc/model-registry.json | jq '.training_history'

# See current model
cat etc/model-registry.json | jq '.current_base_model'

# Reset to original base
tsx -e "import { resetToOriginalBase } from './packages/core/src/model-registry.js'; resetToOriginalBase()"
```

### Custom Sampling Strategies

**Heavy recent bias** (learning new skills):
```bash
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --days-recent 60 \
  --old-samples 2000
```

**Heavy historical coverage** (reinforcing old knowledge):
```bash
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --days-recent 14 \
  --old-samples 5000
```

---

## FAQ

### Q: Can I skip the foundation training?

**A**: Not recommended. The foundation establishes your baseline personality. Monthly updates build on this foundation - without it, you won't have a coherent model.

### Q: What if I only have 500 samples?

**A**: Wait. 500 samples is too small for effective fine-tuning. The model will overfit and produce poor results. Accumulate 3,000+ samples first, or run as a pipeline test only.

### Q: Can I train more frequently than monthly?

**A**: Yes, but consider:
- **Bi-weekly**: Works if you accumulate 500+ samples every 2 weeks
- **Weekly**: Not recommended - too frequent, insufficient new data
- Cost increases proportionally to frequency

### Q: Should I increase old samples over time?

**A**: Not necessarily. 3,000 old samples provides good coverage. If you notice quality degradation, increase to 4,000-5,000, but more isn't always better.

### Q: Can I use this with LoRA training instead?

**A**: The workflow supports both full fine-tuning and LoRA. For LoRA, the memory requirements are lower (16GB vs 70GB), and training is faster (30-60 min vs 1-2 hours). See [lora-training.md](lora-training.md) for details.

### Q: What if I want to completely retrain?

**A**: Reset the registry and retrain from scratch:
```bash
tsx -e "import { resetToOriginalBase } from './packages/core/src/model-registry.js'; resetToOriginalBase()"
tsx brain/agents/fine-tune-cycle.ts --username greggles
```

---

## Related Documentation

- [Continuous Learning System](continuous-learning-system.md) - Model versioning and registry
- [Fine-Tune Pipeline](fine-tune-pipeline.md) - Complete training pipeline overview
- [RunPod Deployment](fine-tune-runpod-deployment.md) - RunPod setup and troubleshooting
- [Training Configuration](training-configuration.md) - Hyperparameters and optimizer settings

---

## Quick Reference

**Foundation training** (once):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles
```

**Monthly updates** (every 4 weeks):
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles --monthly
```

**Check sample count**:
```bash
find profiles/greggles/memory/episodic -name "*.json" | wc -l
```

**View registry**:
```bash
cat etc/model-registry.json | jq
```

**Reset to original**:
```bash
tsx -e "import { resetToOriginalBase } from './packages/core/src/model-registry.js'; resetToOriginalBase()"
```
