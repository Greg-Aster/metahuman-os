# Architecture

MetaHuman OS is a pnpm monorepo with interface shells above one engine and a set
of finite workers above that engine.

```text
apps/site, apps/react-native, packages/cli
  -> transport and user interfaces
  -> public Core and agent-runtime contracts

brain/*
  -> agents, services, training jobs, and external bridges
  -> public Core contracts

packages/core
  -> storage, auth, policy, memory, models, graphs, queues,
     shared API handlers, and domain owners
```

## Main Boundaries

- `packages/core` cannot import app, Brain, Svelte, or Astro implementation.
- `apps/site/src/pages/api` is thin transport. Shared behavior belongs in Core
  handlers.
- Brain workers use public `@metahuman/core` exports rather than deep source
  imports.
- Profile, persona, memory, state, log, model, and output paths are resolved by
  their Core owners; they are not maintained source.
- Cognitive behavior is executed by validated graphs in
  `etc/cognitive-graphs/`, not by a second configurable layer pipeline.

## Conversation Flow

```text
web/mobile request
  -> shared persona-chat handler
  -> authenticated profile and cognitive mode
  -> user-input admission through the buffer graph
  -> mode graph execution
  -> model router and graph nodes
  -> persisted response and streamed client events
```

Dual, Agent, Emulation, and Environment modes each select one graph. The shared
graph executor owns node wiring, validation, progress events, and cancellation.
The model router owns provider and role selection.

## Work And Autonomy

The Work Coordinator is the one durable queue. Trigger Manager admits scheduled
finite work, while Agent Monitor owns persistent services. Active Operator owns
Reactive, Semi, and Full mode transitions; Full policy proposals are not a
second scheduler.

Sleep Workflow owns its ordered sleep stages. Robot Operator owns boredom,
movement, and reflection admission for the robot. Robot Status owns task
continuity and the latest action result; specialized Environment nodes correlate
feedback and select images. Environment Bridge owns transport and adapter
observation data only.

## Data Ownership

Each authenticated profile has its own identity, configuration, memory, state,
and generated output. Core path and storage services resolve those locations.
Runtime data must not be committed, imported as source, or hardcoded into an app
or worker.

Curator owns accepted training records. Training orchestrators consume that
store and produce one runtime artifact per run. Ollama and vLLM backend owners
control activation and loading.

## Extending The System

Before adding a route, node, store, worker, or service:

1. search the maintained tree for the existing responsibility and owner;
2. extend its public contract when the responsibility already exists;
3. keep transport and UI free of domain behavior;
4. register new executable work with the existing queue, trigger, service, or
   graph owner;
5. add focused contract validation and delete superseded wiring in the same
   change.

The remote-safe architecture authority is
`docs/technical/MAINTAINED_SURFACE.md`.
The active refactor rules and validation standard are in
`docs/technical/REFACTOR_BLUEPRINT.md`.
