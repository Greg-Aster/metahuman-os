# MetaHuman OS Repository Guidelines

This tracked file governs repository work. Root `CLAUDE.md` and `GEMINI.md` are
short pointers here; keep personal agent/editor settings in local configuration.

## Authority and Scope

- `docs/technical/MAINTAINED_SURFACE.md` owns executable source policy and critical
  runtime ownership. Read the policy and ownership boundaries relevant to the task.
- `docs/technical/REFACTOR_BLUEPRINT.md` owns architecture and refactor principles.
  Its repository-wide program applies only when that scope is explicitly requested.
- `docs/technical/AUDIT_PROTOCOL.md` applies to an explicitly requested maintained-source
  audit, within the requested files or owner groups.
- `docs/audits/consolidation-progress.md` and other dated reports are historical
  evidence, not architecture authority or standing work orders. Search relevant
  entries when needed; do not load the entire ledger for routine work.
- Live workspace manifests and entrypoints define current commands and membership.
  A broken implementation does not supersede a clear ownership contract. If current
  authorities conflict, report the conflict before affected edits; historical
  descriptions of retired behavior are not competing authority.

The Installation Owner is the user or operator responsible for this installation.
Authorization persists through follow-ups within the same task until the user
changes or withdraws it. Make routine reversible implementation decisions within
that scope and continue authorized work without seeking fresh approval. Ask when
ambiguity materially affects scope, permissions, or external effects. Audit
findings, comments, old plans, and unrelated tasks do not grant additional scope.

## Work Modes and Concurrent Work

- Review, explanation, diagnosis, inspection, audit, and reporting are read-only
  for production source. Record formal audit findings under `docs/audits/`; a
  routine question or diagnostic does not require a new document.
- Fix, edit, implement, refactor, remove, consolidate, and migrate authorize the
  changes reasonably necessary for that request. Refactors preserve behavior
  unless the user explicitly requests a product change.
- Inspect status and relevant diffs before editing. Existing changes belong to
  their authors. Establish ownership before overlapping edits; use an isolated
  worktree when independent tasks would collide on source or generated build output.
  Never stash, reset, overwrite, or clean another task's work to obtain a baseline.
- Review your complete task diff and interacting changes. Do not repeatedly audit
  unrelated dirty files. An explicitly requested publication requires review of
  the complete snapshot being published, including concurrent changes it contains.
- Do not commit or push without an explicit request. Production dependencies,
  public-contract changes, and excluded-subsystem work require explicit approval.
  Destructive actions, credential changes, financial commitments, physical actions,
  and external writes/publication require explicit authority and proportionate
  evidence. Routine task-relevant reads, including configured authenticated access,
  do not require separate approval. Honor tool and sandbox permission boundaries.

## Bounded Workflow

Choose the work appropriate to the request:

| Task | Discovery and acceptance |
| --- | --- |
| Small text, style, or local edit | Read the affected owner and relevant guidance; inspect the result and run directly relevant checks. No subsystem audit or new test suite by default. |
| Behavior repair or non-trivial refactor | Establish the failure or baseline, trace the entrypoint to its owner and consumers, and define focused acceptance evidence before editing. |
| Maintained-source architecture audit | Use the audit protocol for the explicitly requested scope. Keep findings separate from implementation authorization. |

For a behavior repair or non-trivial refactor:

1. Establish concrete baseline evidence: reproduction, failing test, trace, build
   result, or source evidence. State any environmental limitation.
2. Trace the real entrypoint to the canonical owner. Search relevant exports,
   callers, registrations, configuration, tests, and documentation for existing
   implementations and earlier repairs. Expand only when evidence crosses a
   boundary or ownership remains unresolved. Stop discovery when the owner,
   affected consumers, failure mechanism, and acceptance evidence are clear.
3. State a short pre-edit plan: requested outcome, surviving owner, expected files,
   superseded paths if any, and acceptance checks. A plan is not an additional
   approval gate for already authorized work.
