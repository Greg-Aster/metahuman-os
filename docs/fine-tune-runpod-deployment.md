# Fine-Tune RunPod Deployment Guide

**Complete guide for running full fine-tuning on RunPod**

---

## Overview

The fine-tuning pipeline now **fully integrates with RunPod** for remote GPU training. It reuses the existing LoRA training infrastructure but trains **all model weights** instead of just adapters.

### What's Different from LoRA

| Aspect | LoRA (Current) | Full Fine-Tune (New) |
|--------|----------------|---------------------|
| **Training script** | `train_unsloth.py` | `train_full_finetune.py` |
| **Training mode** | `training_mode: "lora"` | `training_mode: "full_finetune"` |
| **GPU required** | 16GB (RTX 4090) | 40-80GB (A100) |
| **Training time** | 30-60 min | 2-6 hours |
| **Learning rate** | 2e-4 | 5e-6 (much lower) |
| **Output** | Adapter weights | Full model |

---

## Prerequisites

### 1. RunPod Account Setup

```bash
# Required environment variables in .env
RUNPOD_API_KEY=your_api_key_here
RUNPOD_SSH_KEY_PATH=/path/to/your/ssh_private_key
RUNPOD_TEMPLATE_ID=pzr9tt3vvq  # Optional: custom template
RUNPOD_GPU_TYPE=NVIDIA A100-SXM4-80GB  # Full fine-tune needs A100
```

**Get your API key**: https://www.runpod.io/console/user/settings

**SSH Key**: RunPod needs your public key added to your account
```bash
# Generate SSH key if you don't have one
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/runpod_ed25519

# Add public key to RunPod:
# https://www.runpod.io/console/user/settings → SSH Public Keys
cat ~/.ssh/runpod_ed25519.pub
```

### 2. GPU Selection

For full fine-tuning, you need:
- **Minimum**: 40GB VRAM (A100-40GB)
- **Recommended**: 80GB VRAM (A100-80GB)
- **Alternative**: Use 8-bit loading for 30B models (fits in 40GB)

Update `.env`:
```bash
# For Qwen3-30B full fine-tune
RUNPOD_GPU_TYPE=NVIDIA A100-SXM4-80GB

# Or 40GB version (requires load_in_8bit: true in config)
RUNPOD_GPU_TYPE=NVIDIA A100-PCIE-40GB
```

---

## Quick Start

### 1. Test Pipeline Locally (Recommended First Step)

```bash
# Test dataset generation with 100 samples
tsx scripts/test-fine-tune-pipeline.ts --username greggles --max 100
```

This validates:
- ✅ Memory curation works
- ✅ Mode formatting correct
- ✅ Schema application successful
- ✅ JSONL export valid
- ✅ No mode contamination

### 2. Run Full Fine-Tuning on RunPod

```bash
# Full fine-tune with all cognitive modes
tsx brain/agents/fine-tune-cycle.ts --username greggles --base-model qwen3-coder:30b
```

**What happens**:
1. **Local**: Generate dataset (curate → format → schema → export)
2. **RunPod**: Create pod with A100 GPU
3. **RunPod**: Upload dataset and training script
4. **RunPod**: Run `train_full_finetune.py` (2-6 hours)
5. **RunPod**: Download fine-tuned model
6. **Local**: Load model to Ollama

---

## Pipeline Stages

### Stage 1: Pod Creation (2-5 min)

```
📦 Stage 1/6: Creating RunPod instance...
📦 Trying COMMUNITY cloud...
✅ Pod created: abc123xyz
```

- Requests A100 GPU on RunPod
- Tries COMMUNITY cloud first, falls back to SECURE
- Waits for pod to start (Docker image loading)

### Stage 2: SSH Connection (1-10 min)

```
🔌 Stage 2/6: Establishing SSH connection...
🔌 SSH connection attempt 5/120... (container starting)
✅ SSH ready: user@host
```

- Waits for pod to be accessible via SSH
- Discovers gateway credentials
- Verifies connection

### Stage 3: File Upload (1-5 min)

```
📤 Stage 3/6: Uploading training data...
📤 Uploaded: dataset.jsonl (5247 samples)
📤 Uploaded: config.json
📤 Uploaded: train_full_finetune.py
✅ Stage 3/6: Upload complete
```

