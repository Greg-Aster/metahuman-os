# Deployment and Remote Access

MetaHuman keeps runtime deployment, remote model execution, and remote browser
access as separate responsibilities. This repository does not provision compute,
storage, DNS, or a hosted MetaHuman instance.

## Runtime deployment ownership

Install and build from the repository root:

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs workspace typechecks, architecture checks, registered tests and
validators, then builds the Site. The server updater uses the same gate. For a
routine local rebuild, `pnpm build` only builds the Site; run focused checks for
the code you changed. `pnpm validate` runs the validator subset only.

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

### Q6A robot task placement

The existing durable graph execution and Work Coordinator run task coordination
on Q6A. Active-task image identification and generated motion plans are finite
`remote-llm` jobs with explicit `executionTarget: remote` at the model router.
The provider bridge must dispatch them to a remote provider; the lane name alone
does not select a backend. These calls neither require local inference health nor
start a local model or use local Big Brother execution. A missing login, unsupported
image transport, remote failure or cancellation returns an explicit result to the
same task. Heavy inference does not run inside the active task's event step.

For a MetaHuman server, connect under **Settings → Backend → Remote Server**
using the selected profile. The existing credential owner saves its server URL
and session privately. In `etc/llm-backend.json`, the existing `remote.provider`
must be `server`; `remote.model` selects the server's vision-capable model. An
empty model asks that server for its configured default. The server must preserve
image content and structured output at `/api/llm/chat`. A system URL without the
profile's authenticated session is insufficient. Keep local backend preferences
for lightweight work; remote task placement is explicit per call.

Verify the authenticated inference request, selected model and returned evidence
against the actual server before runtime acceptance. Tests use an isolated HTTP
server and simulated bodies; they establish dispatch and cancellation contracts,
not remote model quality, Q6A performance or physical movement. This configuration
does not provision or deploy a server.

## Desktop Environment Bridge to a remote Q6A gateway

MetaHuman OS and the Environment Bridge can remain together on the desktop while
the Ubuntu Q6A runs Ainekio's gateway. The desktop connects outward through a
Cloudflare Access TCP hostname to the Q6A gateway; no phone or public MetaHuman
Site tunnel is needed for this connection.

On the Q6A, follow the Ainekio checkout's `Master/gateway/README.md` section
**Desktop MetaHuman connected to a Q6A through Cloudflare**. Its existing relay
launcher adds `AINEKIO_CLOUDFLARE_ENVIRONMENT_HOSTNAME` as a TCP route to
`127.0.0.1:8790` (or the configured gateway port). Create a Cloudflare Access
application and login policy for that hostname. The existing HTTP `/robot` relay
is a separate route; an HTTP tunnel to `/environment` is rejected by the gateway.

Install `cloudflared` on the desktop using the
[official download instructions](https://developers.cloudflare.com/tunnel/downloads/).
In **Agent Monitor → Body connection**, select **Remote via Cloudflare** and configure:

- **Adapter URL**: `ws://127.0.0.1:18790/environment`.
- **Cloudflare Hostname**: the Q6A Access hostname, such as `bridge.ainek.io`.
- **Service Token File**: optional private environment file containing
  `TUNNEL_SERVICE_TOKEN_ID` and `TUNNEL_SERVICE_TOKEN_SECRET`. With the existing
  Access Service Auth policy, the connection needs no extra human login.

Keep the existing tokens in the desktop's ignored `.env`:

```dotenv
MH_ENVIRONMENT_ADAPTER_TOKEN=<same secret as AINEKIO_ENVIRONMENT_ADAPTER_TOKEN on Q6A>
MH_ENVIRONMENT_BRIDGE_TOKEN=<desktop internal Bridge service token>
```

Click **Save and connect**. Remote owns the existing `bin/connect-environment` TCP
launcher and stops that forwarder when stopped. Do not run a separate desktop
forwarding service alongside it. The Q6A gateway and connector remain running.

Open **Agent Monitor → Body connection** (or `/monitor#body-connection`) to
choose the machine running Body Control. Ainekio's Body Control Settings can
save a link to this page on your stationary desktop, reachable through its
existing remote access address. Sign in to MetaHuman as the owner; Body Control
does not receive MetaHuman credentials.

- **This computer** means the MetaHuman host, which can differ from the browser's
  device. The default adapter URL is `ws://127.0.0.1:8790/environment`.
- **LAN / Wi-Fi via SSH** accepts any `user@hostname`, `user@IP` or SSH host alias.
  Establish host trust and noninteractive SSH authentication as the OS account
  running MetaHuman first. SSH config can specify the port and key. Set the remote
  gateway port (default `8790`) and loopback forwarding URL (normally
  `ws://127.0.0.1:18790/environment`). Dashboard port `8791` is separate.
- **Remote via Cloudflare** uses your existing Access TCP hostname and optional
  private service-token file. It can target any configured gateway host.

**Save and connect** saves the settings and invokes the existing bridge
start/restart path. Body Control must already run on the chosen host. Remote owns
its SSH or Cloudflare tunnel; Local and Remote remain mutually exclusive. Old
configurations without `transport` continue using Cloudflare. SSH and Cloudflare
settings are retained separately and share the loopback forwarding URL.

The gateway adapter remains loopback-only. Wired LAN and Wi-Fi both use SSH;
select the Wi-Fi network in the operating system. Switching interrupts the
connection and does not migrate the running task. Existing session and receipt
reconciliation remains responsible for uncertain commands. Check readiness in
Agent Monitor: a started process alone does not establish a working body link.
The selected agent is remembered for startup. The obsolete shared
`MH_ENVIRONMENT_ADAPTER_URL` does not override these separate settings. Matching
adapter credentials must be configured on the selected host; model/provider
selection remains independent in Backend settings.

The forwarding launcher can still be used manually for diagnostics:
`./bin/connect-environment HOSTNAME [LOCAL_PORT]`, while Remote is stopped.

Without a service token, when the Bridge opens the forwarding connection, `cloudflared` launches a browser
for the Cloudflare Access login. Signing into the Cloudflare administration
dashboard alone does not authenticate this client. Cloudflare documents this
[Access TCP browser-login workflow](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/).
The Q6A connector then opens a loopback socket to the gateway while preserving
the inner WebSocket request. The gateway's existing adapter-token authentication
still applies. TCP carries the entire gateway port, including `/robot`; the
separate dashboard port is not forwarded by this route.

Keep the gateway, Q6A connector, desktop forwarder and MetaHuman running. Use
Agent Monitor's Environment Bridge state/diagnostics to confirm the gateway
session and connected robot, then exercise owner-selected commands and the
needed media paths on the actual machines. Local tests do not establish
Cloudflare login or physical demo readiness. Cloudflare recommends
[Client-to-Tunnel for long-lived connections](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/).

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
