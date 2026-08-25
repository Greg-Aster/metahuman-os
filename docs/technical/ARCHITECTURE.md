# MetaHuman OS Architecture

MetaHuman OS is a local-first TypeScript monorepo. Interfaces are thin; Core
owns application behavior; Brain owns asynchronous cognitive work.

## Repository Owners

| Surface | Owner |
| --- | --- |
| Web interface and Astro transport | `apps/site` |
| React Native interface and bundled HTTP host | `apps/react-native` |
| Domain services, API contracts, graphs, queues, storage, and providers | `packages/core` |
| Command-line interface | `packages/cli` |
| Managed agent process runtime | `packages/agent-runtime` |
| Lightweight local model process | `packages/local-model-service` |
| Agents, workflows, and model training | `brain` |
| Operator defaults and deployment configuration | `etc` |
| Policy checks and maintained automation | `scripts`, `bin` |

## Request Flow

```text
Web or mobile client
  -> transport adapter
  -> Core API router and handler
  -> Core domain owner
  -> response
```

Astro route files forward requests through
`@metahuman/core/api/adapters/astro`. They do not own business logic. Mobile
uses the same Core router through its HTTP adapter.

Long-running work follows a different path:

```text
Core service or API handler
  -> Work Coordinator queue
  -> registered Brain agent or workflow
  -> durable result and audit event
```

The queue is the admission owner. Features must not add private schedulers,
parallel queues, or direct background execution paths.

## Cognitive Runtime

Cognitive graphs are the conversation and environment execution model. Graph
JSON defines composition; registered Core nodes own behavior; the graph
executor owns execution and traces. There is no second imperative cognitive
pipeline or configurable cognitive-layer stack.

The maintained conversation path builds authenticated user context, executes
the selected graph, records durable memory through its canonical owner, and
streams typed events to clients.

## Models and Training

The model registry assigns model roles. Core provider and backend services own
Ollama, vLLM, remote-server, RunPod, and Hugging Face integration.

Training has one curation path and one artifact per requested target:

- Ollama training produces a merged GGUF model.
- vLLM training produces a safetensors LoRA adapter.
- Backend Settings owns runtime loading and unloading.

Training lifecycle state is tracked by exact PID records in
`packages/core/src/training-process.ts`; training scripts do not scan or kill
unrelated processes.

## Data Boundary

`persona`, `profiles`, `memory`, `logs`, `out`, and local runtime directories
are user-owned data. Maintained source resolves them through Core path and
storage services. Source code must not embed a developer username, assume the
owner profile, or commit generated runtime content.

## Dependency Rules

- `packages/core` does not import from `apps`, `brain`, framework UI code, or
  runtime data.
- `brain` consumes public `@metahuman/core` exports.
- Interface packages do not duplicate Core domain behavior.
- Cross-cutting work has one named owner and typed contracts at boundaries.
- Retired owners, feature flags, compatibility routes, and obsolete docs are
  deleted when their replacement is established.

See [MAINTAINED_SURFACE.md](MAINTAINED_SURFACE.md) for scope,
[AUDIT_PROTOCOL.md](AUDIT_PROTOCOL.md) for review procedure, and
[REFACTOR_BLUEPRINT.md](REFACTOR_BLUEPRINT.md) for the active refactor.
