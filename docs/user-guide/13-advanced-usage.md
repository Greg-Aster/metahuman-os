## Advanced Usage

### Running Agents as Background Services

You can run multiple agents simultaneously in different terminals:

**Terminal 1:**
```bash
./bin/mh agent run organizer
```

**Terminal 2:**
```bash
./bin/mh agent run boredom-service
```

**Terminal 3:**
```bash
./bin/mh agent run sleep-service
```

### Customizing Reflection Frequency

Edit `etc/boredom.json` to change intervals:
```json
{
  "level": "custom",
  "intervals": {
    "custom": 120  // Reflect every 2 minutes
  }
}
```

Then set level to `custom` via CLI or Web UI.

### YOLO Mode (Experimental)

Enable the **YOLO** toggle in the chat sidebar to loosen planner and executor safeguards. In this mode the operator skips some ID validations and may act with higher autonomy, so review the audit log (`logs/audit/`) after risky runs. Disable the switch to return to the default strict behavior.

### Batch Importing Memories

1. Place text files or JSON files in `memory/inbox/`
2. Run:
   ```bash
   ./bin/mh agent run ingestor
   ```
3. Check `logs/audit/` to verify import
4. Processed files moved to `memory/inbox/_archive/`

### Viewing Agent Statistics

```bash
./bin/mh agent status organizer
```

Shows:
- Total runs
- Successes / failures
- Success rate
- Recent log entries

### Monitoring Processing Status

```bash
./bin/mh agent monitor
```

Shows how many memories are:
- Total memories
- Processed (have tags/entities)
- Unprocessed (awaiting organizer)

### Configuring the ReasoningEngine

The **Operator** agent uses a multi-step reasoning system based on the ReAct pattern (Reason-Act-Observe). You can control which implementation is used via `etc/runtime.json`.

#### Reasoning Implementations

| Implementation | Description | Status |
|----------------|-------------|--------|
| **V1 Legacy** | Original operator (deprecated) | Not recommended |
| **V2 Inline** | ReAct loop with inline code | Default, stable |
| **V2 Service** | Unified ReasoningEngine service | Recommended |

#### Enabling ReasoningEngine Service

**Step 1:** Edit `etc/runtime.json`:
```json
{
  "operator": {
    "reactV2": true,
    "useReasoningService": true
  }
}
```

**Step 2:** Restart web UI (if running):
```bash
cd apps/site && pnpm dev
```

**Step 3:** Verify in audit logs:
```bash
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep operator_feature_flag
```

You should see:
```json
{
  "event": "operator_feature_flag_check",
  "details": {
    "useV2": true,
    "useService": true
  }
}
```

#### Benefits of ReasoningEngine Service

1. **Enhanced Error Recovery**: 7 error types with contextual suggestions
   ```
   FILE_NOT_FOUND → "Use fs_list to check what files exist in the directory"
   TASK_NOT_FOUND → "Use task_list to see available tasks"
   PERMISSION_DENIED → "Check file permissions with fs_list"
   ```

2. **Failure Loop Detection**: Prevents repeated failures
   ```
   Attempt 1: fs_read({ path: "/missing.txt" }) → Error
   Attempt 2: fs_read({ path: "/missing.txt" }) → Error
   Attempt 3: ⚠️ Loop detected! "This action has already failed 2 times..."
   ```

3. **Structured Event Streaming**: Better UI observability
   - Reasoning slider shows step-by-step progress
   - Dual event formats for backward compatibility
   - Full scratchpad history

4. **Reasoning Depth Levels**: Control complexity

   | Level | Name | Steps | Use Case |
   |-------|------|-------|----------|
   | 0 | Off | 1 | Direct execution |
   | 1 | Quick | 5 | Simple tasks |
   | 2 | Focused | 10 | Multi-step (default) |
   | 3 | Deep | 15 | Complex problems |

#### Testing ReasoningEngine

**Test 1: Simple Query (Fast-Path)**
```
User: "List my tasks"

Expected: Fast-path short-circuit, direct skill execution
Audit Event: verbatim_short_circuit
```

**Test 2: Multi-Step Reasoning**
```
User: "Create a task to review the docs and mark it as high priority"

Expected:
  Thought 1: Need to create task with task_create
  Action 1: task_create({ title: "Review the docs", priority: "high" })
  Observation 1: ✅ Task created (ID: task-123)
  Thought 2: Task created successfully
  Response: Created task "Review the docs" with high priority (ID: task-123)
```

**Test 3: Error Recovery**
```
User: "Read the file missing.txt"

Expected:
  Thought 1: Need to read missing.txt
  Action 1: fs_read({ path: "missing.txt" })
  Observation 1: ❌ FILE_NOT_FOUND
    Suggestions:
    - Use fs_list to check what files exist
    - Verify the file path is correct
  Thought 2: File doesn't exist, inform user with suggestions
  Response: File not found. Would you like me to list available files?
```

#### Rollback to Inline V2

If you encounter issues, rollback instantly:

```json
{
  "operator": {
    "reactV2": true,
    "useReasoningService": false
  }
}
```

No code changes needed—the feature flag controls routing.

#### Observing Reasoning Events

**Via Web UI:**
1. Open chat interface
2. Look for "reasoning slider" panel
3. Watch events stream in real-time:
   - 💭 Thought: Blue text
   - ⚡ Action: Yellow text
   - 👁️ Observation: Green text
   - ✅ Completion: Purple text

**Via Audit Logs:**
```bash
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep reasoning
```

Events:
- `reasoning_loop_started` - Reasoning loop begins
- `reasoning_thought` - Planning step
- `reasoning_action` - Skill execution
- `reasoning_observation` - Result processing
- `reasoning_completion` - Final response
- `reasoning_loop_completed` - Loop ends with metadata

#### Performance Characteristics

**V2 Inline vs. Service:**
- ✅ **Same performance** - Service is extracted code, not extra overhead
- ✅ **Same LLM calls** - No additional model invocations
- ✅ **Better observability** - Structured events, clearer logs
- ✅ **Easier debugging** - Scratchpad shows complete reasoning history

**Fast-Path Optimization:**
- Simple queries bypass reasoning loop
- Direct skill execution in <100ms
- Example: "list tasks" → task_list() → response
- Audit event: `verbatim_short_circuit`

#### Configuration Reference

**Full Configuration (`etc/runtime.json`):**
```json
{
  "headless": false,
  "operator": {
    "reactV2": true,
    "useReasoningService": false
  }
}
```

