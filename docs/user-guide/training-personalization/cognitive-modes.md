# Cognitive Modes

Cognitive mode selects the live conversation graph and the default policy for
memory, proactive work, training admission, and operator routing. It does not
select a separate hidden pipeline or LoRA adapter.

## Modes

- **Dual Consciousness** is normal long-term personal operation. Its memory
  policy permits the full supported event set, proactive work is enabled, and
  the Operator path is available to owner and standard accounts.
- **Agent** favors direct command-oriented assistance. Its memory policy admits
  command and outcome events, proactive work is disabled, and the Operator path
  remains available to owner and standard accounts.
- **Emulation** provides stable persona conversation without new long-term
  memory capture. Proactive work, Operator execution, and training are disabled.
- **Environment** is for games, simulators, and robots. Conversation records may
  be retained by policy, proactive work is environment-specific, and semantic
  actions use the Environment Bridge rather than Active Operator.

Cognitive mode and account authorization are distinct. Owner and standard
accounts may retain other profile or configuration permissions in Emulation;
the mode does not make every API read-only. Guest accounts are read-only and
locked to Emulation, and changing the visible mode cannot bypass that policy.

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
- **Emulation:** recording, proactive agents, Operator work, and training are
  disabled; the memory policy rejects new long-term capture.
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
- Choose **Emulation** when you want persona conversation without new long-term
  memory capture. Use a guest account when the whole session must be read-only.
- Choose **Environment** only when an external adapter is connected and you want
  bounded observation/action turns.

Changing mode affects future turns and service admission. It does not retrain a
model, change the active backend, or activate a different adapter.
