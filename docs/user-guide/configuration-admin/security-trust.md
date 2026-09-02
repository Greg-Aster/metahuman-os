# Security and Trust

Security is enforced in Core at the API, profile, path, memory, cognitive-mode,
and skill boundaries. Client-side visibility is not authorization.

## Access model

Every protected request is associated with an authenticated session. Roles are:

- **Owner:** system administration and all owner-authorized operations.
- **Standard:** writable access to the user's own profile, subject to policy.
- **Guest:** authenticated read-only access. A one-hour temporary guest session
  uses this role for public-profile viewing through the isolated guest profile;
  it is not a fourth role.

Public auth/bootstrap routes are explicitly registered. A route is not public
merely because it lacks data in one code path.

## Cognitive modes

Cognitive mode adds behavioral restrictions; it does not replace role checks:

- **Dual** applies normal owner/standard policy and the full supported memory
  event set.
- **Agent** permits task-oriented writes and command/outcome memory events by
  policy.
- **Emulation** blocks new long-term memory capture, Operator work, proactive
  work, and training. It does not revoke every unrelated owner/standard profile
  or configuration permission.
- **Environment** applies its conversation-memory and bounded Environment
  Bridge policy.

Guests remain read-only regardless of the selected presentation. High-security
state restricts the system to Emulation; wetware-deceased state disables Dual.

## Trust levels

Trust controls which skills and autonomous actions may proceed, require
approval, or remain blocked. Profile `trust-coupling.json` may map a cognitive
mode to a trust level. The security-policy and skill-execution owners make the
final decision; changing a UI label does not grant authority.

Use conservative trust first. Increase autonomy only after reviewing successful
audit evidence for the exact capability.

## Profile and path isolation

Profile, storage, and path-security owners resolve user data. Maintained code
must not concatenate unchecked usernames or user-provided relative paths.
Cross-profile access requires an explicit policy decision. Secrets, memories,
persona data, logs, and generated output are private runtime data.

## Remote access

A Cloudflare tunnel transports traffic; it does not weaken the application
session requirement. Before exposing the site:

1. create a strong owner password;
2. verify guest/public profile visibility;
3. keep credentials out of tracked files and logs;
4. run the repository security-route validator;
5. test owner and guest access from a separate browser session.

See [Authentication](/user-guide#authentication) and [Deployment](/user-guide#deployment).

## Special system states

`HIGH_SECURITY=true` permits only Emulation mode. `WETWARE_DECEASED=true`
disables Dual mode. These environment flags affect runtime behavior only after
the owning process reloads them; verify the status endpoint and UI banner after
changing them.

## Operational checks

- Run `pnpm validate:security-routes` after changing routes or policy.
- Run focused security-policy and session tests after changing authorization.
- Review audit records for denied as well as successful sensitive actions.
- Verify the actual profile path and user context when diagnosing access.
- Do not treat a hidden button, a process being alive, or a tunnel response as
  proof that authorization is correct.

Report vulnerabilities privately to the repository owner. Do not place secrets
or personal data in an issue, test fixture, or diagnostic paste.
