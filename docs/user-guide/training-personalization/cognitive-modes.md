# Cognitive Modes

Cognitive mode selects the live conversation graph and the default policy for
memory, proactive work, training admission, and operator routing. It does not
select a separate hidden pipeline or LoRA adapter.

## Modes

| Mode | Intended use | Memory policy | Proactive work | Operator path |
| --- | --- | --- | --- | --- |
| **Dual Consciousness** | Normal long-term personal operation | Full writes | Enabled | Available to the owner |
| **Agent** | Direct command-oriented assistance | Commands and outcomes | Disabled | Available to the owner |
| **Emulation** | Stable read-only persona conversation | Read-only | Disabled | Disabled |
| **Environment** | Games, simulators, and robots | Conversation records | Environment-specific | Uses the Environment bridge, not Active Operator |

Unauthenticated users are forced to Emulation behavior and cannot write profile
memory. Guest profiles may also lock the saved mode.

## Live Execution

Conversation requests load one graph from `etc/cognitive-graphs/`:

- `dual-mode.json`
- `agent-mode.json`
- `emulation-mode.json`
- `environment-mode.json`

A custom graph with the same filename under
`etc/cognitive-graphs/custom/` overrides the system graph. Graph validation and
the shared executor remain the single execution path for all four modes.

The mode definitions in Core own these defaults:

- **Dual:** recording and proactive agents enabled, full memory writes, and
  training-trigger eligibility.
- **Agent:** recording disabled by default, proactive agents disabled, and
  command-only memory policy.
- **Emulation:** recording, proactive agents, and training disabled; memory is
  read-only.
- **Environment:** proactive agents and normal training disabled; conversation
  memory remains available while actions go through the bounded Environment
  workflow.

Individual services still enforce their own admission and safety contracts. A
mode label is not permission to bypass trust, queue, sleep, or environment task
state owners.

## Switching Modes

Use the mode selector in the web interface. The canonical API is:

```http
POST /api/cognitive-mode
Content-Type: application/json

{"mode":"agent"}
```

Valid values are `dual`, `agent`, `emulation`, and `environment`. The API writes
the current profile's `persona/cognitive-mode.json`, records history, applies
the mode defaults, and updates trust when trust coupling is enabled.

Do not edit a profile's mode file while the service is running. Use the API so
validation, locking, trust coupling, and audit records stay consistent.

## Choosing A Mode

- Choose **Dual** when you want normal memory growth and scheduled personal
  workflows.
- Choose **Agent** for explicit tasks with less background autonomy.
- Choose **Emulation** when the profile must remain read-only.
- Choose **Environment** only when an external adapter is connected and you want
  bounded observation/action turns.

Changing mode affects future turns and service admission. It does not retrain a
model, change the active backend, or activate a different adapter.
