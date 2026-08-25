# Multi-User Profiles

Each authenticated user has an isolated profile under
`profiles/<username>/`. Core's profile, storage, session, and security-policy
owners resolve access; callers should not build profile paths or copy private
data themselves.

## Roles

- **Owner** manages users, system settings, and profile visibility.
- **Standard** users manage their own writable profile within policy.
- **Guest** users are authenticated read-only accounts.
- A temporary guest session may view a selected public profile through the
  dedicated guest profile, but it does not gain write access to the source.

Only one owner account may exist. Role checks are enforced by Core API policy,
not by hiding controls in the browser.

## Profile boundary

A normal profile contains:

```text
profiles/<username>/
  persona/    identity, facets, decisions, and cognitive mode
  memory/     profile-owned memory and indexes
  etc/        profile-owned configuration
  data/       durable profile state
  logs/       profile audit and runtime records
  out/        generated artifacts
```

These directories are runtime user data and are not maintained source. Do not
commit them, use them as fixtures, or move their contents into shared `etc/`.

## Configuration and model isolation

Profile creation initializes supported configuration from machine templates and
generates required profile state. Model assignments, chat behavior, training,
voice, autonomy, curiosity, and trust settings can differ by profile.

Machine service policy remains shared. For example, a profile chooses its voice
provider in `voice.json`, while `etc/voice-servers.json` owns the single shared
voice process configuration.

See [Configuration Ownership](../configuration-admin/configuration-files.md).

## Guest profile selection

Public-profile selection copies only the supported persona/configuration view
into the dedicated guest profile and locks it to Emulation mode. The source
profile is not made writable. Private profiles are not eligible for guest
selection.

The optional Mutant Super Intelligence entry appears only when enough public
profiles are available. It builds a temporary merged guest persona; it does not
merge or modify the source profiles.

## Administration

Use **Settings -> Security** for account creation, roles, visibility,
credentials, and deletion. Destructive profile operations are owner-authorized
and must go through the profile owner so protected accounts and storage
boundaries are checked.

Before deleting a profile, export any data the user intends to retain. Generated
runtime data is not recoverable from the source repository.

## Security rules

- Authenticate every non-public API request.
- Treat browser role checks as presentation only; Core is authoritative.
- Never let a username become an unchecked filesystem path.
- Never expose another profile's private memory, credentials, logs, or output.
- Keep temporary guest writes isolated from the selected source profile.
- Record account, visibility, and destructive changes in the audit trail.

See [Authentication](../configuration-admin/authentication.md) and
[Security & Trust](../configuration-admin/security-trust.md).
