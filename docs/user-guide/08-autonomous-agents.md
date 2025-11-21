## Autonomous Agents

MetaHuman OS runs several autonomous agents that process memories and generate insights in the background. These agents are increasingly powered by the system's **Multi-Model Architecture**, which dedicates specific AI models to different roles.

For example, the **Operator Agent**'s complex planning and skill execution is guided by the **Orchestrator** model, which specializes in executive function. In contrast, agents that generate conversational content, like the **Reflector Agent**, leverage the **Persona** model to ensure the voice and tone are aligned with your identity.

This specialization allows the system to use the best cognitive resources for each task, leading to more efficient and intelligent autonomous operation.

**Note:** The behavior of these agents can change based on the active [Cognitive Mode](04-core-concepts.md#8-cognitive-modes-upcoming-feature). For example, in "Agent Mode", proactive agents like the `reflector` and `dreamer` may be disabled.

### Agent Scheduler System

All autonomous agents are now managed by a centralized **Agent Scheduler** service that provides intelligent triggering and coordination. The scheduler is managed by the `run-with-agents` wrapper which is used automatically when you start the web UI via `pnpm dev`.

**Features:**
- **Centralized Management**: The `scheduler-service` via `etc/agents.json` configuration controls all agent behavior
- **Multiple Trigger Types** (via `etc/agents.json`):
  - `interval`: Run agent every N seconds (e.g., organizer every 60s)
  - `time-of-day`: Run agent at specific time (e.g., dreamer at 02:00)
  - `event`: Run agent when specific events occur (future feature)
  - `activity`: Run agent after inactivity threshold (e.g., boredom maintenance after 15 minutes idle)
- **Status Tracking**: Monitors agent execution count, errors, and last run time
- **Headless Mode Support**: Automatically adjusts which agents run based on headless mode setting
- **Single-Instance Protection**: Uses `running.json` registry to prevent duplicate agent instances

**Benefits:**
- **Centralized Control**: A single place to pause/resume/configure all agents.
- **Visibility**: It's easy to see what agents are scheduled and when they'll run.
- **Coordination**: Agents can depend on each other (e.g., "run organizer after memory created").
- **Debugging**: All agent triggers are logged to the audit trail.
- **User Experience**:
  - No agents trigger on boot (configurable).
  - Quiet hours support.
  - Activity detection (don't interrupt user).
- **Resource Management**:
  - Prevent too many agents from running simultaneously.
  - Priority-based scheduling.
  - Detect hung agents and restart them.

**How it works:**
- The `run-with-agents` wrapper automatically starts `scheduler-service` and `audio-organizer`
- Individual agents are registered via the `registerAgent()` system and tracked in `logs/run/running.json`
- Agents run in user context using the `_bootstrap.ts` wrapper from `brain/agents/`
- The system checks for headless mode and only runs essential services (`headless-watcher`) when enabled
- All agent processes are monitored and can be viewed with `mh agent ps`

**Run as service:**
```bash
./bin/mh agent run scheduler-service
```

The scheduler-service is automatically started with the web UI via the `run-with-agents` wrapper and replaces individual agent timers with a more robust, centralized system.

### Agent Execution and User Context

All agents now run within a specific user context using the `_bootstrap.ts` wrapper from `brain/agents/`. This ensures:

- **Per-user isolation**: Each agent operates within the correct user's profile space
- **Security**: Agents access only authorized memory and configuration files
- **Proper auditing**: All agent actions are logged with correct user context
- **Configuration consistency**: Agents use user-specific settings from `profiles/{username}/etc/`

The bootstrap wrapper handles:
- Loading the correct user context based on the agent's intended user
- Setting up file path resolution to the appropriate profile directory
- Maintaining audit trail with proper user attribution
- Managing model selection based on user preferences

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

**Auto-run:** Started automatically via scheduler-service.

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

**Auto-triggered:** By the scheduler-service at configurable intervals.

### 3. Train of Thought Agent

**Purpose:** Performs recursive reasoning by following memory associations, where one thought triggers related thoughts until natural conclusion.

**How it works:**
1. Selects a seed memory using weighted random sampling (recent memories prioritized via 14-day decay)
2. Generates initial thought/reflection on the seed memory
3. Extracts keywords from the thought to search for related memories
4. Evaluates whether to continue (based on confidence, repetition, keyword availability)
5. If continuing, searches for related memories and generates another thought
6. Repeats until max iterations (7) or natural conclusion
7. Aggregates all thoughts into a coherent reasoning chain with insights
8. Saves the consolidated chain as inner dialogue

**Key Features:**
- **Recursive reasoning**: Thoughts chain naturally via keyword extraction and memory search
- **Self-limiting**: Stops when thoughts become repetitive, confidence drops, or keywords exhausted
- **Memory-grounded**: Each thought is seeded from actual episodic memories
- **Configurable**: Max iterations, confidence threshold, temperature all adjustable

**Cognitive Graph Architecture:**
The train of thought system is implemented as a cognitive graph (`etc/cognitive-graphs/train-of-thought.json`) with 10 nodes:
1. `text_input` - Receives seed memory
2. `scratchpad_initializer` - Initializes thought accumulator
3. `thought_generator` - Generates reasoning steps with keywords
4. `scratchpad_updater` - Records each thought
5. `thought_evaluator` - Decides whether to continue or conclude
6. `loop_memory_search` - Finds related memories (excludes already-seen)
7. `conditional_router` - Loop back or exit based on evaluation
8. `thought_aggregator` - Synthesizes all thoughts into narrative/insight
9. `inner_dialogue_capture` - Saves result as inner dialogue
10. `audit_logger` - Logs completion

**Node Types Used:**
- `cognitive/thought_generator`: Generates reflections with confidence scores and keywords
- `cognitive/thought_evaluator`: Decides continuation based on confidence, iterations, repetition
- `cognitive/thought_aggregator`: Combines thoughts into narrative with key insight
- `cognitive/loop_memory_search`: Searches memories while tracking seen IDs

**Example Output:**
```
Step 1: The meeting with Sarah about the ML project reminded me of our earlier discussions...
Step 2: The pattern of iterative refinement in ML mirrors how we approach product design...
Step 3: This connects to the broader theme of embracing uncertainty in creative work...

Insight: The recursive nature of machine learning training shares a fundamental philosophy with
creative iteration—both require embracing uncertainty and learning from each attempt.
```

**Run manually:**
```bash
./bin/mh agent run train-of-thought
```

**Integration with Reflector:**
The reflector agent can optionally use train-of-thought for deeper reasoning. Enable via environment variable:
```bash
REFLECTOR_USE_TRAIN_OF_THOUGHT=true ./bin/mh agent run reflector
```

**Configuration Properties (in cognitive graph):**
- `thought_generator.temperature`: Creativity level (default: 0.75)
- `thought_generator.extractKeywords`: Whether to extract keywords (default: true)
- `thought_evaluator.minConfidence`: Minimum confidence to continue (default: 0.4)
- `thought_evaluator.maxIterations`: Maximum thought iterations (default: 7)
- `thought_aggregator.summaryStyle`: 'narrative' | 'bullets' | 'insight' (default: 'narrative')

### 4. Boredom Service

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

**Purpose:** Converts raw files from the inbox into episodic memories.

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

**Purpose:** Executes complex multi-step tasks using skills via the ReAct pattern (Reason-Act-Observe).

**Current Deployment Modes:**

#### V2 Service (Recommended) - ReasoningEngine
Unified reasoning service with enhanced capabilities:
- **Architecture**: Extracted from operator-react.ts into reusable `@metahuman/core/reasoning` module
- **Error Recovery**: 7 error types with contextual suggestions
  - `FILE_NOT_FOUND` → "Use fs_list to check what files exist"
  - `TASK_NOT_FOUND` → "Use task_list to see available tasks"
  - `PERMISSION_DENIED` → "Check file permissions with fs_list"
  - Plus 4 more error types
- **Failure Loop Detection**: Prevents repeated failures (triggers after 2 attempts)
- **3 Observation Modes**:
  - **Verbatim**: Raw JSON output
  - **Structured**: Formatted tables/summaries
  - **Narrative**: Natural language descriptions
- **Reasoning Depth Levels**: 0 (off), 1 (quick), 2 (focused), 3 (deep)
- **Fast-Path Optimizations**: Short-circuits simple queries (<100ms)
- **SSE Event Streaming**: Real-time reasoning progress in UI

**Enable via** `etc/runtime.json`:
```json
{
  "operator": {
    "reactV2": true,
    "useReasoningService": true
  }
}
```

**Example Execution:**
```
User: "Create a task to review the docs"

Thought 1: Need to create a task using task_create skill
Action 1: task_create({ title: "Review the docs", priority: "medium" })
Observation 1: ✅ Task created (ID: task-123)
Thought 2: Task created successfully, I have all needed info
Response: I've created a task "Review the docs" with medium priority (ID: task-123)
```

#### V2 Inline (Default) - `/api/operator` + `/api/operator/react`
Modern **Reason + Act** loop with inline implementation:
- Plans **ONE step at a time** based on actual observed results
- Never hallucinates data - only uses what it observes
- Adapts strategy when skills fail
- `/api/operator/react` streams progress via Server-Sent Events
- `/api/operator` now uses the same engine for synchronous responses
- Max 10 iterations with intelligent completion detection
- **Same logic as V2 Service**, just not extracted into separate module

**Enable via** `etc/runtime.json`:
```json
{
  "operator": {
    "reactV2": true,
    "useReasoningService": false
  }
}
```

> **Legacy planner removed:** The original planner/executor/critic loop (`brain/agents/operator.ts`) has been retired. Toggling `reactV2` now switches between the enhanced scratchpad loop and the lighter original ReAct loop; both `/api/operator` and `/api/operator/react` use the modern operator stack.

#### Testing the Operator

**Via Web UI:**
1. Open chat interface
2. Ask: "List files in docs/user-guide and summarize the first one"
3. Watch reasoning slider for step-by-step progress

**Via API:**
```bash
curl -X POST http://localhost:4321/api/operator/react \
  -H "Content-Type: application/json" \
  -d '{"goal": "List files in docs/user-guide"}'
```

**Via CLI:**
```bash
./bin/mh chat
> Create a task to review the documentation
```

#### Observing Reasoning Events

**Audit Log Events:**
- `reasoning_loop_started` - Loop begins
- `reasoning_thought` - Planning step
- `reasoning_action` - Skill execution
- `reasoning_observation` - Result processing
- `reasoning_completion` - Final response
- `reasoning_loop_completed` - Loop ends with metadata

**Tail audit logs:**
```bash
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep reasoning
```

#### Performance Comparison

| Feature | V1 Legacy | V2 Inline | V2 Service |
|---------|-----------|-----------|------------|
| **Planning** | Upfront | Step-by-step | Step-by-step |
| **Error Recovery** | Basic | Good | Enhanced (7 types) |
| **Loop Detection** | None | Basic | Advanced |
| **Observability** | Limited | Good | Excellent |
| **SSE Events** | No | Yes | Yes (dual format) |
| **Modularity** | Monolithic | Inline | Extracted service |

#### Related Documentation
- [Core Concepts - ReasoningEngine](04-core-concepts.md#3a-reasoningengine-operator)
- [Advanced Usage - Configuring ReasoningEngine](13-advanced-usage.md#configuring-the-reasoningengine)
- [Configuration Files - runtime.json](14-configuration-files.md#etcruntimejson---runtime-feature-flags)

### 8. Coder Agent (Self-Healing)

**Purpose:** A specialized agent that can write and modify the MetaHuman OS source code.

**How it works:**
- Uses the dedicated `coder` model (`qwen3-coder:30b`) to generate code patches.
- All proposed changes appear in the **Code Approval UI** for you to review before they are applied.
- Has special permissions to write to code directories but is blocked from modifying `memory/` or `persona/` files.
- For a full description, see the [Self-Healing Coder Agent](11-special-features.md#self-healing-coder-agent) section.

### 9. Auto-Approver Agent (Advanced)

**Purpose:** Quality-based dataset approval for LoRA adaptation.

**How it works:**
- Evaluates training datasets for quality metrics
- Automatically approves datasets meeting quality thresholds
- Runs in dry-run mode by default for safety

### 10. Adapter Builder Agent (Advanced)

**Purpose:** Generates training datasets for LoRA models.

**How it works:**
- Cycles through memories to create training pairs
- Applies quality filters to ensure high-quality data
- Formats data appropriately for training

### 11. LoRA Trainer Agent (Advanced)

**Purpose:** Orchestrates LoRA model training.

**How it works:**
- Detects available GPU resources
- Generates training configuration
- Runs training via Axolotl
- Handles errors and monitoring

### 12. Eval Adapter Agent (Advanced)

**Purpose:** Evaluates quality of trained adapters.

**How it works:**
- Runs heuristic quality checks on trained models
- Compares performance to baseline
- Records results for approval workflows

### 13. Transcriber Agent (Advanced)

**Purpose:** Transcribes raw audio files into text.

**How it works:**
- Watches the `memory/audio/inbox` directory for new audio files.
- Uses the configured speech-to-text engine (e.g., `whisper.cpp`) to generate a Markdown transcript.
- Saves the transcript to `memory/audio/transcripts` and archives the original audio file.

### 14. Audio Organizer Agent (Advanced)

**Purpose:** Converts transcripts into structured episodic memories.

**How it works:**
- Scans for unprocessed transcripts in `memory/audio/transcripts`.
- Uses an LLM to segment the transcript and extract key points, entities, and action items.
- Creates new episodic memories, linking them back to the source transcript file.

### 15. Night Processor Agent (Advanced)

**Purpose:** Runs nightly catch-up tasks for audio processing.

**How it works:**
- Triggered by the `sleep-service` during the configured sleep window.
- Runs the `transcriber` and `audio-organizer` agents to process any backlog of audio files from the day.

### 16. AI Ingestor Agent

**Purpose:** Processes and curates AI-related content into structured memories.

**How it works:**
- Monitors for AI-specific content types (research papers, documentation, code snippets)
- Curates and categorizes AI/ML-related memories
- Applies specialized tagging for AI concepts and techniques
- Stores curated content in episodic memory with AI-specific metadata

**Run manually:**
```bash
./bin/mh agent run ai-ingestor
```

### 17. Curator Agent

**Purpose:** Curates and prepares memories for training dataset generation.

**How it works:**
- Selects high-quality memories for training data
- Applies quality filters (content length, tags, entities, clarity)
- Removes duplicates and low-value content
- Formats memories into training-ready structure
- Creates curated subsets for different training purposes

**Used by:** Dataset builder agents for LoRA training

### 18. Digest Agent

**Purpose:** Generates daily/weekly summaries of your activities and memories.

**How it works:**
- Scans recent memories within a configurable time window
- Identifies key themes, patterns, and significant events
- Generates human-readable summaries with citations
- Creates digest memories for quick review
- Can generate multiple digest types (daily, weekly, monthly)

**Run manually:**
```bash
./bin/mh agent run digest
```

### 19. Morning Loader Agent

**Purpose:** Performs morning initialization and loading tasks.

**How it works:**
- Runs during the morning transition (after sleep service completes)
- Loads overnight learnings into active operator profile
- Refreshes short-term state with current day's context
- Prepares system for daily operation
- Activates any new LoRA adapters from nightly training

**Triggered by:** Sleep service at the end of the sleep cycle

### 20. Full-Cycle Agent

**Purpose:** Complete end-to-end LoRA training pipeline on remote services (RunPod).

**How it works:**
- Orchestrates the entire remote training workflow
- Launches GPU pod on RunPod with configured specifications
- Uploads training dataset and configuration
- Monitors remote training progress
- Downloads merged GGUF model
- Converts to Ollama format and activates
- Cleans up remote resources after completion

**Configuration:** Requires `RUNPOD_API_KEY` and pod configuration in `.env`

**Run manually:**
```bash
./bin/mh-train-remote
```

### 21. Full-Cycle-Local Agent

**Purpose:** Complete end-to-end LoRA training pipeline on local GPU.

**How it works:**
- Similar to full-cycle but runs entirely on local hardware
- Requires CUDA-capable GPU with sufficient VRAM (24GB+ recommended)
- Uses Unsloth for efficient LoRA training
- Automatically stops Ollama before training to free VRAM
- Merges adapter and converts to GGUF format
- Creates Ollama modelfile and activates

**Requirements:** NVIDIA GPU with CUDA, 24GB+ VRAM, Unsloth dependencies

**Run manually:**
```bash
./bin/mh-train-local
```

### 22. Adapter Merger Agent

**Purpose:** Merges LoRA adapters into base models for the "rolling merge" strategy.

**How it works:**
- Takes a trained LoRA adapter and base model
- Performs model merging using appropriate merge strategy
- Creates a single, consolidated model file
- Validates merged model integrity
- Prepares merged model for GGUF conversion

**Used by:** Training agents (full-cycle, full-cycle-local)

### 23. GGUF Converter Agent

**Purpose:** Converts trained adapters to GGUF format for Ollama compatibility.

**How it works:**
- Converts merged models from HuggingFace format to GGUF
- Applies quantization if specified (e.g., Q4_K_M, Q5_K_M)
- Optimizes for inference performance
- Validates GGUF file integrity
- Prepares for Ollama modelfile creation

**Used by:** Training agents (full-cycle, full-cycle-local)

### 24. Eval Adapter Agent

**Purpose:** Evaluates the quality of trained adapters against validation sets.

**How it works:**
- Runs comprehensive quality checks on trained models
- Tests on held-out validation data
- Measures key metrics:
  - Grounding accuracy (proper memory citations)
  - Style adherence (matches persona communication style)
  - Safety (no harmful/false-positive outputs)
  - Perplexity and generation quality
- Compares performance to baseline model
- Generates evaluation report with pass/fail determination

**Used by:** Auto-approver agent for quality-based acceptance

### 25. Curiosity System (3 Agents)

**Purpose:** Intelligently asks thoughtful questions during idle periods to deepen understanding and uncover patterns.

**🎯 Conversational Design:** Questions appear naturally in the chat interface as non-blocking system messages. You can answer conversationally without any special formatting - the system uses LLM-based semantic detection to automatically recognize answers.

**📖 Complete Documentation:** See [CURIOSITY-CONVERSATIONAL.md](../CURIOSITY-CONVERSATIONAL.md) for full usage guide, examples, and technical details.

The curiosity system consists of three coordinated agents that work together to ask questions, research context, and detect answers:

#### 25a. Curiosity Service Agent

**Primary agent that generates and expires questions.**

**How it works:**
- Monitors user inactivity (configurable threshold, default 15 minutes)
- Samples recent memories (last 7 days) to identify interesting patterns
- Uses LLM to generate thoughtful, open-ended questions
- Respects per-user trust levels and curiosity settings
- Auto-expires unanswered questions older than 7 days
- Only processes the most recently active user (based on lastLogin)

**Configuration:** `profiles/{username}/etc/curiosity.json`
```json
{
  "maxOpenQuestions": 1,
  "researchMode": "local",
  "inactivityThresholdSeconds": 900,
  "questionTopics": [],
  "minTrustLevel": "observe"
}
```

**Settings:**
- `maxOpenQuestions`: 0 = off, 1 = gentle, 3 = moderate, 5 = chatty
- `researchMode`: "off", "local" (search memories), or "web" (future: web search)
- `inactivityThresholdSeconds`: How long to wait before asking questions
- `minTrustLevel`: Minimum trust level required to ask questions

**UI Controls:**
- Navigate to **System → Settings** in the web UI
- Use the "Curiosity Level" slider to adjust `maxOpenQuestions`
- Select research mode from dropdown

**Question Lifecycle:**
1. **Pending** (`memory/curiosity/questions/pending/`) - Newly asked, awaiting response
2. **Answered** (`memory/curiosity/questions/answered/`) - User replied via chat
3. **Expired** (`memory/curiosity/expired/`) - Older than 7 days without answer

**Run manually:**
```bash
./bin/mh agent run curiosity
```

**Agent Schedule:** 30 minutes (1800s interval), **enabled by default** (auto-starts with dev server)

#### 25b. Curiosity Answer Watcher Agent

**Detects when users answer curiosity questions.**

**How it works:**
- Scans episodic memories for `metadata.curiosity.answerTo` field
- Automatically moves answered questions from `pending/` to `answered/`
- Links the answer event to the question for full traceability
- Only processes the most recently active user

**Answer Detection Flow:**
1. User clicks "Reply in Chat" button on a curiosity question
2. Chat interface sends message with `?questionId=cur-q-...` parameter
3. `/api/persona_chat` captures user message with curiosity metadata
4. Answer watcher detects the metadata and marks question as answered

**Run manually:**
```bash
./bin/mh agent run curiosity-answer-watcher
```

**Agent Schedule:** 5 minutes (300s interval), **enabled by default** (auto-starts with dev server)

#### 25c. Curiosity Researcher Agent

**Performs autonomous research on pending questions when users don't respond.**

This agent enables the AI to satisfy its own curiosity by researching questions internally when the user doesn't answer. This creates an elegant dual-path system: questions go to users first, and if unanswered, the AI researches them itself.

**The Curiosity Flow:**
1. **Curiosity Service** generates a question and asks the user
2. Question is saved to `memory/curiosity/questions/pending/` directory
3. **If user answers**: Answer Watcher detects it, moves question to `answered/`
4. **If user doesn't answer**: Researcher picks up the pending question and researches it autonomously

**How the Researcher works:**
- Selects one pending question per cycle (rate-limited to avoid overwhelming system)
- Uses LLM to extract 2-3 key topics from the question
- Searches episodic memories for up to 5 results per topic
- Generates Markdown research notes with:
  - Key topics identified
  - Related memories with timestamps
  - LLM-generated summary of insights
- Saves research to `memory/curiosity/research/{questionId}-research.md`
- Saves a summary as an `inner_dialogue` event (viewable in Inner Dialogue tab)
- Only processes the most recently active user

**Research Note Example:**
```markdown
# Research Notes: cur-q-1234567890-abc123

**Question:** What patterns do you notice in your creative work?

**Asked:** 11/11/2025, 11:30:00 PM

---

## Key Topics
- creative work
- patterns
- productivity

## Related Memories

### creative work
- Started new painting project today...
  *11/10/2025*

### patterns
- Noticed I'm most creative in mornings...
  *11/08/2025*

## Summary
The research reveals a consistent pattern of morning creativity...

---
*Generated: 2025-11-11T23:45:00.000Z*
```

**Run manually:**
```bash
./bin/mh agent run curiosity-researcher
```

**Agent Schedule:** 60 minutes (3600s interval), **enabled by default** (auto-starts with dev server)

**View in UI:**
- Navigate to **Memory → Curiosity** tab to see all questions
- Pending questions show "Reply in Chat" button
- Answered questions display with completion timestamp
- Research notes are stored as files and can be viewed in file browser

**Control Agents:**
All three curiosity agents are **enabled by default** and will start automatically with `pnpm dev`.

You can control them via:
- **Agent Monitor** in the web UI (right sidebar → System Status)
- CLI: `./bin/mh agent stop curiosity` or `./bin/mh agent start curiosity`
- Edit `etc/agents.json` to disable: set `"enabled": false`

**Click-to-Reply System:**
- Questions appear in the chat interface and are automatically selected with a purple outline.
- A "Reply Indicator" appears above the input box with a preview of the question.
- Simply type your reply and send. The `replyToQuestionId` metadata is automatically included.
- To deselect a question, click the message again or click the cancel (✕) button in the reply indicator.

**API Endpoints:**
- `GET /api/curiosity/questions`: Fetches pending questions for the authenticated user.
- `GET/POST /api/persona_chat`: Handles chat messages and captures reply metadata via the `replyToQuestionId` parameter.

**File Structure:**
```
memory/curiosity/
├── questions/
│   ├── pending/
│   ├── answered/
│   └── expired/
└── research/
```

**Audit Trail:**
All curiosity operations are logged to `logs/audit/*.ndjson`:
- Question generation with metadata
- Answer detection events
- Research completion
- Expiration events with question age

**Trust Level Requirements:**
- Asking questions: Minimum trust level from config (default: "observe")
- Web research: Requires "supervised_auto" or higher
- Answer detection: No trust restrictions (passive monitoring)

**Performance Considerations:**
- Answer watcher scans all episodic events (may be slow for large memory bases)
- Researcher processes one question per cycle to avoid overwhelming system
- Questions older than 7 days are automatically expired to keep system clean

**See Also:**
- Full implementation details: `docs/curiosity-system-COMPLETED.md`
- Enhancement documentation: `docs/curiosity-system-ENHANCEMENTS-COMPLETED.md`
- Configuration reference: [Configuration Files](14-configuration-files.md)

**Future Enhancements:**
- **Question Quality Scoring**: Track which questions get answered vs. ignored and use ML to learn what makes a good question.
- **Multi-Turn Conversations**: Track partial answers across multiple messages.
- **Web Research Integration**: Implement actual web search for `researchMode: 'web'`.
- **Topic Filtering**: Use `questionTopics` config to filter question domains.
- **User Feedback Loop**: Add "helpful/not helpful" buttons to questions.

**Troubleshooting:**

***Issue: Answer Watcher Not Detecting Answers***
- Check if `questionId` was passed in the URL.
- Run the watcher manually with verbose logging: `tsx brain/agents/curiosity-answer-watcher.ts`
- Check for lock conflicts: `ls -la logs/run/locks/agent-curiosity-answer-watcher.lock`

***Issue: Researcher Not Generating Notes***
- Check if there are pending questions.
- Run the researcher manually: `tsx brain/agents/curiosity-researcher.ts`
- Check LLM connectivity.

***Issue: Questions Not Expiring***
- Check the timestamps of the questions in the `pending` directory.
- Run the curiosity service manually (expiration runs first): `tsx brain/agents/curiosity-service.ts`
- Check the `expired` directory.

**Future Enhancements:**
- **Question Quality Scoring**: Track which questions get answered vs. ignored and use ML to learn what makes a good question.
- **Multi-Turn Conversations**: Track partial answers across multiple messages.
- **Web Research Integration**: Implement actual web search for `researchMode: 'web'`.
- **Topic Filtering**: Use `questionTopics` config to filter question domains.
- **User Feedback Loop**: Add "helpful/not helpful" buttons to questions.

**Troubleshooting:**

***Issue: Answer Watcher Not Detecting Answers***
- Check if `questionId` was passed in the URL.
- Run the watcher manually with verbose logging: `tsx brain/agents/curiosity-answer-watcher.ts`
- Check for lock conflicts: `ls -la logs/run/locks/agent-curiosity-answer-watcher.lock`

***Issue: Researcher Not Generating Notes***
- Check if there are pending questions.
- Run the researcher manually: `tsx brain/agents/curiosity-researcher.ts`
- Check LLM connectivity.

***Issue: Questions Not Expiring***
- Check the timestamps of the questions in the `pending` directory.
- Run the curiosity service manually (expiration runs first): `tsx brain/agents/curiosity-service.ts`
- Check the `expired` directory.

### 26. Drift Monitor Agent (Future)

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
