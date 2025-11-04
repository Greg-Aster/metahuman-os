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

### Core Principles
- **Autonomy-first**: Build for autonomous operation with human oversight, not constant approval
- **Deep sync**: Continuous bi-directional learning between you and your digital personality extension
- **Local-first**: Your identity, memories, and reasoning live on your infrastructure
- **Transparent**: All actions, reasoning, and decisions are auditable and explainable
- **Adaptive**: Learns your patterns, preferences, and evolves with you
- **Secure**: Your digital persona is as secure as your own mind—encrypted, private, controlled
- **Extensible**: Modular OS architecture allows skills and capabilities to grow over time

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 9+
- TypeScript 5+
- Python 3.8+ 
- Ollama (for local LLM) - Install from [ollama.ai](https://ollama.ai)
  - Recommended models: `phi3:mini` (default), `dolphin-mistral:latest`, `nomic-embed-text` (embeddings)
- Whisper (for speech-to-text) - Install from [github.com/openai/whisper](https://github.com/openai/whisper)
- Piper (for text-to-speech) - Install from [rhasspy.github.io/piper-samples](https://rhasspy.github.io/piper-samples/)

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

- **Autonomous by Design**: Progressive trust model from observe → suggest → bounded autonomy
- **Deep Sync**: Continuous learning from your decisions and behaviors
- **Local-First**: All data and reasoning on your infrastructure
- **Transparent**: Complete audit trail of all decisions and actions
- **Modular & Extensible**: Domain-centric architecture with extensible skills, agents, and policies
- **Privacy Focused**: Your identity, memories, and reasoning live on your infrastructure
- **Advanced Memory System**: Episodic, semantic, and procedural memory with semantic search
- **Comprehensive Task & Calendar System**: Manage tasks, task lists, and schedule events with advanced linking and recurrence.
- **Skill-Based Execution**: Safe, sandboxed operations with trust-based permissions

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
Modern ChatGPT-style interface with real-time updates:
```bash
cd apps/site && pnpm dev
# Open http://localhost:4321
```

**Features:**
- 💬 Chat - Conversation with your digital personality extension
- 📊 Dashboard - System status and overview
- ✓ Tasks - Task management
- 🧩 Memory - Browse episodic events
- 🎭 Persona - Identity and personality settings
- ⌨️ Terminal - Embedded CLI interface

**Developer Tools (Right Sidebar):**
- Live audit stream
- Agent monitor with statistics
- Boredom control (reflection frequency)
- Model selector (switch Ollama models)

### Three Ways to Interact
1. **Web UI (Recommended)** - Interactive interface with real-time updates
2. **CLI (`mh` command)** - Command-line interface for quick operations
3. **Direct File Access** - All data is stored as human-readable JSON files for direct manipulation

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

### Chat
- `./bin/mh chat` - Interactive persona chat

### Persona & Adapter Commands (Advanced)
- `./bin/mh persona` - Persona management
- `./bin/mh persona status` - Show current persona
- `./bin/mh persona activate` - Generate daily profile
- `./bin/mh adapter` - LoRA adapter workflow management
- `./bin/mh adapter list` - List available adapters
- `./bin/mh adapter merge` - Merge historical adapters
- `./bin/mh adapter review <date>` - Review dataset before approval
- `./bin/mh adapter approve <date>` - Approve dataset for training
- `./bin/mh adapter train <date>` - Start adapter training
- `./bin/mh adapter eval <date>` - Evaluate trained adapter
- `./bin/mh adapter activate <date>` - Activate trained adapter

## Skills System

Skills are the executable capabilities of the MetaHuman OS operator model. They provide controlled, audited interfaces for the AI to interact with the file system, run agents, execute commands, and search memory. Skills are now organized into domains and are namespaced (e.g., `tasks.list`).

### Available Skills

#### Meta-Skills

- **catalog.describe** - Retrieves the available actions for a given domain.

#### Task Domain (`tasks`)

- **tasks.list** - Lists tasks with filters (status, listId, time range).
- **tasks.create** - Creates a task with an optional list, schedule, and tags.
- **tasks.update** - Changes the title, description, priority, or status of a task.
- **tasks.schedule** - Sets the start/end dates and reminders for a task.
- **tasks.listLists** - Fetches all task lists.
- **tasks.createList** - Creates a new task list.

#### Calendar Domain (`calendar`)

- **calendar.listRange** - Lists events for a given date range.
- **calendar.create** - Adds an event to the calendar, with an option to link to a task.
- **calendar.update** - Reschedules or edits an existing event.
- **calendar.delete** - Removes an event from the calendar.
- **calendar.find** - Locates an event by its title or ID.

#### Other Skills

**File System:**
- **fs_list** - List/search for files.
- **fs_read** - Read file contents.
- **summarize_file** - Summarize documents.
- **fs_write** - Create/write files (allowed: memory/, out/, logs/).
- **fs_delete** - Delete files (has dry-run) (allowed: memory/, out/, logs/).
- **json_update** - Update JSON files (allowed: memory/, out/, logs/, etc/).

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

### Trust Levels (Progressive Autonomy)
1. **`observe`** - Monitor only, learn patterns (no autonomous actions)
2. **`suggest`** - Propose actions, require manual approval
3. **`supervised_auto`** - Execute within pre-approved categories
4. **`bounded_auto`** - Full autonomy within defined boundaries
5. **`adaptive_auto`** - Self-expand boundaries based on learning (experimental)

### Trust Levels and Skill Availability

| Trust Level       | Available Skills | Auto-Execute? | Approval Required? |
|-------------------|------------------|---------------|--------------------|
| `observe`         | fs_read, search_index | No | All skills |
| `suggest`         | fs_read, search_index, run_agent | No | All skills |
| `supervised_auto` | All except shell_safe | Yes (low risk) | High-risk only |
| `bounded_auto`    | All | Yes (all) | High-risk only |

### Safety Mechanisms
1. **Approval Queue**: High-risk actions are queued and require explicit approval
2. **Rollback**: All file writes are versioned
3. **Dry Run Mode**: Test operator actions without execution
4. **Emergency Stop**: Stop all running agents and revert trust level

## Autonomous Agents

MetaHuman OS runs several autonomous agents that process memories and generate insights in the background.

### Core Agents

**1. Organizer Agent** - Enriches memories with AI-extracted tags and entities
**2. Reflector Agent** - Generates thoughtful reflections on recent memories
**3. Boredom Service** - Simulates a "wandering mind" by triggering reflections during idle time
**4. Dreamer Agent** - Creates surreal, metaphorical dreams from memory fragments
**5. Sleep Service** - Manages dream generation based on your sleep schedule
**6. Ingestor Agent** - Converts raw files into episodic memories
**7. Operator Agent** - Executes complex multi-step tasks using skills, leveraging the capability catalog for dynamic skill discovery

### Advanced Agents
**8. Auto-Approver Agent** - Quality-based dataset approval for LoRA adaptation
**9. Adapter Builder Agent** - Generates training datasets for LoRA models
**10. LoRA Trainer Agent** - Orchestrates LoRA model training
**11. Eval Adapter Agent** - Evaluates quality of trained adapters

## Long-Term Memory & LoRA Adaptation

MetaHuman OS features a sophisticated personality adaptation system using LoRA (Low-Rank Adaptation) to continuously learn from your memories. This allows your digital personality to evolve over time without needing to retrain the entire base model.

Two tiers of adaptation are available:
- **Tier-1: Prompt Adaptation**: A lightweight, daily process that injects recent memories and persona traits directly into the LLM's system prompt. This provides immediate context for conversations.
- **Tier-2: LoRA Fine-Tuning**: A deeper form of learning where a small "adapter" is fine-tuned on your memories. This permanently encodes patterns, communication styles, and knowledge.

The system uses a **dual-adapter approach** to prevent "catastrophic forgetting" by loading both a historical adapter (containing long-term patterns) and a recent adapter (containing the last 14 days of context) simultaneously.

## Development

This project uses a monorepo structure with pnpm workspaces:
- `packages/core` - Core library with identity, memory, audit, paths, and LLM utilities
- `packages/cli` - Command-line interface
- `apps/site` - Web interface built with Astro and Svelte

## Contributing

We welcome contributions! Please see the [ARCHITECTURE.md](ARCHITECTURE.md) and [DESIGN.md](DESIGN.md) files for technical details about the system architecture.

## Documentation

- Comprehensive User Guide: [docs/user-guide/index.md]
- Design: [DESIGN.md]
- Architecture: [ARCHITECTURE.md]
- Agents overview: [brain/agents/README.md]
- Memory schema: [memory/README.md]

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Support

### Questions or Issues?
- Check the audit logs in `logs/audit/` for operation details
- Review agent logs with `./bin/mh agent logs <name>`
- Inspect memory and config files directly (they're just JSON)
- Check the [Troubleshooting](docs/user-guide/12-troubleshooting.md) section in the user guide