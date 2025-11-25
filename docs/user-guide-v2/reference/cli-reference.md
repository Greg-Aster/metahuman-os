# CLI Command Reference

Complete reference for all `mh` CLI commands. All commands follow the pattern: `./bin/mh <command> [args...]`

## System Commands

### `./bin/mh init`
Initialize MetaHuman OS directory structure and copy template configuration files.

**Usage:**
```bash
./bin/mh init
```

**What it does:**
- Creates all required directories (memory, persona, logs, etc.)
- Copies `.template` files to working configs
- Sets up empty data structures

**First-time setup:**
1. Run `mh init`
2. Edit `persona/core.json` with your details
3. Update `persona/routines.json` with your schedule
4. Review `etc/*.json` for runtime settings

---

### `./bin/mh status`
Show system status overview including identity, active tasks, and memory counts.

**Usage:**
```bash
./bin/mh status
```

**Output:**
- Identity summary (name, trust level)
- Active task count
- Recent event counts

---

### `./bin/mh start [--restart|-r] [--force|-f]`
Start background services (scheduler, audio-organizer, headless-watcher).

**Flags:**
- `--restart` or `-r`: Restart services if already running (default: true)
- `--force` or `-f`: Force kill stuck processes

**Usage:**
```bash
# Start with restart (default)
./bin/mh start

# Start without restarting existing services
./bin/mh start --no-restart

# Force restart stuck services
./bin/mh start --force
```

**Services started:**
- `headless-watcher` (always)
- `scheduler-service` (manages other agents via etc/agents.json)
- `audio-organizer` (audio processing)

Note: In headless mode, only `headless-watcher` starts automatically.

---

### `./bin/mh help`
Display help message with available commands.

**Usage:**
```bash
./bin/mh help
./bin/mh --help
./bin/mh -h
```

---

### `./bin/mh guide`
Show path to user guide documentation.

**Usage:**
```bash
./bin/mh guide
```

---

### `./bin/mh sync`
Sync state and show current configuration (identity, trust level, last updated).

**Usage:**
```bash
./bin/mh sync
```

---

## Memory Commands

### `./bin/mh capture "text"`
Capture an observation to episodic memory.

**Usage:**
```bash
./bin/mh capture "Met with Sarah to discuss the ML project timeline"
./bin/mh capture "Interesting insight: async code patterns improve readability"
```

**What it does:**
- Creates JSON file in `memory/episodic/YYYY/YYYY-MM-DD-<uuid>.json`
- Adds timestamp and metadata
- Logs to audit trail
- Organizer agent will process it later to extract tags/entities

---

### `./bin/mh remember <query>`
Search memory using semantic or keyword search.

**Usage:**
```bash
./bin/mh remember "Sarah project discussion"
./bin/mh remember "machine learning"
```

**Search modes:**
1. **Semantic search** (if index exists): Uses vector embeddings for meaning-based search
2. **Keyword search** (fallback): Simple text matching

**Build index for semantic search:**
```bash
./bin/mh ollama pull nomic-embed-text
./bin/mh index build
```

---

### `./bin/mh find <description>`
AI-powered file search using natural language.

**Usage:**
```bash
./bin/mh find "TypeScript files related to voice training"
./bin/mh find "configuration files for agents"
```

**What it does:**
- Uses LLM to interpret your query
- Searches filesystem with intelligent pattern matching
- Returns relevant file paths

---

## Task Commands

### `./bin/mh task`
List all active tasks.

**Usage:**
```bash
./bin/mh task
```

**Output:**
```
Active Tasks:

[high] Finish ML model training
    Status: in_progress | ID: task-2024-11-25-abc123
    Due: 2024-11-30

[medium] Update documentation
    Status: todo | ID: task-2024-11-24-def456
```

---

### `./bin/mh task add "title"`
Create a new task.

**Usage:**
```bash
./bin/mh task add "Write blog post about vector embeddings"
./bin/mh task add "Review PR #123"
```

**Output:**
```
✓ Created: memory/tasks/active/task-2024-11-25-abc123.json
```

---

### `./bin/mh task start <id>`
Mark task as in progress.

