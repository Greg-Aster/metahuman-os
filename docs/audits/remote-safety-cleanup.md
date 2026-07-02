# Remote-Safety Cleanup Verification

Date: 2026-07-01
Lane: remote-safety cleanup verification

## Scope

Read-only inspection was performed against the remote-safety paths named in `docs/audits/consolidation-progress.md`. No destructive delete commands were run. The only action taken in this lane is this report.

Primary evidence commands:

- `git ls-files -- <remote-safety paths>`
- `git ls-files -s -- external vendor`
- `git log --oneline -- <critical paths>`
- `git status --short -- <remote-safety paths>`
- `rg -l --hidden -i <credential-like terms> <remote-safety paths>`

No credential values, private profile contents, browser data, memory contents, or log payloads were copied into this report.

## Summary

The repository is not remote-safe yet. The current tree has ignore rules for most personal/runtime paths, but Git still tracks older files under those ignored paths. Those tracked files will remain publishable until they are removed from the index in a dedicated cleanup commit.

Tracked remote-safety findings:

| Path class | Tracked count | Classification | Action taken | Recommended action |
| --- | ---: | --- | --- | --- |
| `credentials.txt` | 1 | Critical credential-like root file | Reported only | Rotate any credentials that may have appeared in this file before or during removal. Remove from Git index and keep ignored. |
| `data/user-data/**` | 40 | Chromium/browser runtime state and caches | Reported only | Remove from Git index. Keep ignored. Do not replace with fixtures. |
| `data/argv.json` | 1 | Runtime launch state | Reported only | Remove from Git index. Keep ignored. |
| `.claude/**`, `.obsidian/**` | 5 | Local agent/editor state | Reported only | Remove from Git index. Keep ignored. |
| `apps/site/logs/**` | 3 | Runtime logs | Reported only | Remove from Git index. Keep ignored. |
| `audit-state.json`, `report.json`, `strace.log`, `docs/audit-scratchpad.md` | 5 | Generated audit/debug output | Reported only | Remove from Git index. Keep ignored. Regenerate locally as needed. |
| `tmp/**` | 1 | Temporary scratch data | Reported only | Remove from Git index. Keep ignored. |
| `backups/**` | 2 | Backup material, including archive artifact | Reported only | Remove archive artifact from Git index. Keep only a sanitized README if the backup policy needs documentation. |
| `apps/react-native/android/app/debug.keystore` | 1 | Debug signing key | Reported only | Treat as compromised if pushed. Regenerate local debug keystore after index removal. |
| `persona/**` | 38 | Persona state and archives | Reported only | Remove live persona/state/archive files. Keep only sanitized templates or an explicit `persona/README.md` if needed. |
| `profiles/**` | 57 | Demo/profile config and persona content | Reported only | Keep `profiles/README.md`; replace any intentionally public demos with sanitized fixtures. Remove live/private profile data from Git index. |
| `apps/code-oss/**` | 8,645 | Legacy bulk outside maintained surface | Reported only | Preserve externally if needed, then remove from maintained remote branch. Do not include in normal architecture audits. |
| `external/**` | 8 | Mixed external files plus unmapped gitlinks | Reported only | Convert intended dependencies to declared submodules or vendored source with ownership docs. Remove broken/unmapped gitlinks. |

## External Gitlinks

`.gitmodules` declares only:

- `vendor/llama.cpp`
- `vendor/whisper.cpp`

Git also tracks these unmapped gitlinks:

- `external/applio-rvc`
- `external/gpt-sovits`

`git submodule status` fails because the `external/*` gitlinks have no `.gitmodules` mapping. That makes fresh clone behavior ambiguous. Recommended action: either add explicit submodule mappings and ownership docs, or remove these gitlinks from the maintained remote branch after preserving them elsewhere.

## Credential And History Notes

The cleanup should be handled in this order:

1. Rotate credentials first for any secret that may have appeared in `credentials.txt`, profile configs, runtime logs, browser state, debug traces, or local agent/editor state. I did not inspect or quote the values.
2. Remove tracked sensitive/runtime paths from the Git index in a cleanup commit, leaving ignore rules in place.
3. Re-run the architecture guardrail and verify the `forbidden-tracked-path` count drops.
4. If the repository was already pushed publicly or shared with untrusted parties, evaluate history rewriting for critical blobs after rotation. A normal removal commit does not remove old blobs from history.

History evidence:

- `credentials.txt` exists in history at `5717d0047`.
- `apps/react-native/android/app/debug.keystore` exists in history at `d10b323c7`.
- `data/user-data/**` exists in history at `75158a8c8`.
- `persona/**` and `profiles/**` span many historical commits, including the initial commit and later profile/system updates.
- `external/applio-rvc` and `external/gpt-sovits` exist in history and remain unmapped by `.gitmodules`.
- `apps/code-oss/**` exists in recent history, including `9a9be1972`, `75158a8c8`, and `395c6daa6`.

## Local-Only Residue

Ignored local-only files are also present under these path classes, especially `apps/code-oss` build outputs, local profile runtime data, and local agent state. They are not currently tracked, but they are high-risk if future ignore rules are weakened or paths are force-added. Keep the ignore rules and avoid broad `git add -f` operations under these trees.

## Recommended Cleanup Ticket

Create a dedicated remote-safety cleanup branch with these steps:

1. Stage removals with `git rm --cached` for the tracked remote-safety paths only.
2. Add or keep sanitized templates where the app requires examples, especially for profile/persona configuration.
3. Keep `profiles/README.md` tracked.
4. Decide whether `backups/metahuman-studio/README.md` is useful documentation; otherwise remove all `backups/**` from Git.
5. Resolve `external/*` gitlinks before running submodule-dependent commands.
6. Run `./bin/audit check`.
7. Record the new guardrail violation counts in `docs/audits/consolidation-progress.md`.

No implementation cleanup was performed in this lane because ownership was limited to this report.
