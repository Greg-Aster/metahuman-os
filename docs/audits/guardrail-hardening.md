# Guardrail Hardening

## Scope

- Lane: guardrail hardening.
- Owned files: `scripts/check-architecture.ts`, `bin/audit`, `docs/audits/guardrail-hardening.md`, and package scripts only if needed.
- Constraint: behavior-preserving guardrail changes only; no app/core feature code changes.

## Current State

- `bin/audit check` delegates to `scripts/check-architecture.ts`, so the architecture baseline is the fast guardrail entrypoint.
- The checker uses `git ls-files`, which means forbidden runtime/personal/generated paths are enforced only when tracked. This matches the remote-safety goal after index cleanup: untracked local data can exist, but re-tracked forbidden paths become guardrail violations.
- New violations already fail by comparing current violation IDs against `docs/technical/architecture-guardrail-baseline.json`.

## Hardening Added

- Resolved baseline entries are now reported as stale baseline drift.
- This catches cleanup that removes tracked forbidden paths or boundary debt without refreshing the explicit baseline.
- The opt-in `--fail-on-stale-baseline` flag is available for CI or release gates that should require an exact baseline.

## Validation

- `pnpm -s check:architecture` should continue to pass against the current baseline while reporting stale baseline entries.
- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline` should fail when the baseline is stale.
