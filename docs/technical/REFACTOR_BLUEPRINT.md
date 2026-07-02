# Refactor Blueprint

This is the canonical architecture contract for cleanup work. Future agents should use this before making code changes.

## Target Architecture

MetaHuman is a pnpm monorepo with interface packages on top of a behind-the-scenes engine.

```
apps/* and packages/cli
  -> API adapters, UI, shell commands
  -> call public engine and agent-runtime interfaces

brain/*
  -> autonomous workers, training jobs, schedulers
  -> call public engine interfaces

packages/agent-runtime
  -> agent execution abstraction for web/mobile/process modes

packages/core
  -> engine/domain logic, storage abstraction, auth, policy, memory,
     model routing, graph execution, shared API handlers
```

## Dependency Rules

- `packages/core` must not import from `apps`, `brain`, Astro, Svelte, or UI code.
- `apps/site` client code must not import runtime-heavy core modules. Browser-safe types and schemas are allowed through explicit exports only.
- `apps/site/src/pages/api` should be transport-only. Business logic belongs in `packages/core/src/api/handlers`.
- `brain/agents` should call `@metahuman/core` public exports, not deep `packages/core/src/...` paths.
- CLI command modules should parse arguments and delegate. Durable behavior belongs in core or agent modules.
- Runtime data must be resolved through profile/path utilities. Do not hardcode `profiles/<user>`, `persona/core.json`, or root memory paths.

## Cleanup Order

1. Protect the remote source tree from personal/runtime/generated files.
2. Add guardrails and a debt baseline before moving code.
3. Run the line-by-line audit over the maintained surface.
4. Fix inverted dependencies and deep imports first.
5. Consolidate API routes and CLI command ownership.
6. Split oversized files only after their owner boundary is clear.
7. Delete orphan code only after an audit finding and reference check agree.

## Refactor Rules

- Do not add parallel systems when an existing owner can be corrected.
- Do not patch over old code if the change is architectural; update or remove the old owner.
- Keep migrations behavior-preserving unless the user explicitly asks for a product change.
- Prefer small, reviewable batches with a before/after validation command.
- Every new exception to a boundary rule must be documented in the guardrail baseline with a short reason.
