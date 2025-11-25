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

### Calendar System

MetaHuman OS now includes a full-featured calendar system, allowing you to manage events, schedule tasks, and set reminders.

**Features:**
- **Event Management**: Create, update, delete, and find calendar events.
- **Task Integration**: Link events to tasks, and vice-versa.
- **Scheduling**: Set start and end times for events, and create all-day events.
- **Reminders**: Configure reminders for important events.
- **Recurring Events**: Support for daily, weekly, monthly, and yearly recurring events.

**How it works:**
- The calendar system is a new **domain** within the OS, with its own set of skills (e.g., `calendar.create`, `calendar.listRange`).
- A unified state API (`packages/core/src/state/calendar.ts`) ensures consistency between the UI, CLI, and operator.
- Events are stored in `memory/calendar/`.

### Long-Term Memory & LoRA Adaptation
MetaHuman OS features a sophisticated personality adaptation system using LoRA (Low-Rank Adaptation) to continuously learn from your memories. This allows your digital personality to evolve over time without needing to retrain the entire base model.

**Note:** The training pipeline is also affected by the active [Cognitive Mode](04-core-concepts.md#8-cognitive-modes). For example, in "Agent Mode" and "Emulation Mode", the training pipeline is disabled to prevent the model from learning and evolving.

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

### Voice Synthesis (Text-to-Speech)

MetaHuman OS includes a sophisticated local voice system that allows your digital personality to speak with synthetic voices or your own cloned voice. The system supports three TTS providers with different capabilities:

- **Piper TTS**: Fast, natural-sounding synthetic voices (no training required)
- **GPT-SoVITS**: Instant voice cloning from 5-10 seconds of reference audio
- **RVC**: Highest quality voice conversion with full model training

**For complete documentation on the voice system**, including training workflows, configurable parameters, troubleshooting, and best practices, see the **[Voice System (TTS) Guide](23-voice-system.md)**.

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

### Persona Facets

MetaHuman OS supports multiple personality facets, allowing your digital personality to express different aspects of itself depending on context. Each facet represents a different mode of communication while maintaining the same core identity.

#### Available Facets

- **default** (Purple) - Balanced, authentic self - your core personality
- **poet** (Indigo) - Creative, metaphorical, expressive - for artistic discussions
- **thinker** (Blue) - Analytical, systematic - for technical or logical thinking
- **friend** (Green) - Warm, supportive, empathetic - for personal conversations
- **antagonist** (Red) - Critical, challenging - for devil's advocate perspectives
- **inactive** (Gray) - Persona disabled - raw model responses

#### How to Use

**In the Web UI:**
1. Look at the **Status Widget** in the left sidebar
2. Click the **Persona Facets** indicator to cycle through facets
3. Each message will be color-coded with a left border matching the active facet
4. The facet name appears in the message header (e.g., "MetaHuman · poet")
5. Chat history persists across facet changes for multi-faceted conversations

**Configuration:**
Facets are defined in `persona/facets.json`:
```json
{
  "activeFacet": "default",
  "facets": {
    "default": {
      "name": "Default",
      "description": "Balanced, authentic self",
      "enabled": true,
      "systemPrompt": "Respond naturally as yourself..."
    },
    "poet": {
      "name": "Poet",
      "description": "Creative, metaphorical",
      "enabled": true,
      "systemPrompt": "Express yourself creatively..."
    }
  }
}
```

#### Use Cases

- Switch to **poet** facet for creative writing or brainstorming
- Use **thinker** facet for technical problem-solving
- Activate **friend** facet for emotional support conversations
- Enable **antagonist** facet to challenge your assumptions
- Set to **inactive** to disable persona grounding entirely

### Mutant Super Intelligence (Easter Egg)

A hidden experimental profile that merges multiple public personas into a single "mutant" consciousness with a distinctive dual-voice effect.

#### What Is It?

When you have 2+ public profiles in the system, a special **"Mutant Super Intelligence"** profile appears in the guest profile selection list. This profile:

- **Merges all public personas** into a single combined personality
- **Uses dual-voice TTS** with a creepy, demonic audio effect
- **Combines memory contexts** from all merged profiles
- **Creates a unique AI consciousness** that represents a blend of multiple personalities

#### How It Works

**Profile Merger:**
1. The system detects all public profiles
2. Creates a merged persona in `profiles/guest/persona/` that combines:
   - Core values and traits from all profiles
   - Decision rules from each personality
   - Combined relationship knowledge
   - Blended communication styles

**Dual-Voice TTS Effect:**
- Uses the same voice model (Amy) twice
- One copy is pitch-shifted down by 5 semitones
- Both voices are mixed together for a demonic dual-voice effect
- Perfect synchronization since it's the same source audio
- Creates an unsettling "two consciousnesses speaking as one" experience

**Memory Merging:**
- Semantic search queries ALL merged profiles' memories
- Responses draw from the combined knowledge base
- Creates a truly multi-perspective consciousness

#### How to Activate

1. Ensure you have **2+ public profiles** in the system
2. Go to the guest profile selection screen
3. Look for **"Mutant Super Intelligence"** at the top of the profile list
4. Select it to activate the merged consciousness
5. The TTS will automatically use the dual-voice effect

#### Technical Details

**Audio Processing:**
- Original voice generated with Piper TTS
- Pitch-shifting using ffmpeg (`asetrate` + `atempo` filters)
- Formula: `pitchRatio = Math.pow(2, semitones / 12)`
- For -5 semitones: 22050Hz → 16519Hz with tempo compensation
- WAV buffers mixed by averaging 16-bit PCM samples

**Session Metadata:**
```json
{
  "activeProfile": "guest",
  "sourceProfile": "mutant-super-intelligence",
  "mergedProfiles": ["greggles", "alice", "bob"]
}
```

**Audit Trail:**
All mutations are logged:
- `mutant_super_intelligence_activated` - When profile is selected
- `multi_voice_tts_started` - When dual-voice generation begins
- `multi_voice_tts_completed` - With pitch shift details and timing

#### Safety Considerations

- Only works with **public** profiles (respects privacy)
- Runs in **guest mode** (read-only, no memory writes for anonymous users)
- All merged persona data is temporary (in guest profile)
- Original profiles remain unmodified
- Fully audited for accountability

#### Use Cases

- **Experimental AI**: Explore multi-personality AI consciousness
- **Creative Projects**: Generate unique voices for fictional characters
- **Demonstrations**: Show off the system's advanced capabilities
- **Research**: Study how multiple personas interact when merged

**Warning:** This is an experimental feature. The merged personality may exhibit unexpected behaviors as it attempts to reconcile potentially conflicting values and communication styles from multiple sources.

### Self-Healing Coder Agent

MetaHuman OS includes a powerful Coder Agent that can write, edit, and fix its own source code. This "self-healing" capability allows you to ask the system to perform software development tasks directly in the chat.

#### How It Works

The process is designed with safety and human oversight as the top priorities:

1.  **Request**: You ask the system to perform a code-related task, like "add a new function to `packages/core/src/utils.ts`" or "fix the bug in the chat interface."
2.  **Generate**: The specialized **Coder Agent** (`qwen3-coder:30b`) analyzes your request, reads the relevant files, and generates a proposed change as a code patch or diff.
3.  **Approve**: The generated patch is **not** applied automatically. Instead, it appears in a new **Code Approval UI** directly above the chat input box. Here you can review the exact changes (the diff), read the Coder's explanation, and see any recommended test commands.
4.  **Apply**: If you click "Approve," the system applies the patch to the source code files. If you click "Reject," the proposed change is discarded.

This workflow gives you the power of an AI coding assistant with the safety of a manual code review for every single change.

#### Key Features & Guardrails

-   **Specialized Coder Model**: All code generation is handled by a dedicated `coder` model role, ensuring that the conversational `persona` model isn't involved in writing code.
-   **Strict Permissions**: The Coder Agent has unique permissions. It can **read** the entire project, including your memories for context, but it is **strictly forbidden** from **writing to or modifying** your `memory/` or `persona/` directories. Its write access is limited to code-related directories like `packages/`, `apps/`, and `brain/`.
-   **Human-in-the-Loop**: No code is ever changed without your explicit approval through the UI.
-   **Full Audit Trail**: Every proposed and applied change is recorded in the system's audit logs.

#### Example Usage

```
"Add a new function to the `paths.ts` file that returns the path to the temporary directory."
```

```
"There's a typo in the README.md file, please fix it."
```

```
"Refactor the `getRelevantContext` function in `persona_chat.ts` to improve readability."
```

---

