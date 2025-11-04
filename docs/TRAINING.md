# LoRA Training Guide

MetaHuman OS supports two training methods for creating personalized AI models:

## 🚀 Quick Start

### Remote Training (RunPod - Recommended)
```bash
# Fully automated - trains on RunPod GPU
npx tsx brain/agents/full-cycle.ts
```

### Local Training
```bash
# Trains on your local GPU
./bin/mh-train-local

# Or with a specific model
./bin/mh-train-local "unsloth/Qwen3-Coder-30B-A3B-Instruct"
```

---

## Remote Training (RunPod)

**Advantages:**
- ✅ No local GPU required
- ✅ Fast (RTX 5090 GPUs)
- ✅ Fully automated
- ✅ Handles large models easily

**Requirements:**
- RunPod account with API key
- `RUNPOD_API_KEY` set in `.env`

**How it works:**
1. Creates a temporary GPU pod on RunPod
2. Uploads your training data
3. Trains the model remotely
4. Downloads the merged GGUF file
5. Creates Ollama model automatically
6. Updates `etc/agent.json`

**Configuration:**
```bash
# In .env file
RUNPOD_API_KEY=your_api_key_here
RUNPOD_TEMPLATE_ID=6r5jlk3b89  # Unsloth template
RUNPOD_NO_GATEWAY=1
RUNPOD_DIRECT_SSH_USER=root

# Optional: Override base model
LORA_BASE_MODEL=openai/gpt-oss-20b
```

**Cost:**
- ~$0.50-1.00 per training run (20-30 minutes)
- Pods are automatically terminated after completion

---

## Local Training

**Advantages:**
- ✅ No cloud costs
- ✅ Complete privacy
- ✅ Full control over process

**Requirements:**
- NVIDIA GPU with 24GB+ VRAM
  - Recommended: RTX 4090, RTX 3090, A6000
  - Minimum for 20B models: RTX 3090 (24GB)
- Python 3.10+
- CUDA 11.8 or 12.1
- Unsloth installed

**Setup:**

1. **Install CUDA** (if not already installed):
```bash
# Check CUDA version
nvidia-smi

# Should show CUDA 11.8 or 12.x
```

2. **Install Unsloth**:
```bash
# For CUDA 12.1
pip install "unsloth[cu121-torch220] @ git+https://github.com/unslothai/unsloth.git"

# For CUDA 11.8
pip install "unsloth[cu118-torch220] @ git+https://github.com/unslothai/unsloth.git"
```

3. **Verify installation**:
```bash
python3 -c "import unsloth; print('Unsloth installed successfully!')"
```

4. **Run training**:
```bash
./bin/mh-train-local
```

**How it works:**
1. Builds dataset from your memories
2. Downloads base model (~40GB for GPT-OSS-20B)
3. Trains LoRA adapter locally
4. Merges and converts to GGUF
5. Creates Ollama model automatically
6. Updates `etc/agent.json`

**Expected time:**
- First run: ~60 minutes (includes model download)
- Subsequent runs: ~20-30 minutes (cached model)

---

## Model Options

### Supported Models

**GPT-OSS-20B** (Default)
- Size: 20B parameters (3.6B active)
- VRAM: ~22GB
- Best for: General conversation
```bash
LORA_BASE_MODEL=openai/gpt-oss-20b
```

**Qwen3-Coder-30B**
- Size: 30B parameters
- VRAM: ~22GB (4-bit)
- Best for: Coding tasks
```bash
LORA_BASE_MODEL=unsloth/Qwen3-Coder-30B-A3B-Instruct
```

**Custom models:**
```bash
# Set in .env or pass as argument
export LORA_BASE_MODEL="your/model-name"
./bin/mh-train-local "your/model-name"
```

---

## Training Pipeline

Both methods follow the same pipeline:

