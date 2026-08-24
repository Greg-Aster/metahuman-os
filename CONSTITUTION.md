# MetaHuman OS Engineering Constitution

- **Status:** Draft for Installation Owner ratification
- **Version:** 1.0-draft
- **Created:** 2026-08-24
- **Scope:** All maintained source, refactors, migrations, fixes, tests,
  configuration, and technical documentation

## Preamble

MetaHuman OS is a mature professional system. Changes must make it more coherent,
more reliable, and easier to understand. They must not trade short-term speed for
long-term confusion.

This constitution governs how engineering work is designed, implemented,
validated, and completed. Existing noncompliance is a reason to refactor; it is
not permission to add more noncompliance.

The words **must** and **must not** are requirements. **Should** identifies the
normal standard and requires a written technical reason to depart from it.

In this document, a _patch_ means a workaround placed around the wrong owner or
faulty design. It does not mean a small, focused source edit.

## Rule 1 — Production Quality, Never Patches or Cruft

All finished work must be production-grade. It must solve the underlying problem
at the responsible owner instead of hiding it behind a workaround, bypass,
parallel path, hidden fallback, monkey patch, duplicated check, or growing chain
of special cases.

Within the changed behavior and its owner boundary, completed work must not leave:

- dead, orphaned, unreachable, or commented-out code;
- stale exports, callers, routes, configuration, dependencies, flags, or docs;
- avoidable technical debt, unowned TODOs, or indefinite compatibility layers;
- misleading names, status, logs, or success claims;
- ignored errors, unjustified type evasions, or warnings caused by the change;
- generated, personal, secret, runtime, or machine-local data in maintained
  source.

Professional code has clear names, cohesive units, explicit contracts at
boundaries, deterministic lifecycle behavior, deliberate error handling, and
validation proportionate to risk. It follows the language and repository's
current conventions unless those conventions violate this constitution.

Emergency containment is not a completed fix. If the Installation Owner
explicitly authorizes containment, it must be isolated, visibly temporary, and
paired with a defined permanent correction and removal condition.

## Rule 2 — Discover Before Creating

The first step in any change is to determine whether the required code, owner,
contract, state, or execution path already exists.

Before creating a utility, service, store, route, queue, scheduler, process
manager, policy, validator, adapter, or abstraction, the implementer must:

1. read the maintained-surface and architecture contracts for the area;
2. search the repository by concept and symbol;
3. inspect public exports, imports, callers, routes, registries, configuration,
   tests, and current documentation;
4. trace the real path from entrypoint through policy and state to the final side
   effect or result;
5. inspect runtime evidence when the decision depends on what is actually active;
6. decide whether to reuse, repair, extend, consolidate, replace, or delete the
   existing implementation.

New code is allowed only when discovery shows that the capability does not exist
or cannot correctly belong to an existing owner. The missing capability and its
new canonical owner must be explicit.

One responsibility has one canonical owner. Multiple interfaces may delegate to
that owner; they must not independently own the same state, policy, scheduling,
admission, lifecycle, validation, or side effect.

No change may create a parallel queue, scheduler, process manager, configuration
store, permission engine, memory store, validator, or execution path to avoid
correcting the existing owner.

## Rule 3 — Separation of Concerns and Clean Removal

Every module, utility, and service must have one coherent responsibility and one
clear reason to change.

Interface, transport, domain policy, orchestration, persistence, and external
effects must remain separate when they have different responsibilities. UI and
CLI surfaces translate and delegate; they do not absorb domain behavior. Shared
engine code does not depend on UI or worker implementations. Consumers use public
contracts rather than another subsystem's internals.

Optional functionality must be removable as a unit. Removing it should require
deleting its canonical implementation, explicit wiring or registration, tests,
and documentation—not searching unrelated files for copied logic, scattered
conditionals, hidden side effects, or direct state writes.

Cross-cutting behavior must have a named owner and a narrow interface. Convenience
is not a reason to place behavior in the wrong subsystem.

## Rule 4 — Keep the System Lean and Efficient

Use the smallest complete design that satisfies the real requirement. Every new
file, dependency, process, layer, state store, configuration key, fallback, and
abstraction must earn its place.

Before adding anything, ask:

- Is this capability actually required?
- Does a canonical owner already provide it?
- Can the result be achieved with fewer moving parts?
- Can data be derived rather than copied into another source of truth?
- What existing code becomes unnecessary after this change?

Do not add speculative frameworks, premature generality, pass-through wrappers,
or extension points without a current consumer. Prefer direct, readable, bounded
code over cleverness.

Performance work must be evidence-based. Prefer an existing event-driven path
over polling. Work, retries, concurrency, memory, caches, queues, logs, and
external calls must have limits appropriate to their function.

Superseded code and configuration must be removed as part of the same completed
change. Leaving the old and new paths together for later cleanup is not complete.

## Rule 5 — Explicit Contracts and Canonical State

Every maintained system needs an identifiable owner and a contract that defines:

- purpose and responsibility;
- inputs, outputs, and state;
- configuration and permissions;
- dependencies and external effects;
- startup, shutdown, retry, timeout, and cancellation behavior;
- success, partial success, and failure semantics;
- the evidence required to verify its result.

Mutable state has one authoritative source. Derived views and caches must identify
their source, invalidation rule, and failure behavior. Defaults, validation, and
writes must not be independently reimplemented by every consumer.

