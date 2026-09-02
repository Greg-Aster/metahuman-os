# Source Audits

This directory contains current, remote-safe audit authority for the maintained
MetaHuman source surface.

## Current authority

- `consolidation-progress.md`: chronological cleanup and validation evidence.
- `maintained-source-inventory.md`: generated human-readable source inventory.
- `maintained-source-inventory.json`: generated machine-readable inventory.

## Active evidence ledgers

- `tts-pipleine-work.md`: TTS ownership and remaining runtime validation.
- `robot-operator-motion-control-progress.md`: Robot Operator motion-control work.

Completed point-in-time reports live under `docs/archive/audits/` and are not
current architecture authority. Reports fully superseded by the consolidation
ledger are removed instead of being retained as competing status documents.

Use `docs/technical/AUDIT_PROTOCOL.md` for the file-by-file checklist. Audit
reports must not include local logs, private profile data, memory contents,
credentials, machine-specific paths, or generated runtime output.
