# Environment Interface Bridge

Status: implemented foundation, 2026-07-14

## Ownership

MetaHuman OS owns a generic Environment Bridge agent. The agent is a real
startable process tracked by PID in Agent Monitor. It has no Ainekio commands,
robot protocol knowledge, servo behavior, or environment-specific adapter code.

The configured adapter owns device-specific translation and safety. Ainekio is
one adapter implementation and remains outside this repository.

## Runtime Path

Environment Mode semantic actions enter the MetaHuman environment action queue.
The Environment Bridge agent receives them over authenticated internal SSE and
transfers them over one authenticated full-duplex adapter WebSocket. Adapter
observations and feedback return through the same socket, then enter the
authenticated MetaHuman environment API and bounded environment state.

The connection is event-driven. There is no command polling loop. A reconnect
timer runs only after a connection closes.

## Configuration

- MH_ENVIRONMENT_BRIDGE_TOKEN is the internal agent-to-MetaHuman token.
- MH_ENVIRONMENT_ADAPTER_TOKEN is shared with the selected adapter.
- MH_ENVIRONMENT_ADAPTER_URL optionally overrides the Adapter URL field.
- MH_ENVIRONMENT_GRAPH optionally overrides the Graph field.

Adapter URL and Graph are restart-applied Agent Monitor variables. Tokens are
read-only status fields and their values are never stored in repository
configuration.

## Image Return

Environment observations may contain a JPEG data URL. The
environment_image_input node accepts one still, validates JPEG format and the
120 KiB limit, and emits OpenAI-compatible image_url content. Environment
Context Builder combines the image with the textual state prompt. Provider and
vLLM message types preserve the structured content array through the outgoing
chat-completions request.

Returned text and visual event IDs are deduplicated. Automatic Environment Mode
continuation is serialized per session and limited to eight steps before an
idle reset. The graph emits only semantic actions; adapter and body safety remain
authoritative.

## Deferred

Continuous video, robot PCM utterance assembly, wake-word detection, GPS
drivers, and durable multi-step objectives remain separate follow-up work.