- Uploads `fine_tune_dataset.jsonl`
- Uploads `config.json` with `training_mode: "full_finetune"`
- Uploads `train_full_finetune.py` training script

### Stage 4: Training (2-6 hours)

```
🔥 Stage 4/6: Full fine-tuning model...
⏱️  Expected duration: 2-6 hours for 30B model

[10:15:23] ▶️  MODEL_DOWNLOAD - 📥 Downloading unsloth/Qwen3-Coder-30B-A3B-Instruct
[10:18:45] ▶️  MODEL_DOWNLOAD - ✅ Model loaded in 3.4 minutes (100%)
[10:18:50] ▶️  TRAINING - 🔥 Starting FULL fine-tuning: 3 epochs, ~486 steps
[10:18:50] ▶️  TRAINING - Estimated time: 972-1944 minutes (2-4 sec/step)
[10:19:00] ▶️  TRAINING - Training started...
...
[13:45:12] ▶️  TRAINING - ✅ Training complete in 206.4 minutes (100%)
[13:48:30] ▶️  GGUF_CONVERT - ✅ GGUF created: /workspace/gguf_output/model.gguf
```

**Real-time progress tracking**:
- Model download
- Tokenization
- Training progress (% complete)
- GGUF conversion

### Stage 5: Download Model (10-30 min)

```
📥 Stage 5/6: Downloading fine-tuned model...
📥 Downloading: model.gguf (18.5 GB)
✅ Model downloaded
```

- Downloads full GGUF model from RunPod
- Large file (~15-20GB for 30B model)
- Uses base64 streaming for reliability

### Stage 6: Cleanup (1 min)

```
🗑️  Stage 6/6: Cleaning up...
✅ Pod terminated
✅ Pipeline complete
```

- Terminates RunPod instance
- Saves run summary
- Logs audit trail

---

## Configuration

### Fine-Tune Config (`etc/fine-tune-config.json`)

```json
{
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

  "bf16": true,
  "optim": "adamw_torch",
  "weight_decay": 0.01,

  "load_in_8bit": false
}
```

