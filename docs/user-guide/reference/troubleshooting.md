# Troubleshooting

Diagnose MetaHuman from the canonical owner outward. A running process proves
only that the process exists; verify the request, state transition, durable
output, and user-visible result separately.

## Start with these checks

```bash
./bin/mh status
./bin/mh backend status
./bin/mh agent status
./bin/audit check
```

Also inspect the browser console and the relevant record under `logs/run/` or
the authenticated profile's logs. Do not delete locks, state, or user data until
you have confirmed the exact owner and PID.

## Site does not start

1. Confirm Node and pnpm meet the versions in the root `package.json`.
2. Run `pnpm install` from the repository root.
3. Start the canonical launcher with `./start.sh`, or run the site directly with
   `pnpm --dir apps/site dev` for UI development.
4. If port 4321 is occupied, identify the owning process before changing ports
   or stopping anything.

After rebuilding `apps/site/dist`, restart a long-lived Astro server. A server
that retained an old module graph can request deleted hashed chunks.

## Ollama or vLLM is unavailable

```bash
./bin/mh backend status
./bin/mh ollama status
./bin/mh vllm status
```

Confirm that `etc/llm-backend.json` selects the intended backend and that the
assigned model exists in the authenticated profile's `models.json`. Use Backend
Settings or the backend CLI to switch; do not introduce a second backend-state
file.

If a newly trained model is missing, inspect the training run summary and
Backend Settings. Ollama targets require a successful model creation step;
vLLM targets require the compatible base model and explicit adapter loading.

## An agent does not run

```bash
./bin/mh agent list
./bin/mh agent status
./bin/mh agent logs NAME
```

Check both ownership layers:

- `etc/agents.json` controls Trigger Manager admission for finite work.
- `etc/services.json` controls persistent process lifecycle.

Do not register the same worker in both systems. If the monitor reports an
existing process, compare its PID and command with the owner record before
removing any lock.

## Semantic search is empty

Confirm the embedding backend is reachable, then queue a rebuild for the exact
profile:

```bash
./bin/mh --user USERNAME index build
./bin/mh --user USERNAME index query "test query"
```

Queue admission is not semantic completion. Verify that the index job finishes
and that a subsequent query reads the refreshed profile index.

## A write returns 403

Check the authenticated role and the exact operation first. Guest sessions are
read-only. Emulation blocks long-term memory capture, Operator work, proactive
work, and training, but it does not make every owner/standard configuration
operation read-only. Switch to Dual or Agent only when the rejected operation
requires that mode, the user is authorized, and special system-state flags
permit it.

```bash
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"dual"}'
```

An authenticated browser session cookie is required for protected routes; an
unauthenticated curl request is expected to fail.

## A skill rejects a path or trust level

Path rejection means the Core path resolver or skill policy did not admit the
requested target. Use a path inside the declared boundary and correct typos;
do not widen allowed directories to bypass a single request.

Trust rejection means the canonical security policy requires approval or blocks
that capability. Change trust through the supported UI/CLI only after reviewing
the requested action and its audit history.

## Training does not start

- Confirm no canonical training process is already running.
- Confirm the intended profile has accepted Curator records.
- Review local GPU capability or RunPod credentials.
- Inspect the training log path returned by the launch endpoint.
- For remote S3 transfer, verify the documented `RUNPOD_S3_*` variables or
  disable S3 for that run and use the direct transfer path.

A failed preprocessing, training, conversion, transfer, or registration stage
must remain failed; do not treat partial files as a completed model.

See [AI Training](/user-guide#ai-training).

## Voice is silent

```bash
./bin/mh voice-server status --all
```

Confirm the profile's provider in `voice.json`, then confirm the corresponding
shared process in `etc/voice-servers.json`. A successful TTS generation followed
by silence may be a queue cancellation or playback issue, so inspect both the
TTS result and the later audio-delivery event.

## Reporting a problem

Include the failing command or route, authenticated profile/role (without
credentials), relevant owner configuration, focused log excerpt, and the last
successful state transition. Never include secrets, personal memories, or an
entire runtime-data directory.
