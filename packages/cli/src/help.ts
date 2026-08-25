export function printHelp(): void {
  console.log(`
MetaHuman OS — Command Line Interface
=====================================

Usage: mh [--user <name>] <command> [options]

System:
  init                Initialize required directories and templates
  status              Show identity, task, and memory status
  start               Start services enabled by the service lifecycle owner
  setup <command>     Inspect setup or configure encryption
  guide               Print the user-guide path

Conversation and memory:
  chat                Start a persona-aware conversation
  capture "text"      Capture an episodic event
  remember <query>    Search memory
  find <description>  Find a file by description
  task <command>      Add, list, start, or complete tasks
  index <command>     Build or query the semantic index
  ingest <path>       Ingest supported files

Identity and profiles:
  trust [level]       Show or set the active trust level
  persona <command>   Inspect or generate persona data
  profile <command>   Manage profile data
  user <command>      Inspect users or reset credentials

Agents and models:
  agent <command>     List, run, stop, or inspect managed agents
  big-brother <cmd>   Inspect or stop the Big Brother session
  ollama <command>    Manage the Ollama backend
  vllm <command>      Manage the vLLM backend
  backend <command>   Inspect or switch the active backend

Audio and voice:
  audio <command>         Ingest or inspect audio
  voice <command>         Inspect samples and export training data
  voice-server <command>  Manage shared Kokoro/Whisper services
  kokoro <command>        Manage Kokoro
  sovits <command>        Manage GPT-SoVITS
  rvc <command>           Manage RVC

Context:
  --user <name>, -u <name>  Run the command in one user's profile context

Examples:
  mh status
  mh --user alice capture "Met with Sarah about the project"
  mh --user alice index build
  mh agent list
  mh backend status

Run a command without a subcommand to see its focused help. Protected commands
enforce the same profile and role boundaries as the web API.

For more information, see docs/user-guide/index.md
`.trim())
}
