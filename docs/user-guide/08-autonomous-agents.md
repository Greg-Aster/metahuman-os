## Autonomous Agents

MetaHuman OS runs several autonomous agents that process memories and generate insights in the background.

**Note:** The behavior of these agents can change based on the active [Cognitive Mode](04-core-concepts.md#8-cognitive-modes-upcoming-feature). For example, in "Agent Mode", proactive agents like the `reflector` and `dreamer` may be disabled.

### 1. Organizer Agent

**Purpose:** Enriches memories with AI-extracted tags and entities.

**How it works:**
1. Scans `memory/episodic/` for unprocessed memories
2. Uses Ollama (phi3:mini) to analyze content
3. Extracts tags (categories) and entities (people, places, concepts)
4. Updates memory files with enriched metadata

**Run manually:**
```bash
./bin/mh agent run organizer
```

**Auto-run:** Started automatically with `pnpm dev` in the web UI.

### 2. Reflector Agent

**Purpose:** Generates thoughtful reflections on recent memories.

**Features:**
- Uses weighted random selection (recent memories prioritized)
- 7 reflection styles: connections, progress, feelings, learning, questions, contrast, future
- Creates 1-3 sentence first-person thoughts
- Stored as `type: 'reflection'` memories

**Run manually:**
```bash
./bin/mh agent run reflector
```

**Auto-triggered:** By the boredom-service at configurable intervals.

### 3. Boredom Service

**Purpose:** Simulates a "wandering mind" by triggering reflections during idle time.

**Configuration:** `etc/boredom.json`
```json
{
  "level": "medium",
  "showInChat": true,
  "intervals": {
    "high": 60,      // Reflect every 60 seconds
    "medium": 300,   // Reflect every 5 minutes
    "low": 900,      // Reflect every 15 minutes
    "off": -1        // Disabled
  }
}
```

**Control via Web UI:**
1. Open the Right Sidebar
2. Adjust the "Boredom Control" slider
3. Choose: Manual Only | Focused | Default | Wandering

**Run as service:**
```bash
./bin/mh agent run boredom-service
```
Keep this running in the background for autonomous reflection.

### 4. Dreamer Agent

**Purpose:** Creates surreal, metaphorical dreams from memory fragments during the nightly sleep cycle, and generates "overnight learnings" that adapt the operator profile.

**How it works:**
1. Samples weighted memories (recent + diverse) from the past 7 days
2. Uses high-creativity LLM settings (temperature 0.95) to weave memories into abstract narratives
3. Synthesizes 1-3 short dream entries with links to source memories
4. Extracts implicit/explicit preferences, writing style patterns, and decision heuristics
5. Writes overnight learnings to `memory/procedural/overnight/overnight-learnings-YYYYMMDD.md` with citations
6. Stores dreams as `type: 'dream'` memories in episodic storage

**Dream Schema:**
```json
{
  "id": "evt-202510200130001",
  "timestamp": "2025-10-20T01:30:00.000Z",
  "content": "A surreal dream narrative...",
  "metadata": {
    "type": "dream",
    "sources": ["episodic/2025/2025-10-19/...json"],
    "confidence": 0.7
  }
}
```

**Run manually:**
```bash
./bin/mh agent run dreamer
```

**Auto-triggered:** By sleep-service during sleep hours (respects `maxDreamsPerNight` limit).

### 5. Sleep Service

**Purpose:** Orchestrates the complete nightly "sleep window" pipeline—dreams, audio processing, preference learning, and optional semi-automated LoRA model training.

**Configuration:** `etc/sleep.json`
```json
{
  "enabled": true,
  "window": { "start": "23:00", "end": "06:30" },
  "minIdleMins": 15,
  "maxDreamsPerNight": 3,
  "showInUI": true,
  "evaluate": true,
  "adapters": {
    "prompt": true,
    "rag": true,
    "lora": false  // Set to true to enable weekly LoRA training
  },
  "loraSchedule": "sunday-3am"  // When to run LoRA training
}
```

**Nightly Pipeline Steps:**

1. **Enter Sleep**: When window + idle thresholds are met
2. **Generate Dreams**: Triggers `dreamer` agent (up to `maxDreamsPerNight`)
3. **Process Audio Backlog**: Triggers `night-processor` (transcriber + audio-organizer)
4. **Build Adapters** (optional): Creates prompt/RAG/LoRA adapters from curated training pairs
5. **Evaluate**: Runs quality/safety checks on generated learnings and adapters
6. **Morning Load**: Composes and activates the daily operator profile with overnight learnings

**Semi-Automated LoRA Training Pipeline (Weekly):**

When `adapters.lora` is enabled in the sleep configuration, the sleep-service orchestrates a much more comprehensive weekly training cycle. This typically runs on Sunday at 3 AM (configurable via `loraSchedule`).

**Full LoRA Automation Workflow:**

1. **Dataset Building** (`adapter-builder` agent):
   - Scans recent memories (configurable window, default 14-90 days)
   - Applies quality filters (min content length, requires tags/entities)
   - Extracts training pairs (instruction, input, output format)
   - Saves dataset to `out/datasets/instructions.jsonl`

2. **Quality Check & Auto-Approval** (`auto-approver` agent):
   - Evaluates dataset for quality metrics:
     - Sample count (minimum 50 samples required)
     - Average content length
     - Diversity score (unique vs. total samples)
     - Tag/entity coverage
   - Automatically approves datasets meeting quality thresholds
   - Rejects low-quality datasets with detailed failure reasons
   - Logs approval decision to audit trail

3. **Remote or Local Training** (`lora-trainer` agent):
   - **Remote Mode** (RunPod): Automatically launches GPU pod, uploads dataset, trains on cloud GPU, downloads merged GGUF
   - **Local Mode**: Uses local GPU to train adapter with Unsloth
   - Training parameters defined in `etc/training.json`
   - Tracks progress with real-time status updates to `logs/status/lora-training-*.json`

4. **Model Evaluation** (`eval-adapter` agent):
   - Runs quality checks on trained model
   - Compares performance to baseline
   - Tests grounding accuracy, style adherence, and safety
   - Records evaluation metrics

5. **Activation**:
   - Creates Ollama modelfile for the new merged model
   - Loads model into Ollama
   - Updates `etc/agent.json` to set as active model
   - Archives previous model version

**How it works:**
- Checks every 30 minutes if conditions are met (in sleep window + system idle)
- Respects `maxDreamsPerNight` limit to prevent over-generation
- Handles overnight schedules (e.g., 23:00 - 06:30 crosses midnight)
- All steps are fully audited with detailed event logging
- Weekly LoRA training runs on a separate schedule (e.g., Sunday 3 AM)
- Supports three-tier adaptation model:
  - **Tier 1** (no training): Prompt adapter + RAG expansion
  - **Tier 2** (light training): LoRA adapters with semi-automated approval
  - **Tier 3** (future): Self-distillation with strict safety eval

**LoRA Training Configuration:**

Enable weekly LoRA training by editing `etc/sleep.json`:
```json
{
  "adapters": {
    "lora": true,
    "autoMerge": true,  // Automatically merge and activate trained models
    "schedule": "sunday-3am"  // When to run training
  }
}
```

**Manual Override:**

You can also trigger LoRA training manually:
```bash
# Build dataset for today
./bin/mh-dataset-builder

# Train locally
./bin/mh-train-local

# OR train remotely on RunPod
./bin/mh-train-remote
```

**Run as service:**
```bash
./bin/mh agent run sleep-service
```

**Safety Features:**
- Dry-run mode available before loading adapters
- Thresholded acceptance based on evaluation metrics (auto-approver)
- One-click rollback to previous day's profile
- Trust-aware: Only writes to `memory/`, `persona/`, `out/`, `logs/`
- Quality filters prevent training on low-quality or insufficient data
- Complete audit trail of all training decisions

**Monitoring:**

Track the LoRA training pipeline via:
- **Web UI**: Navigate to "Training" in the left sidebar to see real-time progress
- **Logs**: Check `logs/audit/YYYY-MM-DD.ndjson` for training events
- **Status files**: View `logs/status/lora-training-*.json` for detailed progress

### 6. Ingestor Agent

**Purpose:** Converts raw files into episodic memories.

**Workflow:**
1. Place files in `memory/inbox/`
2. Run ingestor
3. Files are read, split into chunks (2000 chars max), and converted to memories
4. Processed files moved to `memory/inbox/_archive/YYYY-MM-DD/`

**Run manually:**
```bash
./bin/mh agent run ingestor
```

**Batch ingest:**
```bash
./bin/mh ingest <file-or-directory>
```

### 7. Operator Agent

**Purpose:** Executes complex multi-step tasks using skills.

**How it works:**
- Takes user goals and classifies the intent into a **domain** (e.g., `tasks`, `calendar`).
- The planner calls the `catalog.describe('<domain>')` skill to retrieve available actions for that domain.
- It loads the relevant capability brief from `persona/capabilities/<domain>.md` for extra context.
- It breaks the goal into steps using the available skills.
- Executes the plan step-by-step, resolving placeholders to pass IDs from one step to the next.
- Reviews and critiques results.
- Handles complex file operations, git commands, web search, and more.

### 8. Auto-Approver Agent (Advanced)

**Purpose:** Quality-based dataset approval for LoRA adaptation.

**How it works:**
- Evaluates training datasets for quality metrics
- Automatically approves datasets meeting quality thresholds
- Runs in dry-run mode by default for safety

### 9. Adapter Builder Agent (Advanced)

**Purpose:** Generates training datasets for LoRA models.

**How it works:**
- Cycles through memories to create training pairs
- Applies quality filters to ensure high-quality data
- Formats data appropriately for training

### 10. LoRA Trainer Agent (Advanced)

**Purpose:** Orchestrates LoRA model training.

**How it works:**
- Detects available GPU resources
- Generates training configuration
- Runs training via Axolotl
- Handles errors and monitoring

### 11. Eval Adapter Agent (Advanced)

**Purpose:** Evaluates quality of trained adapters.

**How it works:**
- Runs heuristic quality checks on trained models
- Compares performance to baseline
- Records results for approval workflows

### 12. Transcriber Agent (Advanced)

**Purpose:** Transcribes raw audio files into text.

**How it works:**
- Watches the `memory/audio/inbox` directory for new audio files.
- Uses the configured speech-to-text engine (e.g., `whisper.cpp`) to generate a Markdown transcript.
- Saves the transcript to `memory/audio/transcripts` and archives the original audio file.

### 13. Audio Organizer Agent (Advanced)

**Purpose:** Converts transcripts into structured episodic memories.

**How it works:**
- Scans for unprocessed transcripts in `memory/audio/transcripts`.
- Uses an LLM to segment the transcript and extract key points, entities, and action items.
- Creates new episodic memories, linking them back to the source transcript file.

### 14. Night Processor Agent (Advanced)

**Purpose:** Runs nightly catch-up tasks for audio processing.

**How it works:**
- Triggered by the `sleep-service` during the configured sleep window.
- Runs the `transcriber` and `audio-organizer` agents to process any backlog of audio files from the day.

### 15. Drift Monitor Agent (Future)

**Purpose:** Automatically detect and revert poorly performing model adapters.

**Planned Features:**
- **Performance Tracking**: Monitors chat quality metrics over time
  - Response coherence scores
  - Memory grounding accuracy
  - User satisfaction signals (thumbs up/down, corrections)
  - Hallucination detection
- **Baseline Comparison**: Compares current model performance to baseline/previous versions
- **Drift Detection**: Identifies when model quality degrades beyond acceptable thresholds
- **Auto-Rollback**: Automatically reverts to the last known good model version when drift is detected
- **Alert System**: Notifies user when drift is detected and rollback occurs
- **Audit Trail**: Complete logging of all performance metrics and rollback decisions

**Configuration (Planned):** `etc/drift-monitor.json`
```json
{
  "enabled": true,
  "checkInterval": "1 hour",
  "metrics": {
    "coherence": { "threshold": 0.7, "weight": 0.4 },
    "grounding": { "threshold": 0.8, "weight": 0.3 },
    "hallucination": { "threshold": 0.1, "weight": 0.3 }
  },
  "autoRollback": true,
  "rollbackAfterFailures": 3
}
```

**How it will work:**
1. **Continuous Monitoring**: Tracks quality metrics for every chat interaction
2. **Rolling Window Analysis**: Evaluates performance over the last N interactions (e.g., 50-100)
3. **Threshold Detection**: Compares metrics against configured thresholds
4. **Grace Period**: Requires multiple failures before triggering rollback (prevents false positives)
5. **Automatic Rollback**: Reverts to previous model version if thresholds are exceeded
6. **User Notification**: Alerts user via web UI badge and audit log entry
7. **Re-evaluation**: Continues monitoring rolled-back model to ensure stability

**Status:** Planned for Phase 5 (Full Autonomy). See the "What's Next" chapter for timeline.

---

