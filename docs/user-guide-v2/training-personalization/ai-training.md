# AI Training

Train custom AI models to make MetaHuman think, speak, and reason like you. MetaHuman OS uses LoRA (Low-Rank Adaptation) adapters to personalize large language models with your personality, memories, and communication patterns.

## Overview

AI training creates personalized language models from your:
- **Episodic memories** - Conversations and observations
- **Persona data** - Values, goals, communication style
- **Therapy sessions** - Persona Generator interviews
- **Cognitive mode data** - Differentiated by mode (Dual/Agent/Emulation)

**Training Methods:**
- **Local LoRA** - Train on your own GPU (NVIDIA, 24GB+ VRAM)
- **Remote LoRA** - Train on RunPod cloud GPU (pay-per-use)
- **Fine-Tuning** - Full model fine-tuning (advanced, resource-intensive)

**Dual-Adapter System:**
- **Historical adapter** - Consolidated long-term memory (all past training)
- **Recent adapter** - Last 30 days of fresh data
- **Automatic merging** - Both adapters loaded simultaneously for balanced personality

## When to Train

### First Training
- After using MetaHuman for 2-4 weeks
- Once you have 100+ memories (conversations, observations)
- After completing Persona Generator interview

### Regular Training
- **Monthly** - Recommended for active users (enabled by default in `etc/training.json`)
- **Quarterly** - Minimum for less active users
- **After major changes** - New goals, values, or life events

### Training Triggers
- Accumulated 500+ new memories since last training
- Persona significantly updated
- Communication style has evolved
- Want to capture new patterns or preferences

## Accessing AI Training

### Via Web UI (Training Wizard)

1. Navigate to **AI Training** in the left sidebar
2. Click **"Launch Training Wizard"**
3. Follow 5-step guided process

### Via CLI

```bash
# Local LoRA training
./bin/mh agent run full-cycle-local --username <your-username>

# Remote LoRA training (RunPod)
./bin/mh agent run full-cycle --username <your-username>
```

## Training Wizard (Web UI)

The Training Wizard guides you through the entire process:

### Step 1: Choose Training Method

**Local LoRA**
- **Requirements**: NVIDIA GPU with 24GB+ VRAM
- **Cost**: Free (uses your hardware)
- **Time**: 30-60 minutes
- **Best for**: Users with capable GPUs, privacy-conscious
- **Models supported**: Qwen3-14B, Llama-3.1-20B

**Remote LoRA (RunPod)**
- **Requirements**: RunPod API key
- **Cost**: ~$0.50-$2.00 per training run
- **Time**: 20-40 minutes
- **Best for**: Users without GPU, one-time training
- **GPU types**: H100, A100, RTX 4090

**Fine-Tuning**
- **Requirements**: High-end GPU (40GB+ VRAM) or RunPod
- **Cost**: $5-15 per run (RunPod)
- **Time**: 2-4 hours
- **Best for**: Advanced users wanting maximum quality
- **Models supported**: Qwen3-30B-Instruct

### Step 2: Configure RunPod (if Remote)

