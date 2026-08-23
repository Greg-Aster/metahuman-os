export function printHelp(): void {
  console.log(`
MetaHuman OS — Command Line Interface
======================================

Usage: mh <command> [options]

Core Commands:
  init                Initialize MetaHuman OS directory structure
  status              Show system status and identity summary
  start               Start background services (organizer, boredom)
  chat                Converse with your digital personality extension (persona-aware)
  sync                Sync state and update models

Memory & Capture:
  capture "text"      Capture an observation or event
  remember <query>    Search across memory (semantic if indexed)
  find <description>  Use AI to find a file by description

Identity & Trust:
  trust               Show current trust level
  trust <level>       Set trust level (observe|suggest|supervised_auto|bounded_auto)

Persona & Adaptation:
  persona status      Show active profile and adapter state
  persona activate    Generate and activate daily profile (run morning-loader)
  persona diff        Compare base persona vs active profile

LoRA Adapters:
  adapter list        List all datasets (pending, approved, trained)
  adapter review <date>   Review dataset and show sample pairs
  adapter approve <date>  Approve dataset for training
  adapter train <date>    Train LoRA adapter (requires approval)

Agents & Automation:
  agent run <name>    Run a background agent (e.g., 'organizer')
  agent list          List available agents
  agent status        Show agent run statistics
  agent logs [name]   View recent agent activity

Ollama:
  ollama status       Check if Ollama is running
  ollama list         List installed models
  ollama pull <model> Install a model (e.g., phi3:mini)
  ollama chat <model> Interactive chat with a raw model (not persona-aware)
  ollama ask <model>  Ask a one-shot question

vLLM:
  vllm status         Check if vLLM server is running
  vllm start          Start vLLM server (--model, --gpu-util options)
  vllm stop           Stop vLLM server
  vllm restart        Restart vLLM server

LLM Backends:
  backend status      Show current backend status (Ollama/vLLM)
  backend switch      Switch active backend (ollama|vllm)
  backend detect      Detect available backends

Audio Processing:
  audio ingest <path> Copy audio files to inbox for transcription
  audio status        Show audio processing status
  audio list          List audio files and transcripts
  audio info <id>     Show details for an audio file

Voice Training:
  voice status        Show voice training progress
  voice list          List collected voice samples
  voice delete <id>   Delete a voice sample
  voice export        Export dataset for training

Voice Servers:
  voice-server status <kokoro|whisper|--all>
  voice-server start <kokoro|whisper|--all>
  voice-server stop <kokoro|whisper|--all>

Indexing:
  index build         Build embeddings index over memory
  index query "text"  Semantic search using the index

Guide:
  guide               Show path to the user guide

Multi-User Management:
  user list           List all registered users
  user whoami         Show current user context
  user info <name>    Show detailed info for a user

System Setup:
  setup status        Check system configuration status
  setup encryption    Configure passwordless LUKS encryption

Multi-User Usage:
  --user <name>       Run command as specific user (or -u)

Examples:
  mh chat
  mh capture "Met with Sarah about ML project"
  mh agent run organizer
  mh ollama pull phi3:mini

  mh --user alice capture "Had coffee with Bob"
  mh -u bob task add "Review PR"
  mh user list

Security:
  - Owners can modify system files and manage all profiles
  - Standard users can only modify files in their own profile
  - Guests have read-only access
  - All data isolated per user in profiles/<username>/

For more information, see docs/user-guide/index.md
`.trim())
}
