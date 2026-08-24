# Running MetaHuman OS

The maintained runtime is Linux-first. Install dependencies and build the Site
before starting it:

```bash
pnpm install
pnpm --dir apps/site build
```

## Production

```bash
./start.sh
```

`start.sh` is the canonical startup owner. It validates Node, starts configured
background services, and runs the prebuilt web server in the foreground. It
never installs packages or builds source. Press Ctrl+C to stop what it started,
or use `./stop.sh` for a full repository-scoped shutdown.

## Development

```bash
pnpm --dir apps/site dev
```

The development command runs only the Site dev server. Start optional background
services separately with `./bin/start-services --background` when needed.

## Background operation

Install PM2 explicitly, then run:

```bash
./bin/start-pm2
./bin/stop-pm2
```

PM2 supervises the same canonical `start.sh` path as one forked instance. It
does not maintain a second service launcher or cluster multiple web runtimes.

The maintained mobile shell is `apps/react-native`; its build and release
commands are documented in that package.
