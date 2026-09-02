# Agent Source Adapters

`brain/agents` contains TypeScript source adapters for finite autonomous work and
the Environment Bridge service. It is not the owner of agent registration,
scheduling, process supervision, or execution state.

## Canonical Owners

- `packages/core/src/agent-catalog-definitions.ts` defines shipped agent,
  workflow, and service metadata.
- `etc/agents.json` configures Trigger Manager admission for finite work and
  workflows.
- `etc/services.json` configures persistent service boot and restart policy.
- `packages/core/src/queue` owns the Work Coordinator, Trigger Manager, retries,
  cancellation, and terminal task state.
- `packages/agent-runtime` defines the shared `AgentModule` execution contract.
- `docs/technical/MAINTAINED_SURFACE.md` records the current architecture and
  ownership boundaries. `docs/agents.md` is the human-readable overview.

Do not add per-agent manifests, private schedulers, queues, process managers, or
parallel execution paths here.

## Directory Convention

Most finite agent directories contain:

- `index.ts`: `AgentModule` metadata and registration export.
- `core.ts`: one bounded execution contract and source-specific orchestration.
- `cli.ts`: thin process adapter used by the shared execution owner.
- `*.spec.ts`: focused behavior and ownership tests.

Agent behavior may delegate to public Core contracts and editable cognitive
graphs. Profile identity, storage, scheduling, retries, and durable task state
remain with their canonical owners.

`environment-bridge` is the deliberate exception in this folder: it is a
persistent system service supervised through Agent Monitor and configured in
`etc/services.json`. It does not use the finite-agent scheduling lifecycle.
