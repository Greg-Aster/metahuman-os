# Headless Runtime Mode

Headless mode keeps the web interface and configured tunnel available while
pausing local agent processes. Core's runtime-mode service owns the transition;
there is no separate watcher or duplicate scheduler.

## What changes

Entering headless mode:

1. asks the Agent Monitor owner to stop all managed agent processes;
2. records the state in `etc/runtime.json`;
3. writes an audit event describing stopped and failed processes.

Exiting headless mode records active state first, then asks the canonical agent
process runner to start only services enabled with `startOnSystemBoot` in
`etc/services.json`.

The web server, tunnel, and inference services are not implicitly stopped by
this transition. Their lifecycle remains with their own service owners.

## State

The machine-wide state is:

```json
{
  "headless": false,
  "lastChangedBy": "local",
  "changedAt": "2026-08-24T00:00:00.000Z",
  "claimedBy": null
}
```

- `headless` is the current mode.
- `lastChangedBy` is `local` or `remote`.
- `changedAt` is the last transition time.
- `claimedBy` identifies the remote claimant when applicable.

Use the supported runtime-mode API or UI control. Direct edits do not execute
the required stop/start lifecycle and can leave state inconsistent.

## Remote access

Headless mode is not authentication and does not expose the site by itself. Use
the [Deployment Guide](../configuration-admin/deployment.md) and
[Cloudflare Tunnel guide](../../deployment/CLOUDFLARE_TUNNEL.md) for remote
access, and review [Security & Trust](../configuration-admin/security-trust.md)
before exposing an instance.

## Verification

After a transition, verify all three layers separately:

- `etc/runtime.json` reflects the requested mode;
- Agent Monitor shows the expected processes stopped or started;
- the web and tunnel endpoints remain reachable if configured.

A state-file change alone does not prove the process transition succeeded.
