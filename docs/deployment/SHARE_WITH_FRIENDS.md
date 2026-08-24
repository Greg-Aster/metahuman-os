# Sharing MetaHuman OS

Use Cloudflare Tunnel and Access as the public network boundary. Complete
[Cloudflare Tunnel Setup](CLOUDFLARE_TUNNEL.md) before exposing the Site.

## Public guest access

1. Sign in as an owner.
2. Open **System → Settings → Security**.
3. Set the intended persona's visibility to **Public**.
4. Restrict the tunnel with Cloudflare Access before sharing its URL.

Visitors may then choose **Continue as Guest** and select a public profile.
Guest sessions are read-only and remain in emulation mode. Marking a profile
private removes it from guest selection.

## Named accounts

Owners can create a named standard, guest, or owner profile from the profile
management section in Security settings. Send credentials through a separate,
secure channel and give each person a unique account. Do not edit
`persona/users.json` or hard-code credentials in repository scripts.

To revoke access, delete the named profile in Security settings, make the shared
persona private, and remove the person's identity from the Cloudflare Access
policy as appropriate.

Review audit activity and public-profile visibility regularly. Never expose a
development server directly to the internet.
