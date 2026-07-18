# Owner Role Authority Consolidation

## Scope

Consolidate full-system authorization on the persisted `owner` role and remove
the separate administrator concept from maintained runtime code, interfaces,
and current user documentation.

## Findings

### `packages/core/src/security-policy.ts`
- Owner: core authorization policy.
- Summary: the file derived an `isAdmin` flag from `role === 'owner'`, carried
  both values through session and policy types, and exposed a duplicate
  `requireAdmin()` helper beside `requireOwner()`.
- Recommended action: delete the derived administrator state and calculate all
  full-system permissions directly from the owner role.

### `packages/cli/src/mh-new.ts`
- Owner: CLI presentation and user commands.
- Summary: user list, current-user, and user-info output independently checked
  the obsolete `ADMIN_USERS` environment variable. This disagreed with the
  core policy and could report an owner as a non-administrator.
- Recommended action: delete the environment-list check and report the stored
  role only.

### `packages/core/src/api/handlers/security-policy.ts`
- Owner: UI security-policy transport projection.
- Summary: the handler independently recalculated permissions instead of using
  the core policy resolver. Its standard-user and cognitive-mode behavior had
  already drifted from core.
- Recommended action: project UI capability names from the core policy result.

## Result

- The `owner` role is the only full-system authority.
- Standard users retain read/write access to their own profile.
- Guests remain restricted.
- No administrator alias, allowlist, policy field, or helper remains in
  maintained runtime code.
- The obsolete local `ADMIN_USERS` setting was removed from the working
  environment configuration; it is not part of tracked source.
- Historical and current role documentation was aligned with the single
  owner-role model so obsolete setup instructions cannot revive the old path.

## Validation

- `node --import tsx packages/core/src/security-policy.spec.ts`: pass.
- `node --import tsx packages/core/src/api/handlers/security-policy.spec.ts`: pass.
- `pnpm --dir apps/site build`: pass with existing Svelte accessibility and
  bundling warnings.
- `node --import tsx scripts/check-architecture.ts --fail-on-stale-baseline`:
  pass with zero architecture violations.
- `git diff --check`: pass.
- `pnpm -s typecheck:core`: remains red on the repository's documented broad
  TypeScript debt; no diagnostics were reported in the changed policy or API
  handler files.
- `pnpm -s typecheck:cli`: remains red on existing package-resolution and CLI
  typing debt. The owner-authority edits introduced no reported CLI diagnostic.
