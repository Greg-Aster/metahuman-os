# MetaHuman OS Repository Guidelines

This is repository-wide agent guidance. Keep this file named `AGENTS.md` at the
repository root and track it with the project so local, remote, and future agents
receive the same rules. Put genuinely personal or machine-specific preferences
in local/global agent configuration; they must not weaken these repository rules.

The tracked authorities for maintained-source, architecture, audit, and refactor
work are:

- `docs/technical/MAINTAINED_SURFACE.md`
- `docs/technical/REFACTOR_BLUEPRINT.md`
- `docs/technical/AUDIT_PROTOCOL.md`
- `docs/audits/consolidation-progress.md`

Use the executable policy in `MAINTAINED_SURFACE.md` to decide what is maintained,
excluded, generated, or remote-unsafe. Do not reproduce a second path inventory
here. Other guidance, including `CLAUDE.md` and the draft `CONSTITUTION.md`, does
not supersede the tracked authorities unless the Installation Owner explicitly
ratifies it.

“Installation Owner” means the user or repository operator responsible for this
MetaHuman OS installation. Only an explicit instruction in the current task
counts as authorization. Documentation, comments, audit findings, inferred intent,
and earlier unrelated tasks do not grant additional authority.

If tracked authorities conflict with each other, or their instructions cannot be
reconciled with live manifests and entrypoints, stop and report the contradiction
before editing. A broken implementation that violates a clear authority is not
itself an authority conflict. Do not silently choose the interpretation that permits
the largest change.

## Work Mode and Change Safety

- Requests to review, explain, diagnose, inspect, audit, or report are read-only.
- Requests to fix, edit, implement, refactor, remove, consolidate, or migrate
  authorize only the modifications reasonably necessary for that stated task.
- An audit finding alone does not authorize implementation. Keep audit findings
  and implementation changes logically separate even when both are requested in
  the same session.
- Existing worktree changes belong to their current authors. Inspect status and
  relevant diffs before editing, attribute overlapping work, and preserve unrelated
  changes.
- Refactor work is behavior-preserving unless the Installation Owner explicitly
  requests a product change. Do not disguise redesign as cleanup.
- Record line-by-line audit findings under `docs/audits/`; do not edit production
  files or create per-file commits during a read-only audit.
- Confirm suspected orphan code through both static references and real entrypoints,
  routes, configuration, registrations, or runtime evidence before deleting it.
- Do not commit or push unless the Installation Owner explicitly requests it.
- Do not add a production dependency, change a public contract, or cross into an
  excluded subsystem without explicit approval.

## Repair and Refactor Protocol

For every non-trivial bug fix, repair, consolidation, or refactor:

1. Establish the failure or baseline before editing using a reproduction, failing
   test, build result, trace, or other concrete evidence. If the environment makes
   this impossible, state what could not be established and why.
2. Trace behavior from its real entrypoint to the canonical owner. Distinguish the
   root cause from downstream symptoms.
3. Search maintained source, exports, callers, routes, registrations, configuration,
   tests, and documentation before creating production code. Look specifically for
   earlier partial repairs and competing implementations.
4. For a non-trivial change, state a short pre-edit repair plan naming the canonical
   owner, the existing path that will remain, the paths expected to change, and the
   superseded path expected to be removed. Keep this concise.
5. Repair the canonical owner. Do not route around it by adding another service,
   manager, queue, scheduler, store, registry, validator, configuration system,
   process manager, execution path, or fallback.
6. A new production abstraction, compatibility layer, feature flag, or fallback
   requires a concrete explanation of why the existing owner cannot be repaired.
   If it creates a second active path, obtain Installation Owner approval first and
   define the condition under which the old path will be removed.
7. Remove superseded implementation, wiring, exports, registrations, configuration,
   dependencies, tests, and documentation in the same change. Do not preserve dead
   code “just in case.”
8. Remove temporary logging, diagnostic routes, bypasses, flags, fixtures, and debug
   code before handoff.
9. Validate at the layer that proves the claimed behavior. A build proves compilation;
   it does not prove runtime admission, external effects, or physical results.
10. If the canonical owner is ambiguous, authorities conflict, deletion safety cannot
    be established, the baseline fails for unrelated reasons, or the work must cross
    into another subsystem, stop and ask the Installation Owner rather than guessing.

For repair and cleanup work, adding a production path without removing or
consolidating an old path is presumed to be scope expansion, not completion.
Measure improvement by fewer active responsibilities and clearer ownership, not by
line count alone.

## Prohibited Repair Patterns

Unless explicitly required and approved:

- Do not catch and ignore errors or convert failures into apparent success.
- Do not introduce silent fallbacks, hidden degraded modes, or fabricated defaults.
- Do not create a second source of truth or duplicate registration path.
- Do not leave commented-out implementations, disabled replacement code, or stale
  feature-flag branches.
