# Maintained Source Audit Protocol

This protocol applies when the user requests a maintained-source architecture
audit. Review the requested files or owner groups line by line; it does not turn
a routine question, small edit, or behavior repair into a repository-wide audit.
Root `AGENTS.md` defines the bounded workflow for those tasks. Audit findings do
not authorize implementation.

## Audit Inputs

- `docs/technical/MAINTAINED_SURFACE.md`
- `docs/technical/REFACTOR_BLUEPRINT.md`
- `docs/technical/ARCHITECTURE.md`
- `scripts/check-architecture.ts`
- `docs/technical/architecture-guardrail-baseline.json`

## Per-File Checklist

For each maintained file in the requested scope, record the applicable findings
below. Small owner groups may share one record; do not duplicate unchanged
inventory details or create boilerplate records for unrelated files.

- Purpose: what the file owns.
- Layer: core engine, interface, CLI, agent, service, training, script, test, or doc.
- Imports: whether dependency direction follows the blueprint.
- Exports: whether public exports are intentional and stable.
- Data access: path/profile/storage APIs used, and any hardcoded runtime paths.
- Side effects: filesystem, child process, network, model, or shell behavior.
- Security/privacy: auth checks, secret handling, path traversal risk, user data exposure.
- Size/complexity: split candidates and owner boundaries.
- Tests: existing coverage and minimum acceptance test for future edits.
- Disposition: keep, move, split, merge, delete, or defer.

## Audit Output

Write remote-safe findings under `docs/audits/`.

Do not paste personal data, secrets, full logs, runtime memory content, or local profile values into audit output.

Use one record per file or small owner group. Each record should include:

```md
## path/to/file.ts
- Owner:
- Summary:
- Boundary issues:
- Technical debt:
- Security/privacy notes:
- Test gap:
- Recommended action:
```

## Execution Rules

- Write the requested findings, but do not edit production source unless the user
  explicitly starts an implementation phase.
- Reuse relevant evidence after checking its scope and source/environment state.
  Expand discovery only to resolve a concrete boundary or missing proof; record
  the reason. Finish when the requested coverage and findings are complete.
- Do not use stale blanket instructions that require adding logging or return types to every file.
- Do not commit per-file churn from audit agents.
- If a file is likely orphaned, confirm with static references and runtime route/entrypoint discovery before deleting it.
