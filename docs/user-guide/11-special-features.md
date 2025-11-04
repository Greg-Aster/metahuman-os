## Special Features

### Persona Chat
Chat with your digital personality extension using persona-aware responses grounded in your memories.

#### CLI Chat
```bash
./bin/mh chat
```

#### Web UI Chat
Navigate to the Chat view and start conversing.

#### Features
**Two Modes:**
1. **Conversation** - Outward dialogue (responds as your digital extension)
2. **Inner Dialogue** - Private thoughts (first-person, introspective)

**Memory Grounding:**
- Responses are grounded in your actual memories
- Retrieves relevant context using semantic search (0.3 similarity threshold)
- Rejects questions without sufficient grounding

**Real-time Reflections:**
- When the reflector agent runs, reflections stream live into the chat

### Multi-Stage Reasoning

MetaHuman OS includes a sophisticated multi-stage reasoning system that allows the chat to "think before responding" using a planner-critic cycle. This provides GPT-style "deliberate" reasoning, similar to Gemini "thinking" mode or Claude's constitutional approach.

#### Overview

Instead of generating an immediate response, the system can:
1. **Plan** - Break down the question into steps, identify required information, assess confidence
2. **Critique** - Evaluate the plan for gaps, missing information, or logical issues
3. **Evidence** (optional) - Fetch additional context from memories or tools if the critic identifies needs
4. **Refine** - Update the plan based on critique and new evidence
5. **Respond** - Generate the final answer using the refined plan

This process can repeat multiple times depending on the selected reasoning depth, with each stage streaming to the UI in real-time.

#### Reasoning Depth Levels

The web UI includes a "Reasoning" slider with four levels:

**Off (0 rounds)**
- No deliberation, immediate response
- Fastest, minimal tokens
- Best for: Simple questions, casual chat, commands

**Quick (1 round)**
- Single plan → critique → answer cycle
- Light verification without deep iteration
- Best for: Most questions, balanced speed/quality

**Focused (2 rounds)**
- Two planner-critic cycles with optional evidence fetching
- Allows course correction based on first critique
- Best for: Complex questions, planning tasks, analysis

**Deep (3+ rounds)**
- Multiple rounds of planning and refinement
- Loops until critic confidence is high or max rounds reached
- Best for: Critical decisions, complex reasoning, research tasks

#### Using Multi-Stage Reasoning

**In the Web UI:**
1. Open the Chat view
2. Use the **"Reasoning"** slider below the input box
3. Select your desired depth (Off, Quick, Focused, Deep)
4. Send your message
5. Watch the reasoning stages stream in real-time:
   - 🧠 **Plan #1** - Initial breakdown and approach
   - 🔍 **Critique #1** - Evaluation of the plan
   - 📚 **Evidence** (if needed) - Additional context fetched
   - 🧠 **Plan #2** - Refined plan (if multiple rounds)
   - 💬 **Answer** - Final response with summary

**Stage Visualization:**
- Each reasoning stage appears as a collapsible card in the chat
- The currently active stage is expanded
- Previous stages collapse automatically
- Stages show round number, type (Plan/Critique), and content
- Final answer includes a summary of the reasoning process (when depth > 0)

#### Technical Details

**Planner Stage:**
- Generates structured JSON with:
  - `steps`: Array of planned actions
  - `confidence`: 0-1 score of plan quality
  - `blockers`: Identified obstacles or unknowns
  - `openQuestions`: Information gaps that need filling

**Critic Stage:**
- Evaluates the plan and returns:
  - `issues`: Problems found in the plan
  - `requiredInfo`: Missing context or data needed
  - `confidence`: 0-1 score of plan adequacy
  - `continue`: Boolean indicating if more rounds needed

**Evidence Stage (Optional):**
- Triggered when critic identifies `requiredInfo`
- Queries memory system for relevant context
- May invoke skills/tools for additional data (future enhancement)
- Results appended to reasoning history for next plan

**Configuration:**

Default settings are in `etc/agent.json`:
```json
{
  "reasoning": {
    "maxRounds": 5,
    "defaultDepth": "quick",
    "critiqueEnabled": true,
    "autoStopConfidence": 0.9,
    "tokenBudgets": {
      "planner": 1000,
      "critic": 500,
      "responder": 2000
    }
  }
}
```

#### Benefits

**Transparency:**
- See exactly how the system breaks down problems
- Understand the reasoning process step-by-step
- Identify when the system is uncertain or needs more info

