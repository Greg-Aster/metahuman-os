# Auditor Policy

The auditor tracks structural changes and flags potential risks so the MetaHuman stays aligned with design goals.

Checks
- Structure: required folders/files exist (persona, memory, logs).
- Memory: Markdown+frontmatter only in `memory/` (no unexpected binaries).
- Size: warn on files > 5 MB.
- Network: warn on new network calls (curl/fetch/http) outside allowlisted files.
- Secrets: warn on potential secrets (API keys, tokens, private keys).
- Dependencies: list changes to package manifests.

Process
- Snapshot: record current tree with checksums in `logs/audit/baseline.txt`.
- Diff: compare current tree to baseline and list added/removed/modified.
- Check: run policy checks and produce a report.
- All: Diff + Check; write report to `logs/audit/` and optionally append to `out/progress/`.

Allowlist (network)
- `bin/mh`: ntfy notification (optional) is allowed.
- Development dependencies in `apps/site` and `packages/cli` are allowed if local-only.

Escalation
- If unsure, prefer to warn and request review.