**First-time Setup:**
1. Sign up at [runpod.io](https://runpod.io)
2. Generate API key in RunPod dashboard
3. Enter API key in wizard
4. Select GPU type (H100 recommended)

**Wizard Auto-Configuration:**
- Saves RunPod credentials to `profiles/<username>/etc/runpod.json`
- Validates API key before proceeding
- Estimates cost based on GPU selection

**Template:**
- Uses pre-configured `metahuman-runpod-trainer` template
- Includes all dependencies (Unsloth, Python packages)
- Auto-destroys pod after training completes

### Step 3: Review Dataset

The wizard analyzes your data and shows:

**Dataset Statistics:**
```
Total Memories: 1,247
├─ Episodic Memories: 892
├─ Therapy Sessions: 3
├─ Chat Conversations: 340
└─ Recent Memories (30 days): 287

Cognitive Mode Distribution:
├─ Dual: 456 (51%)
├─ Agent: 189 (21%)
└─ Emulation: 247 (28%)

Estimated Training Samples: 2,847
Oldest Memory: 2024-03-15
Newest Memory: 2025-11-25
```

**Quality Indicators:**
- ✅ Sufficient memories (100+ minimum)
- ✅ Diverse content (conversations + observations + interviews)
- ✅ Recent activity (last 30 days)
- ⚠️ Warnings if dataset is small or stale

### Step 4: Training Configuration

**Basic Settings:**
- **Base Model**: Which model to fine-tune
  - `unsloth/Qwen3-14B` (LoRA default, balanced)
  - `unsloth/Qwen3-30B-Instruct` (Fine-tune, higher quality)
- **Training Epochs**: 3 (LoRA) or 2 (Fine-tune)
- **Max Samples**: 3000 (LoRA) or 5000 (Fine-tune)

**Monthly Training Mode** (enabled by default):
- **Days Recent**: 30 - Use last 30 days for recent adapter
- **Old Samples**: 3000 - Max samples from history for historical adapter
- **Creates dual-adapter**: Both historical + recent trained separately

**Advanced Settings:**
- **LoRA Rank**: 8 (default), higher = more capacity
- **Learning Rate**: 0.0002 (2e-4 for LoRA), 0.00002 (2e-5 for fine-tuning)
- **Batch Size**: 1 (LoRA), 4 (fine-tuning)
- **Gradient Accumulation Steps**: 16 (LoRA), 8 (fine-tuning)
- **Max Sequence Length**: 2048 (~1500 words)

**Optional Features:**
- **Enable S3 Upload**: Upload model to S3 after training (if configured)
- **Enable Preprocessing**: Curate dataset before training (recommended)

**Configuration File**: All settings saved to `etc/training.json`

### Step 5: Launch Training

**Pre-flight Checks:**
1. Dataset validated
2. GPU availability confirmed (local) or RunPod ready (remote)
3. Configuration reviewed
4. Disk space verified (need ~10GB free)

**Click "Start Training"**

**Training Process Begins:**

```
🚀 Training Launched
├─ Run ID: 2025-11-25-143022
├─ Method: local-lora (dual-adapter)
├─ PID: 123456
└─ Logs streaming...
```

## Training Process (Behind the Scenes)

### 1. Dataset Building

**Curator Agent** (`curator.ts`):
- Reads episodic memories from `profiles/<username>/memory/episodic/`
- Filters by date range (30 days for recent, all for historical)
- Extracts conversation pairs
- Assigns confidence scores based on:
  - Message clarity
  - Persona relevance
  - Conversation coherence
  - Cognitive mode appropriateness

**Schema Application** (`schema-manager.ts`):
- Converts memories to training format
- Applies persona context (identity, values, goals)
- Formats as instruction-response pairs
- Tags with cognitive mode metadata

**Output:**
```
profiles/<username>/out/adapters/2025-11-25/
├── recent/
│   └── instructions.jsonl       # Recent 30 days
├── historical/
│   └── instructions.jsonl       # All past data
└── metadata.json
```

**Sample Format:**
```json
{
  "instruction": "What are your thoughts on AI safety?",
  "response": "I believe AI safety is crucial. As someone who values transparency and ethical development, I think we need robust testing, clear guidelines, and ongoing oversight.",
  "metadata": {
    "cognitiveMode": "dual",
    "confidence": 0.89,
    "timestamp": "2025-11-20T14:30:00Z"
  }
}
```

### 2. Optional Auto-Approval

**Auto-Approver Agent** (`auto-approver.ts`):
- Reviews dataset quality automatically
- Checks thresholds:
  - Minimum pairs: 50
  - Minimum high-confidence: 70%
  - Minimum reflection percentage: 10%
  - Maximum low-confidence: 15%
- **Dry run mode**: Preview without approving
- **Real mode**: Auto-approves if quality passes

**Configuration**: `profiles/<username>/etc/auto-approval.json`

**Approval File**: `out/adapters/2025-11-25/approved.json`

### 3. LoRA Training

**Adapter Builder** (`adapter-builder.ts`):
- Uses Unsloth for efficient LoRA training
- Trains on GPU (local or RunPod)
- Creates separate adapters for historical and recent data
- Saves checkpoints every 50 epochs

**Training Script**: `external/train_unsloth.py`

**Progress Monitoring:**
```
[Epoch 1/3] Loss: 0.8234 | LR: 2e-4
[Epoch 2/3] Loss: 0.3421 | LR: 2e-4
[Epoch 3/3] Loss: 0.1567 | LR: 2e-4
Training complete! Adapter saved.
```

**Output:**
```
out/adapters/2025-11-25/
├── recent/
│   ├── adapter_model.safetensors
│   └── adapter_config.json
└── historical/
    ├── adapter_model.safetensors
    └── adapter_config.json
```

### 4. Adapter Merging

**Adapter Merger** (`adapter-merger.ts`):
- Merges historical and recent adapters
- Creates consolidated base model
- Preserves both adapters for dual-loading

**Historical Merge** (one-time):
- Merges all past adapters into `history-merged.gguf`
- Only runs if historical adapter changed
- Saves merged GGUF to `out/adapters/_history/`

**Dual-Adapter Setup**:
- Historical: `_history/history-merged.gguf`
- Recent: `2025-11-25/adapter.gguf`
- Both loaded simultaneously by Ollama

### 5. GGUF Conversion

**GGUF Converter** (`gguf-converter.ts`):
- Converts safetensors adapters to GGUF format
- Creates Ollama Modelfile
- Quantizes to Q4_K_M (balanced quality/size)

**Modelfile Example:**
```
FROM unsloth/Qwen3-14B
ADAPTER ./adapter.gguf
PARAMETER temperature 0.7
PARAMETER top_p 0.9
```

**Output:**
```
out/adapters/2025-11-25/
├── adapter.gguf                 # Recent adapter
├── Modelfile                    # Ollama config
└── model_info.json              # Metadata
```

### 6. Model Activation

**Set Active Adapter** (`adapters.ts`):
- Registers new adapter as active
- Updates `etc/active-adapter.json`:

```json
{
  "modelName": "greggles-dual-2025-11-25",
  "activatedAt": "2025-11-25T14:30:00Z",
  "isDualAdapter": true,
  "adapters": {
    "historical": "out/adapters/_history/history-merged.gguf",
    "recent": "out/adapters/2025-11-25/adapter.gguf"
  },
  "baseModel": "unsloth/Qwen3-14B",
  "trainingMethod": "local-lora",
  "runLabel": "monthly-2025-11-25"
}
```

**Ollama Boot Message**:
```
[llm] Using adapter: greggles-dual-2025-11-25
  ├─ Historical: _history/history-merged.gguf
  └─ Recent: 2025-11-25/adapter.gguf
```

### 7. Cleanup

**Training Cleanup** (`training-cleanup.ts`):
- Removes temporary files
- Compresses logs
- Deletes intermediate artifacts
- Keeps only final adapters and metadata

## Monitoring Training

### Live Log Streaming

**Console Logs** (technical):
```
[curator] Processing 1,247 memories...
[curator] Filtered to 2,847 training pairs
[curator] Average confidence: 0.82
[adapter-builder] Starting LoRA training...
[adapter-builder] Epoch 1/3: Loss 0.8234
[adapter-builder] Epoch 2/3: Loss 0.3421
[adapter-builder] Epoch 3/3: Loss 0.1567
[gguf-converter] Converting to GGUF format...
[full-cycle-local] ✓ Training complete!
```

**Event Stream** (user-friendly):
```
📊 Dataset prepared: 2,847 samples
🧠 Historical adapter: Training...
⏱️ ETA: 25 minutes
✅ Historical adapter: Complete
🔄 Recent adapter: Training...
⏱️ ETA: 15 minutes
✅ Recent adapter: Complete
🔗 Merging adapters...
✅ Model activated: greggles-dual-2025-11-25
```

### Training UI

**Progress Display:**
- Real-time progress bar (0-100%)
- Current step indicator
- Estimated time remaining
- Live log tail (last 50 lines)

**Cancellation:**
- Click **"Cancel Training"** button
- Gracefully stops processes
- Cleans up partial files
- Preserves previous working adapter

## Training Storage Structure

All training data is stored per-user:

```
profiles/<username>/out/adapters/
├── 2025-11-25/                  # Latest training run
│   ├── recent/
│   │   ├── instructions.jsonl   # Recent dataset
│   │   ├── adapter_model.safetensors
│   │   └── adapter_config.json
│   ├── historical/
│   │   ├── instructions.jsonl   # Historical dataset
│   │   ├── adapter_model.safetensors
│   │   └── adapter_config.json
│   ├── adapter.gguf             # Recent GGUF
│   ├── Modelfile
│   ├── metadata.json
│   ├── approved.json
│   └── eval.json
├── 2025-10-25/                  # Previous run
├── 2025-09-25/                  # Older run
└── _history/
    └── history-merged.gguf      # Consolidated historical
```

## Configuration Files

### Main Training Config

**Location**: `etc/training.json`

```json
{
  "base_model": "unsloth/Qwen3-14B",
  "num_train_epochs": 3,
  "max_samples": 3000,
  "monthly_training": true,
  "days_recent": 30,
  "old_samples": 3000,
  "lora_rank": 8,
  "learning_rate": 0.0002,
  "per_device_train_batch_size": 1,
  "gradient_accumulation_steps": 16,
  "max_seq_length": 2048
}
```

**Environment Override**:
```bash
# Use different base model
export METAHUMAN_BASE_MODEL="unsloth/Qwen3-30B-Instruct"
```

### Auto-Approval Config

**Location**: `profiles/<username>/etc/auto-approval.json`

```json
{
  "enabled": true,
  "dryRun": false,
  "thresholds": {
    "minPairs": 50,
    "minHighConfidence": 0.7,
    "minReflectionPct": 0.1,
    "maxLowConfidence": 0.15
  },
  "alertEmail": null
}
```

### RunPod Config

**Location**: `profiles/<username>/etc/runpod.json`

```json
{
  "apiKey": "RUNPOD_API_KEY_HERE",
  "templateId": "metahuman-runpod-trainer",
  "gpuType": "NVIDIA H100 PCIe",
  "costEstimate": "$1.50"
}
```

## Dual-Adapter System Explained

### Why Two Adapters?

**Historical Adapter:**
- Captures entire personality history
- Stable, well-established patterns
- All memories ever collected
- Merged incrementally (only updates when historical data changes)

**Recent Adapter:**
- Fresh, current data (last 30 days)
- Captures recent shifts and new patterns
- Trained every month
- Replaces previous recent adapter

**Combined Loading:**
- Ollama loads both adapters simultaneously
- Historical provides foundation
- Recent adds current context
- Balanced personality: stable + adaptive

### Adapter Lifecycle

**First Training:**
1. Collect 100+ memories
2. Train initial adapter
3. Both historical and recent are the same

**Second Training (30 days later):**
1. Historical: Use previous adapter as base, merge with new data
2. Recent: Train fresh on last 30 days
3. Now using dual-adapter system

**Third Training (60 days later):**
1. Historical: Merge previous historical + previous recent
2. Recent: Train fresh on last 30 days
3. Consolidated history grows, recent stays fresh

## Best Practices

### Data Collection

1. **Quantity**: Aim for 100+ memories before first training
2. **Quality**: Use persona generator for rich interview data
3. **Diversity**: Mix conversations, observations, reflections
4. **Cognitive modes**: Use Dual mode for training data (richer context)
5. **Regular updates**: Add memories daily, train monthly

### Training Frequency

- **Active users**: Monthly (automated if `monthly_training: true`)
- **Moderate users**: Quarterly
- **Light users**: When you have 500+ new memories
- **After major changes**: Immediately after personality updates

### GPU Requirements

**Local Training:**
- LoRA (14B model): 24GB VRAM
- LoRA (20B model): 32GB VRAM
- Fine-Tuning (30B model): 40GB+ VRAM

**RunPod Recommendations:**
- H100: Best performance, ~$2/hour
- A100: Good balance, ~$1.50/hour
- RTX 4090: Budget option, ~$0.50/hour

### Quality Optimization

1. **Clean data**: Review memories, delete low-quality entries
2. **Persona accuracy**: Keep persona up to date
3. **Confidence thresholds**: Adjust in auto-approval config
4. **Training epochs**: 2-3 for LoRA, 1-2 for fine-tuning
5. **Evaluation**: Test adapter after training, verify responses

## Troubleshooting

### Training Fails to Start
- Check GPU availability: `nvidia-smi` (local)
- Verify RunPod API key (remote)
- Check disk space (need 10GB+ free)
- Review training logs for specific error

### Poor Model Quality
- Need more training data (100+ memories minimum)
- Increase training epochs (3-5 for LoRA)
- Adjust learning rate (try 0.0001 or 0.0003)
- Review dataset quality (low confidence samples)
- Ensure persona is accurate

### Out of Memory (OOM)
- Reduce batch size to 1
- Reduce gradient accumulation steps
- Use smaller base model (7B instead of 14B)
- Use RunPod with larger GPU

### Training Stuck/Frozen
- Check GPU temperature (may be throttling)
- Kill stuck processes: `./bin/mh agent ps` then kill PID
- Check training logs for last activity
- Restart with fresh run

## Next Steps

- Configure [Cognitive Modes](cognitive-modes.md) to use your trained adapter
- Use trained model in [Chat Interface](../using-metahuman/chat-interface.md)
- Monitor adapter quality in [Dashboard](../using-metahuman/dashboard-monitoring.md)
- Combine with [Voice Training](voice-training.md) for complete personalization