**Usage:**
```bash
./bin/mh task start task-2024-11-25-abc123
```

---

### `./bin/mh task done <id>`
Mark task as completed.

**Usage:**
```bash
./bin/mh task done task-2024-11-25-abc123
```

**What it does:**
- Moves task from `active/` to `completed/`
- Updates timestamp
- Logs completion to audit trail

---

## Agent Commands

### `./bin/mh agent list`
List all available agents.

**Usage:**
```bash
./bin/mh agent list
```

**Output:**
```
Available Agents (40):

  organizer
  reflector
  dreamer
  curiosity-service
  ...
```

---

### `./bin/mh agent run <name>`
Execute an agent manually.

**Usage:**
```bash
./bin/mh agent run organizer
./bin/mh agent run reflector
./bin/mh agent run dreamer
```

**Common agents:**
- `organizer` - Process memories, extract tags/entities
- `reflector` - Generate reflections from memory chains
- `dreamer` - Create dream from memory fragments
- `curiosity-service` - Ask user-facing questions
- `inner-curiosity` - Generate internal questions/answers

---

### `./bin/mh agent status [name]`
Show agent execution statistics.

**Usage:**
```bash
# All agents
./bin/mh agent status

# Specific agent
./bin/mh agent status organizer
```

**Output:**
```
Agent: organizer

Total runs: 145
Successful: 142
Failed: 3
Last run: 2024-11-25 10:30:15
```

---

### `./bin/mh agent logs [name]`
View recent agent logs (last 20 entries).

**Usage:**
```bash
# All logs
./bin/mh agent logs

# Specific agent
./bin/mh agent logs organizer
```

---

### `./bin/mh agent monitor`
Show memory processing status for all agents.

**Usage:**
```bash
./bin/mh agent monitor
```

**Output:**
- Unprocessed memory counts
- Processing queue status
- Agent activity

---

### `./bin/mh agent ps`
List running agent processes with PIDs and uptimes.

**Usage:**
```bash
./bin/mh agent ps
```

**Output:**
```
Running agents:

  scheduler-service    pid=12345  uptime=2h 15m     started 2024-11-25T08:15:00Z
  organizer           pid=12346  uptime=1h 30m     started 2024-11-25T09:00:00Z
```

---

### `./bin/mh agent stop <name>`
Stop a running agent.

**Flags:**
- `--force`: Force kill if graceful shutdown fails
- `--all`: Stop all running agents

**Usage:**
```bash
# Stop specific agent
./bin/mh agent stop organizer

# Force stop
./bin/mh agent stop organizer --force

# Stop all agents
./bin/mh agent stop --all
```

---

## Ollama Commands

### `./bin/mh ollama status`
Check if Ollama is running.

**Usage:**
```bash
./bin/mh ollama status
```

**Output:**
```
✓ Ollama is running (v0.3.12)
  Endpoint: http://localhost:11434
```

---

### `./bin/mh ollama list`
List installed models with sizes and details.

**Usage:**
```bash
./bin/mh ollama list
```

**Output:**
```
Installed Models (3):

  phi3:mini
    Size: 2.30 GB
    Modified: 2024-11-20 10:15:30
    Family: phi3
    Parameters: 3.8B
```

---

### `./bin/mh ollama pull <model>`
Install a model from Ollama library.

**Usage:**
```bash
./bin/mh ollama pull phi3:mini
./bin/mh ollama pull nomic-embed-text
./bin/mh ollama pull qwen2.5-coder:7b
```

**Progress display:**
Shows download progress with status updates.

---

### `./bin/mh ollama delete <model>`
Remove an installed model.

**Usage:**
```bash
./bin/mh ollama delete phi3:mini
```

---

### `./bin/mh ollama info <model>`
Show detailed model information.

**Usage:**
```bash
./bin/mh ollama info phi3:mini
```

**Output:**
- Model family and architecture
- Parameter count
- Quantization details
- System prompt template

---

### `./bin/mh ollama chat <model>`
Interactive chat session with a model.

**Usage:**
```bash
./bin/mh ollama chat phi3:mini
```

**Commands during chat:**
- Type messages normally
- `exit` or Ctrl+C to quit

---