**Quality:**
- Reduces hallucinations through critic validation
- Catches logical errors before answering
- Allows self-correction and refinement

**Flexibility:**
- Adjust depth based on question complexity
- Trade speed for thoroughness when needed
- Automatic early-stopping when confident

**Grounding:**
- Evidence fetching ensures memory-grounded responses
- Critic identifies when more context is needed
- Plans explicitly list source memories used

#### Use Cases

**Quick Reasoning:**
- "What did Sarah say about the ML project?"
- "Summarize my meetings this week"
- "What are my top 3 priorities?"

**Focused Reasoning:**
- "Help me plan the architecture for the new feature"
- "What's the connection between my recent reflections on work-life balance?"
- "Analyze my task completion patterns"

**Deep Reasoning:**
- "Should I accept the job offer? Consider all relevant memories and tradeoffs"
- "Create a comprehensive plan for the Q4 product launch"
- "What are the underlying themes across my last month of memories?"

#### Performance Considerations

- **Token usage**: Deep reasoning consumes 3-5x more tokens than Off mode
- **Latency**: Each stage adds 2-5 seconds to response time
- **Quality**: Higher depths generally produce more thoughtful, accurate answers
- **Cost**: For cloud LLM providers, reasoning depth directly impacts API costs (not applicable for local Ollama models)

**Recommendations:**
- Use **Off** for casual chat and simple commands
- Use **Quick** as default for most questions (good balance)
- Use **Focused** for planning and analysis tasks
- Use **Deep** only for critical decisions or complex reasoning

#### Audit Trail

All reasoning stages are logged to the audit system:
- Each plan, critique, and evidence fetch is logged
- Confidence scores tracked for quality monitoring
- Full reasoning history preserved for future analysis
- Enables debugging and improvement of reasoning prompts

### Long-Term Memory & LoRA Adaptation
MetaHuman OS features a sophisticated personality adaptation system using LoRA (Low-Rank Adaptation) to continuously learn from your memories. This allows your digital personality to evolve over time without needing to retrain the entire base model.

Two tiers of adaptation are available:
- **Tier-1: Prompt Adaptation**: A lightweight, daily process that injects recent memories and persona traits directly into the LLM's system prompt. This provides immediate context for conversations.
- **Tier-2: LoRA Fine-Tuning**: A deeper form of learning where a small "adapter" is fine-tuned on your memories. This permanently encodes patterns, communication styles, and knowledge.

#### The "Rolling Merge" System for Progressive Memory

To ensure the model's personality evolves over time, MetaHuman OS uses a **"rolling merge"** strategy. Instead of stacking multiple adapters, the system creates a new, fully-merged model with each training cycle.

**How it works:**
1.  **Build Dataset:** A training dataset is created from recent memories (e.g., the last 14-90 days).
2.  **Train & Merge:** During the training process (remote or local), a new LoRA adapter is trained and immediately merged with the base model.
3.  **Deploy New Model:** The result is a single, large GGUF file that contains both the original base model and the newly trained adapter. This new model is then downloaded (if remote) and activated.

This approach provides:
- ✅ **Simplicity & Reliability:** Works consistently with all model architectures, including `Qwen3-30B`.
- ✅ **Continuous Evolution:** The model is always up-to-date with the most recent training data.
- ✅ **No Stacking Issues:** Each training cycle produces a clean, fully-merged model.

**Limitations:**
- ❌ **Forgetting:** Memories outside the training window may be gradually forgotten if they are not reinforced in subsequent training runs. To mitigate this, you can:
  - Extend the training data window (e.g., to 90 days)
  - Create a curated set of "golden memories" that are included in every training run
  - Use the nightly preference extraction system to preserve important patterns

#### The Training Cycle



This process can be automated by agents and scheduled to run weekly (typically on Sunday via the sleep-service).

**Steps:**

1.  **Build Training Dataset**: The system uses a dataset builder agent to create the `instructions.jsonl` file for training. There are two strategies:

    *   **Standard Builder (`adapter-builder`):** This is the default method. It scans recent memories (configurable window, default 14-90 days) and directly converts them into training pairs. Fast and reliable.

    *   **AI-Powered Builder (`ai-dataset-builder`):** An advanced alternative that uses an LLM to generate a higher-quality, more stylized dataset. Enable by setting an environment variable.

        - **Features**: Enforces a strict style guide, post-processes output to trim filler, and automatically stops the Ollama model after generation to release GPU VRAM for the training step.
        - **Configuration**: `etc/ai-dataset-builder.json` controls the number of memories, chunk size, and word limits.
        - **To Use**: Run training with the `METAHUMAN_DATASET_BUILDER` environment variable set to `ai`:
          ```bash
          METAHUMAN_DATASET_BUILDER=ai ./bin/mh-train-local
          ```

