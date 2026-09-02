# CLI Command Reference

This is the maintained user-facing reference for the `mh` CLI. Use `./bin/mh`
from the repository root, or `mh` if `bin/` is on your `PATH`. The executable's
top-level and focused help remain authoritative when commands change.

## Core Commands

### `./bin/mh init`
Initialize MetaHuman OS directory structure and copy template configuration files.

### `./bin/mh status`
Show system status overview (identity summary, tasks, recent events).

### `./bin/mh start [--restart|-r] [--force|-f]`
Start background services.
- `--restart` or `-r`: restart already-running agents (default: on)
- `--force` or `-f`: force-stop stuck processes

### `./bin/mh chat`
Start a persona-aware chat session in the terminal.

### `./bin/mh guide`
Print the local user guide path. Note: the guide lives in `docs/user-guide/`.

### `./bin/mh help`
Show CLI help.

## Memory & Capture

### `./bin/mh capture "text"`
Capture a short observation or event into memory.

### `./bin/mh remember QUERY`
Search memory. Uses semantic search if an embeddings index is available, otherwise falls back to keyword matching.

### `./bin/mh find DESCRIPTION`
Use the LLM to locate files by description.

### `./bin/mh ingest FILE_OR_DIRECTORY`
Copy UTF-8 TXT, Markdown, or JSON files into the memory inbox. This stages the
files; run `./bin/mh agent run ingestor` or use **System → Agent Catalog → Inbox
Ingestor → Run now** to process them.

## Tasks

### `./bin/mh task`
List active tasks.

### `./bin/mh task add "title"`
Create a new task.

### `./bin/mh task start TASK_ID`
Mark a task as in progress.

### `./bin/mh task done TASK_ID`
Mark a task as completed.

## Trust & Identity

### `./bin/mh trust`
Show the current trust level and available modes.

### `./bin/mh trust LEVEL`
Set the trust level (`observe`, `suggest`, `supervised_auto`, `bounded_auto`, or
`adaptive_auto`).

## Persona & Adaptation

### `./bin/mh persona COMMAND`
Manage persona profiles and the interactive interview flow.

Commands:
- `status` (show current persona state)
- `generate [--resume]` (start or resume interview)
- `sessions` (list interview sessions)
- `view ID` (view session transcript)
- `apply ID [strategy]` (`replace`, `merge`, `append`)
- `discard ID` (delete a session)
- `cleanup [--dry-run] [--max-age DAYS]`

## Agents & Automation

### `./bin/mh agent COMMAND`
Run finite agents and inspect or control persistent agent processes through the
maintained shared command surface.

Commands:
- `run NAME`
- `list`
- `status [name]`
- `logs [name]`
- `ps`
- `stop NAME` or `stop --all [--force]`

## LLM Backends

### `./bin/mh ollama COMMAND`
Ollama management.

Commands:
- `status`
- `list`
- `pull MODEL`
- `delete MODEL`
- `info MODEL`
- `chat MODEL`
- `ask MODEL "text"`

### `./bin/mh vllm COMMAND`
vLLM server control.

Commands:
- `status`
- `start [--model NAME] [--gpu-util VALUE]`
- `stop`
- `restart`

### `./bin/mh backend COMMAND`
Switch between active backends.

Commands:
- `status`
- `start`
- `switch <ollama|vllm>`
- `detect`

## Indexing

### `./bin/mh index build`
Queue a full embeddings-index rebuild for the current user. Requires `--user`
and a running MetaHuman server/Work Coordinator. The configured embedding
service must be available when the queued job executes.

Example:
```bash
./bin/mh --user USERNAME index build
```

### `./bin/mh index query "text"`
Query the embeddings index.

## Voice Samples (Collection)

### `./bin/mh voice COMMAND`
Manage collected voice samples used for training.

Commands:
- `status`
- `list`
- `delete SAMPLE_ID`
- `export`

## Voice Training & Servers

### `./bin/mh rvc COMMAND`
RVC (Applio) management.

Commands:
- `install`
- `train [--name MODEL] [--epochs N] [--save-every N] [--batch-size N] [--device auto|cpu|cuda]`
- `status [--name MODEL]`
- `uninstall`

### `./bin/mh sovits COMMAND`
GPT-SoVITS server management.

Commands:
- `install`
- `start [--port PORT]`
- `stop`
- `restart [--port PORT]`
- `status`
- `logs [--tail N]`
- `download-models`
- `test [text]`
- `uninstall`

### `./bin/mh kokoro COMMAND`
Kokoro TTS management.

Commands:
- `install`
- `status`
- `serve <start|stop>`
- `voices`
- `test [--text TEXT]`
- `uninstall`

### `./bin/mh voice-server COMMAND`
Manage the shared Kokoro and Whisper service lifecycle.

Commands:
- `status <kokoro|whisper|--all>`
- `start <kokoro|whisper|--all> [--boot]`
- `stop <kokoro|whisper|--all>`

### `./bin/mh big-brother COMMAND`
Inspect or stop the active Big Brother terminal session.

Commands:
- `status`
- `stop`

## User Management

### `./bin/mh user COMMAND`
User management and account inspection.

Commands:
- `list`
- `whoami`
- `info USERNAME`
- `reset-password USERNAME [--recovery]`

### `./bin/mh --user USERNAME COMMAND`
Run any command under a specific user context.

## Profile Storage

### `./bin/mh profile COMMAND`
Manage the profile storage path.

Commands:
- `path`
- `path set PATH [--delete-source]`
- `path reset`
- `devices`
- `validate PATH`
- `migrate status`

## System Setup

### `./bin/mh setup COMMAND`
System-level setup helpers.

Commands:
- `status`
- `encryption`