### `./bin/mh ollama ask <model> "question"`
One-shot question to a model.

**Usage:**
```bash
./bin/mh ollama ask phi3:mini "What is the capital of France?"
./bin/mh ollama ask qwen2.5-coder:7b "Explain async/await in JavaScript"
```

---

### `./bin/mh ollama doctor`
Diagnose Ollama setup and connectivity issues.

**Usage:**
```bash
./bin/mh ollama doctor
```

**Checks:**
- Ollama service status
- Endpoint connectivity
- Model availability
- Common configuration issues

---

## Semantic Index Commands

### `./bin/mh index build`
Build vector embeddings index for semantic search.

**Prerequisites:**
```bash
./bin/mh ollama pull nomic-embed-text
```

**Usage:**
```bash
./bin/mh index build
```

**What it does:**
- Scans all episodic memories
- Generates vector embeddings using nomic-embed-text
- Saves index to `memory/index/`
- Takes a few minutes for large memory collections

---

### `./bin/mh index query "text"`
Perform semantic search on indexed memories.

**Usage:**
```bash
./bin/mh index query "conversations about machine learning"
./bin/mh index query "Sarah mentioned project deadlines"
```

**Output:**
```
Top matches (semantic, model=nomic-embed-text):

  85.3%  memory/episodic/2024/2024-11-20-abc123.json
      Discussed ML project timeline with Sarah...

  72.1%  memory/episodic/2024/2024-11-15-def456.json
      Meeting notes: project deadline moved to Dec 1...
```

---

## Trust & Identity Commands

### `./bin/mh trust`
Show current trust level and available modes.

**Usage:**
```bash
./bin/mh trust
```

**Output:**
```
Current trust level: observe

Available modes:
  observe (current)
    System monitors but takes no action
  suggest
    System proposes actions for approval
  supervised_auto
    Execute pre-approved action categories
  bounded_auto
    Full autonomy within defined boundaries
```

---

### `./bin/mh trust <level>`
Set trust level.

**Usage:**
```bash
./bin/mh trust observe
./bin/mh trust suggest
./bin/mh trust supervised_auto
./bin/mh trust bounded_auto
```

**Trust levels:**
1. **observe** - Monitor only, no actions
2. **suggest** - Propose actions, require approval
3. **supervised_auto** - Execute approved categories
4. **bounded_auto** - Full autonomy in boundaries

---

## File Ingestion Commands

### `./bin/mh ingest <file-or-dir>`
Copy files to memory inbox for processing.

**Usage:**
```bash
./bin/mh ingest document.pdf
./bin/mh ingest ~/Documents/notes/
./bin/mh ingest *.txt
```

**What it does:**
- Copies files to `memory/inbox/`
- Ingestor agent will process them later
- Processed files move to `memory/inbox/_archive/`

**Supported formats:**
- Text files (.txt, .md)
- PDFs
- JSON
- (More formats via specialized agents)

---

## Chat Commands

### `./bin/mh chat`
Interactive persona-aware chat session.

**Usage:**
```bash
./bin/mh chat
```

**Features:**
- Persona context from `persona/core.json`
- Memory grounding (semantic search if indexed)
- Conversation history
- Cognitive mode awareness

**Commands during chat:**
- Type messages normally
- `exit` or Ctrl+C to quit

---

## Audio Commands

### `./bin/mh audio ingest <file-or-dir>`
Copy audio files to inbox for transcription.

**Usage:**
```bash
./bin/mh audio ingest recording.wav
./bin/mh audio ingest ~/Recordings/
```

**Supported formats:**
- WAV, MP3, FLAC, M4A, OGG

---

### `./bin/mh audio status`
Show audio processing status.

**Usage:**
```bash
./bin/mh audio status
```

---

### `./bin/mh audio list`
List audio files and transcripts.

**Usage:**
```bash
./bin/mh audio list
```

---

### `./bin/mh audio info <id>`
Show details for a specific audio file.

**Usage:**
```bash
./bin/mh audio info audio-2024-11-25-abc123
```

---

## Voice Training Commands

### `./bin/mh voice status`
Show voice training sample collection progress.

**Usage:**
```bash
./bin/mh voice status
```

