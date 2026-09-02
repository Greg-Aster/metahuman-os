# Authentication

MetaHuman OS uses server-owned sessions and profile-scoped authorization. Login establishes an account identity, role, and resolved profile; it is not only a client-side preference.

## Create the First Account

On a new installation, choose **Create Account**. The first account becomes the installation owner.

- username: 3–50 characters using letters, numbers, `_`, or `-`;
- password: at least 6 characters;
- display name and email: optional.

After creation, the interface displays 10 recovery codes. Save them outside the MetaHuman repository in a password manager or another secure location. Each code is single-use.

Complete the onboarding flow before relying on the profile for normal work.

## Log In and Out

Enter the username and password at the authentication gate. A successful login creates the `mh_session` cookie and loads the account's profile context. If encrypted profile storage is configured, login also attempts to unlock it before creating the authenticated session.

If storage cannot be made ready, login must report the failure rather than opening a fabricated empty profile.

Use the account menu to log out. Closing a browser tab is not the same as explicitly destroying the server session.

## Guest Access

**Continue as Guest** creates an authenticated guest-role session with a one-hour lifetime. It is not anonymous access. Guests can choose only profiles intentionally marked public and have read-only capabilities. Private profiles remain hidden.

Guest mode is appropriate for limited demonstrations, not administration or profile changes.

## Reset a Forgotten Password

Choose **Forgot password?**, then provide:

1. username;
2. one unused recovery code;
3. a new password and confirmation.

A successful reset invalidates the prior recovery-code set and displays a new set. Save the new codes immediately.

The installation owner can also use the local CLI administration path:

```bash
./bin/mh user list
./bin/mh user reset-password USERNAME
./bin/mh user reset-password USERNAME --recovery
```

These local owner operations are privileged. Do not expose them through an untrusted shell or public endpoint.

## Multi-Device Profile Sync

The login screen can bootstrap a profile from a configured MetaHuman server. **Sync from Server** requires the remote URL, username, and password. The flow verifies remote credentials, imports priority profile data, creates or updates the local account through the sync owner, imports profile files, and saves sync configuration.

A successful login is not proof that sync completed. Confirm the explicit sync result and imported profile state. If profile import succeeds but saving sync configuration fails, address the reported partial state before assuming future synchronization is configured.

## Account Context in the CLI

Commands that operate on profile data should use explicit user context in a multi-user installation:

```bash
./bin/mh user whoami
./bin/mh user list
./bin/mh --user USERNAME persona status
./bin/mh --user USERNAME task
```

Do not fabricate an owner or anonymous context to bypass a command that requires a registered user.

## Troubleshooting

### Invalid username or password

Re-enter the credentials. A login failure does not by itself mean the account is missing; do not start profile sync solely to work around a mistyped password.

### Encrypted storage is locked

Use the password that owns the encrypted profile and resolve the storage readiness error. Do not create a second plaintext profile as a fallback.

### Profile is incomplete

If the account exists but required persona data is missing, use the supported sync or recovery workflow. Confirm the actual profile location before changing storage configuration.

## Related Guides

- [Accounts and Security](/user-guide#accounts-security)
- [Setup and Login](/user-guide#03-setup-and-login)
- [Multi-User Profiles](/user-guide#multi-user-profiles)
- [Deployment and Remote Access](/user-guide#deployment)
