# Common Workflows

This guide provides step-by-step instructions for common tasks and workflows in MetaHuman OS. Each workflow is designed to be practical and task-oriented.

---

## Table of Contents

1. [Voice Training End-to-End](#voice-training-end-to-end)
2. [Memory Management Best Practices](#memory-management-best-practices)
3. [LoRA Adapter Training Pipeline](#lora-adapter-training-pipeline)
4. [Multi-User Profile Setup](#multi-user-profile-setup)
5. [Task and Project Management](#task-and-project-management)
6. [Building Semantic Index](#building-semantic-index)
7. [File Ingestion Workflow](#file-ingestion-workflow)
8. [Creating Custom Workflows (Node Editor)](#creating-custom-workflows-node-editor)
9. [Backup and Recovery](#backup-and-recovery)
10. [Troubleshooting Common Issues](#troubleshooting-common-issues)

---

## Voice Training End-to-End

### Goal
Train a personalized voice model using GPT-SoVITS from scratch.

### Prerequisites
- 10-15 minutes of clean audio recordings
- GPU with at least 8GB VRAM (recommended)
- Patience (training takes 1-2 hours)

### Steps

#### 1. Install GPT-SoVITS

```bash
# Install dependencies and clone repository
./bin/mh sovits install
```

**Estimated time:** 10-15 minutes

#### 2. Download Pre-trained Models

```bash
# Download base models (several GB)
./bin/mh sovits download-models
```

**Estimated time:** 15-30 minutes (depends on internet speed)

#### 3. Collect Voice Samples

**Option A: Web UI (Recommended)**
1. Navigate to **Voice Training** widget
2. Click **"Start Recording"**
3. Read provided prompts clearly
4. Record 50-100 samples (10-15 minutes of audio)
5. Review and delete any bad samples

**Option B: Upload Existing Audio**
1. Place audio files in `memory/voice-samples/`
2. Web UI will detect them automatically

**Tips for Quality:**
- Use a quiet room
- Speak naturally, not robotically
- Vary intonation and emotion
- Avoid background noise
- Use a decent microphone (even phone mic works)

#### 4. Export Training Dataset

```bash
# Export samples to GPT-SoVITS format
./bin/mh voice export
```

This creates:
- `out/voices/sovits/dataset/` - Audio files + metadata
- Automatic silence trimming
- Sample normalization

#### 5. Start GPT-SoVITS Server

```bash
# Start server
./bin/mh sovits start

# Verify it's running
./bin/mh sovits status
```

#### 6. Train the Model

**Via Web UI:**
1. Navigate to **Training Monitor**
2. Select GPT-SoVITS tab
3. Click **"Start Training"**
4. Monitor progress in real-time

**Via Command Line:**
Training is currently done through the web UI or manually using GPT-SoVITS tools.

#### 7. Test the Voice

```bash
# Test synthesis
./bin/mh sovits test "Hello! This is my new voice."
```

Audio file saved to `out/test-audio/`

#### 8. Configure as Default Voice

Edit `etc/voice.json`:
```json
{
  "tts": {
    "provider": "sovits",
    "sovits": {
      "serverUrl": "http://localhost:9880",
      "speakerId": "yourname",
      "referenceAudio": "path/to/reference.wav",
      "referenceText": "Reference text"
    }
  }
}
```

**Done!** Your personalized voice is now active.

---

## Memory Management Best Practices

### Goal
Maintain a clean, organized, and searchable memory system.

### Daily Practices

#### Capture Observations Regularly

```bash
# Quick captures throughout the day
./bin/mh capture "Interesting insight from meeting with Alex"
./bin/mh capture "Need to follow up on the ML paper review"
./bin/mh capture "Had a great workout session - new PR on deadlift"
```

**Best practices:**
- Capture as soon as possible (memory is fresh)
- Be specific (names, dates, numbers)
- Include context (who, what, why)
- Don't worry about perfect formatting

#### Run the Organizer Agent

The organizer enriches memories with tags and entities:

```bash
# Check organizer status
./bin/mh agent status organizer

# Manually run if needed
./bin/mh agent run organizer
```

**What it does:**
- Extracts key entities (people, places, topics)
- Adds semantic tags
- Categorizes memory type
- Improves search quality

#### Review Inner Dialogue

Reflections are internal thoughts, not shown in chat:

```bash
# Trigger a reflection manually
./bin/mh agent run reflector
```

**In Web UI:**
1. Go to **Memory Browser**
2. Click **"Inner Dialogue"** tab
3. Review recent reflections
4. Adjust boredom settings if too frequent/infrequent

### Weekly Practices

#### Build Semantic Index

```bash
# Build or update vector index
./bin/mh index build

# Test semantic search
./bin/mh index query "what did I learn this week about machine learning?"
```

**Rebuilding schedule:**
- Weekly if actively using the system
- After major conversation sessions
- When search quality degrades

#### Review and Prune Tasks

```bash
# List active tasks
./bin/mh task

# Complete stale tasks
./bin/mh task done <id>

# Archive old tasks (via web UI)
```

### Monthly Practices

#### Check Storage Usage

```bash
# Check directory sizes
du -sh memory/episodic/
du -sh memory/index/
du -sh logs/
```

#### Review Audit Logs

```bash
# Recent activity
tail -n 100 logs/audit/$(date +%Y-%m-%d).ndjson

# Search for specific events
grep "lora_training" logs/audit/*.ndjson
```

#### Backup Important Data

```bash
# See "Backup and Recovery" section below
```

---

## LoRA Adapter Training Pipeline

### Goal
Train a LoRA adapter to personalize the LLM's responses to your style.

### Prerequisites
- At least 500-1000 memories captured
- 2-4 weeks of conversation history
- GPU with 16GB+ VRAM (or use RunPod/cloud)

### Full Workflow

#### 1. Review Memory Quality

```bash
# Check total memories
find memory/episodic/ -name "*.json" | wc -l

# Review recent conversations
./bin/mh remember "conversation" | head -n 20
```

**Quality checklist:**
- ✅ Diverse conversation topics
- ✅ Mix of short and long responses
- ✅ Natural dialogue (not just commands)
- ✅ Consistent personality

#### 2. Curate Training Dataset

Datasets are automatically generated by the sleep-service agent based on recent memories.

```bash
# List available datasets
./bin/mh adapter list

# Review a specific dataset
./bin/mh adapter review 2025-01-15
```

**Review output shows:**
- Total conversation pairs
- Sample pairs (first 5)
- Dataset composition by type
- Confidence distribution

#### 3. Approve Dataset

```bash
# If quality looks good, approve
./bin/mh adapter approve 2025-01-15 "Looks great, diverse topics"

# If quality is poor, reject
./bin/mh adapter reject 2025-01-15 "Too many technical conversations, not balanced"
```

#### 4. Train the Adapter

**Option A: Local Training (if you have GPU)**

```bash
# Start training
./bin/mh adapter train 2025-01-15
```

Training typically takes:
- 7B model: 30-45 minutes
- 13B model: 1-2 hours
- 30B model: 3-4 hours

**Option B: Cloud Training (RunPod/vast.ai)**

1. Export dataset:
   ```bash
   # Dataset is in out/adapters/2025-01-15/instructions.jsonl
   ```

2. Upload to RunPod:
   - Use the Unsloth template
   - Follow [RunPod Training Guide](../11-special-features.md#runpod-training)

3. Download trained adapter:
   ```bash
   # Place safetensors in out/adapters/2025-01-15/
   ```

#### 5. Evaluate Adapter Quality

```bash
# Run evaluation agent
./bin/mh adapter eval 2025-01-15
```

**Evaluation metrics:**
- Response coherence
- Style consistency
- Factual accuracy
- Overall quality score

Passing score: **> 0.7** (configurable in `etc/training.json`)

#### 6. Activate the Adapter

```bash
# Convert to GGUF and load into Ollama
./bin/mh adapter activate 2025-01-15
```

This:
- Converts safetensors → GGUF format
- Loads both historical + recent adapters (dual-adapter mode)
- Creates Ollama model: `greg-2025-01-15`
- Updates `etc/models.json` with active adapter info

#### 7. Test the Adapter

```bash
# Chat with the new model
./bin/mh chat

# In chat, test if responses feel more "you"
```

**Compare:**
- Base model responses (generic)
- Adapted model responses (personalized)

#### 8. Merge Historical Adapters (Optional)

After training multiple adapters:

```bash
# Merge all historical adapters into one consolidated adapter
./bin/mh adapter merge
```

**Benefits of dual-adapter mode:**
- Historical adapter: Lifetime consolidated memory
- Recent adapter: Last 14 days (keeps personality fresh)
- Together: Long-term stability + recent adaptability

---

## Multi-User Profile Setup

### Goal
Configure MetaHuman OS for multiple users with isolated profiles.

### When to Use Multi-User Mode
- Shared server/machine
- Family members each want their own personality
- Testing different personas
- Development/production separation

### Setup Steps

#### 1. Verify Multi-User Support Enabled

Multi-user mode is built-in. Each user has isolated:
- `~/metahuman-profiles/<username>/` directory
- Separate persona, memories, tasks, adapters

#### 2. Create a New User Profile

**Via Web UI:**
1. Logout if authenticated
2. Click **"Register"** or **"Create Profile"**
3. Enter username, email, password
4. Complete setup wizard

**Via CLI (for admin/testing):**
```bash
# Create user directories manually
# (Automatic on first web UI login)
```

#### 3. Configure User-Specific Settings

Each user can customize:
- `~/metahuman-profiles/<username>/persona/core.json`
- `~/metahuman-profiles/<username>/etc/voice.json`
- `~/metahuman-profiles/<username>/etc/cognitive-mode.json`

#### 4. Run Commands as Specific User

```bash
# Run command as specific user
./bin/mh --user alice chat

# Short form
./bin/mh -u alice task list
```

#### 5. Switch Users in Web UI

1. Click username in header
2. Select **"Logout"**
3. Login as different user

### Guest Access

- Guest users have read-only access
- No memory saving
- All cognitive modes available for testing
- Perfect for demos

---

## Task and Project Management

### Goal
Organize work using MetaHuman's task system effectively.

### Basic Task Workflow

#### Creating Tasks

```bash
# Simple task
./bin/mh task add "Review pull request #123"

# Task with description (via web UI is easier)
```

**In Web UI:**
1. Go to **Tasks** page
2. Click **"New Task"**
3. Enter:
   - Title
   - Description
   - Priority (high/medium/low)
   - Due date (optional)

#### Managing Tasks

```bash
# List all active tasks
./bin/mh task

# Start working on a task
./bin/mh task start <id>

# Mark task as done
./bin/mh task done <id>

# Archive completed tasks (via web UI)
```

### Project Organization

MetaHuman supports hierarchical projects:

**Structure:**
```
memory/tasks/
├── active/
│   ├── task-001.json
│   ├── task-002.json
├── completed/
│   └── task-003.json
└── projects/
    ├── ml-project/
    │   ├── task-004.json
    │   ├── task-005.json
    └── website-redesign/
        ├── task-006.json
```

**Creating a project:**
1. In web UI, create task
2. Add `project: "ml-project"` field
3. Tasks auto-group by project

### Integrations

#### Link Tasks to Memories

When capturing events, reference tasks:

```bash
./bin/mh capture "Made progress on task-001, implemented the authentication flow"
```

The organizer agent will:
- Extract task reference
- Link memory to task
- Update task timeline

#### Calendar Integration

```bash
# List upcoming events
./bin/mh calendar list

# Create event
./bin/mh calendar create "Team meeting tomorrow at 2pm"
```

Calendars are synced with tasks (deadlines become calendar events).

---

## Building Semantic Index

### Goal
Enable semantic search across your memories using vector embeddings.

### When to Build Index
- After collecting 50+ memories
- Weekly if actively using the system
- Before important searches

### Steps

#### 1. Choose Embedding Model

Default: `nomic-embed-text` (via Ollama)

```bash
# Verify model is available
./bin/mh ollama list | grep nomic-embed-text

# Pull if missing
./bin/mh ollama pull nomic-embed-text
```

#### 2. Build the Index

```bash
# Initial build (takes 5-15 minutes for 1000 memories)
./bin/mh index build
```

**What happens:**
- Reads all episodic memories
- Generates embeddings for each memory
- Stores in `memory/index/`
- Creates FAISS vector database

#### 3. Test Semantic Search

```bash
# Semantic query (finds conceptually similar memories)
./bin/mh index query "what did I learn about machine learning?"

# Compare to keyword search
./bin/mh remember "machine learning"
```

**Semantic search benefits:**
- Finds related concepts (not just exact keywords)
- Understands synonyms and context
- Better for vague/conceptual queries

#### 4. Incremental Updates

```bash
# Update index with new memories (much faster)
./bin/mh index build --incremental
```

**Recommendation:**
- Full rebuild: Monthly
- Incremental: Weekly or after major sessions

---

## File Ingestion Workflow

### Goal
Import documents, PDFs, code files into your memory system.

### Supported Formats
- Text files (.txt, .md)
- PDFs (.pdf)
- Code files (.js, .ts, .py, etc.)
- JSON, YAML, CSV

### Workflow

#### 1. Add Files to Inbox

```bash
# Ingest a single file
./bin/mh ingest ~/Documents/important-notes.md

# Ingest entire directory
./bin/mh ingest ~/Projects/documentation/

# Ingest with context
./bin/mh ingest ~/book.pdf
```

Files are copied to `memory/inbox/`.

#### 2. Run Ingestor Agent

```bash
# Process inbox files
./bin/mh agent run ingestor
```

**What happens:**
- Reads each file
- Extracts text content
- Creates episodic memories with:
  - File metadata (name, path, type)
  - Content summary
  - Key entities and topics
- Archives processed files to `memory/inbox/_archive/`

#### 3. Search Ingested Content

```bash
# Find the ingested document
./bin/mh remember "important-notes"

# Semantic search across content
./bin/mh index query "what was in that book about productivity?"
```

### Best Practices

**For Large Documents:**
- Split into sections manually
- Ingest chapter by chapter
- Add context in filenames

**For Code:**
- Ingest README files
- Include docstrings/comments
- Ingest design docs separately

---

## Creating Custom Workflows (Node Editor)

### Goal
Build visual workflows using the node-based cognitive system.

### Prerequisites
- Web UI running
- Basic understanding of graph-based workflows

### Example: Custom Morning Routine

#### 1. Open Node Editor

1. In web UI, navigate to **Node Editor**
2. Click **"New Workflow"**

#### 2. Add Nodes

**Node Palette** (left sidebar):
- **Memory Search** - Query episodic memories
- **LLM Prompt** - Send prompt to language model
- **Task Query** - Fetch active tasks
- **Conditional** - Branch based on conditions
- **Output** - Display result

**Example workflow:**
```
Start Node
  ↓
Memory Search (query: "yesterday")
  ↓
LLM Prompt (template: "Summarize these memories")
  ↓
Task Query (fetch active tasks)
  ↓
LLM Prompt (template: "Create daily plan")
  ↓
Output (display plan)
```

#### 3. Connect Nodes

- Click output port on first node
- Drag to input port on next node
- Repeat until workflow complete

#### 4. Configure Node Parameters

Click each node to set:
- **Memory Search**: `query: "yesterday"`, `limit: 10`
- **LLM Prompt**: `model: "persona"`, `temperature: 0.7`
- **Task Query**: `status: "active"`, `limit: 5`

#### 5. Test the Workflow

1. Click **"Run Workflow"**
2. View results in output node
3. Debug issues using node execution logs

#### 6. Save and Reuse

1. Click **"Save Workflow"**
2. Name it: "Morning Briefing"
3. Run anytime from **Workflows** menu

### Advanced: Scheduled Workflows

Workflows can be scheduled to run automatically:
1. Save workflow
2. Configure schedule in `etc/workflows.json`
3. Scheduler service will run at specified times

**Example schedule:**
```json
{
  "schedules": [
    {
      "workflow": "morning-briefing",
      "cron": "0 8 * * *",
      "enabled": true
    }
  ]
}
```

---

## Backup and Recovery

### Goal
Protect your memories, persona, and trained models.

### What to Backup

**Essential:**
- `persona/` - Your personality and identity
- `memory/episodic/` - All captured memories
- `memory/tasks/` - Active and completed tasks
- `etc/` - Configuration files

**Important:**
- `out/adapters/` - Trained LoRA adapters
- `out/voices/` - Trained voice models
- `memory/index/` - Semantic index (can be rebuilt)

**Optional:**
- `logs/audit/` - Audit trail (large, can be rotated)
- `memory/inbox/` - Raw files (already processed)

### Backup Strategies

#### Strategy 1: Simple Tar Archive

```bash
# Create backup
tar -czf metahuman-backup-$(date +%Y-%m-%d).tar.gz \
  persona/ \
  memory/episodic/ \
  memory/tasks/ \
  etc/ \
  out/adapters/ \
  out/voices/

# Restore
tar -xzf metahuman-backup-2025-01-15.tar.gz
```

#### Strategy 2: Git Repository

```bash
# Initialize git (if not already)
git init

# Add important files to git
git add persona/ memory/episodic/ memory/tasks/ etc/
git commit -m "Backup $(date +%Y-%m-%d)"

# Push to private remote
git remote add backup https://github.com/youruser/metahuman-backup
git push backup main
```

**Warning:** Do NOT commit trained models to git (too large).

#### Strategy 3: Incremental Rsync

```bash
# Daily incremental backup to external drive
rsync -avz --delete \
  --exclude 'logs/' \
  --exclude 'memory/inbox/' \
  --exclude 'node_modules/' \
  ~/metahuman/ \
  /mnt/backup/metahuman/
```

#### Strategy 4: Cloud Sync

**Using rclone:**
```bash
# Install rclone, configure cloud provider
rclone sync ~/metahuman/persona/ remote:metahuman/persona/
rclone sync ~/metahuman/memory/ remote:metahuman/memory/
rclone sync ~/metahuman/etc/ remote:metahuman/etc/
```

### Recovery Procedures

#### Restore from Backup

```bash
# Extract backup
tar -xzf metahuman-backup-2025-01-15.tar.gz

# Rebuild semantic index
./bin/mh index build

# Restart services
./bin/mh start --restart
```

#### Partial Recovery (Persona Only)

```bash
# Restore just persona
cp backup/persona/core.json persona/core.json

# Verify
./bin/mh persona status
```

#### Emergency: Rebuild from Audit Logs

If memories are lost but audit logs exist:
```bash
# Use audit logs to reconstruct events
# (Manual process, see troubleshooting docs)
```

---

## Troubleshooting Common Issues

### Issue 1: Ollama Connection Failed

**Symptoms:**
- Chat returns "LLM provider not available"
- `./bin/mh status` shows Ollama offline

**Solution:**
```bash
# Check if Ollama is running
ps aux | grep ollama

# Start Ollama if not running
ollama serve

# Verify connection
./bin/mh ollama status

# Diagnose issues
./bin/mh ollama doctor
```

### Issue 2: Memory Not Saving

**Symptoms:**
- Conversations disappear
- `./bin/mh remember` shows no results

**Possible Causes:**
1. **In emulation mode** (read-only)
   - Switch to dual or agent mode

2. **Anonymous user** (web UI)
   - Login or register

3. **Permission issues**
   - Check directory permissions: `ls -la memory/episodic/`
   - Fix: `chmod -R u+w memory/`

**Verify:**
```bash
# Check recent memories
ls -lt memory/episodic/$(date +%Y)/ | head

# Check audit logs
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep "memory_captured"
```

### Issue 3: Agent Won't Start

**Symptoms:**
- `./bin/mh start` fails
- Agents show as stopped in `./bin/mh agent ps`

**Possible Causes:**
1. **Stale lock file**
   ```bash
   # Check for stale locks
   ls -la logs/run/locks/

   # Remove stale lock
   rm logs/run/locks/organizer.lock
   ```

2. **Process still running**
   ```bash
   # Find process
   ps aux | grep organizer

   # Kill if needed
   pkill -f organizer
   ```

3. **Dependency missing**
   ```bash
   # Reinstall dependencies
   pnpm install
   ```

**Solution:**
```bash
# Force restart
./bin/mh start --force

# Verify
./bin/mh agent ps
```

### Issue 4: GPU Out of Memory (OOM)

**Symptoms:**
- Training crashes midway
- Error: "CUDA out of memory"

**Solutions:**

1. **Reduce batch size**
   Edit `etc/training.json`:
   ```json
   {
     "per_device_train_batch_size": 1,
     "gradient_accumulation_steps": 32
   }
   ```

2. **Use smaller model**
   ```bash
   ./bin/mh fine-tune --base-model qwen3-coder:7b
   ```

3. **Enable CPU fallback**
   Edit `etc/training.json`:
   ```json
   {
     "device": "cpu"
   }
   ```
   (Warning: Much slower)

4. **Use cloud GPU**
   - RunPod, vast.ai, or AWS
   - See [RunPod Training Guide](../11-special-features.md#runpod-training)

### Issue 5: Web UI Not Loading

**Symptoms:**
- Browser shows "Cannot connect"
- Port 4321 not responding

**Solutions:**

1. **Check if dev server is running**
   ```bash
   ps aux | grep "astro dev"

   # Start if not running
   cd apps/site
   pnpm dev
   ```

2. **Port already in use**
   ```bash
   # Find process on port 4321
   lsof -i :4321

   # Kill and restart
   kill <PID>
   pnpm dev
   ```

3. **Clear Astro cache**
   ```bash
   cd apps/site
   rm -rf .astro
   pnpm dev
   ```

4. **Check firewall**
   ```bash
   # Allow port 4321
   sudo ufw allow 4321
   ```

### Issue 6: Voice Synthesis Not Working

**Symptoms:**
- Silence when testing voice
- Error: "TTS provider failed"

**Solutions:**

**For GPT-SoVITS:**
```bash
# Check server status
./bin/mh sovits status

# Restart server
./bin/mh sovits restart

# Check logs
./bin/mh sovits logs --tail 100
```

**For Piper:**
```bash
# Verify model installed
ls -la external/piper/models/

# Test directly
echo "test" | external/piper/piper --model external/piper/models/en_US-lessac-medium.onnx --output_file test.wav
```

**For Kokoro:**
```bash
# Check server
./bin/mh kokoro status

# Restart
./bin/mh kokoro serve stop
./bin/mh kokoro serve start

# Test
./bin/mh kokoro test
```

---

## Next Steps

You've completed the common workflows guide! For more advanced topics:

- [Voice System Guide](../23-voice-system.md) - Comprehensive voice training
- [LoRA Training](../11-special-features.md#lora-adapter-training) - Advanced adapter training
- [Node-Based Workflows](../28-node-based-cognitive-system.md) - Visual workflow system
- [Multi-User Setup](../19-multi-user-profiles.md) - Detailed multi-user configuration
- [Troubleshooting](../12-troubleshooting.md) - Full troubleshooting guide

Happy building! 🚀
