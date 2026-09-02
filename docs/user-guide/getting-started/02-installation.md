# Installation

This chapter installs the maintained Linux-first MetaHuman OS server. If you are
using an installation managed by someone else, continue to
[Setup and First Login](/user-guide#03-setup-and-login).

## Requirements

Required:

- Linux
- Git
- Node.js `>=22.3.0 <23`
- pnpm `>=10.15.1 <11`

The repository includes `.nvmrc`, and installation rejects unsupported Node
versions. Disk, memory, CPU, and GPU requirements depend on the models and
optional services you choose.

Optional:

- Ollama, vLLM, the local-model service, or a configured remote model backend
- Python environments required by particular training or voice providers
- An NVIDIA GPU for supported local training or larger local inference
- `cloudflared` for the maintained tunnel workflow
- PM2 for background supervision of the canonical production launcher

## 1. Clone the repository

```bash
git clone https://github.com/Greg-Aster/metahuman-os.git
cd metahuman-os
```

If the repository already exists, use that installation instead of cloning a
second runtime.

## 2. Select the supported Node and pnpm versions

With NVM:

```bash
nvm install
nvm use
corepack enable
corepack prepare pnpm@10.15.1 --activate
```

Confirm the runtime:

```bash
node --version
pnpm --version
pnpm check:node
```

## 3. Install workspace dependencies

Run from the repository root:

```bash
pnpm install
```

This installs the pnpm workspace and runs the maintained post-install setup. It
does not download every optional model, voice provider, or training environment.

## 4. Build the web application

```bash
pnpm --dir apps/site build
```

A successful build proves that the current Site source compiled. It does not
prove that model, voice, tunnel, sync, or environment services are configured.

## 5. Start production

```bash
./start.sh
```

`start.sh` is the production startup owner. It validates Node, prevents a
second overlapping launcher, starts configured background services, and runs
the prebuilt Site in the foreground.

Open `http://127.0.0.1:4321` on the server. The installation may use another
address only when its exposure configuration says so.

To stop the foreground launcher, press Ctrl+C. To stop repository-scoped
services explicitly:

```bash
./stop.sh
```

## Development mode

For Site development with hot reload:

```bash
pnpm dev
```

The development command starts the Site dev server, not the complete production
service stack. Start optional background services separately when the feature
under test requires them:

```bash
./bin/start-services --background
```

Do not run development and production web servers on the same configured port.

## Optional background supervision

PM2 is optional. Once installed, it supervises the same `start.sh` path as one
forked process:

```bash
./bin/start-pm2
```

Stop that supervised process with:

```bash
./bin/stop-pm2
```

Do not combine PM2 with another independently started MetaHuman production
launcher.

## Verify the installation

Check the web listener and canonical CLI:

```bash
curl -I http://127.0.0.1:4321
./bin/mh status
./bin/mh backend status
```

Then verify in the web interface:

- The authentication screen loads.
- After login, Server Status reports the selected backend honestly.
- The Queue panel is visible.
- Optional services show stopped, missing, or unavailable instead of fabricated
  success when they are not installed.

Use `logs/server.log` and `logs/run/` for launcher diagnostics. These are
local runtime logs and must not be committed.

## Updating an existing installation

Do not treat `git pull` as a complete update. Source changes may require new
dependencies and a rebuilt Site. Use the owner-controlled update workflow in
System settings when available, or stop the installation and deliberately run:

```bash
git pull --ff-only
pnpm install
pnpm --dir apps/site build
./start.sh
```

Review local changes before pulling. Never overwrite profile data or a dirty
worktree to force an update.

## Next step

Continue to [Setup and First Login](/user-guide#03-setup-and-login). For startup failures,
see [Troubleshooting](/user-guide#troubleshooting).
