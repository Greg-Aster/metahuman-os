# Deployment and Remote Access

MetaHuman keeps runtime deployment, remote model execution, and remote browser
access as separate responsibilities. This repository does not provision compute,
storage, DNS, or a hosted MetaHuman instance.

## Runtime deployment ownership

Install and build from the repository root:

```bash
pnpm install
pnpm build
```

Launch the complete built system with:

```bash
./start.sh
```

`./start.sh` is the production lifecycle owner. It starts the built standalone
Site server and the configured background services, including the MetaHuman-owned
Cloudflare tunnel process. It fails when the production bundle is missing rather
than building during startup. `pnpm dev` is for local development, and
`pnpm start` previews only the Site package; neither is the supported full-system
deployment command.

`etc/deployment.json` is the tracked deployment configuration seed.
`packages/core/src/deployment.ts`
loads it and applies the supported `DEPLOYMENT_MODE` and `METAHUMAN_ROOT`
environment overrides. Server mode changes configured storage and provider
settings, but it does not create external infrastructure.

Keep credentials, profiles, memories, logs, generated output, and machine-local
state outside tracked configuration. An operator deploying to another host must
provide its runtime environment and persistent filesystem.

## Remote model execution

Remote model calls remain behind the Core provider contract in
`packages/core/src/providers/bridge.ts`.
Profile-specific RunPod settings are resolved by
`packages/core/src/runpod-config.ts`
and the credential owner exposed through the application. Configure a supported
backend through maintained settings; do not add provider-specific API routes,
fallbacks, queues, or credential files.

Remote model execution does not expose the MetaHuman web application. Use the
tunnel path below when a browser must reach a local installation remotely.

## Cloudflare tunnel ownership

MetaHuman's built-in tunnel manager currently owns a **locally managed named
tunnel**. It runs `cloudflared tunnel run NAME`, records its owned process, and
coordinates shared request admission with the Site. Cloudflare's remotely managed
token/service workflow is not controlled by MetaHuman's Network settings.

Do not enable a separate systemd `cloudflared` service alongside the built-in
manager. Two process owners can start competing tunnel instances and make the UI's
status and stop controls inaccurate.

The tunnel transports requests; it does not replace MetaHuman authentication or
authorization. Use Cloudflare Access as an additional public boundary.

## Configure a locally managed tunnel

### 1. Install and authenticate `cloudflared`

Install `cloudflared` using Cloudflare's current
[download instructions](https://developers.cloudflare.com/tunnel/downloads/), then
authenticate the local installation:

```bash
cloudflared tunnel login
```

This creates the account certificate in the local Cloudflare configuration
directory. Do not copy that certificate or tunnel credentials into the repository.

### 2. Create the tunnel and DNS route

```bash
cloudflared tunnel create metahuman
cloudflared tunnel route dns metahuman mh.yourdomain.com
```

Record the tunnel UUID and generated credentials path. The hostname must be on a
domain managed by the selected Cloudflare account.

### 3. Configure the local origin

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR-TUNNEL-UUID
credentials-file: /home/YOUR_USERNAME/.cloudflared/YOUR-TUNNEL-UUID.json

ingress:
  - hostname: mh.yourdomain.com
    service: http://127.0.0.1:4321
  - service: http_status:404
```

Keep the catch-all rule last. If MetaHuman uses a non-default `PORT`, use the same
port in the origin service URL.

Validate the Cloudflare configuration before enabling it in MetaHuman:

```bash
cloudflared tunnel ingress validate
cloudflared tunnel info metahuman
```

### 4. Configure MetaHuman

Set the non-secret tunnel identity in `etc/cloudflare.json`:

```json
{
  "enabled": true,
  "tunnelName": "metahuman",
  "hostname": "mh.yourdomain.com",
  "autoStart": true
}
```

`enabled` and `autoStart` can also be toggled by an owner under
**System → Network**. The Network panel starts, stops, and reports the
process owned by MetaHuman; it does not create the Cloudflare account, tunnel,
credentials, DNS route, or local Cloudflare YAML file.

When the configuration is enabled at startup, `./start.sh` keeps the Site listener
on `127.0.0.1`, admits the configured hostname and HTTPS origin, and starts the
tunnel through the background-service launcher. An explicit `MH_EXPOSURE_MODE`
remains an operator override.

Do not tunnel a development server. Build first, then start the complete system:

```bash
pnpm build
./start.sh
```

## Configure public access

Protect the public hostname with a Cloudflare Access self-hosted application and
an allow policy for the intended identities. Follow Cloudflare's current
[Access application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
rather than relying on pricing, dashboard labels, or limits copied into this
repository.

Cloudflare Access and MetaHuman sessions are separate checks. Passing Cloudflare
Access must still lead to the MetaHuman authentication gate.

### Public guest sessions

1. Sign in to MetaHuman as an owner.
2. Open **System → Security**.
3. Mark only the intended profile as **Public**.
4. From a separate browser session, choose **Continue as Guest**.
5. Select the public profile and verify that the session remains read-only in
   Emulation mode.

The auth gate creates a one-hour passwordless guest-role session; it does not grant
an unauthenticated request access to protected APIs. Private profiles remain absent
from the guest selector.

### Named accounts

The installation has exactly one owner. That owner can create named standard or
guest profiles under Security settings. Send credentials through a separate secure
channel and create a unique account for each person. Do not edit the user database
or embed credentials in scripts.

To revoke access, delete the named profile when applicable, mark shared profiles
private, remove the identity from the Cloudflare Access policy, and confirm that an
existing session can no longer reach protected data.

## Verification

Validate each boundary separately:

1. `curl http://127.0.0.1:4321/` confirms the local built Site responds.
2. The authenticated Network panel reports the configured hostname, running
   process, and shared exposure mode.
3. A separate external browser reaches the Cloudflare Access boundary.
4. Owner login works through the public hostname.
5. **Continue as Guest** exposes only public profiles and cannot perform writes.
6. Stopping the tunnel in Network settings makes the public hostname unavailable
   without stopping the local Site.

A successful build does not prove that the tunnel is running. A running tunnel does
not prove that Cloudflare Access or MetaHuman authorization is correct.

## Troubleshooting

- **Tunnel not installed:** install `cloudflared` in a path recognized by the
  operating system, then reload Network settings.
- **Tunnel will not start:** confirm `enabled`, `tunnelName`, `hostname`, the local
  credentials file, and `cloudflared tunnel info NAME`.
- **Origin unavailable:** confirm the built Site is running on the port configured
  in `~/.cloudflared/config.yml`.
- **Host or origin rejected:** restart through `./start.sh` so the configured
  hostname and HTTPS origin are admitted before the Site starts.
- **Network status differs from the operating system:** stop any independently
  managed `cloudflared` service and use one lifecycle owner.
- **Guest sees no profiles:** mark an intended profile public while signed in as an
  owner; do not weaken route authentication.

See [Security and Trust](/user-guide#security-trust), [Authentication](/user-guide#authentication),
and [Headless Runtime Mode](/user-guide#headless-mode) for the adjacent
contracts.
