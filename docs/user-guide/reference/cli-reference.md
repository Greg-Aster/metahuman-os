# CLI Command Reference

Complete reference for the `mh` CLI. Use `./bin/mh` from the repo root, or `mh` if `bin/` is on your `PATH`.

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

### `./bin/mh sync`
Show current identity + trust state and mark a sync checkpoint.

### `./bin/mh guide`
Print the local user guide path. Note: the guide lives in `docs/user-guide/`.

### `./bin/mh help`
Show CLI help.

## Memory & Capture

### `./bin/mh capture "text"`
Capture a short observation or event into memory.

### `./bin/mh remember <query>`
Search memory. Uses semantic search if an embeddings index is available, otherwise falls back to keyword matching.

### `./bin/mh find <description>`
Use the LLM to locate files by description.

### `./bin/mh ingest <file-or-directory>`
Copy files into the memory ingest inbox for processing.

## Tasks

### `./bin/mh task`
List active tasks.

### `./bin/mh task add "title"`
Create a new task.

### `./bin/mh task start <task-id>`
Mark a task as in progress.

### `./bin/mh task done <task-id>`
Mark a task as completed.

## Trust & Identity

### `./bin/mh trust`
Show the current trust level and available modes.

### `./bin/mh trust <level>`
Set the trust level (`observe`, `suggest`, `supervised_auto`, `bounded_auto`).

## Persona & Adaptation

### `./bin/mh persona <command>`
Manage persona profiles and the interactive interview flow.

Commands:
- `activate` (generate and activate daily profile)
- `status` (show current persona state)
- `diff` (compare base persona vs active profile)
- `generate [--resume]` (start or resume interview)
- `sessions` (list interview sessions)
- `view <id>` (view session transcript)
- `apply <id> [strategy]` (`replace`, `merge`, `append`)
- `discard <id>` (delete a session)
- `cleanup [--dry-run] [--max-age <days>]`

### `./bin/mh adapter <command>`
Manage LoRA adapter datasets and training.

Commands:
- `list`
- `merge`
- `review <date>`
- `approve <date> [notes]`
- `reject <date> [reason]`
- `train <date>`
- `eval <date>`
- `activate <date>`

## Agents & Automation

### `./bin/mh agent <command>`
Manage background agents.

Commands:
- `run <name>`
- `list`
- `status [name]`
- `logs [name]`
- `ps`
- `stop <name>` or `stop --all [--force]`

## LLM Backends

### `./bin/mh ollama <command>`
Ollama management.

Commands:
- `status`
- `list`
- `pull <model>`
- `delete <model>`
- `info <model>`
- `chat <model>`
- `ask <model> "text"`

### `./bin/mh vllm <command>`
vLLM server control.

Commands:
- `status`
- `start [--model <name>] [--gpu-util <value>]`
- `stop`
- `restart`

### `./bin/mh backend <command>`
Switch between active backends.

Commands:
- `status`
- `switch <ollama|vllm>`
- `detect`

## Indexing

### `./bin/mh index build`
Build embeddings index for the current user. Requires `--user`.

Example:
```bash
./bin/mh --user greggles index build
```

### `./bin/mh index query "text"`
Query the embeddings index.

## Audio Processing

### `./bin/mh audio <command>`
Audio ingestion and transcription workflow.

Commands:
- `ingest <file-or-directory>`
- `status`
- `list`
- `info <audio-id>`

## Voice Samples (Collection)

### `./bin/mh voice <command>`
Manage collected voice samples used for training.

Commands:
- `status`
- `list`
- `delete <sample-id>`
- `export`

## Voice Training & Servers

### `./bin/mh rvc <command>`
RVC (Applio) management.

Commands:
- `install`
- `train [--name <model>]`
- `test [--model <model>] [--input <file>]`
- `status`
- `uninstall`

### `./bin/mh sovits <command>`
GPT-SoVITS server management.

Commands:
- `install`
- `start [--port <port>]`
- `stop`
- `restart [--port <port>]`
- `status`
- `logs [--tail <n>]`
- `download-models`
- `test [text]`
- `uninstall`

### `./bin/mh kokoro <command>`
Kokoro TTS management.

Commands:
- `install`
- `status`
- `serve <start|stop> [--port <port>] [--lang <lang>]`
- `voices`
- `test [--text <text>]`
- `train-voicepack [options]`
- `uninstall`

## User Management

### `./bin/mh user <command>`
User management and account inspection.

Commands:
- `list`
- `whoami`
- `info <username>`
- `reset-password <username> [--recovery]`

### `./bin/mh --user <username> <command>`
Run any command under a specific user context.

## Profile Storage

### `./bin/mh profile <command>`
Manage the profile storage path.

Commands:
- `path`
- `path set <path> [--delete-source]`
- `path reset`
- `devices`
- `validate <path>`
- `migrate status`

## System Setup

### `./bin/mh setup <command>`
System-level setup helpers.

Commands:
- `status`
- `encryption`