**Output:**
- Total samples collected
- Sample duration
- Training readiness

---

### `./bin/mh voice list`
List collected voice samples.

**Usage:**
```bash
./bin/mh voice list
```

---

### `./bin/mh voice delete <id>`
Delete a voice sample.

**Usage:**
```bash
./bin/mh voice delete sample-2024-11-25-abc123
```

---

### `./bin/mh voice export`
Export dataset for voice training.

**Usage:**
```bash
./bin/mh voice export
```

**Output:**
Exports training dataset to `out/voice-training/`

---

## RVC Voice Cloning Commands

### `./bin/mh rvc install`
Install RVC (Applio) and dependencies.

**Usage:**
```bash
./bin/mh rvc install
```

**Prerequisites:**
- Python 3.10+
- CUDA toolkit (for GPU acceleration)

---

### `./bin/mh rvc train [--name <name>]`
Train RVC voice model from audio samples.

**Usage:**
```bash
./bin/mh rvc train
./bin/mh rvc train --name my-voice
```

**Requirements:**
- At least 10 minutes of audio samples
- Clean audio (minimal background noise)

---

### `./bin/mh rvc test --model <name> --input <file>`
Test voice conversion with a trained model.

**Usage:**
```bash
./bin/mh rvc test --model my-voice --input test.wav
```

---

### `./bin/mh rvc status`
Check RVC installation and list trained models.

**Usage:**
```bash
./bin/mh rvc status
```

---

### `./bin/mh rvc uninstall`
Remove RVC installation.

**Usage:**
```bash
./bin/mh rvc uninstall
```

---

## GPT-SoVITS Voice Cloning Commands

### `./bin/mh sovits install`
Install GPT-SoVITS and dependencies.

**Usage:**
```bash
./bin/mh sovits install
```

---

### `./bin/mh sovits start [--port <port>]`
Start GPT-SoVITS server.

**Usage:**
```bash
./bin/mh sovits start
./bin/mh sovits start --port 9880
```

**Default port:** 9880

---

### `./bin/mh sovits stop`
Stop the running GPT-SoVITS server.

**Usage:**
```bash
./bin/mh sovits stop
```

---

### `./bin/mh sovits restart [--port <port>]`
Restart the server.

**Usage:**
```bash
./bin/mh sovits restart
./bin/mh sovits restart --port 9880
```

---

### `./bin/mh sovits status`
Check server status and health.

**Usage:**
```bash
./bin/mh sovits status
```

---

### `./bin/mh sovits logs [--tail N]`
Show server logs.

**Usage:**
```bash
./bin/mh sovits logs
./bin/mh sovits logs --tail 100
```

**Default:** Last 50 lines

---

### `./bin/mh sovits download-models`
Download pre-trained models.

**Usage:**
```bash
./bin/mh sovits download-models
```

---

### `./bin/mh sovits test [text]`
Test server with sample text.

**Usage:**
```bash
./bin/mh sovits test "Hello, this is a test"
```

---

### `./bin/mh sovits uninstall`
Remove GPT-SoVITS installation.

**Usage:**
```bash
./bin/mh sovits uninstall
```

---

## Kokoro TTS Commands

### `./bin/mh kokoro install`
Install Kokoro TTS and dependencies.

**Usage:**
```bash
./bin/mh kokoro install
```

---

### `./bin/mh kokoro status`
Check Kokoro installation and server status.

**Usage:**
```bash
./bin/mh kokoro status
```

---

### `./bin/mh kokoro serve <start|stop> [--port 9882] [--lang a] [--device cpu]`
Manage Kokoro TTS server.

**Usage:**
```bash
# Start server
./bin/mh kokoro serve start

# Start with custom settings
./bin/mh kokoro serve start --port 9883 --lang en --device cuda

# Stop server
./bin/mh kokoro serve stop
```

**Options:**
- `--port`: Server port (default: 9882)
- `--lang`: Language code (default: a for American English)
- `--device`: cpu or cuda (default: cpu)

---

### `./bin/mh kokoro voices`
List available built-in voices.

**Usage:**
```bash
./bin/mh kokoro voices
```

---