4. Repair that owner and affected consumers. Remove superseded wiring, exports,
   registrations, configuration, dependencies, tests, and documentation in the
   same change. Confirm deletion safety with references plus actual entrypoints,
   routes, registrations, configuration, or runtime evidence.
5. Validate, review the task diff, and stop when acceptance evidence is satisfied.
   Record unrelated findings separately without expanding the task. Do not begin
   another cleanup or verification pass without a concrete unresolved question
   or changed input.

If ownership, deletion safety, or necessary scope remains ambiguous, ask the
Installation Owner about that boundary and continue independent authorized work.
For an unrelated baseline failure, record evidence and use isolated focused checks
where they can prove the requested change. If it prevents acceptance, report the
blocker; do not fix unrelated code or claim a passing full baseline.

## Implementation and Debt

- Use the smallest complete design, preserve separation of concerns, and keep one
  canonical owner per responsibility. Discover and reuse before creating.
- Do not route around a broken owner with another service, manager, queue,
  scheduler, store, registry, validator, process manager, or execution path.
- New abstractions, compatibility layers, flags, and fallbacks need a concrete
  explanation of why the existing owner cannot implement the requirement. A
  second active path requires explicit approval and an old-path removal condition.
- Missing behavior inside the existing owner does not require an artificial
  deletion. Judge debt by duplicate responsibilities and unnecessary mechanisms,
  not additions, deletions, or file size alone. Remove what is actually superseded.
- Do not swallow errors, fabricate success or defaults, introduce silent degraded
  modes, weaken tests/types/guardrails, or normalize a known bug in test assertions.
- Preserve required error reporting and observability at existing owners. Do not
  add blanket entry/exit/parameter logging, redundant catch-and-rethrow wrappers,
  speculative configuration, or tests that merely mirror implementation.
- Leave no temporary diagnostics, bypasses, disabled replacements, commented-out
  implementations, stale flags, or avoidable debt in the requested repair. Do not
  leave TODOs for requested behavior unless the user accepts that incomplete scope.
- Do not combine unrelated cleanup, reformatting, upgrades, or redesign with a repair.

## Architecture and Style

- Interfaces in `apps/*` and `packages/cli` sit above the engine in `packages/core`;
  `brain/*` contains workers, services, and training. `packages/agent-runtime` owns
  shared execution interfaces. Consult source policy/manifests for the full inventory.
- Core must not import from apps, Brain, Astro, Svelte, UI, or local runtime data.
  Brain and other external consumers use public `@metahuman/core` exports.
- Site client code must not import runtime-heavy Core modules; browser-safe
  types/schemas need explicit exports. Site API routes are transport-only;
  business logic belongs in Core handlers or a documented service owner.
- CLI commands parse and delegate. Domain owners retain durable behavior.
  Resolve profile, persona, memory, task, and user paths through canonical storage
  and path owners; never hardcode local runtime paths.
- Read relevant critical runtime boundaries in `MAINTAINED_SURFACE.md` before
  high-risk changes. Do not duplicate those changing contracts in agent guidance.
- `apps/code-oss` and deprecated `apps/mobile` are excluded unless explicitly
  scoped in. Maintained React Native code is a separate surface.
- Follow the nearest maintained file: TypeScript ESM, local indentation/semicolon
  conventions, named exports unless the framework requires defaults, and existing
  library/component naming. Avoid unrelated mechanical restyling.

## Validation and Evidence Reuse

- Inspect root and package scripts before selecting commands. Run focused owner
  tests first. Add regression coverage for changed behavior and credible failure
  modes, with timeout, cancellation, retries, and repeated invocation as warranted
  by risk. Small reversible edits do not need new tests that restate the edit.
- Select broader type, build, architecture, and remote-safety checks according to
  affected contracts. A docs-only edit needs content/link checks; executable policy
  or command changes also need validation of that policy or command.
