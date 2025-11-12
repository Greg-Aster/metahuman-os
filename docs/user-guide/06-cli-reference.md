## Command Line Interface

### System Commands
- `./bin/mh init` - Initialize directory structure
- `./bin/mh status` - Show system status
- `./bin/mh start` - Start background services (with --restart/-r and --force/-f options)
- `./bin/mh help` - Display help
- `./bin/mh guide` - Show path to user guide
- `./bin/mh sync` - Sync state and update models

### Memory Commands
- `./bin/mh capture "text"` - Capture observation
- `./bin/mh remember <query>` - Search memory (semantic if indexed)
- `./bin/mh find <description>` - AI-powered file search

### Task Commands
- `./bin/mh task` - List active tasks
- `./bin/mh task add "title"` - Create task
- `./bin/mh task start <id>` - Start task
- `./bin/mh task done <id>` - Complete task

### Calendar Commands
- `./bin/mh calendar list` - List calendar events for the upcoming week
- `./bin/mh calendar create "<title>"` - Create a new calendar event

### Agent Commands
- `./bin/mh agent list` - List available agents
- `./bin/mh agent run <name>` - Execute agent
- `./bin/mh agent status [name]` - Show agent statistics
- `./bin/mh agent logs [name]` - View recent logs
- `./bin/mh agent monitor` - Show memory processing status
- `./bin/mh agent ps` - List running agent processes
- `./bin/mh agent stop <name>` - Stop running agent (--force option available)
- `./bin/mh agent stop --all` - Stop all running agents

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
- `./bin/mh chat` - Interactive persona-aware chat

### Audio Commands
- `./bin/mh audio ingest <file-or-dir>` - Copy audio files to the inbox for transcription
- `./bin/mh audio status` - Show audio processing status
- `./bin/mh audio list` - List audio files and transcripts
- `./bin/mh audio info <id>` - Show details for an audio file

### Voice Training Commands
- `./bin/mh voice status` - Show voice training progress
- `./bin/mh voice list` - List collected voice samples
- `./bin/mh voice delete <id>` - Delete a voice sample
- `./bin/mh voice export` - Export dataset for training

### Persona & Adapter Commands (Advanced)
- `./bin/mh persona` - Persona management
- `./bin/mh persona status` - Show current persona
- `./bin/mh persona activate` - Generate daily profile
- `./bin/mh persona diff` - Compare base persona vs active profile
- `./bin/mh adapter` - LoRA adapter workflow management
- `./bin/mh adapter list` - List available adapters
- `./bin/mh adapter review <date>` - Review dataset before approval
- `./bin/mh adapter approve <date>` - Approve dataset for training
- `./bin/mh adapter train <date>` - Start adapter training
- `./bin/mh adapter eval <date>` - Evaluate trained adapter
- `./bin/mh adapter activate <date>` - Activate trained adapter

### SoVITS Voice Cloning Commands
- `./bin/mh sovits` - SoVITS voice cloning workflow management

### Multi-User Management Commands
- `./bin/mh user list` - List all registered users
- `./bin/mh user whoami` - Show current user context
- `./bin/mh user info <name>` - Show detailed info for a user
- `./bin/mh --user <username> <command>` - Run command as specific user
- `./bin/mh -u <username> <command>` - Short form for running command as specific user

---