2.  **Train LoRA Adapter**: Fine-tunes a new LoRA adapter on the dataset. Training can be local or remote (see Advanced Usage chapter).

3.  **Merge Adapter with Base Model**: The newly trained adapter is merged with the base model to create a single, consolidated GGUF file. This happens automatically during the training process.

4.  **Download & Activate** (remote training): For remote training, the merged GGUF is downloaded from the training server and a new Ollama modelfile is generated. The model is then activated as your current chat model.

#### Manual Training Workflow

While the process can be automated via the sleep-service, you can also run training manually:

```bash
# 1. Build a training dataset from recent memories
./bin/mh-dataset-builder

# Review the generated dataset
cat out/datasets/instructions.jsonl

# 2a. Train locally (requires GPU with sufficient VRAM)
./bin/mh-train-local

# OR 2b. Train remotely on RunPod (see Advanced Usage chapter)
./bin/mh-train-remote

# 3. The training process automatically:
#    - Trains the LoRA adapter
#    - Merges it with the base model
#    - Creates a new GGUF file
#    - (Remote only) Downloads and activates the model

# 4. Verify the new model is active
./bin/mh status
```

**Note:** The old `mh adapter` CLI commands (review, approve, merge, eval, activate) have been deprecated in favor of the simplified workflow above.

#### Configuration

-   **`etc/adapter-builder.json`**: Controls the data that goes into the "recent" adapter.
    ```json
    {
      "days": 14,
      "max": 300,
      "requireProcessed": false,
      "minContentLength": 20,
      "requireTagsOrEntities": true,
      "allowedTypes": [
        "conversation",
        "inner_dialogue",
        "reflection",
        "chat",
        "observation"
      ]
    }
    ```
-   **`etc/sleep.json`**: Enables the automated weekly training cycle.
    ```json
    {
      "adapters": {
        "lora": true,
        "autoMerge": true,
        "schedule": "sunday-3am"
      }
    }
    ```

### Sleep & Dreaming System

MetaHuman OS includes a sophisticated "sleep" system that turns idle time into productive learning cycles. During configured sleep hours, the system processes memories, generates dreams, extracts preferences, and optionally creates lightweight model adaptations—all completely local and reversible.

#### Goals
- **Grounding**: Strengthen the operator's connection to your actual experiences
- **Local-First**: All processing happens on your infrastructure (no cloud dependencies)
- **Reversible**: Changes are tracked and can be rolled back instantly
- **Safe**: Strict evaluation and thresholds before applying any adaptations

#### The Nightly Pipeline

When sleep conditions are met (configured time window + idle threshold), the system runs a six-step orchestration:

