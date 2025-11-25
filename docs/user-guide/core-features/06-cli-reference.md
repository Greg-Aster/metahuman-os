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

### RVC Voice Cloning Commands
- `./bin/mh rvc install` - Install RVC (Applio) and dependencies
- `./bin/mh rvc train [--name <name>]` - Train RVC voice model from audio samples
- `./bin/mh rvc test --model <name> --input <file>` - Test voice conversion
- `./bin/mh rvc status` - Check RVC installation and list trained models
- `./bin/mh rvc uninstall` - Remove RVC installation

### GPT-SoVITS Voice Cloning Commands
- `./bin/mh sovits install` - Install GPT-SoVITS and dependencies
- `./bin/mh sovits start [--port <port>]` - Start GPT-SoVITS server (default port: 9880)
- `./bin/mh sovits stop` - Stop the running server
- `./bin/mh sovits restart [--port <port>]` - Restart the server
- `./bin/mh sovits status` - Check server status and health
- `./bin/mh sovits logs [--tail N]` - Show server logs (default: last 50 lines)
- `./bin/mh sovits download-models` - Download pre-trained models
- `./bin/mh sovits test [text]` - Test server with sample text
- `./bin/mh sovits uninstall` - Remove GPT-SoVITS installation

### Kokoro TTS Commands
- `./bin/mh kokoro install` - Install Kokoro TTS and dependencies
- `./bin/mh kokoro status` - Check Kokoro installation and server status
- `./bin/mh kokoro serve <start|stop> [--port 9882] [--lang a] [--device cpu]` - Manage Kokoro server
- `./bin/mh kokoro voices` - List available built-in voices
- `./bin/mh kokoro test [--text TEXT] [--voice VOICE]` - Test synthesis with sample text
- `./bin/mh kokoro train-voicepack [--speaker NAME] [--dataset DIR] [--epochs N]` - Train custom voicepack
- `./bin/mh kokoro uninstall` - Remove Kokoro installation

### LoRA Adapter Commands
- `./bin/mh adapter list` - List all datasets (pending, approved, trained)
- `./bin/mh adapter merge` - Merge historical adapters into single consolidated adapter
- `./bin/mh adapter review <date>` - Review dataset and show sample pairs
- `./bin/mh adapter approve <date> [notes]` - Approve dataset for training
- `./bin/mh adapter reject <date> [reason]` - Reject and archive dataset
- `./bin/mh adapter train <date>` - Train LoRA adapter (requires approval)
- `./bin/mh adapter eval <date>` - Evaluate trained adapter
- `./bin/mh adapter activate <date>` - Activate adapter for use (requires passing eval)

### Fine-Tune Commands
- `./bin/mh fine-tune [--username <name>]` - Run cognitive mode fine-tuning pipeline
- `./bin/mh fine-tune --base-model <model>` - Specify base model (default: qwen3-coder:30b)
- `./bin/mh fine-tune --max <count>` - Limit maximum samples to process
- `./bin/mh fine-tune --mode <type>` - Filter by cognitive mode (dual, emulation, or agent)
- `./bin/mh fine-tune --skip-validation` - Skip dataset validation checks

### Persona Management Commands
**Profile Commands:**
- `./bin/mh persona activate` - Generate and activate daily profile (run morning-loader)
- `./bin/mh persona status` - Show current persona state (profile, adapter)
- `./bin/mh persona diff` - Compare base persona vs active profile

**Generator Commands (Interactive Interview):**
- `./bin/mh persona generate` - Start interactive personality interview
- `./bin/mh persona generate --resume` - Resume latest active session
- `./bin/mh persona sessions` - List all interview sessions
- `./bin/mh persona view <id>` - View session transcript
- `./bin/mh persona apply <id> [strategy]` - Apply persona changes (strategies: replace, merge, append)
- `./bin/mh persona discard <id>` - Delete a session
- `./bin/mh persona cleanup [--dry-run] [--max-age <days>]` - Clean up old sessions (default: 30 days)

### Multi-User Management Commands
- `./bin/mh user list` - List all registered users
- `./bin/mh user whoami` - Show current user context
- `./bin/mh user info <name>` - Show detailed info for a user
- `./bin/mh --user <username> <command>` - Run command as specific user
- `./bin/mh -u <username> <command>` - Short form for running command as specific user

---