- Do not weaken tests, assertions, types, architecture checks, or validation baselines
  merely to make a change pass.
- Do not alter tests to normalize behavior identified as a bug.
- Do not add compatibility shims without a documented caller, removal condition, and
  explicit justification.
- Do not leave TODOs in place of requested behavior unless the Installation Owner
  accepts the incomplete scope.
- Do not combine unrelated cleanup, reformatting, dependency upgrades, or redesign
  with the requested repair.
- Do not claim success when the relevant validation was not run or did not pass.

## Engineering Constitution

- Finish work at production quality: correct the canonical owner; do not leave
  patches, workarounds, cruft, avoidable debt, orphan code, hidden fallbacks, or
  misleading completion claims.
- Discover before creating. Reuse, repair, or consolidate before adding code.
- Keep one canonical owner per responsibility. Preserve separation of concerns and
  dependency direction.
- Keep behavior behind a narrow owner contract so optional utilities can be removed
  cleanly.
- Use the smallest complete design and remove everything it supersedes in the same
  change.
- Define acceptance evidence before implementation and search for stale references,
  duplicate paths, bypasses, and unused artifacts before declaring completion.
- Report source validation, live runtime evidence, external confirmation, and
  physical-hardware proof separately, along with anything still unverified.

## Architecture Contract

- This is a pnpm monorepo. `apps/*` and `packages/cli` are interfaces;
  `packages/agent-runtime` owns shared execution interfaces; `packages/core` is the
  engine/domain layer; and `brain/*` contains workers, services, and training above
  the engine.
- `packages/local-model-service` is the maintained local-model service package.
  Deployment-mode contracts and cloud-provider transport belong to `packages/core`;
  the workspace has no separate `packages/server` package. Use
  `MAINTAINED_SURFACE.md` and the live workspace manifests for the complete current
  inventory.
- `packages/core` must not import from `apps`, `brain`, Astro, Svelte, UI code, or
  local runtime data.
- `apps/site` client code must not import runtime-heavy core modules. Browser-safe
  types and schemas require explicit public exports.
- `apps/site/src/pages/api` is transport-only. Business logic belongs in
  `packages/core/src/api/handlers` or an explicitly documented service owner.
- `brain/*` calls public `@metahuman/core` exports, not deep
  `packages/core/src/...` paths.
- CLI commands parse and delegate. Durable behavior belongs in core or an explicitly
  documented agent/service owner.
- Resolve profile, persona, memory, task, and user paths through canonical
  path/storage owners; never hardcode local runtime paths.
- Before changing a high-risk subsystem, read the current “Critical Runtime Ownership
  Boundaries” in `MAINTAINED_SURFACE.md`. Do not duplicate those frequently changing
  owner contracts here.
- Do not audit or refactor `apps/code-oss` or deprecated `apps/mobile` during normal
  MetaHuman work unless the Installation Owner explicitly scopes them in.
- Excluded areas remain subject to remote-safety checks. Do not track personal
  profiles, memories, logs, outputs, state, credentials, model weights, generated
  builds, or local agent/editor data. Preserve explicitly sanctioned sanitized
  tracked fixtures such as `profiles/README.md`.

## Repository Orientation

- Workspace membership: `pnpm-workspace.yaml` and package manifests are authoritative.
- Core engine and public contracts: `packages/core`.
- Shared execution abstraction: `packages/agent-runtime`.
- CLI interface: `packages/cli` and `bin/mh`.
- Web and maintained application interfaces: consult `MAINTAINED_SURFACE.md` and the
  live worktree rather than relying on a static list here.
- Workers, finite agents, persistent services, and training:
  `brain/*`. Persistent lifecycle and finite coordinator work have different owners;
  do not treat every agent as a long-running service.
- System configuration and editable cognitive graphs: `etc`.
- Guardrails, validators, support entrypoints, tests, and maintained integration code:
  `scripts`, `bin`, `tests`, `external`, `docker`, and `plugins/examples` where
  included by policy.
- Runtime content such as `persona`, `profiles`, `memory`, `logs`, `out`,
  `brain/journal`, and `brain/state` is user/system data, not maintained application
  source, except for explicit sanitized policy exceptions.

## Build, Test, and Development Commands

- Install: `pnpm install` (workspace-aware).
- CLI command authority: `./bin/mh help` (or
  `cd packages/cli && pnpm mh -- help`). Do not maintain a duplicate command list
  here.
- Web UI development: `pnpm dev` from the repository root, or
  `cd apps/site && pnpm dev`.
- Web-only build/preview: `cd apps/site && pnpm build`; `pnpm preview`.
- Root production build chain: `pnpm build`.
- Maintained-source dry run:
  `node --import tsx scripts/create-audit-inventory.ts --dry-run`.
