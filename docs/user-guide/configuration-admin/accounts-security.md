# Accounts and Security

This chapter covers account roles, profile visibility, profile storage, recovery, and the operational evidence needed to protect a multi-user installation.

## Roles

- **Owner** — the first account; can administer the installation and owner-only surfaces.
- **Standard** — a named authenticated account with its own writable profile
  boundary, subject to policy.
- **Guest** — an authenticated, read-only role limited to public profiles. The
  one-hour temporary guest session uses this same role.

Role checks are enforced by server handlers. Hiding a button is not the security boundary.

## Profile Isolation

Persona, memory, tasks, voice assets, training data, configuration, and state are resolved for the active profile. Never construct a profile path by joining `profiles/` with an unvalidated username. Custom storage can move a profile outside the repository, and encrypted storage has additional readiness requirements.

Use supported UI and CLI operations. For diagnostics, resolve the current path through the profile owner:

```bash
./bin/mh --user USERNAME profile path
```

Private profile data must not be committed even when an internal profile happens to live below the repository directory.

## Profile Visibility

Owners can mark a profile public or private through the profile controls.

- **Private** profiles are available only to authorized named accounts.
- **Public** profiles may appear in the guest profile chooser.

Public visibility does not grant write permission and does not make the underlying profile files public repository content.

## Storage Types

The profile-location controls support installation-owned storage modes such as internal, external, and encrypted locations. Configure the location through the UI so the path is validated and the profile owner records the intended policy.

Before moving a profile:

1. back up the profile securely;
2. validate the destination and available space;
3. stop active writes or follow the UI's migration flow;
4. verify the resolved path after the change;
5. verify persona, memory, and encryption readiness before removing the old copy.

Do not treat a fallback location as a successful encrypted or external mount. The UI reports when a fallback is active.

## Encryption

Encrypted profile storage can use the configured operating-system or application storage owner. Login attempts to unlock supported encrypted storage before establishing the session.

There is no safe hidden fallback for a lost encryption secret. Keep recovery material outside the repository and test recovery while a backup exists. A successful account password reset does not necessarily recover independently encrypted data.

## Recovery Codes

Account creation produces 10 single-use recovery codes. Using one to reset a password invalidates the old set and produces a new set. Never store recovery codes in source control, shared logs, screenshots, or the user guide.

## Remote Access

Remote access expands the trust boundary. Use HTTPS, restrict who can reach the origin, keep owner endpoints authenticated, and expose guest access only when at least one intentionally public profile exists.

Cloud model and training providers receive the data submitted to them. Local-first operation does not mean every configured workflow stays on the machine.

## Security Checklist

- use a strong, unique owner password;
- store recovery codes and encryption secrets securely;
- keep private profiles private;
- review pending approvals before authorizing actions;
- keep runtime data, credentials, and model weights out of Git;
- verify remote endpoints and TLS before entering credentials;
- inspect audit and terminal failure states instead of accepting apparent success;
- update dependencies and the application through deliberate, reviewed changes.

## Related Guides

- [Authentication](/user-guide#authentication)
- [Security and Trust](/user-guide#security-trust)
- [Deployment and Remote Access](/user-guide#deployment)
- [Configuration Ownership](/user-guide#configuration-files)