External effects and global lifecycle changes occur only at explicit owner
boundaries. Repeated invocation must be safe or explicitly rejected.

## Rule 6 — Complete Migrations; Never Permanent Dual Systems

A migration must identify every maintained consumer, name the target owner, move
callers, validate the target path, and remove the retired path. A refactor must
not stop after adding a new implementation beside the old one.

A compatibility layer is justified only by a verified current consumer. It must
have a canonical owner, narrow scope, tests, and an objective removal condition.
“It may be needed later” is not sufficient.

Data and configuration migrations must define validation, failure recovery, and
the exact point at which legacy reads and writes end.

## Rule 7 — Evidence Is Part of the Implementation

Behavior-preserving refactors require a baseline before code changes. Every
change must define its acceptance evidence before implementation and validate at
the canonical owner boundary.

Validation must be proportionate to risk and may include:

- focused tests for success, failure, timeout, cancellation, and repeated use;
- type, build, lint, architecture, and remote-safety checks;
- reference and entrypoint searches for moved or deleted code;
- runtime evidence for runtime behavior;
- correlated observation or external confirmation for environment and physical
  outcomes.

A passing build does not prove runtime behavior. A running process does not prove
work admission. An action acknowledgement does not prove an external result.
Completion claims must state exactly what the collected evidence proves.

## Rule 8 — Reliable, Bounded, and Observable Behavior

Failures must be explicit and visible at the interface responsible for acting on
them. The system must not silently switch provider, model, queue, state store, or
execution mode in a way that hides a broken owner or changes semantics.

Long-running and external work must define bounds, timeout, cancellation,
backpressure, partial-failure, and shutdown behavior. Retries must be limited and
must not duplicate non-idempotent effects.

Logs and status must be useful, proportionate, and honest. They must not expose
secrets or private content, and they must distinguish requested, admitted,
running, completed, failed, partial, and unverified states.

## Rule 9 — Security, Privacy, and Safety Are Architecture

Untrusted input is validated at the owning boundary. Authorization goes through
the canonical policy owner and follows least privilege. Models, generated text,
remembered content, and external data cannot grant permissions.

Secrets, credentials, profiles, memories, logs, model weights, generated output,
and machine-local state are data, not maintained source. Profile and path access
must use canonical storage owners and must not cross user boundaries implicitly.

Destructive, external, credentialed, financial, or physical actions require
controls and result evidence proportionate to their effect. Safety checks must
not be bypassed by convenience paths or optimistic status.

## Rule 10 — Documentation and Guardrails Change with the Code

Architecture contracts, owner inventories, tests, and automated guardrails are
part of the system. A change that alters ownership, a public contract,
configuration, startup behavior, or user-visible behavior must update its
authoritative documentation and enforcement in the same change.

Update an existing authority when it already owns the information. Do not create
competing architecture documents, stale migration plans, or duplicate rule sets.
Historical records may describe what happened; they do not override current
contracts.

## Required Refactoring Protocol

### Before Coding

1. State the requested behavior, scope, constraints, and non-goals.
2. Read the current maintained-surface, architecture, and owner contracts.
3. Perform the discovery required by Rule 2.
4. Record the existing owner and path, duplication findings, and behavior
   baseline.
5. Identify the owner to change, obsolete code to remove, and proof required for
   completion.

### While Coding

1. Correct the canonical owner rather than adding a compensating owner.
2. Keep dependencies pointed in the documented direction.
3. Implement one complete, reviewable behavior slice.
4. Define failure, lifecycle, and resource-bound behavior explicitly.
5. Remove every path, registration, dependency, test, and document superseded by
   that slice.
6. Update contracts and guardrails when ownership or behavior changes.

### Before Declaring Completion

1. Search again for stale callers, duplicate owners, retired names, bypasses,
   flags, configuration, unused exports, and orphaned files.
2. Confirm suspected orphan code through both static references and actual
   entrypoints or runtime registration before deleting it.
3. Review the diff for unrelated changes, accidental local data, unnecessary
   complexity, and artifacts that should be removed.
4. Run the agreed validation and preserve the relevant evidence.
5. Verify the end-to-end behavior at the strongest layer available.
6. Report what is proven, what remains unverified, and any pre-existing failure
   that prevented validation.

If these conditions are not met, the work is incomplete. It must be described as
incomplete rather than made to look finished through a fallback, exception, or
optimistic report.

## Definition of Done

A change is done only when all applicable statements are true:

- the correct canonical owner implements the behavior;
- no duplicate or bypass path was introduced or left behind;
- responsibilities and dependencies follow the architecture;
- replaced code, configuration, dependencies, and docs are removed;
- contracts, types, failure semantics, and lifecycle behavior are explicit;
- security, privacy, safety, and data boundaries are preserved;
- acceptance tests and architecture checks pass, or pre-existing failures are
  clearly separated with evidence;
- runtime or physical claims have matching runtime or physical proof;
- the diff contains no unrelated work or machine-local data;
- authoritative documentation and guardrails match the implementation.

## Governance

The Installation Owner ratifies this constitution and approves changes to its
meaning. More specific repository contracts may add stricter requirements but
must not weaken these rules.

A proposed amendment must explain the problem, affected owners, enforcement or
migration impact, and why it does not create a competing authority. The version
and ratification status must be updated when an amendment is accepted.

Existing violations do not become precedent. A deviation approved for one
specific situation does not silently amend the constitution.
