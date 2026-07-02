# Robot Friend

Robot Friend is a lightweight conversation interface for a small robot-side device. The app serves a local browser UI and proxies a narrow allowlist of requests to a running MetaHuman Astro server.

The app is intentionally isolated:

- no imports from `apps/site`
- no imports from `packages/core`
- no imports from `brain`
- no motor or servo control in V1
- no root package scripts

## Run

```sh
pnpm --dir apps/robot-friend dev
```

Create `robot-friend.config.json` next to this README for local credentials. That file is ignored and must not be committed.

Or use the central launcher:

```sh
./apps/robot-friend/start.sh
```

LAN mode is the default. The launcher listens on all network interfaces and prints one or more `Network URL` entries. Open one of those URLs on a phone or tablet connected to the same Wi-Fi network.

To force local-only mode:

```sh
./apps/robot-friend/start.sh --local
```

Use the default LAN mode only on a trusted network because the interface can proxy authenticated chat, STT, and TTS requests to the MetaHuman server.

You can also override the bind address or port for one run:

```sh
./apps/robot-friend/start.sh --host 0.0.0.0 --port 4377
```

Mobile browsers require a secure context for microphone access. Plain LAN HTTP can load the chat UI, but phone voice input needs HTTPS because the phone is not browsing `localhost`.

For local Wi-Fi voice input, serve Robot Friend over HTTPS with a certificate the phone trusts:

```sh
./apps/robot-friend/start.sh --https --key certs/robot-friend.key --cert certs/robot-friend.crt
```

The app serves HTTPS directly. The certificate is the only hard requirement from the browser.

## Build

```sh
pnpm --dir apps/robot-friend build
pnpm --dir apps/robot-friend start
```

The build includes a lightweight size budget check with no runtime dependencies:

```sh
pnpm --dir apps/robot-friend size:check
```

## Boundary

The MetaHuman server remains the brain. Robot Friend is only the interface: microphone capture, TTS playback, transcript display, status display, and a local proxy that forwards authenticated requests.