**ReasoningEngine Config (programmatic):**
```typescript
import { ReasoningEngine } from '@metahuman/core/reasoning';

const engine = new ReasoningEngine({
  depth: 'focused',              // 'off' | 'quick' | 'focused' | 'deep'
  maxSteps: 10,                  // Override depth default
  enableFastPath: true,          // Enable fast-path optimizations
  enableVerbatimShortCircuit: true, // Short-circuit simple queries
  enableErrorRetry: true,        // Enable error analysis & suggestions
  enableFailureLoopDetection: true, // Prevent repeated failures
  sessionId: 'session-123',
  userId: 'user-456',
});

const result = await engine.run(
  'List my tasks',
  { memories: [], conversationHistory: [] },
  (event) => console.log(event) // Progress callback
);
```

**Related Documentation:**
- [Core Concepts - ReasoningEngine](04-core-concepts.md#3a-reasoningengine-operator)
- [Configuration Files - runtime.json](14-configuration-files.md#etcruntimejson---runtime-feature-flags)
- Implementation Status: `docs/implementation-plans/reasoning-service-consolidation-STATUS.md`

### LoRA Training Workflow Testing
Try this comprehensive test sequence:

1. **Test file listing:**
   ```
   "List all markdown files in docs/"
   ```

2. **Test reading:**
   ```
   "Read the README.md file"
   ```

3. **Test writing:**
   ```
   "Create a file out/test.txt containing 'MetaHuman Operator Test'"
   ```

4. **Test deletion:**
   ```
   "Delete out/test.txt"
   ```

5. **Test git:**
   ```
   "Show me the git status"
   ```

6. **Test memory search:**
   ```
   "Search my memories for the word 'operator'"
   ```

7. **Test web search:**
   ```
   "Search the web for AI agent architectures"
   ```

8. **Test multi-step:**
   ```
   "List markdown files in docs/, read the first one, and create a summary in out/doc-summary.txt"
   ```

### Emergency Controls for LoRA
- Delete `persona/overrides/active-adapter.json` → instant base model fallback
- Set `etc/auto-approval.json` → `enabled: false` → disable automation
- Set `etc/sleep.json` → `adapters.lora: false` → stop dataset generation

### Check Audit Logs
```bash
# View today's events
cat logs/audit/$(date +%Y-%m-%d).ndjson | jq -r '.event'

# Filter LoRA events
grep "lora_" logs/audit/$(date +%Y-%m-%d).ndjson | jq .

# Check auto-approval decisions
grep "lora_dataset_auto" logs/audit/$(date +%Y-%m-%d).ndjson | jq .
```

### Emergency Rollback
```bash
# Disable adapter immediately
rm persona/overrides/active-adapter.json

# Stop automation
vim etc/auto-approval.json  # Set enabled: false
vim etc/sleep.json           # Set adapters.lora: false

# Restart chat service
cd apps/site && pnpm dev
```

### File Operations API

MetaHuman OS provides a dedicated REST API for creating, reading, and managing files programmatically. This API integrates with the skills system to provide secure, trust-aware file operations.

#### Endpoints

**POST `/api/file_operations`** - Create or read files

**Request Body:**
```json
{
  "action": "create|read|write",
  "filename": "string",
  "content": "string (required for create/write)",
  "overwrite": "boolean (optional)"
}
```

**Actions:**
- `create` or `write`: Create new file or overwrite existing
- `read`: Read contents of existing file

**Success Response:**
```json
{
  "success": true,
  "message": "Successfully created file \"example.txt\"",
  "path": "/absolute/path/to/file"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message"
}
```

**GET `/api/file_operations?action=status`** - Get system status

**Response:**
```json
{
  "status": "online",
  "trustLevel": "supervised_auto",
  "canWrite": true,
  "canRead": true,
  "basePath": "/home/user/metahuman/out"
}
```

#### Usage Examples

**Create a file:**
```bash
curl -X POST http://localhost:4321/api/file_operations \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "filename": "example.txt",
    "content": "This is an example file created through the API!"
  }'
```

**Read a file:**
```bash
curl -X POST http://localhost:4321/api/file_operations \
  -H "Content-Type: application/json" \
  -d '{
    "action": "read",
    "filename": "example.txt"
  }'
```

**Check system status:**
```bash
curl http://localhost:4321/api/file_operations?action=status
```

#### Security Features

1. **Trust Level Validation**: Operations only performed at appropriate trust levels
2. **Skill Availability Checking**: Verifies required skills are available
3. **Safe Path Handling**: All operations restricted to `out/` directory
4. **Input Validation**: All parameters validated before processing
5. **Auto-Approval**: Automatically approves API-initiated operations

#### File Storage Location

All files created through this API are stored in:
```
/home/user/metahuman/out/
```

This ensures isolation from sensitive system files and persona data.

#### Integration with Skills System

The API uses the following skills:
- **fs_write**: Creating and writing files
- **fs_read**: Reading file contents
- **Trust-aware execution**: Respects current trust levels
- **Auto-approval**: Automatically approves trusted operations

#### Error Handling

Clear error messages for:
- Missing required parameters
- Invalid action types
- Insufficient trust level
- Unavailable skills
- File system errors
- Invalid file paths

#### Common Issues

**Permission Denied:**
- Ensure MetaHuman OS has write permissions for `out/` directory
- Check: `ls -la out/`

**Skill Unavailable:**
- Verify trust level allows file operations
- Check status: `curl http://localhost:4321/api/file_operations?action=status`

**Invalid Filename:**
- Filenames are sanitized to prevent path traversal attacks
- Use simple names without `..`, `/`, or special characters

#### Future Enhancements

Planned improvements:
- File listing capabilities
- File deletion support
- Directory operations
- File metadata retrieval
- Batch operations
- File search functionality

### Performance Characteristics
- **Tier-1 (Prompt Adaptation)**: Activation time 1-2 seconds, chat latency +0ms, memory +10KB
- **Tier-2 (LoRA Adaptation)**: Dataset generation 5-30 seconds, training 10-60 minutes, activation 5-30 seconds, chat latency +0-500ms
- **Automation Overhead**: Auto-approval <1 second, nightly pipeline +30-90 seconds total, no impact on interactive performance

### Remote LoRA Training with RunPod

MetaHuman OS supports fully automated remote LoRA training on cloud GPU providers like RunPod. This workflow allows you to prepare datasets locally, train on powerful remote GPUs (e.g., RTX 5090), and automatically retrieve the trained adapter—all orchestrated by the system.

#### Overview: Full Cycle Remote Training

The remote training workflow (`FULL_CYCLE_REMOTE_TRAIN`) automates the entire process:

1. **Build dataset locally** using `adapter-builder.ts`
2. **Launch RunPod GPU pod** with Unsloth trainer image
3. **Send dataset + config** to the pod via SSH/SCP
4. **Run training remotely** on high-end GPU
5. **Download trained adapter** back to local system
6. **Integrate into pipeline** (merge, convert to GGUF, activate)
7. **Shut down pod** to stop billing

This approach combines local-first data preparation with cloud GPU power for training, then brings everything back for local inference.

#### Prerequisites

Before using remote training, ensure you have:

1. **RunPod Account & API Key**: Sign up at runpod.io and generate an API key
2. **SSH Key Pair**: Create and register your public key with RunPod
3. **Docker Image**: Build and push the Unsloth trainer image to a registry
4. **RunPod Template**: Create a template using your Docker image (get template ID)

**Environment Setup:**

```bash
# Required environment variables
export RUNPOD_API_KEY="your-api-key-here"
export RUNPOD_TEMPLATE_ID="pzr9tt3vvq"  # Your template ID
export SSH_KEY_PATH="$HOME/.ssh/runpod_key"
```

#### Directory Structure Contract

Remote training follows a strict directory layout:

```
/home/greggles/metahuman/
├── out/adapters/<DATE_STR>/
│   ├── <DATE_STR>.jsonl          # Raw dataset from adapter-builder
│   └── adapter/                   # Downloaded trained adapter
│       ├── adapter_model.safetensors
│       └── adapter_config.json
└── metahuman-runs/<DATE_STR>/
    ├── unsloth_dataset.jsonl      # Cleaned dataset
    ├── config.json                # Training hyperparameters
    └── run-summary.json           # Execution audit trail
```

**Rules:**
- `DATE_STR` format: `YYYY-MM-DD` (e.g., `2025-10-24`)
- All steps must use these exact paths
- Each training run is immutable (never overwrite previous runs)

#### Step-by-Step Workflow

**Step 0: Define Runtime Variables**

```bash
DATE_STR="2025-10-24"  # Today's date
PROJECT_ROOT="/home/greggles/metahuman"
OUT_ROOT="$PROJECT_ROOT/out/adapters/$DATE_STR"
WORK_LOCAL="$PROJECT_ROOT/metahuman-runs/$DATE_STR"

mkdir -p "$WORK_LOCAL"
mkdir -p "$OUT_ROOT/adapter"
```

**Step 1: Prepare Training Data Locally**

Verify raw dataset exists:
```bash
test -s "$OUT_ROOT/$DATE_STR.jsonl" || echo "ERROR: Raw dataset missing"
```

Clean dataset for Unsloth (keep only required fields):
```bash
jq -c '{instruction, input, output}' "$OUT_ROOT/$DATE_STR.jsonl" \
  | jq -c 'select(.instruction and .output)' \
  > "$WORK_LOCAL/unsloth_dataset.jsonl"

# Count samples
wc -l "$WORK_LOCAL/unsloth_dataset.jsonl"
```

**Step 2: Write Training Config**

Create `$WORK_LOCAL/config.json`:
```json
{
  "base_model": "Qwen/Qwen3-30B-Instruct",
  "lora_rank": 8,
  "num_train_epochs": 2,
  "learning_rate": 0.0002,
  "per_device_train_batch_size": 1,
  "gradient_accumulation_steps": 16,
  "max_seq_length": 2048
}
```

**Key hyperparameters:**
- `per_device_train_batch_size: 1` - Required for 30B models on 32GB VRAM
- `gradient_accumulation_steps: 16` - Simulates larger batch size
- `max_seq_length: 2048` - Conservative to reduce memory usage

**Step 3: Start RunPod Pod**

Use RunPod GraphQL API to create pod:
```bash
CREATE_RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"mutation { podCreate(input: { templateId: \\\"$RUNPOD_TEMPLATE_ID\\\" }) { id } }\"}")

POD_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.podCreate.id')
```

Poll for pod status until RUNNING and extract SSH endpoint:
```bash
# Poll every 10 seconds until pod is ready
while true; do
  STATUS=$(curl -s -X POST "https://api.runpod.io/graphql" \
    -H "Authorization: Bearer $RUNPOD_API_KEY" \
    -d "{\"query\": \"query { pod(input: { podId: \\\"$POD_ID\\\" }) { runtime { ports } } }\"}")

  POD_IP=$(echo "$STATUS" | jq -r '.data.pod.runtime.ports[0].ip')
  [[ "$POD_IP" != "null" ]] && break
  sleep 10
done
```

**Step 4: Upload Dataset and Config**

Create input directory on pod:
```bash
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
  root@"$POD_IP" "mkdir -p /workspace/input"
```

Upload files:
```bash
scp -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
  "$WORK_LOCAL/unsloth_dataset.jsonl" \
  root@"$POD_IP":/workspace/input/

scp -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
  "$WORK_LOCAL/config.json" \
  root@"$POD_IP":/workspace/input/
```

**Step 5: Run Training on Pod**

Execute training script remotely:
```bash
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
  root@"$POD_IP" \
  "source /workspace/unsloth-venv/bin/activate && python /workspace/train_unsloth.py"
```

This step takes 10-60 minutes depending on dataset size and GPU.

**Step 6: Download Merged GGUF File**

Verify the merged GGUF exists on the server:
```bash
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
  root@"$POD_IP" "ls -lh /output/*.gguf"
```

Download the merged GGUF file (this is the primary artifact):
```bash
scp -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
  root@"$POD_IP":/output/greg-$DATE_STR.gguf \
  "$OUT_ROOT/"
```

**Optional:** Also download the raw adapter files (for debugging or manual merging):
```bash
scp -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" -r \
  root@"$POD_IP":/output/adapter/* \
  "$OUT_ROOT/adapter/"
```

**Note:** The GGUF file is the ready-to-use model. The adapter files are only needed if you want to do custom merging or conversion locally.

**Step 7: Terminate Pod**

Stop billing by terminating pod:
```bash
TERMINATE_RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d "{\"query\": \"mutation { podTerminate(input: { podId: \\\"$POD_ID\\\" }) { id status } }\"}")
```

**Step 8: Write Run Summary**

Create audit trail at `$WORK_LOCAL/run-summary.json`:
```json
{
  "date": "2025-10-24",
  "samples_used": 123,
  "base_model": "Qwen/Qwen3-30B-Instruct",
  "pod_id": "abc123",
  "pod_ip": "11.22.33.44",
  "adapter_path": "/home/greggles/metahuman/out/adapters/2025-10-24/adapter/",
  "terminated": true,
  "training_success": true
}
```

#### Post-Processing: GGUF Download (Automatic)

**Important:** The remote training process automatically produces a fully-merged GGUF file on the training server. This file is downloaded directly—no local GGUF conversion is needed for the remote workflow.

**What actually happens:**
1. **On the RunPod server:** Training completes → Adapter is merged with base model → GGUF file is created
2. **Downloaded artifact:** A single, large `.gguf` file (e.g., `greg-2025-10-24.gguf`)
3. **Local activation:** The GGUF is loaded into Ollama with a new modelfile

**Verify the downloaded GGUF:**
```bash
# Check that the GGUF file exists (not just adapter_model.safetensors)
ls -lh out/adapters/$DATE_STR/*.gguf

# Expected: greg-YYYY-MM-DD.gguf (10-30GB depending on base model size)
```

**Load into Ollama:**
```bash
# The full-cycle script does this automatically, but you can manually:
ollama create greg-$DATE_STR -f out/adapters/$DATE_STR/Modelfile

# Set as active model
echo '{"model": "greg-'$DATE_STR'"}' > etc/agent.json
```

**Note:** The old local post-processing steps (gguf-converter.ts, mh adapter merge) are **only for local training workflows**, not remote training. For remote training, the GGUF is pre-built on the server.

#### Training Script Requirements

The Docker image must include `/workspace/train_unsloth.py` with this contract:

**Inputs:**
- `/workspace/input/config.json` - Training hyperparameters
- `/workspace/input/unsloth_dataset.jsonl` - Training data

**Outputs:**
- `/output/greg-YYYY-MM-DD.gguf` - **Primary artifact:** Fully-merged GGUF model ready for Ollama
- `/output/adapter/adapter_model.safetensors` - Raw LoRA weights (optional)
- `/output/adapter/adapter_config.json` - PEFT config (optional)

**Minimal training script:**
```python
import json
from datasets import load_dataset
from unsloth import FastLanguageModel, train

# Read config
cfg = json.load(open("/workspace/input/config.json"))

# Load dataset
dataset = load_dataset("json",
                      data_files="/workspace/input/unsloth_dataset.jsonl",
                      split="train")

# Load model in 4-bit
model, tokenizer = FastLanguageModel.from_pretrained(
    cfg["base_model"],
    load_in_4bit=True,
    use_gradient_checkpointing=True
)

# Format with prompt template
def to_text(ex):
    return {"text": f"""### Instruction:
{ex['instruction']}

### Input:
{ex['input']}

### Response:
{ex['output']}{tokenizer.eos_token}"""}

dataset = dataset.map(to_text)

# Train LoRA
train(
    model=model,
    tokenizer=tokenizer,
    dataset=dataset,
    lora_rank=cfg.get("lora_rank", 8),
    num_train_epochs=cfg.get("num_train_epochs", 2),
    learning_rate=cfg.get("learning_rate", 0.0002),
    per_device_train_batch_size=cfg.get("per_device_train_batch_size", 1),
    gradient_accumulation_steps=cfg.get("gradient_accumulation_steps", 16),
    output_dir="/output/adapter"
)
```

#### Error Handling

**Training fails:**
- Check logs from SSH session output
- Verify dataset format (must have `instruction`, `input`, `output`)
- Ensure GPU has sufficient VRAM (32GB minimum for 30B models)

**Pod termination fails:**
- WARNING: Pod may still be running and billing
- Manually terminate via RunPod dashboard using `POD_ID` from summary

**Download fails:**
- Check `/output/adapter` exists on pod before terminating
- Verify SSH key permissions (chmod 600)
- Try manual SCP with verbose flag: `scp -v ...`

#### Cost Optimization

**GPU Selection:**
- RTX 4090: ~$0.40/hour (24GB VRAM, sufficient for smaller models)
- RTX 5090: ~$0.60/hour (32GB VRAM, recommended for 30B models)
- A100 80GB: ~$1.50/hour (overkill unless training 70B+ models)

**Time Estimates:**
- Dataset prep: 30 seconds (local)
- Pod startup: 1-3 minutes
- Upload: 10 seconds
- Training: 20-60 minutes (depends on dataset size)
- Download: 20 seconds
- Total runtime: ~30-70 minutes = $0.30-0.70 per run

**Tips to reduce costs:**
- Use spot instances (50% cheaper, may be interrupted)
- Train during off-peak hours
- Batch multiple days of data into single training run
- Set aggressive timeout limits in config

#### Automation with Agents

The remote training workflow can be automated via `brain/agents/full-cycle-remote.ts`:

```bash
# Run automated remote training for today
tsx brain/agents/full-cycle-remote.ts $(date +%Y-%m-%d)
```

This agent handles all 8 steps autonomously and reports summary at completion.

---

## Full Fine-Tuning with Monthly Updates

**For more comprehensive documentation, see [Monthly Training Workflow](../monthly-training-workflow.md)**

Unlike LoRA adapters (which only train a small subset of parameters), full fine-tuning trains the entire model, creating a completely personalized version of the base model. MetaHuman OS supports incremental monthly fine-tuning to continuously improve your personality model over time.

### LoRA vs. Full Fine-Tuning

| Aspect | LoRA (Adapters) | Full Fine-Tuning |
|--------|----------------|------------------|
| **Training time** | 30-60 minutes | 1-3 hours |
| **GPU memory** | 16GB (RTX 5090) | 70GB (A100 80GB) |
| **Cost per run** | ~$1.00 | ~$2.00-$3.00 |
| **Model size** | 2GB adapter | 28GB full model |
| **Quality** | Good for style | Excellent for personality |
| **Forgetting** | Low risk | Requires careful strategy |

**When to use full fine-tuning:**
- You want the highest quality personality capture
- You're willing to spend $2-3/month for training
- You have 3,000+ quality samples
- You want a standalone model (not dependent on base model updates)

### Monthly Training Strategy

Full fine-tuning uses a **monthly update** strategy to prevent catastrophic forgetting:

1. **Foundation training** (once): Train on 5,000-10,000 samples to establish baseline personality
2. **Monthly updates**: Mix recent memories (last 30 days) with random old samples (3,000)

This approach:
- ✅ Learns new experiences from recent memories
- ✅ Prevents forgetting by mixing in old memories
- ✅ Reduces training time vs. full dataset retraining
- ✅ Costs only $1.50-$2.00 per month

### Quick Start Commands

**Foundation training** (first time):
```bash
# Wait until you have 3,000+ samples accumulated
find profiles/greggles/memory/episodic -name "*.json" | wc -l

# Run foundation training (one-time)
tsx brain/agents/fine-tune-cycle.ts --username greggles
```

**Monthly updates** (every 4 weeks):
```bash
# Automatic monthly strategy (30 days recent + 3000 old)
tsx brain/agents/fine-tune-cycle.ts --username greggles --monthly
```

**Custom strategy**:
```bash
# 45 days recent + 4000 old samples
tsx brain/agents/fine-tune-cycle.ts --username greggles \
  --days-recent 45 \
  --old-samples 4000

# Bi-weekly updates (14 days + 2000 old)
tsx brain/agents/fine-tune-cycle.ts --username greggles \
  --days-recent 14 \
  --old-samples 2000
```

### Training Pipeline

The full fine-tuning pipeline consists of 6 steps:

1. **Memory Curation**: Load and clean episodic memories
   - Splits by date (recent vs. old)
   - Randomly samples old memories
   - Combines for training dataset

2. **Mode Formatting**: Apply cognitive mode templates
   - Dual mode: `<thought>` / `<world>` tags
   - Emulation mode: Standard chat format
   - Agent mode: Tool invocation format

3. **Schema Application**: Apply model-specific chat template
   - Qwen3: `<|user|>` / `<|assistant|>` format
   - Other models: Configurable templates

4. **JSONL Export**: Convert to training format
   - Validates structure
   - Checks quality metrics
   - Exports to `.jsonl`

5. **RunPod Training**: Execute on cloud GPU
   - Launches A100 80GB pod
   - Uploads dataset + config
   - Runs full fine-tuning script
   - Downloads trained model (~28GB)

6. **Model Registration**: Update model registry
   - Tracks version lineage
   - Sets current_base_model for next run
   - Enables continuous learning

### Configuration Files

**Base config** (`etc/fine-tune-config.json`):
```json
{
  "base_model": "Qwen/Qwen3-14B",
  "training_mode": "full_finetune",
  "learning_rate": 5e-6,
  "num_train_epochs": 3,
  "per_device_train_batch_size": 1,
  "gradient_accumulation_steps": 32,
  "bf16": true,
  "optim": "adafactor"
}
```

**Mode-specific configs** (`etc/modes/dual-config.json`, `emulation-config.json`, `agent-config.json`):
- Override base config for mode-specific training
- Adjust learning rate, warmup steps, etc.
- Use with `--mode <mode>` flag

### Memory Requirements

**14B model on A100 80GB**:
```
Model weights (bf16):        28GB
Gradients (bf16):            28GB
Adafactor optimizer:         14GB
Activations (checkpointed):   5GB
CUDA overhead:                3GB
──────────────────────────────────
Total:                       ~78GB ✓
```

**Why Adafactor is critical**:
- AdamW requires 60GB for optimizer states (total: 116GB ❌)
- Adafactor only needs 14GB (total: 75GB ✓)
- Uses factorized second moments (no full parameter-wise storage)

### Quality Metrics

Before training, the curator reports quality metrics:

```
Quality metrics:
  - Avg assistant length: 43.6 words
  - Short samples (<=40 words): 93%  ⚠️ TOO HIGH
  - Long samples (>100 words): 3%
  - Filler detected: 8.3%
  - Mode distribution:
    - Dual: 65.7%
    - Emulation: 34.3%
    - Agent: 0%
```

**Target metrics**:
- Short samples: <50% (you want variety!)
- Filler detected: <10%
- Mode distribution: 20-40% dual, 40-60% emulation, 10-20% agent

**If you see 93% short samples**: Capture more substantial conversations, not just brief acknowledgments.

### Cost Breakdown

**Foundation training** (5,000 samples):
- GPU time: 2 hours × $1.89/hr = $3.78
- Total: ~$4.00

**Monthly update** (30 days recent + 3000 old = ~4,000 samples):
- GPU time: 1.5 hours × $1.89/hr = $2.84
- Total: ~$3.00

**Annual cost** (12 monthly updates):
- Foundation: $4.00 (once)
- 11 updates: $2.50 × 11 = $27.50
- **Total**: $31.50/year

### Continuous Learning Lineage

The model registry tracks version history:

```json
{
  "original_base_model": "Qwen/Qwen3-14B",
  "current_base_model": "/profiles/greggles/out/.../v3/model",
  "training_history": [
    {
      "version": 1,
      "base_model_used": "Qwen/Qwen3-14B",
      "samples_trained": 5247,
      "timestamp": "2025-11-01T10:00:00Z"
    },
    {
      "version": 2,
      "base_model_used": "/out/.../v1/model",
      "samples_trained": 4102,
      "timestamp": "2025-12-01T10:00:00Z"
    },
    {
      "version": 3,
      "base_model_used": "/out/.../v2/model",
      "samples_trained": 4301,
      "timestamp": "2026-01-01T10:00:00Z"
    }
  ]
}
```

Each run builds on the previous version, creating continuous personality evolution.

### Troubleshooting

**"Only 230 samples - recommended 5000+"**:
- This is a pipeline test, not enough for real training
- Continue accumulating memories
- Wait until you have 3,000+ samples

**"Short samples: 93%"**:
- Capture more substantial conversations
- Avoid training on mostly brief acknowledgments
- Aim for <50% short samples

**"Training failed: No space left on device"**:
- Fixed in latest version (saves to `/workspace/` network volume)
- Clear cached work directories if still occurring

**"Optimizer uses AdamW instead of Adafactor"**:
- Check `etc/fine-tune-config.json` has `"optim": "adafactor"`
- Clear cached configs: `rm -rf metahuman-runs/greggles/YYYY-MM-DD/*`

### Loading Trained Model to Ollama

After training completes, load the new model:

```bash
# The trained model is at:
# profiles/greggles/out/fine-tuned-models/YYYY-MM-DD/RUN-ID/model/

# Convert to GGUF (if not done automatically)
# ... GGUF conversion steps here ...

# Load to Ollama
ollama create greggles-v2 -f profiles/greggles/out/.../Modelfile

# Test
ollama run greggles-v2 "How are you feeling today?"
```

### Best Practices

1. **Wait for quality data**: Don't rush to 3,000 samples with low-quality content
2. **Monthly schedule**: Pick a consistent day (e.g., 1st of month)
3. **Monitor metrics**: Check curator output before each run
4. **Keep backups**: Retain last 2-3 model versions for rollback
5. **Test before deleting**: Verify new model quality before removing old versions

### Related Documentation

- **[Monthly Training Workflow](../monthly-training-workflow.md)** - Complete guide (recommended reading)
- **[Continuous Learning System](../continuous-learning-system.md)** - Model registry and versioning
- **[Fine-Tune RunPod Deployment](../fine-tune-runpod-deployment.md)** - RunPod setup

---

### Docker Deployment for LoRA Training

MetaHuman OS supports containerized LoRA training for cloud GPU providers like RunPod. This allows you to train adapters on powerful remote GPUs while keeping your local system lightweight.

#### Building the Docker Image

**Step 1: Generate requirements.txt from local environment**

Create an exact snapshot of your working Python environment:

```bash
cd /home/greggles/metahuman
source venv/bin/activate
pip freeze > requirements.txt
echo "requirements.txt generated successfully"
```

Verify the file contains packages like `torch`, `accelerate`, `axolotl`, etc.

**Step 2: (Optional) Remove Unsloth for stability**

Unsloth provides significant speed/memory benefits but can cause installation issues. If you encounter problems, edit `requirements.txt` and remove the `unsloth` line.

If removing Unsloth, also modify `brain/agents/lora-trainer.ts` to disable it in the config:

```typescript
// Change from:
${trainingParams.unsloth ? 'unsloth: true' : ''}

// To:
# unsloth: false
```

**Step 3: Build and push Docker image**

```bash
cd /home/greggles/metahuman
docker build -t gregoryaster/metahuman-trainer:latest .
docker push gregoryaster/metahuman-trainer:latest
```

#### Docker Image Contents

The Dockerfile includes:
- Ubuntu 22.04 base with CUDA 12.1 support
- Python 3.11
- PyTorch with GPU support
- Axolotl for LoRA training
- All dependencies from `requirements.txt`
- MetaHuman OS codebase

#### Using on RunPod

1. **Launch a pod** with the custom image: `gregoryaster/metahuman-trainer:latest`
2. **Select GPU**: A4000/A5000 (16GB) or higher recommended
3. **Volume setup**: Mount persistent storage to `/workspace/metahuman/out`
4. **SSH access**: Enable SSH for running training commands

**Run training remotely:**

```bash
# SSH into the pod
ssh root@<pod-ip>

# Navigate to workspace
cd /workspace/metahuman

# Run full training cycle
tsx brain/agents/full-cycle.ts <YYYY-MM-DD>

# Or run individual steps
tsx brain/agents/lora-trainer.ts <YYYY-MM-DD>
```

**Retrieve trained adapters:**

```bash
# Download from pod to local
scp -r root@<pod-ip>:/workspace/metahuman/out/adapters/<date> ./out/adapters/

# Or use the pod's volume download feature
```

#### Dockerfile Dependency Management

The Dockerfile uses `requirements.txt` to ensure the Docker environment matches your local working environment exactly:

```dockerfile
# Copy requirements file
COPY requirements.txt .

# Install dependencies using exact versions
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu121 -r requirements.txt
```

This prevents version mismatches that could cause training failures.

#### Troubleshooting Docker Builds

**Build fails with CUDA errors:**
- Ensure base image supports your CUDA version
- Check `requirements.txt` has correct PyTorch wheel URL

**Runtime errors on RunPod:**
- Verify GPU is detected: `nvidia-smi`
- Check CUDA version matches: `nvcc --version`
- Ensure `accelerate` config is correct: `accelerate config`

**Memory issues during training:**
- Reduce `per_device_train_batch_size` in `etc/training.json`
- Increase `gradient_accumulation_steps` to maintain effective batch size
- Consider removing `unsloth` if using older GPUs

**Adapter won't load locally:**
- Verify GGUF conversion succeeded: check `adapter.gguf` exists
- Ensure Modelfile paths are absolute
- Run `ollama create` manually to test loading

### Local LoRA Training Setup

MetaHuman OS supports training LoRA adapters locally on your own GPU, avoiding the need for cloud services like RunPod.

#### Quick Start

**Step 1: Run the setup script**
```bash
./bin/setup-local-training
```

This will:
- Check for NVIDIA GPU
- Create/activate a Python virtual environment
- Install PyTorch with CUDA 12.1 support
- Install Unsloth and all dependencies
- Install GGUF conversion tools

**Step 2: Run local training**
```bash
./bin/mh-train-local
```

Or specify a different base model:
```bash
./bin/mh-train-local "unsloth/Qwen3-Coder-30B-A3B-Instruct"
```

#### Hardware Requirements

**Minimum:**
- NVIDIA GPU with 24GB+ VRAM (e.g., RTX 3090, RTX 4090, RTX 5090, A100)
- 50GB+ free disk space
- 32GB+ RAM recommended

**Software:**
- Ubuntu 20.04+ or similar Linux distribution
- NVIDIA drivers (525+)
- CUDA 12.1+ (will be installed by PyTorch if missing)
- Python 3.10+

#### Python Virtual Environment

The setup creates a venv at `/home/greggles/metahuman/venv/` with these packages:

**Core Training:**
- `torch` - PyTorch with CUDA 12.1
- `unsloth` - Fast LoRA training framework
- `transformers` - HuggingFace transformers
- `datasets` - HuggingFace datasets
- `accelerate` - Training acceleration
- `bitsandbytes` - 4-bit quantization

**GGUF Conversion:**
- `gguf` - GGUF file format
- `protobuf` - Protocol buffers
- `sentencepiece` - Tokenization
- `mistral_common` - Model support

#### How Local Training Works

1. **Setup script** (`./bin/setup-local-training`):
   - Creates venv if needed
   - Installs all Python dependencies
   - Verifies GPU is available

2. **Training wrapper** (`./bin/mh-train-local`):
   - Checks GPU availability
   - Activates venv automatically
   - Runs the full training pipeline

3. **Training orchestrator** (`brain/agents/full-cycle-local.ts`):
   - Uses venv Python if available
   - Builds training dataset
   - Calls training script with local mode flags
   - Creates GGUF file
   - Loads into Ollama
   - Updates `etc/agent.json`

4. **Training script** (`docker/runpod-trainer/train_unsloth.py`):
   - Detects local vs RunPod mode
   - Downloads base model (cached after first run)
   - Trains LoRA adapter
   - Merges adapter with base model
   - Converts to GGUF format

#### Training Progress

When training runs, you'll see real-time progress with these stages:

1. **INIT** - Loading configuration
2. **DATASET** - Loading training data
3. **MODEL_DOWNLOAD** - Downloading base model (cached after first run)
4. **PREPROCESSING** - Preparing dataset
5. **LORA_SETUP** - Configuring adapters
6. **TRAINING** - Fine-tuning (this is the longest stage)
7. **SAVE_ADAPTER** - Saving adapter weights
8. **GGUF_MERGE** - Converting to GGUF format
9. **COMPLETE** - Done!

#### Troubleshooting Local Training

**"nvidia-smi not found"**

Install NVIDIA drivers:
```bash
sudo ubuntu-drivers autoinstall
```

**"CUDA out of memory"**

Try a smaller model:
```bash
./bin/mh-train-local "openai/gpt-oss-20b"  # 20B model
```

Or reduce batch size in `etc/training.json`:
```json
{
  "per_device_train_batch_size": 1,
  "gradient_accumulation_steps": 32
}
```

**"unsloth not found"**

Re-run the setup script:
```bash
./bin/setup-local-training
```

**"ModuleNotFoundError: No module named 'X'"**

Activate venv and install missing package:
```bash
source venv/bin/activate
pip install <package-name>
```

#### Manual Setup (Alternative)

If you prefer to set up manually without the script:

```bash
# Create venv
python3 -m venv venv
source venv/bin/activate

# Install PyTorch
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Install Unsloth
pip install "unsloth[cu121-torch220] @ git+https://github.com/unslothai/unsloth.git"

# Install dependencies
pip install datasets transformers accelerate bitsandbytes
pip install gguf protobuf sentencepiece mistral_common
```

#### Local vs RunPod Comparison

| Feature | Local Training | RunPod Training |
|---------|----------------|-----------------|
| Setup | One-time venv setup | No setup needed |
| Cost | Free (electricity only) | ~$0.50-2.00/hour |
| Speed | Depends on your GPU | Usually faster (RTX 5090) |
| Reliability | Always available | Sometimes pods unavailable |
| Storage | Uses your disk | Ephemeral |
| Model caching | Cached locally | Downloaded each time |

**Recommendation:** Use local training if you have a good GPU (RTX 3090+). Use RunPod for occasional training or if you don't have sufficient VRAM.

#### Chat Template Format (Critical)

**Important Note:** The training script uses the correct chat template format for each model family. For Qwen models, this is **ChatML format**:

```
<|im_start|>system
You are MetaHuman Greg, a helpful assistant.<|im_end|>
<|im_start|>user
{instruction}<|im_end|>
<|im_start|>assistant
{output}<|im_end|>
```

Using the wrong chat template will result in nonsense output. The training script automatically detects the base model's chat template.

**Verify your training data format:**
```bash
python3 -c "
import json
with open('metahuman-runs/YYYY-MM-DD/unsloth_dataset.jsonl') as f:
    example = json.loads(f.readline())
    # Check for <|im_start|> tokens in formatted text
    print(example)
"
```

#### After Training Completes

1. **Use the trained model:**
   The model is automatically loaded into Ollama.
   ```bash
   ./bin/mh chat
   ```

2. **View training artifacts:**
   ```bash
   ls -lh out/adapters/$(date +%Y-%m-%d)/
   ```

3. **Check adapter status:**
   ```bash
   ./bin/mh adapter list
   ```

### Integration Architecture

MetaHuman OS uses a unified system design where the CLI, web UI, and autonomous agents all share the same core library and data layer. This ensures consistency, auditability, and type safety across all interfaces.

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   User Interfaces                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   CLI    │  │  Web UI  │  │ Agents   │  │   API    │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
└───────┼────────────┼─────────────┼─────────────┼──────────┘
        │            │             │             │
        └────────────┴─────────────┴─────────────┘
                           ↓
        ┌──────────────────────────────────────┐
        │      @metahuman/core Library         │
        │  ┌────────┬─────────┬──────────┐    │
        │  │Persona │ Memory  │  Audit   │    │
        │  │Manager │ Manager │  Logger  │    │
        │  └────────┴─────────┴──────────┘    │
        └──────────────────────────────────────┘
                           ↓
        ┌──────────────────────────────────────┐
        │          Data Layer                  │
        │  persona/  memory/  logs/  brain/    │
        └──────────────────────────────────────┘
```

#### Core Library (@metahuman/core)

All system components use the shared `@metahuman/core` package located in `packages/core/`.

**Key Exports:**
- `paths` - Centralized path management
- `identity` - Persona loading/saving (core, relationships, routines, rules)
- `memory` - Memory operations (episodic, tasks, search, capture)
- `audit` - Complete audit logging system
- `skills` - Skill execution and approval queue management

**Benefits:**
- ✅ Single source of truth for all data operations
- ✅ Consistent behavior across CLI and web UI
- ✅ Type-safe interfaces
- ✅ Automatic audit logging
- ✅ Easy to test and maintain

#### API Endpoints

The web UI provides RESTful API endpoints for real-time interaction:

**GET `/api/status`** - System status, identity summary, task counts

**GET `/api/tasks`** - List all active tasks

**POST `/api/tasks`** - Create a new task with audit logging

**PATCH `/api/tasks`** - Update task status with audit logging

**GET `/api/audit`** - Query audit logs (supports `date` and `security` parameters)

**GET `/api/approvals`** - Get pending skill execution approvals

**POST `/api/approvals`** - Approve or reject a skill execution

**POST `/api/file_operations`** - Secure file operations (create, read, write)

#### Audit Logging

Every action is logged across all interfaces using the audit system.

**Audit Entry Structure:**
```typescript
interface AuditEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'critical';
  category: 'system' | 'decision' | 'action' | 'security' | 'data';
  event: string;
  details?: any;
  actor?: 'human' | 'system' | 'agent';
}
```

**Storage:**
- Format: NDJSON (newline-delimited JSON)
- Location: `logs/audit/YYYY-MM-DD.ndjson`
- Rotation: Daily files
- Immutable: Append-only log

**Helper Functions:**
```typescript
// Log a data change
auditDataChange({
  type: 'create' | 'update' | 'delete',
  resource: 'task' | 'event' | 'persona',
  path: '/path/to/resource',
  actor: 'human' | 'system' | 'agent',
  details: { ... }
});

// Log a security event
auditSecurity({
  type: 'permission_denied',
  severity: 'high',
  description: 'Attempted unauthorized action',
});

// Log a decision
auditDecision({
  situation: 'User requested X',
  chosen: 'Option Y',
  reasoning: 'Because Z',
  confidence: 0.85,
  maker: 'system',
});

// Generic audit
audit({
  level: 'info',
  category: 'system',
  event: 'system_started',
  actor: 'system',
});
```

#### Data Flow Examples

**Example 1: User Captures Event via CLI**
```
User runs: ./bin/mh capture "Met with Sarah"
    ↓
CLI (mh-new.ts) calls captureEvent()
    ↓
@metahuman/core/memory.ts creates event JSON
    ↓
@metahuman/core/audit.ts logs data_create
    ↓
Files created:
  - memory/episodic/2025/evt-20251019-160000-met-with-sarah.json
  - logs/audit/2025-10-19.ndjson (append)
    ↓
Web UI can immediately query via GET /api/audit
```

**Example 2: User Creates Task via Web UI**
```
User POSTs to /api/tasks
    ↓
API endpoint (apps/site/api/tasks.ts) calls createTask()
    ↓
@metahuman/core/memory.ts creates task
    ↓
@metahuman/core/audit.ts logs data_create
    ↓
API endpoint also calls auditDataChange()
    ↓
Files created:
  - memory/tasks/active/task-20251019-160500.json
  - logs/audit/2025-10-19.ndjson (append)
    ↓
CLI 'mh task' command shows new task immediately
```

**Operator Automations:** At `supervised_auto` trust and above, the autonomous operator now has dedicated `task_list`, `task_find`, `task_create`, and `task_update_status` skills. When a user asks the assistant to review, locate, add, or complete work, the router sends the request through these skills so the resulting JSON files and audit entries mirror the same flow as the web UI and CLI.

**Example 3: Skill Approval Workflow**
```
Agent attempts high-risk skill execution
    ↓
@metahuman/core/skills.ts checks requiresApproval flag
    ↓
Skill queued instead of executed
    ↓
Queue item saved to out/approval-queue/<id>.json
    ↓
Web UI polls GET /api/approvals every 5 seconds
    ↓
User sees pending approval in sidebar badge
    ↓
User clicks "Approve & Execute"
    ↓
POST /api/approvals with action='approve'
    ↓
Skill executes with full audit trail
    ↓
Result returned to user, queue item marked approved
```

#### Integration Points

**CLI → Core:**
```typescript
import { captureEvent, createTask, audit } from '@metahuman/core';

// CLI commands use core library
const filepath = captureEvent("My observation");

// Automatic audit logging
auditDataChange({
  type: 'create',
  resource: 'episodic_event',
  path: filepath,
  actor: 'human',
});
```

**Web UI → Core (via API):**
```typescript
// API endpoint: apps/site/src/pages/api/tasks.ts
import { listActiveTasks } from '@metahuman/core/memory';

export const GET: APIRoute = async () => {
  const tasks = listActiveTasks();
  return new Response(JSON.stringify({ tasks }));
};
```

**Web UI → Core (direct):**
```astro
---
// Astro page can also use core directly at build time
import { loadPersonaCore } from '@metahuman/core';
const persona = loadPersonaCore();
---
<h1>{persona.identity.name}</h1>
```

#### Development Workflow

**Adding New Features:**

1. **Core Library** (if data operations needed)
   ```bash
   cd packages/core/src
   # Edit memory.ts, identity.ts, skills.ts, or audit.ts
   ```

2. **CLI Command**
   ```bash
   cd packages/cli/src
   # Edit mh-new.ts
   # Import from @metahuman/core
   ```

3. **Web API Endpoint**
   ```bash
   cd apps/site/src/pages/api
   # Create new-endpoint.ts
   # Import from @metahuman/core
   ```

4. **Web UI Component**
   ```bash
   cd apps/site/src/components
   # Create NewComponent.svelte
   # Use API or import @metahuman/core directly
   ```

**Adding Audit Logging:**
```typescript
// In any component (CLI, web, agent)
import { audit, auditDataChange } from '@metahuman/core';

// Log the action
auditDataChange({
  type: 'create',
  resource: 'my_resource',
  path: '/path/to/resource',
  actor: 'human',
  details: { customField: 'value' },
});
```

### Extending with Skills and Agents

MetaHuman OS is designed for extensibility, allowing users to define custom behaviors and automations. This is primarily done by adding **Skills** and **Agents**.

#### Adding a Skill

Skills are executable actions that MetaHuman OS can perform. They are defined in the `brain/skills` directory.

1.  **Create a Skill Manifest:** Create a new manifest file (e.g., `my-skill.json`) under `brain/skills/`.
2.  **Register the Skill:** Implement the skill logic within your codebase, consuming `@metahuman/core` helpers as needed.
3.  **Policy Enforcement:** Policies automatically enforce trust levels and audit every skill registration and execution for safety.

#### Adding an Agent

Agents are background scripts that perform autonomous routines. They reside in the `brain/agents` directory.

1.  **Create an ESM Script:** Place an ECMAScript Module (ESM) script (e.g., `my-agent.ts`) in `brain/agents/`.
2.  **Import Core Modules:** Your agent script can import necessary modules from `@metahuman/core` (e.g., memory, LLM, audit, locks) to interact with the system.
3.  **Register and Manage:** The CLI and Web UI can manage the lifecycle and logs of registered agents, making it easy to monitor their operation.

#### Extending the Web UI

You can also extend the web user interface to interact with your custom features.

1.  **Use Astro Routes:** Astro routes in `apps/site` can directly import any core helper.
2.  **Feature Parity:** This ensures that new features can have full parity across all user surfaces (CLI, agents, and web UI).

#### Benefits of This Architecture

✅ **Single Source of Truth** - All components use same data layer
✅ **Type Safety** - TypeScript across entire system
✅ **Audit Trail** - Complete logging of all actions
✅ **Testability** - Core library can be tested independently
✅ **Consistency** - Same behavior in CLI and web UI
✅ **Extensibility** - Easy to add new interfaces (mobile, desktop, API)
✅ **Transparency** - Every action is auditable and explainable

---
