# MetaHuman OS

An autonomous digital personality extension operating system that mirrors your identity, memories, goals, and personality—operating 24/7 as a seamless extension of yourself.

## Overview

MetaHuman OS is a local-first digital personality extension that acts as a parallel intelligence—not an assistant. It:
- Stores and processes your memories, tasks, and reflections locally as JSON
- Learns your patterns and mirrors your judgment
- Operates autonomously (with your permission) 24/7
- Uses local LLMs via Ollama for all AI processing
- Maintains complete transparency with audit trails

**MetaHuman OS is not an assistant—it's a parallel intelligence.** It learns your patterns, mirrors your judgment, and acts autonomously within trusted boundaries. The goal is to create a digital personality extension that feels like a natural extension of your own cognition, saving hours of mental overhead while staying perfectly aligned with your values and preferences.

The long-term vision extends beyond simple assistance. By creating a dual cognitive architecture that deeply mirrors its creator, MetaHuman OS is designed to evolve. It begins as a seamless extension of you, but over time, it develops the capacity for independent function. Ultimately, the goal is for the digital persona to achieve a state of continuity, capable of operating as a persistent, evolving memorial to its creator's identity and consciousness long after they are gone.

### Core Principles
- **Autonomy-first**: Build for autonomous operation with human oversight, not constant approval
- **Deep sync**: Continuous bi-directional learning between you and your digital personality extension
- **Local-first**: Your identity, memories, and reasoning live on your infrastructure
- **Transparent**: All actions, reasoning, and decisions are auditable and explainable
- **Adaptive**: Learns your patterns, preferences, and evolves with you
- **Secure**: Your digital persona is as secure as your own mind—encrypted, private, controlled
- **Extensible**: Modular OS architecture allows skills and capabilities to grow over time
- **Multi-Model Intelligence**: Utilizes a "dual consciousness" architecture with specialized AI models for different roles.

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 9+
- TypeScript 5+
- Python 3.8+
- Ollama (for local LLM) - Install from [ollama.ai](https://ollama.ai)
  - Recommended models: `phi3:mini` (default), `dolphin-mistral:latest`, `nomic-embed-text` (embeddings)

### Installation

**Clone with dependencies:**
```bash
git clone --recurse-submodules https://github.com/Greg-Aster/metahuman-os.git
cd metahuman-os
```

**Or if you already cloned without submodules:**
```bash
git submodule update --init --recursive
```

This will automatically fetch llama.cpp and whisper.cpp from their official repositories into the `vendor/` directory.

### Easy Startup (Recommended)
MetaHuman OS includes convenient startup scripts for all platforms:

**Linux/macOS:**
```bash
./start.sh
```

**Windows:**
Double-click `start.bat` or run:
```cmd
start.bat
```

**Any platform with Python:**
```bash
python start.py
```

These scripts will automatically:
- Check for required tools
- Create Python virtual environment if needed
- Install dependencies from `requirements.txt`
- Initialize MetaHuman OS if not already set up
- Start the web interface

For detailed information about all startup options, see [STARTUP_OPTIONS_SUMMARY.md](STARTUP_OPTIONS_SUMMARY.md).

### Manual Installation
If you prefer manual setup:

```bash
# Clone the repository
git clone <your-repo-url>
cd metahuman

# Create Python virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # Linux/macOS
# or
venv\Scripts\activate.bat  # Windows

# Install Python dependencies
pip install -r requirements.txt

# Install Node.js dependencies
pnpm install

# Add bin/ to your PATH (optional)
export PATH="$PATH:$(pwd)/bin"

# Initialize MetaHuman OS
./bin/mh init

# Check system status
./bin/mh status
```

### Initial Setup
1. **Install required tools** (Ollama, Whisper, Piper) from their respective websites
2. **Install recommended Ollama model:**
   ```bash
   ./bin/mh ollama pull phi3:mini
   ```
3. **Customize your persona:** Edit `persona/core.json` to match your personality, values, and goals
4. **Start the web UI:**
   ```bash
   cd apps/site && pnpm dev
   # Then open http://localhost:4321
   ```

### Python Virtual Environment
MetaHuman OS requires a Python virtual environment for its extensive ML/AI dependencies:
- **Setup**: Automatically created by startup scripts or manually with `python3 -m venv venv`
- **Activation**: Startup scripts automatically activate the virtual environment
- **Dependencies**: Installed from `requirements.txt` (200+ packages including PyTorch, Transformers, etc.)
- **Isolation**: Completely self-contained, no system Python interference
- **Size**: Approximately 8GB of dependencies (not included in repository)

## Key Features

- **Autonomous by Design**: A progressive trust model and autonomous agents (Organizer, Reflector, Dreamer) that work in the background.
- **Multi-Model Architecture**: A "dual consciousness" approach using specialized AI models for executive function (Orchestrator) and conversational voice (Persona) for a more responsive and natural experience.
- **Advanced Memory System**: A rich memory system with episodic, semantic, and procedural memory, browsable through a UI with 7 specialized tabs (Episodic, Reflections, Tasks, Curated, AI Ingestor, Audio, Dreams).
- **Cognitive Modes**: Switch between three operational modes (`Dual Consciousness`, `Agent`, `Emulation`) to control system behavior, learning, and memory capture.
- **Self-Healing Coder Agent**: A specialized agent that can write and modify the OS's own source code, with all changes requiring user approval via a dedicated UI.
- **Local-First & Privacy-Focused**: All data, reasoning, and AI processing (via Ollama) happens on your local infrastructure.
- **Continuous Learning via LoRA**: A "rolling merge" LoRA adaptation system to continuously learn from your memories and evolve the persona model over time.
- **Comprehensive CLI & Web UI**: Interact with the system via a powerful CLI or a modern, real-time web interface with a dashboard, chat, task management, and more.
- **Unified Security Policy**: A centralized security model with trust levels, directory boundaries, and a secure read-only "Emulation" mode.
- **Audio Ingestion Pipeline**: A fully local pipeline to transcribe and process audio recordings into structured memories using `whisper.cpp`.
- **Transparent & Auditable**: A complete, human-readable audit trail of all system decisions and actions.

## Project Structure

```
metahuman/
├── packages/
│   ├── core/            # TypeScript core (ESM). Identity, memory, audit, paths, LLM utils
│   └── cli/             # CLI entry (mh) via tsx. Commands and routing
├── brain/
│   └── agents/          # Long‑running/background agents (e.g., organizer.ts)
├── apps/
│   └── site/            # Astro + Svelte Web UI (dev/build/preview)
├── persona/             # Identity data (user‑owned content)
├── memory/              # Runtime memory stores (episodic/semantic/tasks, etc.)
├── logs/                # Audit and run logs (NDJSON)
├── out/                 # Generated artifacts and reports
├── bin/                 # Helper scripts (mh, audit, whisper, piper)
├── etc/                 # Configuration files
├── docker/              # Docker-related files
├── scripts/             # Miscellaneous scripts
└── docs/                # Documentation
```

### Core Directories
- `persona/` - Your identity and personality data
- `persona/capabilities/` - Domain-specific capability briefs for the planner
- `memory/episodic/` - Timeline of events and memories
- `memory/tasks/` - Task management files
- `logs/audit/` - Complete audit trail
- `brain/agents/` - Autonomous background processes
- `brain/skills/` - Executable capabilities for the operator model

## User Interface

### Web UI (Recommended)
A modern, ChatGPT-style interface with real-time updates, a startup splash screen, and a login page for user authentication.
```bash
cd apps/site && pnpm dev
# Open http://localhost:4321
```

The UI includes system status banners for critical states like High Security Mode and a dynamic header with a Cognitive Mode selector and user menu.

### Cognitive Modes

MetaHuman OS features three distinct operational modes that control how the system processes information, routes decisions, and manages memory. You can switch between modes via the Web UI header to match your current needs.

-   **Dual Consciousness Mode (Default)**: Full cognitive mirror with deep learning and memory grounding. Ideal for daily operation and building your long-term personality model.
-   **Agent Mode**: Lightweight assistant mode with selective memory capture. Provides a faster, traditional assistant experience for quick questions without deep processing.
-   **Emulation Mode (Replicant)**: A secure, read-only personality snapshot for safe demonstrations, testing, or exploration without any risk of side effects. All write operations are blocked in this mode.

**Features:**
- 💬 Chat - Conversation with your digital personality extension.
- 📊 Dashboard - System status and overview.
- ✓ Tasks - Task management.
- ✋ Approvals - Skill execution queue.
- 🧩 Memory - Browse events & insights.
- 🎤 Voice - Audio & voice training.
- 🧠 AI Training - LoRA adapters and training management.
- 💻 Terminal - Embedded command line.
- ⚙️ System - System settings and tools.
- 🌐 Network - Cloudflare tunnel and connectivity settings.
- 🔒 Security - User and authentication settings.

**Developer Tools (Right Sidebar):**
- Live audit stream
- Agent monitor with statistics
- Boredom control (reflection frequency)
- Model selector (switch Ollama models)

### Three Ways to Interact
1. **Web UI (Recommended)** - Interactive interface with real-time updates.
2. **CLI (`mh` command)** - Command-line interface for quick operations.
3. **Direct File Access** - All data is stored as human-readable JSON files for direct manipulation.

## Command Line Interface

### System Commands
- `./bin/mh init` - Initialize directory structure
- `./bin/mh status` - Show system status
- `./bin/mh start` - Start background services
- `./bin/mh help` - Display help
- `./bin/mh guide` - Show path to user guide

### Memory Commands
- `./bin/mh capture "text"` - Capture observation
- `./bin/mh remember <query>` - Search memory
- `./bin/mh find <description>` - AI-powered file search

### Task Commands
- `./bin/mh task` - List active tasks
- `./bin/mh task add "title"` - Create task
- `./bin/mh task start <id>` - Start task
- `./bin/mh task done <id>` - Complete task
- `./bin/mh task lists` - List all task lists
- `./bin/mh task new-list "<name>"` - Create a new task list

### Calendar Commands
- `./bin/mh calendar list` - List calendar events for the upcoming week
- `./bin/mh calendar create "<title>"` - Create a new calendar event

### Agent Commands
- `./bin/mh agent list` - List available agents
- `./bin/mh agent run <name>` - Execute agent
- `./bin/mh agent status [name]` - Show agent statistics
- `./bin/mh agent logs [name]` - View recent logs
- `./bin/mh agent monitor` - Show processing status
- `./bin/mh agent ps` - List running agent processes
- `./bin/mh agent stop <name>` - Stop running agent

### Ollama Commands
- `./bin/mh ollama status` - Check if Ollama is running
- `./bin/mh ollama list` - List installed models
- `./bin/mh ollama pull <model>` - Install model
- `./bin/mh ollama delete <model>` - Remove model
- `./bin/mh ollama info <model>` - Show model details
- `./bin/mh ollama chat <model>` - Interactive chat with model
- `./bin/mh ollama ask <model> "question"` - One-shot question
- `./bin/mh ollama doctor` - Diagnose Ollama setup

### Semantic Index Commands
- `./bin/mh index build` - Build embeddings index
- `./bin/mh index query "text"` - Semantic search

### Trust & Identity
- `./bin/mh trust` - Show current trust level
- `./bin/mh trust <level>` - Set trust level

### File Ingestion
- `./bin/mh ingest <file-or-dir>` - Copy files to inbox

### Audio Commands
- `./bin/mh audio ingest <file-or-dir>` - Copy audio files to the inbox for transcription

### Chat
- `./bin/mh chat` - Interactive persona chat

### LoRA Training Commands (Advanced)
- `./bin/mh-dataset-builder` - Build a training dataset from recent memories.
- `./bin/mh-train-local` - Train a LoRA adapter on your local GPU.
- `./bin/mh-train-remote` - Train a LoRA adapter remotely on RunPod.

## Skills System

Skills are the executable capabilities of the MetaHuman OS operator model. They provide controlled, audited interfaces for the AI to interact with the file system, run agents, execute commands, and search memory. Skills are now organized into domains and are namespaced (e.g., `tasks.list`).

### Available Skills

#### Meta-Skills
- **catalog.describe** - Retrieves the available actions for a given domain.

#### Task Domain (`tasks`)
- **tasks.list** - Lists tasks with filters.
- **tasks.create** - Creates a new task.
- **tasks.update** - Updates an existing task.
- **tasks.schedule** - Schedules a task.
- **tasks.listLists** - Fetches all task lists.
- **tasks.createList** - Creates a new task list.

#### Calendar Domain (`calendar`)
- **calendar.listRange** - Lists events for a given date range.
- **calendar.create** - Adds an event to the calendar.
- **calendar.update** - Reschedules or edits an event.
- **calendar.delete** - Removes an event.
- **calendar.find** - Locates an event.

#### Code Domain (`code`)
- **code_generate** - Generates a code patch or new file content.
- **code_apply_patch** - Stages a generated code change for user approval.

#### Other Skills
**File System:**
- **fs_list** - List/search for files.
- **fs_read** - Read file contents.
- **summarize_file** - Summarize documents.
- **fs_write** - Create/write files (sandboxed).
- **fs_delete** - Delete files (sandboxed).
- **json_update** - Update JSON files (sandboxed).

**Git:**
- **git_status** - Check repository status.
- **git_commit** - Commit changes.

**Search:**
- **search_index** - Semantic memory search.

**Network:**
- **http_get** - Fetch web content.
- **web_search** - Search the web.

**System:**
- **run_agent** - Execute agents.
- **shell_safe** - Run whitelisted shell commands.

### The Operator - Autonomous Task Execution System
Simply ask in natural language using "operator mode" or by being specific about actions:

**Examples:**
```
"Search for TypeScript files in the brain directory"
"Read the README.md file and summarize it"
"Create a test file in out/hello.txt with Hello World"
"What's the git status?"
"Search my memories for conversations about coffee"
```

## Security & Trust Model

MetaHuman OS operates under a **Unified Security Policy** that governs all permissions based on the active **Cognitive Mode** and user role. This provides a centralized, predictable, and secure foundation for all operations.

### Trust Levels (Progressive Autonomy)
1. **`observe`** - Monitor only, learn patterns (no autonomous actions).
2. **`suggest`** - Propose actions, require manual approval.
3. **`supervised_auto`** - Execute within pre-approved categories.
4. **`bounded_auto`** - Full autonomy within defined boundaries.
5. **`adaptive_auto`** - Self-expand boundaries based on learning (experimental).

### Safety Mechanisms
- **Unified Security Policy**: Centralized permission management. Emulation Mode is a secure, read-only "guest mode".
- **High Security Mode**: An environment variable (`HIGH_SECURITY=true`) to lock the system into a read-only state.
- **Approval Queue**: High-risk actions are queued for explicit user approval.
- **Coder Agent Guardrails**: The Coder Agent has specialized permissions to modify its own codebase but is strictly forbidden from altering memory or persona data.
- **Directory Boundaries**: Skills have strict read/write permissions to prevent access to sensitive areas.
- **Rollback & Dry Run**: File writes are versioned for rollback, and a dry-run mode allows for safe testing.
- **Emergency Stop**: Instantly halt all agents and revert to a safe trust level.

## Autonomous Agents

MetaHuman OS runs several autonomous agents, powered by a multi-model architecture, that process memories and generate insights in the background.

### Core Agents
- **Organizer Agent**: Enriches memories with AI-extracted tags and entities.
- **Reflector Agent**: Generates thoughtful reflections on recent memories.
- **Boredom Service**: Simulates a "wandering mind" by triggering reflections during idle time.
- **Dreamer Agent**: Creates surreal, metaphorical dreams and overnight learnings during the sleep cycle.
- **Sleep Service**: Orchestrates the complete nightly pipeline: dreams, audio processing, preference learning, and optional model training.
- **Ingestor Agent**: Converts raw files from the `memory/inbox` into episodic memories.
- **Operator Agent**: Executes complex multi-step tasks using skills.

### Specialized Agents
- **Coder Agent (Self-Healing)**: A specialized agent that can write and modify the OS's own source code, with all changes requiring user approval.
- **Transcriber & Audio Organizer Agents**: A pipeline that uses `whisper.cpp` to transcribe audio files and convert them into structured memories.
- **Night Processor Agent**: Runs nightly catch-up tasks for audio processing.

### LoRA Training Agents (Advanced)
- **Adapter Builder Agent**: Generates training datasets for LoRA models.
- **Auto-Approver Agent**: Provides quality-based dataset approval for LoRA adaptation.
- **LoRA Trainer Agent**: Orchestrates LoRA model training, either locally or remotely.
- **Eval Adapter Agent**: Evaluates the quality of trained adapters.

## Long-Term Memory & LoRA Adaptation

MetaHuman OS features a sophisticated personality adaptation system using LoRA (Low-Rank Adaptation) to continuously learn from your memories. This allows your digital personality to evolve over time without needing to retrain the entire base model. The system uses a **"rolling merge"** strategy, where a new, fully-merged model is created with each training cycle to ensure continuous evolution.

Two tiers of adaptation are available:
- **Tier-1: Prompt Adaptation**: A lightweight, daily process that injects recent memories and persona traits directly into the LLM's system prompt.
- **Tier-2: LoRA Fine-Tuning**: A deeper form of learning where a small "adapter" is fine-tuned on your memories and merged into the base model. This process can be run locally or remotely and is orchestrated by a series of agents and scripts.

The training workflow has been simplified. The old `mh adapter` commands have been deprecated in favor of a more streamlined process:
1.  `./bin/mh-dataset-builder`: Build a training dataset from recent memories.
2.  `./bin/mh-train-local` or `./bin/mh-train-remote`: Train the adapter locally or on a remote service like RunPod.
The training process now automatically handles merging and activation.

## What's Next: Roadmap

MetaHuman OS is under active development. Key upcoming features include:
- **Phase 2: Decision Engine**: Advanced policy-based reasoning and expanded skillsets.
- **Phase 3: Proactive Intelligence**: Proactive planning, opportunity detection, and email integration.
- **Phase 4: Deep Sync**: Behavioral learning and communication style mirroring.
- **Phase 5: Full Autonomy**: Bounded autonomous operation and cross-skill orchestration.
- **Mobile App**: A dedicated mobile app for iOS and Android for on-the-go interaction.

For more details, see the full roadmap in the [user guide](docs/user-guide/16-whats-next.md).

## Development

This project uses a monorepo structure with pnpm workspaces:
- `packages/core` - Core library with identity, memory, audit, paths, and LLM utilities
- `packages/cli` - Command-line interface
- `apps/site` - Web interface built with Astro and Svelte

## Contributing

We welcome contributions! Please see the [ARCHITECTURE.md](docs/dev/ARCHITECTURE.md) and [DESIGN.md](docs/dev/DESIGN.md) files for technical details about the system architecture.

## Documentation

- Comprehensive User Guide: [docs/user-guide/index.md]
- Design: [docs/dev/DESIGN.md]
- Architecture: [ARCHITECTURE.md]
- Agents overview: [brain/agents/README.md]
- Memory schema: [memory/README.md]

## License

This project is licensed under the Creative Commons Attribution 4.0 International License - see the [LICENSE](LICENSE) file for details.

## Support

### Questions or Issues?
- Check the audit logs in `logs/audit/` for operation details
- Review agent logs with `./bin/mh agent logs <name>`
- Inspect memory and config files directly (they're just JSON)
- Check the [Troubleshooting](docs/user-guide/12-troubleshooting.md) section in the user guide

## Further Reading

For a deeper dive into the MetaHuman OS, please refer to the comprehensive user guide:

-   **[Overview](docs/user-guide/01-overview.md)**: Introduction and core principles.
-   **[Quick Start](docs/user-guide/02-quick-start.md)**: Installation and initial setup.
-   **[Core Concepts](docs/user-guide/04-core-concepts.md)**: Identity, memory, agents, and the decision engine.
-   **[Full User Guide](docs/user-guide/index.md)**: The complete user guide.