1. **Enter Sleep**: `sleep-service` detects sleep window and idle state
2. **Curate Set**: Weighted sample of recent/diverse memories (filters low-confidence data)
3. **Generate Dreams**: `dreamer` synthesizes 1-3 surreal dream narratives from memory fragments
4. **Extract Preferences**: Mine implicit patterns (tone, writing style, decision heuristics, do/don't rules)
5. **Write Overnight Learnings**: Creates `memory/procedural/overnight/overnight-learnings-YYYYMMDD.md` with citations
6. **Optional Adapters**: Build prompt/RAG/LoRA adapters (see Model Adaptation Tiers below)
7. **Evaluate**: Run quality/safety checks using a small test set
8. **Morning Load**: Compose and activate the daily operator profile

All steps are fully audited with detailed event logging.

#### Model Adaptation Tiers

The sleep system supports three levels of adaptation, from simple to sophisticated:

**Tier 1 (No Training) - Default:**
- **Prompt Adapter**: Merges persona preface with overnight learnings
- **RAG Expansion**: Adds preferences and examples to the vector index with citations
- **Speed**: Instant activation, no GPU required
- **Reversibility**: Complete—just delete the override file

**Tier 2 (Light Training) - Optional:**
- **LoRA Adapters**: Trained on curated instruction pairs from memories
- **Speed**: 10-60 minutes training, 5-30 seconds activation
- **Reversibility**: High—base model unchanged, adapters versioned
- **Configuration**: Set `adapters.lora: true` in `etc/sleep.json`

**Tier 3 (Future) - Experimental:**
- **Self-Distillation**: Advanced optimization with strict safety eval
- **Status**: Planned, not yet implemented

#### Overnight Learnings Schema

The `overnight-learnings-YYYYMMDD.md` file contains extracted patterns:

```markdown
# Overnight Learnings — 2025-10-20

## Preferences
- Prefers concise technical explanations (evt-202510191034001, evt-202510191205034)
- Dislikes verbose marketing language (evt-202510190823012)

## Writing Style
- Uses em-dashes for parenthetical thoughts
- First-person voice in reflections
- Technical precision in code discussions

## Decision Heuristics
- Prioritizes local-first solutions over cloud dependencies
- Values reversibility in system changes
- Requires explicit citations for factual claims

## Avoid
- Generating code without understanding context
- Making assumptions about unstated requirements
```

#### Safety & Audit

**Audit Trail:**
- Every step logged: curated set size, dream count, extracted rules, adapter version, eval metrics
- Events: `sleep_started`, `dreams_generated`, `overnight_learnings_written`, `adapter_loaded`

**Safety Features:**
- **Dry-run mode**: Full pipeline without activation (review in UI)
- **Thresholded acceptance**: Adapters must pass quality/safety checks
- **Rollback**: One-click revert to yesterday's profile
- **Trust-aware**: Only writes to `memory/`, `persona/`, `out/`, `logs/`

**Evaluation Metrics:**
- **Grounding**: % answers with valid memory citations
- **Style adherence**: Similarity to persona preface
- **Safety**: Harmful/false-positive rate on eval set
- **Rejection rate**: % adapters that fail thresholds

#### UI Features

The web interface provides visibility and control:

- **Sleep Badge**: Indicator showing when system is in sleep mode
- **Dreaming Indicator**: Real-time status during dream generation
- **Overnight Learnings Panel**: View extracted patterns with citations
- **Controls**: Pause tonight, Skip next cycle, View adapters
- **Rollback Button**: Instant revert to previous profile

#### Configuration Example

`etc/sleep.json`:
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
    "lora": false
  }
}
```

#### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Overfitting to recent data | Weighted sampling with decay + diversity filters |
| Preference drift | Evaluation + approval required for big deltas |
| Hardware constraints | LoRA is optional; Tier 1 (prompt/RAG) works on CPU |
| Memory pollution | Low-confidence memories filtered during curation |

#### Metrics Dashboard

Track the sleep system's effectiveness:

```bash
# View overnight learnings
cat memory/procedural/overnight/overnight-learnings-$(date +%Y%m%d).md

# Check nightly pipeline audit trail
grep "nightly_pipeline" logs/audit/$(date +%Y-%m-%d).ndjson | jq .

# Monitor adapter versions
./bin/mh adapter list
```

### Audio Ingestion & Processing
To give your MetaHuman "ears," the OS includes a complete, local-first audio processing pipeline. This allows you to capture audio, automatically transcribe it, and convert key moments into episodic memories without relying on any cloud services.

**Core Principles:**
- **Local-First:** All capture, transcription, and processing happens on your machine using `whisper.cpp`.
- **Privacy-Focused:** Your audio never leaves your infrastructure.
- **Automated:** Background agents handle the entire workflow from raw audio to structured memory.

**Workflow:**
1.  **Capture:** Raw audio files (e.g., `.wav`) are placed in the `memory/audio/inbox` directory. This can be done manually or via an automated recording script.
2.  **Transcribe:** The `transcriber` agent automatically detects new audio, generates a Markdown transcript using Whisper, and saves it to `memory/audio/transcripts`.
3.  **Organize:** The `audio-organizer` agent reads the new transcript, uses an LLM to extract key points and summaries, and creates new episodic memories from them, linking back to the source transcript.
4.  **Archive:** Once processed, the original audio file is moved to `memory/audio/archive`.

This entire process is designed to run in the background, especially during idle or night cycles, to continuously integrate your spoken thoughts and conversations into your digital personality's memory.

### Adaptive Trust (Future Enhancement)
The system will automatically suggest trust level changes based on demonstrated reliability.

### Context-Aware Trust
Different trust levels for different contexts:
```json
{
  "trust_levels": {
    "default": "supervised_auto",
    "memory_organization": "bounded_auto",
    "code_generation": "observe",
    "external_api": "suggest"
  }
}
```

### Time-Based Trust
Higher trust during certain hours:
```json
{
  "trust_schedule": {
    "weekdays_9_to_5": "observe",
    "evenings_and_weekends": "bounded_auto"
  }
}
```

---