### `./bin/mh kokoro test [--text TEXT] [--voice VOICE]`
Test synthesis with sample text.

**Usage:**
```bash
./bin/mh kokoro test
./bin/mh kokoro test --text "Hello world" --voice af_sarah
```

---

### `./bin/mh kokoro train-voicepack [--speaker NAME] [--dataset DIR] [--epochs N]`
Train custom voicepack from audio samples.

**Usage:**
```bash
./bin/mh kokoro train-voicepack --speaker my-voice --dataset ./samples --epochs 100
```

**Requirements:**
- Clean audio samples (WAV format)
- At least 30 minutes of audio
- Consistent recording quality

---

### `./bin/mh kokoro uninstall`
Remove Kokoro installation.

**Usage:**
```bash
./bin/mh kokoro uninstall
```

---

## LoRA Adapter Commands

### `./bin/mh adapter list`
List all datasets (pending, approved, trained).

**Usage:**
```bash
./bin/mh adapter list
```

**Output:**
```
Pending Datasets:
  2024-11-20 - 45 pairs

Approved Datasets:
  2024-11-15 - 67 pairs (approved)

Trained Adapters:
  2024-11-10 - active (eval: 0.85)
  2024-11-05 - archived
```

---

### `./bin/mh adapter merge`
Merge historical adapters into single consolidated adapter.

**Usage:**
```bash
./bin/mh adapter merge
```

**What it does:**
- Combines all past training cycles
- Creates `history-merged.gguf`
- Used for dual-adapter models

---

### `./bin/mh adapter review <date>`
Review dataset and show sample conversation pairs.

**Usage:**
```bash
./bin/mh adapter review 2024-11-20
```

**Output:**
Shows sample user/assistant pairs from the dataset.

---

### `./bin/mh adapter approve <date> [notes]`
Approve dataset for training.

**Usage:**
```bash
./bin/mh adapter approve 2024-11-20 "Good quality samples"
./bin/mh adapter approve 2024-11-20
```

**What it does:**
- Marks dataset as approved
- Enables training
- Logs approval to audit trail

---

### `./bin/mh adapter reject <date> [reason]`
Reject and archive dataset.

**Usage:**
```bash
./bin/mh adapter reject 2024-11-20 "Low quality samples"
```

---

### `./bin/mh adapter train <date>`
Train LoRA adapter from approved dataset.

**Usage:**
```bash
./bin/mh adapter train 2024-11-20
```

**Prerequisites:**
- Dataset must be approved
- GPU with sufficient VRAM (24GB+ recommended for 30B models)
- Training configuration in `etc/training.json`

**Training process:**
1. Loads base model from `etc/training.json`
2. Trains LoRA adapter using Unsloth
3. Saves adapter to `out/lora-adapters/<date>/`
4. Runs evaluation automatically

---

### `./bin/mh adapter eval <date>`
Evaluate trained adapter quality.

**Usage:**
```bash
./bin/mh adapter eval 2024-11-20
```

**Output:**
- Perplexity score
- Sample generations
- Quality metrics

---

### `./bin/mh adapter activate <date>`
Activate adapter for use in chat.

**Usage:**
```bash
./bin/mh adapter activate 2024-11-20
```

**Prerequisites:**
- Adapter must be trained
- Must pass evaluation threshold

**What it does:**
- Updates `active-adapter.json`
- Converts adapter to GGUF format (if needed)
- Restarts affected services

---

## Persona Management Commands

### Profile Commands

#### `./bin/mh persona activate`
Generate and activate daily profile (run morning-loader agent).

**Usage:**
```bash
./bin/mh persona activate
```

**What it does:**
- Runs morning-loader agent
- Generates daily profile from base persona
- Merges recent context and priorities
- Activates for current session

---

#### `./bin/mh persona status`
Show current persona state (profile, adapter).

**Usage:**
```bash
./bin/mh persona status
```

**Output:**
```
Profile: daily-2024-11-25
Adapter: 2024-11-20 (active)
Trust Level: observe
Cognitive Mode: dual
```

---

#### `./bin/mh persona diff`
Compare base persona vs active profile.

**Usage:**
```bash
./bin/mh persona diff
```

**Output:**
Shows differences between `persona/core.json` and active daily profile.