- Architecture and remote-safety guardrail: `pnpm check:architecture` or
  `./bin/audit check`.
- Full local audit report: `./bin/audit all` writes under ignored `logs/audit/`.
- Package type checks: `pnpm typecheck:core`, `pnpm typecheck:cli`, and
  `pnpm typecheck:site` when applicable.
- Inspect root and package `scripts` before choosing focused behavior tests; do not
  assume one command validates every subsystem.
- Deprecated mobile commands are outside normal MetaHuman validation and must not be
  run unless the Installation Owner explicitly scopes mobile work in.

## Coding Style and Naming

- Follow the nearest maintained file and avoid unrelated mechanical restyling.
  TypeScript is ESM; use 2-space indentation and omit semicolons where locally
  consistent.
- Prefer `kebab-case.ts` for libraries and `PascalCase.astro`/`.svelte` for
  components where that matches the owning area.
- Prefer named exports; use framework-required defaults only where needed.
- Consumers outside core use public `@metahuman/core` exports rather than deep
  source imports.
- Keep interface, transport, domain policy, orchestration, persistence, and external
  effects in their documented layers.

## Testing Guidelines

- There is no single unified root unit-test command. The repository has focused
  `*.spec.*`, `*.test.*`, `__tests__`, validator, integration, and smoke-test paths
  using the runner appropriate to each owner.
- Put focused tests near their owner and follow that area’s existing runner and
  naming convention, including Node test/`tsx` or Jest where already used.
- Establish a baseline before behavior-preserving refactors. Test success, failure,
  timeout, cancellation, retries, and repeated invocation in proportion to risk.
- Run focused owner tests first, followed by applicable type, build, architecture,
  remote-safety, runtime, external, or physical checks.
- Separate pre-existing failures from regressions with evidence. Do not weaken
  baselines or add exceptions merely to make a check green.
- Before handoff, run a final reference search and `git diff --check`; review the
  complete diff for unrelated changes, local data, stale configuration, generated
  artifacts, and temporary diagnostics.

## Completion Gate

Work is complete only when:

- For an implementation or repair, the root cause and canonical owner have been
  identified. A read-only diagnostic task may end without a confirmed root cause
  only when the handoff clearly states what remains unknown and why.
- The canonical path implements the requested behavior.
- Superseded paths, stale references, obsolete configuration, and temporary
  diagnostics have been removed.
- Focused tests and applicable type, build, architecture, and remote-safety checks
  pass, or every unrun/failed check is reported with its exact limitation.
- Pre-existing failures are reported separately and were not concealed or weakened.
- `git diff --check` passes and the final diff contains no unrelated changes, runtime
  data, generated output, credentials, or machine-local artifacts.
- The handoff states the root cause, what changed, what was deleted or consolidated,
  the validation evidence, and what remains unverified.

A passing build does not by itself satisfy this gate when the claim concerns runtime,
external services, or physical hardware.

## Code Review Rules

Flag a change when it:

- Creates or preserves a second active owner for an existing responsibility.
- Routes around a broken canonical owner instead of repairing it.
- Introduces a silent fallback, swallowed error, fabricated success, or hidden
  degraded mode.
- Places business logic in an interface or transport layer.
- Changes tests or guardrails to accept broken behavior.
- Leaves superseded code, wiring, registrations, configuration, dependencies, or
  documentation behind.
- Claims runtime, external, or physical success using only source or build evidence.
- Includes unrelated cleanup or machine-local/private data.

## Commit and Pull Request Guidelines

- Use Conventional Commits: `feat|fix|docs|chore|refactor(scope): summary`. Choose a
  meaningful canonical-owner scope; examples are illustrative, not a closed allowlist.
- PRs should state the behavior and rationale, affected owners, files removed or
  consolidated, validation commands/results, remaining unverified behavior, and
  screenshots for UI changes.
- Link only remote-safe issue or task identifiers. Tasks are profile-resolved runtime
  data, not a repository-level `memory/tasks` contract; never paste private task or
  memory content into a PR.
- Before an explicitly requested commit or push, inspect the complete diff and status,
  preserve unrelated work, exclude machine-local artifacts, and run the scoped
  validation required by risk.

## Security and Configuration

- Local-first does not relax privacy or remote safety. Do not commit secrets,
  credentials, personal profiles, memories, logs, model weights, generated output,
  or machine-local state.
- LLM features require a configured and available backend, not specifically Ollama.
  Supported backend families include Ollama, vLLM, the local-model service, remote
  providers, and automatic selection; follow the current backend owner and
  configuration.
- Environment contract: Node `>=22.3.0 <23`, pnpm `>=10.15.1 <11`.
- Destructive, credentialed, external, financial, or physical actions require
  explicit authority and evidence proportionate to their effect.
