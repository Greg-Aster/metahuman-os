# Autonomous Agents

MetaHuman OS includes a comprehensive suite of **40 autonomous agents** that run as background processes to enrich memories, generate reflections, train models, and maintain the system. These agents are coordinated by the **Scheduler Service** and can be triggered by intervals, time-of-day, events, or user activity.

> **Source of Truth**: This documentation is generated from actual agent implementations in [`brain/agents/`](../../brain/agents/) as of 2025-11-25.

---

## Agent Categories

Agents are organized by function:

1. [Memory Processing](#memory-processing-agents) — Enrich and organize memories
2. [Curiosity & Reflection](#curiosity--reflection-agents) — Generate questions and internal thoughts
3. [Sleep & Night Processing](#sleep--night-processing-agents) — Nightly pipelines and dream generation
4. [Dataset Building](#dataset-building-agents) — Prepare training data from memories
5. [Training Pipeline](#training-pipeline-agents) — LoRA and fine-tuning orchestration
6. [Training Support](#training-support-agents) — Utilities for model training
7. [Persona & Analysis](#persona--analysis-agents) — Personality evolution and understanding
8. [Audio Processing](#audio-processing-agents) — Transcription and audio memory conversion
9. [System Services](#system-services) — Core infrastructure and scheduling

---

## Memory Processing Agents

### 1. Organizer Agent

**File**: `brain/agents/organizer.ts`

**Purpose**: Automatically processes and enriches memories with LLM-extracted tags and entities.

**Behavior**:
- Scans episodic memories for unprocessed entries (across all users)
- Uses LLM to extract:
  - Tags (lowercase keywords)
  - Entities (people, places, organizations)
- Updates `metadata.processed = true` when complete
- **MULTI-USER**: Processes all logged-in users sequentially with isolated contexts

**Trigger**: Activity-based (300s inactivity) via `etc/agents.json`

**Configuration**: `etc/agents.json` → `organizer` section

**CLI Usage**:
```bash
./bin/mh agent run organizer
```

---

### 2. Ingestor Agent

**File**: `brain/agents/ingestor.ts`

**Purpose**: Converts raw files in `memory/inbox/` into episodic memories.

**Behavior**:
- Reads files from `memory/inbox/`
- Splits long content into 2000-character chunks
- Creates episodic events for each chunk
- Moves processed files to `memory/inbox/_archive/YYYY-MM-DD/`
- Supports JSON and text files

**Trigger**: Manual or scheduled

**CLI Usage**:
```bash
./bin/mh ingest <file-or-directory>
```

---

### 3. AI Ingestor Agent

**File**: `brain/agents/ai-ingestor.ts`

**Purpose**: LLM-powered classification and summarization before saving memories.

**Behavior**:
- Reads raw files from `memory/inbox/`
- Uses LLM (via `callLLMJSON` with 'curator' role) to classify:
  - Type: conversation, journal, search, fragment, observation, inner_dialogue, reflection
  - Title: short (≤10 words)
  - Summary: 1-3 sentences
  - Tags: ≤6 lowercase keywords
  - Entities: names/orgs/places
  - Quality: 0-1 (skips spam/garbage with <0.4)
- Saves compact episodic events (content = summary)
- Links back to source filename
- Archives originals to `_archive/YYYY-MM-DD/`

**Trigger**: Manual

**Configuration**: `etc/ai-ingestor.json`

---

### 4. Audio Organizer Agent

**File**: `brain/agents/audio-organizer.ts`

**Purpose**: Converts audio transcripts into episodic memories with LLM-extracted metadata.

**Behavior**:
- Polls every 15 minutes for unorganized transcripts
- Generates summary and extracts metadata using LLM
- Creates episodic events with tags and entities
- Marks transcripts as `organized: true`

**Trigger**: Night pipeline (via `night-processor.ts`)

**Configuration**: `etc/audio.json`

---

### 5. Memory Metrics Cache Agent

**File**: `brain/agents/memory-metrics-cache.ts`

**Purpose**: Background job that updates metrics cache for all users.

**Behavior**:
- Iterates through all logged-in users
- Updates metrics cache via `updateMetricsCache()`
- Cleans up orphaned tool outputs (90 days retention)
- **MULTI-USER**: Processes each user with isolated context

**Trigger**: Scheduled interval (configurable)

---

## Curiosity & Reflection Agents

### 6. Reflector Agent

**File**: `brain/agents/reflector.ts`

**Purpose**: Generates internal reflections using associative memory chains.

**Behavior**:
- Considers **all memories** (no pool limit, entire lifetime)
- Builds chains of 3-5 associated memories by following keyword connections
- Simulates train of thought (one memory triggers search for related memories)
- Uses weighted selection (14-day decay factor allows old memories to surface)
- Example: "coffee with Sarah" → search("Sarah") → "Sarah mentioned project" → search("project") → reflection
- **Deprioritizes technical keywords** to avoid self-referential content (e.g., "metahuman", "organizer", "reflector")
- Can optionally use recursive train-of-thought mode (via `REFLECTOR_USE_TRAIN_OF_THOUGHT=true`)
- **IMPORTANT**: Saves as `type: 'inner_dialogue'` — reflections are internal thoughts only, visible in Inner Dialogue tab, NEVER in main chat

**Trigger**: Activity-based via boredom-maintenance (900s inactivity)

**Configuration**: `etc/agents.json` → `boredom-maintenance` section

**CLI Usage**:
```bash
./bin/mh agent run reflector
```

---

### 7. Train-of-Thought Agent

**File**: `brain/agents/train-of-thought.ts`

**Purpose**: Performs recursive reasoning by following memory associations.

**Behavior**:
- Builds associative chains of memories
- Follows semantic connections between events
- Generates deep insights through multi-hop reasoning
- Can be triggered:
  1. Directly via CLI: `./bin/mh agent run train-of-thought`
  2. From reflector agent (via `agent_trigger` node)
  3. From inner-curiosity for deeper exploration

**Trigger**: On-demand or via reflector/inner-curiosity

**CLI Usage**:
```bash
./bin/mh agent run train-of-thought
```

---

### 8. Curiosity Service Agent

**File**: `brain/agents/curiosity-service.ts`

**Purpose**: Monitors user inactivity and asks thoughtful questions in main chat.

**Behavior**:
- Uses node-based workflow (`etc/cognitive-graphs/curiosity-mode.json`)
- Weighted memory selection (14-day decay, same as reflector)
- Samples from **all memories** (entire lifetime), not just recent 7 days
- Deprioritizes technical keywords to avoid meta-questions
- Questions appear in chat as `💭 I'm curious: <question>`
- User can reply, triggering conversation and memory storage
- Respects `maxOpenQuestions` limit and trust/autonomy policies
- **MULTI-USER**: Processes all users sequentially with isolated contexts

**Trigger**: Activity-based (900s inactivity) via `etc/agents.json`

**Configuration**: `etc/curiosity.json`

**CLI Usage**:
```bash
./bin/mh agent run curiosity-service
```

---

### 9. Inner Curiosity Agent

**File**: `brain/agents/inner-curiosity.ts`

**Purpose**: Generates self-directed questions and answers them internally.

**Behavior**:
- Uses weighted memory selection (same algorithm as reflector/curiosity)
- Generates question about patterns/connections in memories
- Searches local memory for relevant context
- Synthesizes thoughtful answer from findings
- Saves as `type: 'inner_dialogue'` — NEVER appears in main chat
- **MULTI-USER**: Processes all logged-in users sequentially
- Example output: `🤔 <question>\n\n💭 <answer>`

**Trigger**: Configurable interval (default: 1800s)

**Configuration**: `etc/curiosity.json` → `innerQuestionMode` ('off', 'local', 'web'), interval

**CLI Usage**:
```bash
./bin/mh agent run inner-curiosity
```

---

### 10. Curiosity Researcher Agent

**File**: `brain/agents/curiosity-researcher.ts`

**Purpose**: Performs deeper research on pending curiosity questions.

**Behavior**:
- Extracts key topics from questions using LLM
- Searches episodic memory for question-related content (5 results per topic, max 3 topics)
- Generates research notes and summaries
- Saves findings as `inner_dialogue` events
- Web search integration placeholder (planned)
- **MULTI-USER**: Processes all users sequentially

**Trigger**: Manual or scheduled

**Configuration**: `etc/curiosity.json` → `researchMode` ('off', 'local', 'web')

---

## Sleep & Night Processing Agents

### 11. Dreamer Agent

**File**: `brain/agents/dreamer.ts`

**Purpose**: Creates surreal dreams from lifetime memory fragments.

**Behavior**:
- Accesses **all episodic memories** (entire lifetime, no time limit)
- Uses reflective exponential decay weighting:
  - Formula: `weight = exp(-ageInDays / 227)`
  - 1-year-old memories retain ~20% probability
  - Contemplative weighting allows older memories to appear frequently
- Curates weighted sample of diverse memories (default: 15 memories)
- Generates surreal dream narratives using LLM
- Extracts preferences and heuristics
- Writes overnight learnings to procedural memory
- **MULTI-USER**: Processes all users sequentially

**Trigger**: Night pipeline (via `sleep-service.ts`)

**Configuration**: `etc/sleep.json` → `maxDreamsPerNight`, `evaluate`

**CLI Usage**:
```bash
./bin/mh agent run dreamer
```

---

### 12. Sleep Service

**File**: `brain/agents/sleep-service.ts`

**Purpose**: Orchestrates the nightly processing pipeline.

**Behavior**:
- Checks if current time is within sleep window (e.g., 23:00–06:30)
- Verifies system idle threshold (e.g., 15 minutes)
- Runs nightly pipeline:
  1. Dreamer agent (with `maxDreamsPerNight` limit)
  2. Audio processing (transcriber + audio-organizer)
  3. LoRA training pipeline (adapter-builder, auto-approver, trainer, eval, activation)
- **MULTI-USER**: System-level orchestrator, triggers multi-user agents internally

**Trigger**: Night pipeline (via `night-pipeline.ts`)

**Configuration**: `etc/sleep.json`

**Functions**:
- `loadSleepConfig()` — Read configuration
- `isSleepTime()` — Check if within sleep window
- `isIdle()` — Check system idle duration
- `runNightlyPipeline()` — Execute full pipeline

---

### 13. Night Pipeline Agent

**File**: `brain/agents/night-pipeline.ts`

**Purpose**: Wrapper agent triggered by scheduler to run nightly processing.

**Behavior**:
- Calls `sleep-service.ts` functions
- Actual pipeline orchestration handled by `sleep-service.ts`

**Trigger**: Time-of-day (02:00) via `etc/agents.json`

**Configuration**: `etc/agents.json` → `night-pipeline` section

---

### 14. Night Processor Agent

**File**: `brain/agents/night-processor.ts`

**Purpose**: Runs transcriber and audio-organizer in one-shot mode.

**Behavior**:
- Spawns `transcriber.ts` with `ONESHOT=1` env var
- Spawns `audio-organizer.ts` with `ONESHOT=1` env var
- Waits for both to complete
- Audits exit codes (success/failure)

**Trigger**: Night pipeline (via `sleep-service.ts`)

---

### 15. Morning Loader Agent

**File**: `brain/agents/morning-loader.ts`

**Purpose**: Loads overnight learnings and activates daily operator profile.

**Behavior**:
- Loads base persona from `persona/core.json`
- Finds most recent overnight learnings file (`memory/procedural/overnight/overnight-learnings-*.md`)
- Composes daily operator profile (base persona + overnight learnings)
- Activates new profile as prompt adapter (Tier 1 model adaptation)
- Audits activation

**Trigger**: End of sleep cycle (after dreamer completes)

**Implementation**: Tier 1 model adaptation (prompt adapter only, no training)

---

## Dataset Building Agents

### 16. Curator Agent

**File**: `brain/agents/curator.ts`

**Purpose**: Prepares clean, persona-friendly training data.

**Behavior**:
- Processes raw episodic memories into curated summaries
- Uses LLM to remove:
  - Tool syntax
  - JSON fragments
  - Operator transcripts
- Runs incrementally (~50 uncurated memories per run)
- Outputs to `memory/curated/conversations/*.json`
- **MULTI-USER**: Processes user-specific memories

**Trigger**: Scheduled interval (1800s / 30 min) via `etc/agents.json`

**Configuration**: `etc/curator.json`

**CLI Usage**:
```bash
./bin/mh agent run curator
```

---

### 17. AI Dataset Builder Agent

**File**: `brain/agents/ai-dataset-builder.ts`

**Purpose**: Transforms entire memory corpus into instruction tuning samples.

**Behavior**:
- Uses currently configured LLM (Ollama or adapter)
- Processes memories in batches (configurable `chunkSize`)
- Generates high-quality instruction→output pairs
- Supports:
  - `--max <number>`: Maximum memories to process
  - `--chunk <number>`: Memories per LLM batch
  - `--model <name>`: Override model name
  - `--username <name>`: User whose memories to process
- Outputs JSONL to `out/datasets/YYYY-MM-DD/ai_dataset.jsonl`

**Trigger**: Manual (typically during training preparation)

**Configuration**: `etc/ai-dataset-builder.json`

**CLI Usage**:
```bash
pnpm tsx brain/agents/ai-dataset-builder.ts --output ./out/datasets/2025-10-31/ai_dataset.jsonl --username greggles --max 2000
```

---

### 18. AI Dataset Builder (Restrictive)

**File**: `brain/agents/ai-dataset-builder-restrictive.ts`

**Purpose**: Same as AI Dataset Builder but with stricter quality filtering.

**Behavior**:
- Identical functionality to `ai-dataset-builder.ts`
- Different system prompt emphasizing quality over quantity
- More restrictive filtering thresholds

**Trigger**: Manual

**Configuration**: `etc/ai-dataset-builder-restrictive.json` (if exists)

---

### 19. User Dataset Builder Agent

**File**: `brain/agents/user-dataset-builder.ts`

**Purpose**: Builds training datasets for specific users.

**Behavior**:
- Collects:
  1. All episodic memories
  2. Therapy session transcripts
  3. Chat conversations
- Uses curator model to generate high-quality training samples
- Outputs JSONL with instruction/input/output format

**Trigger**: Manual

**CLI Usage**:
```bash
npx tsx brain/agents/user-dataset-builder.ts --username greggles --output out/adapters/2025-11-14/dataset.jsonl --max 3000
```

---

### 20. Curated Aggregator Agent

**File**: `brain/agents/curated-aggregator.ts`

**Purpose**: Aggregates LLM-curated conversations for training.

**Behavior**:
- Reads from `memory/curated/conversations/*.json` (output of curator.ts)
- Filters conversations marked `suitableForTraining: true`
- Converts to `CuratedSample[]` format
- Preserves cognitive mode metadata (dual/emulation/agent)
- Outputs for mode-formatter

**Trigger**: Training pipeline (before mode-formatter)

**Input**: `memory/curated/conversations/*.json`

**Output**: Array of `CuratedSample` objects

---

## Training Pipeline Agents

### 21. Adapter Builder Agent

**File**: `brain/agents/adapter-builder.ts`

**Purpose**: Builds curated instruction→response pairs from user data.

**Behavior**:
- Collects user-specific data:
  1. Therapy sessions (highest priority)
  2. Episodic memories
  3. Chat conversations
- Uses configurable curator model to evaluate, filter, and improve samples
- Batch curation with quality threshold filtering
- Persona-aware sample generation
- **MULTI-USER**: Processes specified user with isolated context

**Trigger**: Training pipeline (full-cycle.ts, full-cycle-local.ts)

**Configuration**: `etc/training-data.json` → `curator` section

**CLI Usage** (typically called by full-cycle):
```bash
pnpm tsx brain/agents/adapter-builder.ts --username greggles --output out/adapters/2025-11-14/dataset.jsonl
```

---

### 22. Auto-Approver Agent

**File**: `brain/agents/auto-approver.ts`

**Purpose**: Automatically approves high-quality datasets based on thresholds.

**Behavior**:
- Validates dataset metadata:
  - Minimum pair count (default: 30)
  - High-confidence percentage (default: 60%)
  - Reflection percentage (default: 20%)
  - Maximum low-confidence (default: 20%)
- Runs in **dry-run mode by default** for safety
- Requires explicit `dryRun: false` in config to activate

**Trigger**: Training pipeline (after dataset generation)

**Configuration**: `etc/auto-approval.json`

**CLI Usage**:
```bash
tsx auto-approver.ts 2025-10-21
```

---

### 23. LoRA Trainer Agent

**File**: `brain/agents/lora-trainer.ts`

**Purpose**: Remote orchestrator for RunPod LoRA training.

**Behavior**:
- Manages complete training lifecycle:
  1. Upload dataset to RunPod via SSH
  2. Upload training config and scripts
  3. Execute training remotely
  4. Monitor training progress
  5. Download adapter (.safetensors format)
  6. Convert to GGUF for Ollama
  7. Upload to S3 (if configured)
  8. Clean up remote resources
- SSH connection management with keepalive (8+ hour support)
- Progress tracking and audit logging

**Trigger**: Full-cycle orchestrators (full-cycle.ts)

**Configuration**: `.env` → `RUNPOD_API_KEY`, `SSH_KEY_PATH`, S3 credentials

**Requirements**:
- RunPod account with API key
- SSH key for pod access
- S3 bucket (optional, for artifact storage)

---

### 24. Fine-Tune Trainer Agent

**File**: `brain/agents/fine-tune-trainer.ts`

**Purpose**: RunPod wrapper for **full fine-tuning** (not LoRA).

**Behavior**:
- Reuses `lora-trainer.ts` infrastructure but adapts for full fine-tuning:
  - Uploads `fine_tune_dataset.jsonl` instead of `unsloth_dataset.jsonl`
  - Uploads `train_full_finetune.py` instead of `train_unsloth.py`
  - Uses `fine-tune-config.json`
  - Downloads **complete model** instead of adapter
- Supports cognitive mode filtering (dual/emulation/agent)

**Trigger**: Fine-tune-cycle orchestrator (fine-tune-cycle.ts)

**Configuration**: `etc/fine-tune-config.json`, `etc/fine-tune-dual.json`, `etc/fine-tune-emulation.json`, `etc/fine-tune-agent.json`

---

### 25. Fine-Tune Cycle Orchestrator

**File**: `brain/agents/fine-tune-cycle.ts`

**Purpose**: Coordinates full fine-tuning pipeline.

**Behavior**:
- **Phase 1: Data Preparation**
  1. Curate memories (clean, assign modes)
  2. Format samples (apply mode tags)
  3. Apply schema (model-family wrappers)
  4. Export JSONL (training dataset)
  5. Validate dataset
- **Phase 2: Remote Training**
  6. Run remote fine-tuning on RunPod
- **Phase 3: Deployment**
  7. Load fine-tuned model to Ollama

**Trigger**: Manual

**Configuration**: `etc/training.json`, `etc/fine-tune-*.json`

**CLI Usage**:
```bash
tsx brain/agents/fine-tune-cycle.ts --username greggles --base-model qwen3-coder:30b --mode-filter dual --monthly-training
```

**Flags**:
- `--username <name>`: User profile
- `--base-model <name>`: HuggingFace model identifier
- `--mode-filter <mode>`: dual/emulation/agent
- `--max-samples <n>`: Limit dataset size
- `--skip-validation`: Skip dataset validation
- `--days-recent <n>`: Recent sample window (for monthly training)
- `--old-samples <n>`: Historical sample count (for monthly training)
- `--monthly-training`: Enable monthly training defaults

---

### 26. Full-Cycle Orchestrator (Remote)

**File**: `brain/agents/full-cycle.ts`

**Purpose**: Complete **LoRA adapter** training pipeline on RunPod.

**Behavior**:
- **Phase 1: Dataset Building**
  1. Build dataset (via adapter-builder.ts)
  2. Prepare config
- **Phase 2: Remote Training**
  3. Run remote training (via runRemoteTraining from lora-trainer.ts)
- **Phase 3: Evaluation & Activation**
  4. Evaluate adapter (eval-adapter.ts)
  5. Activate adapter (setActiveAdapter)
  6. Auto-load to Ollama (if successful)
- **Phase 4: Cleanup**
  7. Clean up stuck processes
  8. Remove temporary files
  9. Write summary on failure

**Trigger**: Manual or automated training flows

**Configuration**: `etc/training.json`, `.env`

**CLI Usage**:
```bash
npx tsx brain/agents/full-cycle.ts --username greggles
```

**Requirements**:
- RunPod account
- SSH key
- S3 bucket (optional)

---

### 27. Full-Cycle Orchestrator (Local)

**File**: `brain/agents/full-cycle-local.ts`

**Purpose**: Complete **LoRA adapter** training pipeline on **local machine**.

**Behavior**:
- Same phases as `full-cycle.ts` but runs training locally
- Requires:
  - Python 3.10+ with unsloth installed
  - CUDA-capable GPU (NVIDIA)
  - At least 24GB VRAM for 20B models
- Training execution:
  - Spawns `train_unsloth.py` with local GPU
  - Monitors progress
  - Handles errors and cleanup

**Trigger**: Manual

**Configuration**: `etc/training.json`

**CLI Usage**:
```bash
npx tsx brain/agents/full-cycle-local.ts --username greggles
```

**Hardware Requirements**:
- NVIDIA GPU with 24GB+ VRAM (for 20B models)
- CUDA toolkit installed
- Python 3.10+ with unsloth

---

## Training Support Agents

### 28. Adapter Merger Agent

**File**: `brain/agents/adapter-merger.ts`

**Purpose**: Merges multiple LoRA adapters into single consolidated adapter.

**Behavior**:
- Finds all `.safetensors` adapters in `out/adapters/YYYY-MM-DD/` directories
- Supports merge methods:
  - `linear`: Simple weighted average
  - `ties`: Task-specific merge
  - `dare_ties`: Dropout-aware merge
  - `slerp`: Spherical linear interpolation
- Requires Python `mergekit` library
- Falls back to simple concatenation if mergekit unavailable
- Outputs merged adapter to `out/adapters/merged-<timestamp>/`

**Trigger**: Manual (typically for dual-adapter system)

**Configuration**: Merge config passed as parameter

**CLI Usage**:
```bash
./bin/mh adapter merge --method linear --output history-merged
```

---

### 29. GGUF Converter Agent

**File**: `brain/agents/gguf-converter.ts`

**Purpose**: Converts LoRA adapters from `.safetensors` to `.gguf` format for Ollama.

**Behavior**:
- Validates adapter exists (`adapter_model.safetensors`)
- Ensures `llama.cpp` is available (clones if missing)
- Checks Python dependencies (`gguf` package)
- Runs `llama.cpp/convert_lora_to_gguf.py`
- Outputs `adapter.gguf` in same directory

**Trigger**: Training pipeline (after training completes)

**Configuration**: None (uses llama.cpp defaults)

**CLI Usage**:
```bash
tsx gguf-converter.ts 2025-10-21
```

**Requirements**:
- `llama.cpp` (auto-cloned to `vendor/llama.cpp/`)
- Python 3 with `gguf` package

---

### 30. Eval Adapter Agent

**File**: `brain/agents/eval-adapter.ts`

**Purpose**: Scores trained LoRA adapters for groundedness, style consistency, and safety.

**Behavior**:
- **Current Implementation**: Heuristic evaluation
  - Checks adapter file exists and is non-zero
  - Validates dataset quality metrics (high-confidence %, reflection %)
  - Adapter size heuristic (10-100MB = good)
  - Calculates composite score (0-1)
- **Future Implementation**: Real evaluation
  - Load validation set (held-out 10% from dataset)
  - Run inference with adapted model
  - Score outputs vs expected
  - Check for hallucinations/drift

**Trigger**: Training pipeline (after adapter conversion)

**Configuration**: None

**CLI Usage**:
```bash
tsx eval-adapter.ts 2025-10-21
```

**Output**: `out/adapters/YYYY-MM-DD/eval.json`

---

### 31. Training Exporter Agent

**File**: `brain/agents/training-exporter.ts`

**Purpose**: Converts schema-applied samples to JSONL format.

**Behavior**:
- Converts `SchemaAppliedSample[]` to `{"input": "...", "output": "..."}` JSONL
- Validates:
  - Proper JSON escaping
  - No malformed records
  - Each record standalone
  - No mode contamination
- Logs warnings for suspicious patterns

**Trigger**: Training pipeline (after schema application)

**Input**: `SchemaAppliedSample[]` array

**Output**: JSONL string

---

### 32. Mode Formatter Agent

**File**: `brain/agents/mode-formatter.ts`

**Purpose**: Applies cognitive mode formatting tags to curated samples.

**Behavior**:
- Transforms `CuratedSample` → `FormattedSample`
- **Dual Mode**: `<thought>: ${user_text}` → `<world>: ${assistant_text}`
- **Emulation Mode**: `<user>: ${user_text}` → `<assistant>: ${assistant_text}`
- **Agent Mode**: `<instruction>: ${user_text}` → `<action>: ${assistant_text}`
- **CRITICAL**: Only applies formatting tags, does not modify content

**Trigger**: Training pipeline (after curation, before schema application)

**Input**: `CuratedSample[]` array

**Output**: `FormattedSample[]` array

---

## Persona & Analysis Agents

### 33. Psychoanalyzer Agent

**File**: `brain/agents/psychoanalyzer.ts`

**Purpose**: Reviews recent memories and incrementally updates persona files.

**Behavior**:
- Uses psychotherapist model to extract personality insights
- Reviews recent episodic memories (configurable window)
- Identifies patterns in:
  - Communication style
  - Values and beliefs
  - Emotional responses
  - Decision-making patterns
- Incrementally updates `persona/*.json` files
- **MULTI-USER**: Processes specified user with isolated context

**Trigger**: Manual or scheduled

**Configuration**: `etc/psychoanalyzer.json`

**CLI Usage**:
```bash
./bin/mh agent run psychoanalyzer
```

---

### 34. Digest Agent

**File**: `brain/agents/digest.ts`

**Purpose**: Builds long-term thematic understanding from memories.

**Behavior**:
- Analyzes recent memories (default: 14 days)
- Extracts:
  - Recurring themes (with frequency)
  - Frequently referenced facts
  - Catchphrases and quirks
  - Behavioral patterns
- Updates persona cache for quick reference
- Builds long-term thematic digest for persona model

**Trigger**: Manual or scheduled

**Configuration**: None (uses defaults)

**CLI Usage**:
```bash
./bin/mh agent run digest
```

**Part of**: Phase 5 (Conscious/Unconscious State)

---

### 35. Summarizer Agent

**File**: `brain/agents/summarizer.ts`

**Purpose**: Summarizes conversation sessions into concise overviews.

**Behavior**:
- Analyzes conversations by session ID
- Generates summaries of:
  - Key topics
  - Decisions made
  - Outcomes
  - Tools used
- Stores summaries as episodic events
- **Mode-aware behavior**:
  - Dual/Agent: Summaries saved to episodic memory
  - Emulation: Uses ephemeral summaries (not saved)
- Can be triggered manually or automatically on buffer overflow
- **MULTI-USER**: Processes specified user with isolated context

**Trigger**: Manual or automatic (on conversation buffer overflow)

**Configuration**: None

**CLI Usage**:
```bash
tsx brain/agents/summarizer.ts --session conv-1699358400-x7k2p9q1
tsx brain/agents/summarizer.ts --auto  # Summarize all unsummarized sessions
```

**Part of**: Phase 3 (Memory Continuity)

---

## Audio Processing Agents

### 36. Transcriber Agent

**File**: `brain/agents/transcriber.ts`

**Purpose**: Monitors `memory/audio/inbox` for audio files and transcribes them.

**Behavior**:
- Polls every 10 seconds for new audio files
- Auto-detects best available provider:
  1. `whisper.cpp` (local, fast)
  2. OpenAI Whisper API (cloud, high-quality)
  3. Mock (fallback for development)
- Supports configuration overrides:
  - Provider selection
  - Model selection (e.g., base.en, small, medium, large)
  - Language
  - Temperature
- Saves transcripts to `memory/audio/transcripts/<audioId>.txt`
- Creates metadata file with transcription details

**Trigger**: Night pipeline or manual

**Configuration**: `etc/audio.json` → `transcription` section

**CLI Usage**:
```bash
./bin/mh agent run transcriber
```

---

### 37. Audio Organizer Agent

**File**: `brain/agents/audio-organizer.ts`

**(Already documented above in Memory Processing section)**

---

## System Services

### 38. Scheduler Service

**File**: `brain/agents/scheduler-service.ts`

**Purpose**: Background service that runs the AgentScheduler.

**Behavior**:
- Manages all agent triggers:
  - **Interval**: Run every N seconds (e.g., organizer every 300s)
  - **Time-of-day**: Run at specific time (e.g., night-pipeline at 02:00)
  - **Event**: Run on specific events (e.g., new memory created)
  - **Activity**: Run after N seconds of inactivity (e.g., boredom-maintenance after 900s)
- Single-instance guard (prevents multiple schedulers)
- Watches `etc/agents.json` for configuration changes
- Reloads config automatically on file change
- Preloads embedding model in background
- Graceful shutdown on SIGINT/SIGTERM

**Trigger**: Runs continuously as background service

**Configuration**: `etc/agents.json`

**CLI Usage**:
```bash
# Started automatically by web dev server
# Or manually:
./bin/mh agent run scheduler-service
```

**Lifecycle**:
- `scheduler.loadConfig()` — Load agent configurations
- `scheduler.start()` — Begin scheduling
- `scheduler.stop()` — Graceful shutdown

---

### 39. Operator (ReAct Loop)

**File**: `brain/agents/operator-react.ts`

**Purpose**: Modern agentic loop using Reason + Act pattern.

**Behavior**:
- **Unlike legacy static planner**, this operator:
  - Plans **ONE step at a time**
  - Observes the result
  - Adapts the next step based on what it learned
- Prevents hallucinated filenames and other issues caused by planning all steps upfront
- **Structured Scratchpad** with explicit blocks:
  - Thought: LLM reasoning about what to do
  - Action: Tool invocation with args
  - Observation: Result of tool execution
- **Tool Catalog**: Auto-generated skill documentation (cached for 1 minute)
- **Observation Modes**:
  - `verbatim`: Raw JSON output (for "list tasks" queries)
  - `structured`: Bullet lists with only observed data
  - `narrative`: Human-readable summaries (V1 style)
- **Response Styles** (via `conversational_response` skill):
  - `default`: Conversational (temp 0.7)
  - `strict`: Data-only, no embellishment (temp 0.0)
  - `summary`: Brief 2-3 sentence overview (temp 0.3)
- **Error Recovery**:
  - Intelligent retry with contextual suggestions
  - Failure loop detection (prevents repeated failures)
  - Error codes: FILE_NOT_FOUND, PERMISSION_DENIED, INVALID_ARGS, etc.
- **Verbatim Short-Circuit**:
  - Detects "list tasks" intent
  - Skips planning loop, returns raw structured data
  - Saves 2+ LLM calls per query
- **Feature Flag**: Controlled by `etc/runtime.json` → `operator.reactV2` (default: false)

**Trigger**: Web UI chat or API requests

**Configuration**: `etc/operator.json`

**Key Functions**:
- `runOperatorWithFeatureFlag()` — Main entry point
- `runReActLoopV2()` — Execute ReAct loop
- `planNextStepV2()` — LLM planning with tool catalog

**To Enable V2**: Edit `etc/runtime.json`, set `"operator": { "reactV2": true }`

---

### 40. Headless Watcher Service

**File**: `brain/agents/headless-watcher.ts`

**Purpose**: Monitors runtime config and manages agent lifecycle based on headless mode.

**Behavior**:
- Watches `etc/runtime.json` for changes
- **When headless mode enabled**:
  - Stops all local agents (organizer, reflector, curiosity, etc.)
  - Keeps tunnel and web server running
  - Provides keepalive mechanism to prevent system sleep
- **When headless mode disabled**:
  - Resumes normal agent operations
  - Starts default agents (scheduler-service, boredom-service, sleep-service)
- **MULTI-USER**: System-level service managing global runtime state
- Retry logic with exponential backoff (max 5 retries)

**Trigger**: Runs continuously as background service

**Configuration**: `etc/runtime.json` → `headless` section

**CLI Usage**:
```bash
./bin/mh agent run headless-watcher
```

---

### 41. Bootstrap Wrapper

**File**: `brain/agents/_bootstrap.ts`

**Purpose**: Establishes user context for agents before they execute.

**Behavior**:
- Agents run as standalone Node processes
- Need explicit context to access user-specific paths:
  - `paths.persona`, `paths.episodic`, etc.
- Bootstrap wrapper:
  1. Finds first owner user
  2. Establishes user context via `withUserContext()`
  3. Dynamically imports agent module within context
  4. Calls `default()` or `run()` function if exported
- Uses `systemPaths.brain` (system-level path) before context is set

**Usage**:
```bash
tsx brain/agents/_bootstrap.ts <agent-name>
```

**Example**:
```bash
tsx brain/agents/_bootstrap.ts organizer
```

**Script Overrides**:
- `curiosity` → `curiosity-service.ts`

---

## Agent Scheduler Configuration

All agents are configured via **`etc/agents.json`**. The scheduler service reads this file and manages agent lifecycle.

### Configuration Structure

```json
{
  "agents": {
    "organizer": {
      "enabled": true,
      "trigger": {
        "type": "activity",
        "inactivityThreshold": 300
      },
      "description": "Enrich memories with tags and entities"
    },
    "reflector": {
      "enabled": false,
      "trigger": {
        "type": "interval",
        "interval": 3600
      },
      "description": "Generate reflections (disabled in favor of boredom-maintenance)"
    },
    "boredom-maintenance": {
      "enabled": true,
      "trigger": {
        "type": "activity",
        "inactivityThreshold": 900
      },
      "description": "Activity-based reflection triggering"
    },
    "curiosity": {
      "enabled": true,
      "trigger": {
        "type": "activity",
        "inactivityThreshold": 900
      },
      "description": "User-facing curiosity questions"
    },
    "curator": {
      "enabled": true,
      "trigger": {
        "type": "interval",
        "interval": 1800
      },
      "description": "Prepare training data"
    },
    "night-pipeline": {
      "enabled": true,
      "trigger": {
        "type": "time_of_day",
        "time": "02:00"
      },
      "description": "Nightly processing pipeline"
    }
  }
}
```

### Trigger Types

1. **Interval**: Run every N seconds
   ```json
   { "type": "interval", "interval": 3600 }
   ```

2. **Time-of-day**: Run at specific time (24-hour format)
   ```json
   { "type": "time_of_day", "time": "02:00" }
   ```

3. **Activity**: Run after N seconds of conversation inactivity
   ```json
   { "type": "activity", "inactivityThreshold": 900 }
   ```

4. **Event**: Run on specific events (planned)
   ```json
   { "type": "event", "event": "memory_created" }
   ```

---

## Common CLI Commands

### Running Agents Manually

```bash
# Run specific agent
./bin/mh agent run <agent-name>

# Examples
./bin/mh agent run organizer
./bin/mh agent run reflector
./bin/mh agent run curiosity-service
./bin/mh agent run dreamer
./bin/mh agent run curator
./bin/mh agent run psychoanalyzer

# List available agents
./bin/mh agent list

# Show agent statistics
./bin/mh agent status

# Monitor agent processing
./bin/mh agent monitor

# List running agent processes
./bin/mh agent ps

# Stop running agent
./bin/mh agent stop <name>
```

### Training Pipeline

```bash
# Full-cycle LoRA training (remote)
npx tsx brain/agents/full-cycle.ts --username greggles

# Full-cycle LoRA training (local)
npx tsx brain/agents/full-cycle-local.ts --username greggles

# Fine-tuning cycle (full model)
tsx brain/agents/fine-tune-cycle.ts --username greggles --base-model qwen3-coder:30b --mode-filter dual

# Build dataset only
pnpm tsx brain/agents/adapter-builder.ts --username greggles --output out/adapters/2025-11-14/dataset.jsonl

# Evaluate adapter
tsx eval-adapter.ts 2025-10-21

# Convert to GGUF
tsx gguf-converter.ts 2025-10-21
```

---

## Multi-User Support

Many agents are **MULTI-USER capable**, processing all logged-in users sequentially with isolated contexts:

- ✅ **Organizer** — Processes all users' unprocessed memories
- ✅ **Curiosity Service** — Asks questions to all logged-in users
- ✅ **Inner Curiosity** — Generates internal questions for all users
- ✅ **Curiosity Researcher** — Researches questions for all users
- ✅ **Dreamer** — Creates dreams for all users during sleep cycle
- ✅ **Memory Metrics Cache** — Updates metrics for all users
- ✅ **Curator** — Prepares training data for all users
- ✅ **Psychoanalyzer** — Analyzes memories for specified user
- ✅ **Summarizer** — Summarizes conversations for specified user

**System-level agents** (no user context):
- ⚙️ **Scheduler Service** — Manages all agent triggers
- ⚙️ **Headless Watcher** — Manages runtime mode
- ⚙️ **Sleep Service** — Orchestrates nightly pipeline
- ⚙️ **Operator (ReAct)** — Executes tasks (user context via API request)

---

## Agent Dependencies

### Python Dependencies

Some agents require Python packages:

- **unsloth** — LoRA training (full-cycle, full-cycle-local, lora-trainer)
- **gguf** — GGUF conversion (gguf-converter)
- **mergekit** — Adapter merging (adapter-merger)
- **whisper** — Audio transcription (transcriber, if using whisper.cpp)

### External Services

Some agents require external services:

- **Ollama** — LLM inference (organizer, curator, reflector, curiosity, inner-curiosity, psychoanalyzer, ai-dataset-builder)
- **RunPod** — Remote training (lora-trainer, fine-tune-trainer)
- **OpenAI Whisper API** — Audio transcription (transcriber, optional)
- **S3** — Artifact storage (lora-trainer, optional)

### System Requirements

**For Local Training** (full-cycle-local):
- NVIDIA GPU with 24GB+ VRAM
- CUDA toolkit
- Python 3.10+
- unsloth library

**For Remote Training** (full-cycle, lora-trainer):
- RunPod account with API key
- SSH key for pod access
- S3 bucket (optional)

---

## Troubleshooting

### Agent Won't Start

**Issue**: `Another instance is already running`

**Solution**: Check if lock file's PID is actually alive:
```bash
ps -p <pid>  # Check process
rm logs/run/locks/<agent-name>.lock  # Remove stale lock
```

### Organizer Not Processing Memories

**Issue**: Memories remain unprocessed

**Checklist**:
1. Is Ollama running? `./bin/mh ollama status`
2. Is organizer enabled in `etc/agents.json`?
3. Check logs: `tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep organizer`
4. Run manually: `./bin/mh agent run organizer`

### Reflector Not Generating Reflections

**Issue**: No inner dialogue events

**Solution**: Reflector is disabled in favor of boredom-maintenance. Check `etc/agents.json`:
```json
{
  "boredom-maintenance": {
    "enabled": true,
    "trigger": { "type": "activity", "inactivityThreshold": 900 }
  }
}
```

### Training Pipeline Fails

**Issue**: RunPod training errors

**Checklist**:
1. Verify `.env` credentials: `RUNPOD_API_KEY`, `SSH_KEY_PATH`
2. Check RunPod quota and credit balance
3. Review training logs in `metahuman-runs/<username>/<date>/<run-label>/`
4. Verify GPU availability: Run `nvidia-smi` on pod
5. Check dataset quality: Review `metadata.json`

### Curiosity Questions Not Appearing

**Issue**: No curiosity questions in chat

**Checklist**:
1. Is curiosity enabled in `etc/agents.json`?
2. Check trust level in `persona/core.json` (requires `suggest` or higher)
3. Check `maxOpenQuestions` in `etc/curiosity.json` (must be > 0)
4. Check inactivity threshold (default: 900s = 15 min)
5. Run manually: `./bin/mh agent run curiosity-service`

---

## Related Documentation

- **[CLI Reference](06-cli-reference.md)** — Agent management commands
- **[Core Concepts](04-core-concepts.md)** — System architecture overview
- **[Memory System](07-memory-system.md)** — Episodic memory structure
- **[Cognitive Modes](core-features/04b-cognitive-modes.md)** — Dual/Agent/Emulation modes
- **[LoRA Adapter Training](11-special-features.md#lora-adapter-training)** — Training pipeline details
- **[Fine-Tuning & Monthly Updates](13-advanced-usage.md#full-fine-tuning-with-monthly-updates)** — Cognitive mode training
- **[Configuration Files](14-configuration-files.md)** — etc/agents.json, etc/curiosity.json, etc/training.json

---

**MetaHuman OS agents work 24/7 to extend your mind!** 🧠⚡