---

### Generator Commands (Interactive Interview)

#### `./bin/mh persona generate`
Start interactive personality interview to generate/update persona.

**Usage:**
```bash
./bin/mh persona generate
```

**What it does:**
- Starts LLM-guided interview
- Asks questions about values, goals, communication style
- Generates persona JSON from responses
- Saves session for review

---

#### `./bin/mh persona generate --resume`
Resume latest active interview session.

**Usage:**
```bash
./bin/mh persona generate --resume
```

---

#### `./bin/mh persona sessions`
List all interview sessions.

**Usage:**
```bash
./bin/mh persona sessions
```

**Output:**
```
Interview Sessions:

  session-2024-11-25-abc123 (active)
    Started: 2024-11-25 10:15:00
    Progress: 12/20 questions

  session-2024-11-20-def456 (completed)
    Started: 2024-11-20 09:00:00
    Completed: 2024-11-20 09:45:00
```

---

#### `./bin/mh persona view <id>`
View session transcript.

**Usage:**
```bash
./bin/mh persona view session-2024-11-25-abc123
```

**Output:**
Shows full Q&A transcript from interview.

---

#### `./bin/mh persona apply <id> [strategy]`
Apply persona changes from interview session.

**Strategies:**
- `replace` - Replace entire persona (default)
- `merge` - Merge with existing persona (keep existing values not in new data)
- `append` - Append new sections, don't modify existing

**Usage:**
```bash
# Replace entire persona
./bin/mh persona apply session-2024-11-25-abc123

# Merge new values with existing
./bin/mh persona apply session-2024-11-25-abc123 merge

# Only append new sections
./bin/mh persona apply session-2024-11-25-abc123 append
```

**What it does:**
- Updates `persona/core.json`
- Logs change to audit trail
- Backs up old persona to `persona/backups/`

---

#### `./bin/mh persona discard <id>`
Delete an interview session.

**Usage:**
```bash
./bin/mh persona discard session-2024-11-25-abc123
```

---

#### `./bin/mh persona cleanup [--dry-run] [--max-age <days>]`
Clean up old interview sessions.

**Usage:**
```bash
# Preview what would be deleted
./bin/mh persona cleanup --dry-run

# Delete sessions older than 30 days (default)
./bin/mh persona cleanup

# Delete sessions older than 60 days
./bin/mh persona cleanup --max-age 60
```

---

## Multi-User Management Commands

### `./bin/mh user list`
List all registered users.

**Usage:**
```bash
./bin/mh user list
```

**Output:**
```
Users:

  greggles (owner)
    ID: user-abc123
    Created: 2024-11-01

  friend (viewer)
    ID: user-def456
    Created: 2024-11-15
```

---

### `./bin/mh user whoami`
Show current user context.

**Usage:**
```bash
./bin/mh user whoami
```

**Output:**
```
Current user: greggles
Role: owner
ID: user-abc123
```

---

### `./bin/mh user info <name>`
Show detailed info for a specific user.

**Usage:**
```bash
./bin/mh user info greggles
```

**Output:**
```
User: greggles
Role: owner
ID: user-abc123
Created: 2024-11-01
Profile Path: profiles/greggles/
```

---

### `./bin/mh --user <username> <command>`
Run command as specific user (for multi-user setups).

**Usage:**
```bash
./bin/mh --user greggles status
./bin/mh -u friend task
```

**What it does:**
- Switches user context for the command
- Loads that user's profile paths
- All operations use their data directories

**Example multi-user workflow:**
```bash
# Capture memory as user "alice"
./bin/mh --user alice capture "Had a great meeting today"

# List alice's tasks
./bin/mh -u alice task

# Show alice's status
./bin/mh --user alice status
```

---

## Unimplemented Commands

The following commands appear in older documentation but are **not currently implemented** in the CLI:

### Calendar Commands (Not Implemented)
```bash
# These commands do NOT work:
./bin/mh calendar list
./bin/mh calendar create "<title>"
```

**Status:** Calendar functionality exists as skills (`calendar_list`, `calendar_create`) that can be called by the operator in the web UI, but direct CLI commands are not implemented.