**Key settings**:
- `learning_rate`: **5e-6** (much lower than LoRA's 2e-4)
- `gradient_accumulation_steps`: **32** (effective batch size = 32)
- `load_in_8bit`: Set to `true` for 40GB GPUs (slight quality loss)

### Model-Specific Configs

**Qwen3-30B** (recommended):
```json
{
  "base_model": "unsloth/Qwen3-Coder-30B-A3B-Instruct",
  "bf16": true,
  "load_in_8bit": false
}
```

**LLaMA3-70B** (requires 80GB GPU):
```json
{
  "base_model": "meta-llama/Meta-Llama-3-70B-Instruct",
  "bf16": true,
  "load_in_8bit": true,
  "learning_rate": 3e-6
}
```

---

## Cost Estimation

### RunPod Pricing (as of 2025)

| GPU | VRAM | Community Cloud | Secure Cloud |
|-----|------|----------------|--------------|
| A100-40GB | 40GB | ~$1.00/hr | ~$1.50/hr |
| A100-80GB | 80GB | ~$1.50/hr | ~$2.20/hr |

**Full fine-tune costs**:
- **Dataset generation**: Free (runs locally)
- **Pod creation**: 5 minutes (~$0.10)
- **Training**: 2-6 hours (~$3.00-$9.00)
- **Download**: 30 minutes (~$0.50)
- **Total**: ~$4-$10 per run

**Tips to save money**:
- Use Community Cloud (cheaper but less availability)
- Train with fewer epochs (2 instead of 3)
- Use smaller datasets for testing

---

## Monitoring Progress

### Real-Time Console Output

```bash
# Watch training progress in terminal
tsx brain/agents/fine-tune-cycle.ts --username greggles --base-model qwen3-coder:30b
```

Output shows:
- Current stage (1/6 through 6/6)
- Progress percentage
- Estimated time remaining
- Training metrics (loss, etc.)

### RunPod Dashboard

Monitor in browser:
1. Go to https://www.runpod.io/console/pods
2. Find your pod by ID (shown in console)
3. Click "Logs" to see Python training output
4. Click "Metrics" to see GPU utilization

---

## Troubleshooting

### "No pods available"

```
❌ Failed to create pod on any cloud
```

**Solution**:
- Try different GPU type: `RUNPOD_GPU_TYPE=NVIDIA A100-PCIE-40GB`
- Wait 5-10 minutes and retry (pods become available)
- Use Secure Cloud (more expensive but more availability)

### "Training failed - Out of memory"

```
torch.cuda.OutOfMemoryError: CUDA out of memory
```

**Solution**:
1. Enable 8-bit loading in `etc/fine-tune-config.json`:
   ```json
   {"load_in_8bit": true}
   ```
2. Reduce sequence length:
   ```json
   {"max_seq_length": 1024}
   ```
3. Use larger GPU (A100-80GB)

### "Connection timeout"

```
⚠️  SSH connection timed out
```

**Solution**:
- Pod may still be starting (Docker image download)
- Wait up to 10 minutes for large base models
- Check RunPod dashboard to see pod status

### "Dataset too small"

```
⚠️  Warning: Only 847 samples (recommended: 5000+)
```

**Solution**:
- Capture more memories (observations, conversations, tasks)
- Remove `--max` limit to use all available memories
- Proceed anyway (will work but lower quality)

---

## Advanced Usage

### Mode-Specific Training

Train only one cognitive mode with optimized hyperparameters:

```bash
# Train only dual mode (personality deepening)
# Uses etc/modes/dual-config.json (higher learning rate, more warmup)
tsx brain/agents/fine-tune-cycle.ts --username greggles --mode dual --max 3000

# Train only emulation mode (chatbot)
# Uses etc/modes/emulation-config.json (balanced training)
tsx brain/agents/fine-tune-cycle.ts --username greggles --mode emulation

# Train only agent mode (tool usage)
# Uses etc/modes/agent-config.json (lower LR, higher regularization)
tsx brain/agents/fine-tune-cycle.ts --username greggles --mode agent
```

**Mode-Specific Configs**: Each mode has optimized hyperparameters in [etc/modes/](../etc/modes/):
- **Dual**: Higher learning rate (6e-6), more warmup (150 steps), needs 3K+ samples
- **Emulation**: Balanced settings (5e-6), standard warmup (100 steps), needs 5K+ samples
- **Agent**: Lower learning rate (4e-6), tighter clipping, needs 2K+ diverse tool examples

See [Mode Configurations Guide](fine-tune-mode-configs.md) for detailed hyperparameter explanations.

### Custom Base Models

```bash
# Fine-tune LLaMA3-70B
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --base-model meta-llama/Meta-Llama-3-70B-Instruct

# Fine-tune Phi-3
tsx brain/agents/fine-tune-cycle.ts \
  --username greggles \
  --base-model microsoft/Phi-3-medium-4k-instruct
```

### Resume Failed Training

If training fails mid-run, you can manually resume:

1. Find the pod ID from the error log
2. SSH into the pod (credentials in log)
3. Check training output: `cat /workspace/training_output.txt`
4. Resume if checkpoints exist

---

## Output Files

After successful fine-tuning:

```
profiles/greggles/out/fine-tuned-models/2025-11-21/2025-11-21-214447-cd70d7/
├── curated_memories.json          # Cleaned memories
├── formatted_samples.json         # Mode-tagged samples
├── schema_applied.json            # Schema-wrapped samples
├── fine_tune_dataset.jsonl        # Training dataset
├── model/                         # Fine-tuned model
│   ├── config.json
│   ├── model.safetensors
│   └── tokenizer files...
├── model.gguf                     # GGUF format (for Ollama)
└── run-summary.json               # Metadata
```

---

## Next Steps

1. **Test the pipeline** on 100 samples
2. **Run full fine-tune** on RunPod
3. **Load model to Ollama** (coming soon)
4. **Compare to LoRA** - which works better for your use case?

---

## References

- [Mode Configurations Guide](fine-tune-mode-configs.md) - Hyperparameter tuning for each cognitive mode
- [Quick Start Guide](fine-tune-quickstart.md)
- [Implementation Plan](fine-tune-implementation-plan.md)
- [Master Specification](model-fine-tune-overview.md)
- [RunPod Documentation](https://docs.runpod.io/)
