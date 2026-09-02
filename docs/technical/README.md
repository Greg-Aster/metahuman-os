# MetaHuman OS — Documentation Index

## Current Authority

- Maintained source surface: [MAINTAINED_SURFACE.md](MAINTAINED_SURFACE.md)
- Refactor blueprint: [REFACTOR_BLUEPRINT.md](REFACTOR_BLUEPRINT.md)
- Audit protocol: [AUDIT_PROTOCOL.md](AUDIT_PROTOCOL.md)
- Architecture boundary contract: [ARCHITECTURE.md](ARCHITECTURE.md)
- Consolidation progress: [../audits/consolidation-progress.md](../audits/consolidation-progress.md)
- Maintained-source inventory: [../audits/maintained-source-inventory.md](../audits/maintained-source-inventory.md)

## Maintained Technical Evidence

- Environment Mode performance ledger:
  [environment-mode-performance.md](environment-mode-performance.md)

This ledger preserves dated measurements and validation evidence. Its current
status section is maintained, but historical entries are not current runtime
claims or architecture authority.

## Public Orientation

- Project overview: [../../README.md](../../README.md)
- Startup guide: [../../STARTUP.md](../../STARTUP.md)
- CLI reference: [../user-guide/reference/cli-reference.md](../user-guide/reference/cli-reference.md)
- User guide: [../user-guide/index.md](../user-guide/index.md)

Historical material is isolated under `docs/archive/` and is not an
implementation authority.

Tips
- Use `./bin/mh help` for current CLI.
- Initialize runtime data: `./bin/mh init`
- Check repo hygiene: `./bin/audit check` (full: `./bin/audit all`)
- `apps/*` are interface shells, `packages/core` is the engine, and `brain/*` sits above the engine.
- Runtime logs, memories, persona, profiles, and local agent data are user-owned data, not maintained source.