**Workaround:** Use the web UI chat and ask the operator to manage calendar events.

---

### Fine-Tune Command (Not Implemented)
```bash
# This command does NOT work:
./bin/mh fine-tune [--username <name>]
```

**Status:** The command handler exists in `packages/cli/src/commands/fine-tune.ts` but is **not registered** in the main CLI router. Fine-tuning is only available via:
1. Web UI ("Run Full Cycle Now" button)
2. Direct script execution: `pnpm tsx brain/agents/fine-tune-cycle.ts`

**Why:** The fine-tune CLI command was never added to the command router in `mh-new.ts`.

---

## Command Aliases & Shortcuts

### Short flags
- `-h` → `--help`
- `-r` → `--restart` (for `mh start`)
- `-f` → `--force` (for `mh start` and `mh agent stop`)
- `-u` → `--user` (for multi-user commands)

### Exit commands
- `exit`, `quit`, `Ctrl+C` → Exit interactive sessions (chat, ollama chat)

---

## Environment Variables

### User Context
- `USER` - Default username for multi-user commands (falls back to "greggles")

### Training Configuration
- `METAHUMAN_BASE_MODEL` - Override base model for training (default: from `etc/training.json`)

### Development
- `NODE_PATH` - Node module search paths (set automatically by CLI)

---

## Tips & Best Practices

### Command Patterns

**Chain commands with bash:**
```bash
# Capture and immediately search
./bin/mh capture "Important note" && ./bin/mh remember "Important"

# Run multiple agents
./bin/mh agent run organizer && ./bin/mh agent run reflector
```

**Use command substitution:**
```bash
# Get task count
TASK_COUNT=$(./bin/mh task | grep -c "Status:")
echo "You have $TASK_COUNT active tasks"
```

### Multi-User Workflows

**Switch between users:**
```bash
# Work as user "alice"
export MH_USER=alice
./bin/mh status
./bin/mh capture "Alice's note"

# Switch to user "bob"
export MH_USER=bob
./bin/mh status
```

**Or use flag for each command:**
```bash
./bin/mh -u alice capture "Alice's note"
./bin/mh -u bob task
```

### Agent Management

**Check if agents are stuck:**
```bash
./bin/mh agent ps | grep "days"  # Check for long-running agents
```

**Clean restart all agents:**
```bash
./bin/mh agent stop --all
./bin/mh start --force
```

**Monitor agent activity:**
```bash
watch -n 5 './bin/mh agent ps'
```

### Memory Best Practices

**Regular captures:**
```bash
# Add to your shell alias
alias note='./bin/mh capture'

# Then just:
note "Quick observation"
```

**Search workflow:**
```bash
# Build index once
./bin/mh ollama pull nomic-embed-text
./bin/mh index build

# Then semantic search works
./bin/mh remember "project discussions"
```

**Monitor processing:**
```bash
# Check if organizer is keeping up
./bin/mh agent monitor
```

---

## Troubleshooting

### "Not initialized. Run: mh init"
**Solution:** Run `./bin/mh init` to create required directories.

---

### "Ollama is not running"
**Solution:**
```bash
# Start Ollama service
ollama serve

# Or check status
./bin/mh ollama status
```

---

### "Another instance is already running"
**Cause:** Stale lock file.

**Solution:**
```bash
# Check if process is actually running
ps -p $(cat logs/run/locks/<agent-name>.lock | jq -r '.pid')

# If not running, remove lock
rm logs/run/locks/<agent-name>.lock
```

---

### Command not found: mh
**Cause:** Using `mh` instead of `./bin/mh`

**Solution:**
```bash
# Either use full path
./bin/mh status

# Or add to PATH
export PATH="$PATH:$(pwd)/bin"
mh status
```

---

### Permission denied
**Cause:** `bin/mh` script not executable.

**Solution:**
```bash
chmod +x bin/mh
```

---

## See Also

- **[Autonomous Agents](../advanced-features/autonomous-agents.md)** - Background agent details
- **[Multi-User Profiles](../advanced-features/multi-user-profiles.md)** - Multi-user setup guide
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions
- **[Voice System](../training-personalization/voice-system.md)** - Voice training details
