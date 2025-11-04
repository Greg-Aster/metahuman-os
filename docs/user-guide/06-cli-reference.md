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

### Audio Commands
- `./bin/mh audio ingest <file-or-dir>` - Copy audio files to the inbox for transcription

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

---

