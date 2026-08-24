# System Refactor Blueprint

- **Status:** Active
- **Started:** 2026-08-24
- **Scope:** The complete maintained source surface

This is the canonical plan for the MetaHuman OS system refactor. Detailed audit
findings belong under `docs/audits/`; chronological implementation evidence
belongs in `docs/audits/consolidation-progress.md`.

## Engineering Principles

1. **Production quality.** Correct the canonical owner. Do not leave patches,
   workarounds, cruft, avoidable debt, orphan code, hidden fallbacks, or misleading
   completion claims.
2. **Discover before creating.** Search maintained source, exports, callers,
   routes, configuration, tests, and documentation. Reuse, repair, or consolidate
   the existing owner before adding code.
3. **One system per responsibility.** Do not create duplicate or competing queues,
   schedulers, stores, validators, policies, services, or execution paths.
4. **Separation of concerns.** Preserve dependency direction and keep behavior
   behind a narrow owner contract so optional utilities can be removed cleanly.
5. **Lean implementation.** Use the smallest complete design. Delete superseded
   code, wiring, configuration, dependencies, tests, and docs in the same change.
6. **Evidence before completion.** Run focused validation and search for stale
   references, duplicate paths, and unused artifacts. Report unverified behavior
   honestly.

## Refactor Scope

The maintained boundary is defined by `docs/technical/MAINTAINED_SURFACE.md`, not
by directory size or convenience. Excluded runtime, personal, generated, vendor,
archive, and legacy bulk areas are not normal refactor targets. Remote-safety
checks still apply to the complete tracked tree.

Existing worktree changes belong to their current authors. Before editing an
overlapping file, attribute the change, understand its intended owner and
validation state, and preserve unrelated work.

The program is behavior-preserving unless the Installation Owner explicitly
requests a product change. An audit finding authorizes a scoped refactor ticket,
not unrelated redesign.

## Target Architecture

MetaHuman is a pnpm monorepo with interface packages on top of a behind-the-scenes
engine.

```text
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
- `apps/site` client code must not import runtime-heavy core modules. Browser-safe
  types and schemas are allowed through explicit exports only.
- `apps/site/src/pages/api` is transport-only. Business logic belongs in
  `packages/core/src/api/handlers` or an explicitly documented service owner.
- `brain/*` calls public `@metahuman/core` exports, not deep
  `packages/core/src/...` paths.
- CLI commands parse and delegate. Durable behavior belongs in core or an
  explicitly documented agent/service owner.
- Runtime data is resolved through profile, path, and storage owners. Do not
  hardcode profile, persona, memory, or user paths.

## Owner-by-Owner Method

For each owner group:

1. inventory its entrypoints, public contracts, callers, registrations,
   configuration, state, side effects, tests, and runtime evidence;
2. record keep, repair, merge, move, split, or delete findings using
   `docs/technical/AUDIT_PROTOCOL.md`;
3. identify duplicate ownership, inverted dependencies, bypasses, compatibility
   residue, dead paths, and missing validation;
4. define one bounded implementation slice with a baseline, deletion set, and
   acceptance evidence;
5. change the canonical owner, move its consumers, and remove the superseded path;
6. run focused tests plus applicable type, build, architecture, remote-safety, and
   runtime checks;
7. record proven results and remaining unverified behavior in the progress ledger.

Auditing and implementation remain separate passes. Suspected orphan code is
deleted only after static references and real entrypoints or registrations agree.

## Repository-Wide Audit Order

1. Maintained-source boundary, remote safety, workspace entrypoints, and guardrails.
2. Root package metadata, dependency ownership, lockfiles, and build configuration.
3. `packages/core` foundations: paths, storage, auth, policy, models, providers,
   memory, and shared infrastructure.
4. `packages/core` domain owners: queues, triggers, agents, autonomy, environment,
   speech, training, and other services.
5. Core API handlers, graph execution, nodes, schemas, and public exports.
6. `packages/agent-runtime`, `packages/cli`, and the local model service package.
7. `apps/site` transport, client stores, components, and public assets.
8. `brain/*` agents, services, training, scripts, policies, and rules.
9. React Native and other maintained interface applications.
10. `etc`, `scripts`, `bin`, `docker`, plugins, tests, fixtures, and maintained docs.
11. Final cross-repository orphan, duplicate-owner, dependency, configuration,
    documentation, and end-to-end validation pass.

Do not begin a later owner group merely to avoid resolving a finding in the
current group. A high-risk dependency may be audited early when it blocks proof,
but its ownership must be recorded.

## Slice Record

Every implementation entry in the progress ledger includes:

- scope and canonical owner;
- baseline behavior and evidence;
- duplication, debt, and boundary findings;
- decision and non-goals;
- files changed, moved, merged, and deleted;
- validation commands and results;
- remaining unverified behavior or blockers.

## Program Completion Criteria

The repository-wide refactor is complete only when:

- every maintained owner group has an audit disposition and recorded evidence;
- architecture and remote-safety checks pass without stale or unexplained drift;
- dependency direction and critical runtime ownership match the maintained
  contracts;
- no known duplicate owner, bypass path, obsolete compatibility path, orphan
  implementation, or avoidable touched-scope debt remains;
- replaced dependencies, configuration, tests, generated artifacts, and docs are
  removed or updated;
- package-level type, build, and focused behavior checks pass;
- runtime, external, and physical claims are supported by matching evidence;
- current architecture and user documentation describe the surviving system;
- the final diff is scoped, reviewable, remote-safe, and free of stale references.

An unresolved item may be recorded for owner judgment, but it cannot be silently
treated as completed. Guardrail baselines must not be refreshed merely to hide
new drift.