```
1. Dataset Builder
   ↓ (generates training pairs from memories)
2. Data Cleaning
   ↓ (removes duplicates, validates format)
3. Training
   ↓ (LoRA fine-tuning, 2 epochs)
4. GGUF Conversion
   ↓ (merges adapter, quantizes to Q4_K_M)
5. Evaluation
   ↓ (validates quality)
6. Activation
   ↓ (creates Ollama model)
7. Auto-switch
   └→ (updates etc/agent.json)
```

---

## Troubleshooting

### Local Training

**GPU out of memory:**
```bash
# Reduce batch size in training config
# Edit: metahuman-runs/YYYY-MM-DD/config.json
{
  "per_device_train_batch_size": 1,  # Already minimum
  "gradient_accumulation_steps": 8   # Reduce from 16
}
```

**Unsloth import error:**
```bash
# Reinstall with correct CUDA version
pip uninstall unsloth
pip install "unsloth[cu121-torch220] @ git+https://github.com/unslothai/unsloth.git"
```

**Model download stalls:**
```bash
# HuggingFace token may be required for some models
export HF_TOKEN=your_token_here
```

### Remote Training

**RunPod connection failed:**
```bash
# Check API key
echo $RUNPOD_API_KEY

# Verify template
./bin/mh adapter list
```

**SSH timeout:**
- Pod is starting up (wait 2-5 minutes)
- Check RunPod dashboard for pod status

**Upload failed:**
- Network issue - script will retry automatically
- If persists, check firewall/VPN settings

---

## Output Files

Both methods produce:

```
out/adapters/YYYY-MM-DD/
├── adapter/                     # LoRA adapter weights
│   ├── adapter_model.safetensors
│   ├── adapter_config.json
│   └── ...
├── adapter.gguf                 # Merged GGUF (ready for Ollama)
├── Modelfile                    # Ollama model definition
└── eval.json                    # Evaluation results
```

---

## Advanced Usage

### Custom Training Config

Edit before training:
```bash
# Edit config template in full-cycle.ts or full-cycle-local.ts
{
  "base_model": "openai/gpt-oss-20b",
  "lora_rank": 8,              # Higher = more parameters (8-64)
  "num_train_epochs": 2,       # More = better fit (1-5)
  "learning_rate": 0.0002,
  "per_device_train_batch_size": 1,
  "gradient_accumulation_steps": 16,
  "max_seq_length": 2048       # Context window
}
```

### Manual Training

If you want more control:

```bash
# 1. Build dataset
npx tsx brain/agents/adapter-builder.ts

# 2. Run training manually
python3 docker/runpod-trainer/train_unsloth.py \
  --data metahuman-runs/YYYY-MM-DD/unsloth_dataset.jsonl \
  --config metahuman-runs/YYYY-MM-DD/config.json \
  --output out/adapters/YYYY-MM-DD/adapter

# 3. Create Ollama model
ollama create my-model -f out/adapters/YYYY-MM-DD/Modelfile
```

---

## Best Practices

1. **Train regularly** - Weekly training captures your latest thinking
2. **Review dataset** - Check `instructions.jsonl` before training
3. **Monitor quality** - Check `eval.json` scores (>0.7 is good)
4. **Compare models** - Test both GPT-OSS and Qwen3-Coder
5. **Backup adapters** - Keep historical versions in `out/adapters/`

---

## FAQ

**Q: Which training method should I use?**
A: Remote (RunPod) if you want fastest/easiest. Local if you have a good GPU and want privacy/control.

**Q: How much does remote training cost?**
A: ~$0.50-1.00 per run (20-30 minutes on RTX 5090)

**Q: Can I train without a GPU?**
A: No, LoRA training requires a GPU. Use remote training instead.

**Q: How long does training take?**
A: Remote: 20-30 min. Local: 20-30 min (after first download)

**Q: Will this overwrite my current model?**
A: Yes, `etc/agent.json` is automatically updated to use the new model. Old models remain available.

**Q: Can I switch back to a previous model?**
A: Yes, edit `etc/agent.json` to point to any model in `ollama list`