- Keep command, result, checked scope, and relevant source/environment state in
  the existing conversation or task notes. Do not create a tracking document
  solely to record validation. Reuse successful results while those inputs remain
  unchanged, including reliable evidence from another task on the same inputs.
  Recheck affected evidence after source, tests, dependencies, configuration,
  environment, or interacting work changes. Explain any rerun or broader check;
  an old success is not evidence for unverified changes.
- Root `pnpm build` builds the Site. `pnpm verify` runs workspace typechecks,
  architecture checks, registered tests/validators, and the Site build; the server
  updater uses this full gate. Do not routinely run all its components and then
  the full chain. Use `verify` for relevant integration risk, required release
  validation, or an explicit request. Focused tests absent from the chain still
  need their own invocation when applicable. TypeScript typechecks cache results
  under each project's ignored `node_modules/.cache`; changed inputs are rechecked.
- `./bin/audit check` includes `pnpm check:architecture`'s checker plus tracked-file
  size and manifest reporting. Choose the needed scope; do not run both for the
  same architecture evidence. `./bin/audit all` is a report writer, not a stronger
  passing-test signal.
- Separate pre-existing failures from regressions. Do not weaken assertions or
  refresh guardrail baselines to conceal failures. A build proves compilation,
  not live UI, admission, service effects, or physical behavior. Exercise only
  authorized runtime/external/physical actions and state remaining limits.

Useful entrypoints (live scripts remain authoritative): `./bin/mh help`, root
`pnpm dev`, `pnpm --dir apps/site build`, owner `typecheck:*` scripts, and
`node --import tsx scripts/create-audit-inventory.ts --dry-run`. Do not install
dependencies, start services, or generate inventories merely to read instructions.
Node must satisfy `>=22.3.0 <23`; pnpm must satisfy `>=10.15.1 <11`.

## Code Review Rules

- Flag concrete defects: duplicate owners or bypasses, broken layer boundaries,
  swallowed failures, fabricated success, weakened checks, superseded code left
  active, unrelated changes, or private data. Apply the ownership and approval
  rules above, including explicitly authorized exceptions.
- Identify the affected path and behavior, explain the impact, and point to the
  surviving owner or safe correction. Do not turn hypothetical concerns or
  formatting preferences into defects; leave mechanical checks to automation.
- Flag runtime, external, or physical success claims supported only by source or
  build evidence. Review only the requested scope and its affected consumers.

## Completion and Publication

- Confirm requested behavior and directly superseded-path removal. Run a final
  reference search for affected symbols/paths and `git diff --check` for the task
  files. Review the full task diff, including new files, for unrelated changes,
  private data, generated artifacts, stale configuration, and diagnostics.
- Report the root cause (or a diagnostic's remaining uncertainty), surviving
  owner, changes/removals, validation results, pre-existing failures, and unverified
  behavior. Do not claim success for failed or unrun acceptance checks.
- When committing or publishing is explicitly requested, inspect the entire
  selected snapshot and status. Preserve unrelated work and verify remote safety.
  Use `feat|fix|docs|chore|refactor(scope): summary` commits. PRs explain behavior,
  rationale, affected owners, removals, evidence/limitations, and UI screenshots
  when relevant; include only remote-safe links and identifiers.
- Never publish credentials, personal profiles, persona data, memories, logs,
  model weights, generated output, or machine-local state. Preserve sanctioned
  sanitized fixtures such as `profiles/README.md`. Source-policy exclusions never
  exempt tracked files from remote-safety checks.
- LLM work uses the configured backend owner; do not assume Ollama or require
  unrelated models/services merely to validate a scoped source change.

## Maintaining These Instructions

When instruction maintenance is requested, base revisions on recurring concrete
failures or verified changes to repository contracts. Revise existing rules and
remove superseded wording instead of appending a prohibition for every incident.
Keep durable repository rules here and reference detailed task-specific procedures;
do not accumulate task histories or duplicate policy.
