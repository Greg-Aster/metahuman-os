# Robot Friend Progress

Created: 2026-07-01

## Goal

Build MetaHuman into a WiFi-enabled conversation program that can run headless on a small mobile device, expose a reduced web interface locally or through Cloudflare, use microphone input and TTS output, and eventually control a miniature mobile robot.

The immediate target is not full robotics autonomy. The first target is a simple, reliable "robot friend" interface:

- text conversation
- push-to-talk or conversation-mode voice input
- assistant speech output
- status display
- headless/runtime mode awareness
- optional Cloudflare/local-network exposure
- future-safe motion controls with hard stop and command timeouts

## Product Direction

A headless web interface is a good direction.

In this project, "headless" should mean the program runs without a desktop GUI while still serving a small browser-based UI. The UI can be opened from a phone, tablet, laptop, or another computer on the same network.

### Benefits

- Cross-platform by default: Android, iOS, Linux, Windows, macOS, tablets, and old phones can all use a browser.
- Good first version: open a local URL, talk to the system, see status, and later control motion.
- One UI can serve desktop, phone, Raspberry Pi, and robot-hosted deployments.
- It matches existing repo direction: MetaHuman already has Astro/Svelte web UI, unified API handlers, mobile/nodejs-mobile support, and Cloudflare tunnel support.
- It keeps the robot service local-first. Cloudflare can be optional remote access, not the required path.

### Downsides

- Browser microphone and speech APIs vary by browser and platform.
- Real-time voice streaming is harder than text chat. The repo already has STT/TTS, but true low-latency full-duplex audio would need a more deliberate audio transport later.
- Remote motion control is safety-sensitive. Cloudflare exposure must not mean arbitrary internet motor commands.
- Browser UI code should never directly drive motors. Motion needs a backend owner with allowlists, timeouts, speed limits, and a physical stop path.

### What other projects tend to do

- Browser/mobile robot dashboards are common, especially in ROS ecosystems through WebSocket bridges.
- DIY mobile robot projects often use Raspberry Pi or Jetson-class computers, optionally with microcontrollers for motor control.
- Local-first/offline control is common in privacy-conscious robotics projects.
- Native mobile apps are useful for deeper device integration, but a web UI is usually the fastest cross-platform control surface.

Reference links from the initial research:

- Cloudflare Tunnel docs: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
- WebRTC overview: https://en.wikipedia.org/wiki/WebRTC
- Web Speech API overview: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- ROS web UI pattern with ROSBridge/roslibjs: https://arxiv.org/abs/2406.02210
- ROS-Mobile Android control/monitoring app: https://arxiv.org/abs/2011.02781
- Recent local-first open-source robot example: https://www.tomshardware.com/3d-printing/maker-kicks-off-oomwoo-an-open-source-robot-vacuum-you-can-3d-print-and-build-yourself

## Repo Audit Summary

This audit follows the local architecture contract:

- apps are interface shells
- `packages/core` owns engine/domain/API handler logic
- `brain/*` owns workers and agents above the engine
- `apps/site/src/pages/api` should stay thin transport over core handlers
- `apps/code-oss`, runtime data, profiles, logs, and local agent files are not normal refactor targets

The current worktree is already very dirty, including large legacy `apps/code-oss` changes and runtime/local data removals. This progress document is intentionally the only new file for this task.

## Existing Building Blocks

### 1. Web app shell exists

The main web UI already boots through Astro/Svelte:

- `apps/site/src/pages/index.astro` imports `ChatLayout`, `LeftSidebar`, `RightSidebar`, `CenterContent`, and `AuthGate`.
- The default authenticated UI is a full app shell, not a simple robot UI.
- `CenterContent.svelte` eagerly loads `ChatInterface.svelte` and lazy-loads many other panels.

Implication: a simple robot interface should be a new reduced page/component, not a rewrite of the main app.

Recommended first UI owner:

- `apps/site/src/pages/robot-friend.astro`
- `apps/site/src/components/RobotFriendInterface.svelte`

### 2. Conversation backend exists

The primary conversation route is already unified:

- `packages/core/src/api/router.ts` registers `/api/persona_chat`.
- `packages/core/src/api/handlers/persona-chat.ts` owns the cognitive graph chat pipeline and SSE streaming.
- `apps/site/src/pages/api/persona_chat.ts` is thin `astroHandler` transport.

The existing full chat UI already uses this path.

Status: mostly usable for robot-friend conversation.

Gap: the reduced interface needs a simpler frontend path that does not pull in the whole multi-panel MetaHuman UI.

### 3. Microphone input exists

The existing chat component wires microphone input through:

- `apps/site/src/lib/client/composables/useMicrophone.ts`
- `apps/site/src/components/ChatInterface.svelte`
- `apps/site/src/components/chat/InputArea.svelte`
- `packages/core/src/api/handlers/stt.ts`
- `apps/site/src/pages/api/stt.ts`

Capabilities found:

- browser `MediaRecorder` / `getUserMedia` path
- server STT endpoint
- React Native speech bridge support
- conversation mode with voice activity detection
- silence detection
- voice ducking while TTS is speaking
- queued voice messages while the LLM is busy

Status: strong existing base.

Gaps:

- No dedicated reduced microphone UI.
- Browser permission and secure-context behavior still matters for LAN/mobile browsers.
- Wake word is marked deprecated/disabled in the current microphone composable.

### 4. TTS output exists

TTS is already provider-based:

- `packages/core/src/tts.ts`
- `packages/core/src/api/handlers/tts.ts`
- `apps/site/src/lib/client/composables/useTTS.ts`
- `apps/site/src/pages/api/tts.ts`
- `apps/site/src/pages/api/tts-stream.ts`

Capabilities found:

- Piper
- GPT-SoVITS
- RVC
- Kokoro
- browser/native `speechSynthesis` mode
- batch TTS through `/api/tts`
- streaming TTS through `/api/tts-stream`
- TTS state reporting to `/api/pause-state`

Status: strong existing base.

Gap: robot-friend UI needs a smaller TTS control surface: speak on/off, stop speaking, voice/provider status.

### 5. Cloudflare tunnel support exists

Tunnel code exists in:

- `packages/core/src/cloudflare-tunnel.ts`
- `packages/core/src/api/handlers/cloudflare.ts`
- `apps/site/src/pages/api/cloudflare/*`
- `apps/site/src/components/NetworkServerSettings.svelte`
- `docs/deployment/CLOUDFLARE_TUNNEL.md`
- `bin/start-cloudflare`

Capabilities found:

- tunnel config in `etc/cloudflare.json`
- status/start/stop/toggle endpoints
- Network settings panel
- docs for Cloudflare Access and tunnel setup

Status: usable for optional remote exposure.

Gaps:

- Motion controls must not be remotely exposed without extra robot-specific safety/auth.
- Cloudflare start/stop handlers do not appear owner-guarded in the router lines audited. That should be reviewed before robot deployment.

### 6. Headless runtime mode exists, but has a functional gap

Headless/runtime-mode files exist:

- `packages/core/src/runtime-mode.ts`
- `packages/core/src/api/handlers/runtime-mode.ts`
- `apps/site/src/pages/api/runtime/mode.ts`
- `apps/site/src/components/NetworkServerSettings.svelte`
- `apps/site/src/components/HeadlessClaimBanner.svelte`
- `docs/implementation-plans/headless-runtime-mode.md`
- `docs/user-guide/advanced-features/headless-mode.md`
- `etc/runtime.json`

Implemented pieces:

- persisted runtime flag in `etc/runtime.json`
- owner-guarded `/api/runtime/mode` route in `packages/core/src/api/router.ts`
- Network settings toggle
- claim banner UI
- `isHeadless()` checks in startup/boot paths

Important gap:

- `packages/core/src/runtime-mode.ts` has `enterHeadlessMode()` and `exitHeadlessMode()` functions that stop and restart agents.
- `packages/core/src/api/handlers/runtime-mode.ts` currently calls `setRuntimeMode()` directly instead of calling `enterHeadlessMode()` or `exitHeadlessMode()`.
- That means toggling the mode through the API writes the flag, but may not stop already-running local agents.

Status: concept and UI are present, but backend behavior should be corrected before depending on it for robot-safe resource control.

### 7. Local network / mobile host path exists

React Native mobile infrastructure exists:

- `apps/react-native/App.tsx`
- `apps/react-native/nodejs-assets/nodejs-project/main.js`
- `apps/react-native/scripts/build-handlers.mjs`
- `brain/mobile-handlers.ts`
- `brain/mobile-agents.ts`
- `packages/core/src/api/adapters/mobile.ts`
- `packages/core/src/api/adapters/http.ts`

Relevant capability:

- The React Native app starts a Node.js backend.
- The backend serves static UI and API routes from the same unified handler stack.
- `main.js` has WiFi broadcast mode:
  - default bind: `127.0.0.1`
  - broadcast bind: `0.0.0.0`
  - `/api/network-info`
  - `/api/network-settings`

Status: strong path for phone-as-host or phone-as-controller experiments.

Gaps:

- Root `package.json` still points mobile scripts at deprecated `apps/mobile`, while maintained docs mention `apps/react-native`.
- WiFi broadcast is currently implemented in the React Native nodejs-mobile backend, not as a general desktop/Pi server mode.
- No robot-specific pairing or control-safety layer exists.

### 8. Remote server / desktop LLM path exists

Remote server handlers exist:

- `packages/core/src/api/handlers/remote-server.ts`
- `apps/site/src/pages/api/remote-server/*`
- provider bridge code includes `remote-server`

Status: useful for a small robot/phone using a larger desktop server for LLM inference.

Gap: the simple robot UI should explicitly show what backend is active: local robot, phone backend, desktop remote server, cloud provider, etc.

### 9. Motion control does not exist yet

Searches across maintained source did not find a real robot motion owner:

- no motor controller API
- no GPIO adapter
- no serial/microcontroller adapter
- no ROS/ROSBridge adapter
- no joystick/gamepad robot-control surface
- no velocity command schema
- no safety watchdog for motion commands

Status: not implemented.

This is the main missing subsystem for a mobile robot friend.

## What Needs To Happen For A Simple Interface

### Phase 1: Reduced conversation page

Add a minimal page that reuses existing conversation, STT, and TTS capability without loading the full app shell.

Proposed files:

- `apps/site/src/pages/robot-friend.astro`
- `apps/site/src/components/RobotFriendInterface.svelte`

First screen:

- transcript/message list
- text input
- mic button
- conversation mode toggle
- speak on/off
- stop speaking
- backend status
- headless status
- no sidebars, no training panels, no complex settings

Use existing APIs first:

- `GET /api/status`
- `GET /api/runtime/mode`
- `POST /api/persona_chat` or SSE `GET /api/persona_chat`
- `POST /api/stt`
- `POST /api/tts` or `POST /api/tts-stream`
- `POST /api/pause-state`

### Phase 2: Fix headless toggle behavior

Update `packages/core/src/api/handlers/runtime-mode.ts` so:

- enabling headless calls `enterHeadlessMode(actor)`
- disabling headless calls `exitHeadlessMode(actor, claimedBy)`
- direct config writes remain a lower-level helper, not the public API behavior

The former `headless-watcher` service has been removed. Headless transitions are now owned by `packages/core/src/runtime-mode.ts`, and disabling headless mode resumes agents from the Boot Manager configuration.

### Phase 3: General local-network server mode

The React Native backend already has WiFi broadcast mode. For Raspberry Pi or laptop-hosted robot mode, add an equivalent desktop/server setting.

Likely owner:

- `packages/core/src/api/handlers/server-info.ts` for status/read side
- a new `packages/core/src/network-mode.ts` or documented network config owner
- a thin app settings panel later

Requirements:

- bind to localhost by default
- allow `0.0.0.0` only when explicitly enabled
- show local LAN URLs
- warn if auth is disabled or weak
- pair with headless mode for robot appliance use

### Phase 4: Robot control API

Add a backend-owned robot control surface. Do not put motor behavior in Svelte.

Proposed core owner:

- `packages/core/src/robot/types.ts`
- `packages/core/src/robot/controller.ts`
- `packages/core/src/robot/adapters/null-adapter.ts`
- `packages/core/src/robot/adapters/serial-adapter.ts` later
- `packages/core/src/api/handlers/robot-control.ts`

Proposed API:

- `GET /api/robot/status`
- `POST /api/robot/command`
- `POST /api/robot/stop`

Initial command schema:

```ts
type RobotCommand =
  | { type: 'stop' }
  | { type: 'drive'; linear: number; angular: number; durationMs: number }
  | { type: 'look'; yaw?: number; pitch?: number; durationMs?: number }
```

Safety rules:

- owner-only by default
- disabled unless `robot.enabled === true`
- max speed caps from config
- required `durationMs`
- server-side stop after timeout
- emergency stop endpoint
- ignore motion commands while unauthenticated, remote-untrusted, or unpaired
- LLM can request motion only through an allowlisted intent layer, never raw hardware control

### Phase 5: Robot UI controls

Once the backend exists, add controls to `RobotFriendInterface.svelte`:

- large stop button
- small directional pad
- speed slider
- motion lock toggle
- status row: connected, battery if available, control lease, last command

Only show controls when `/api/robot/status` says the robot adapter is connected and enabled.

### Phase 6: Hardware adapters

Start with a `null` adapter for UI testing.

Then choose one concrete hardware path:

- Raspberry Pi serial to microcontroller
- ESP32 motor controller over serial/WiFi
- ROSBridge if the platform uses ROS 2
- phone-hosted prototype with no motors yet

Recommended first real hardware path:

- Raspberry Pi or small Linux board runs MetaHuman/server
- USB serial to an ESP32/Arduino motor controller
- motor controller owns PWM, encoders, and immediate stop
- MetaHuman sends high-level velocity commands with short TTLs

## Current Readiness Matrix

| Capability | Current status | Notes |
|---|---:|---|
| Web UI shell | Exists | Full app shell is heavy; add reduced page. |
| Text conversation | Exists | `/api/persona_chat` and chat UI are mature enough to reuse. |
| Mic input | Exists | Browser, Whisper/server path, and React Native bridge exist. |
| TTS output | Exists | Provider-based TTS with streaming support exists. |
| Conversation mode | Exists | `useMicrophone` has conversation state machine and voice ducking. |
| Local network exposure | Partial | Exists in React Native backend; general server mode still needed. |
| Cloudflare exposure | Exists | Needs auth/safety review before robot controls. |
| Headless mode | Partial | Flag/UI exist; API should call lifecycle functions. |
| Mobile app host | Partial | React Native/nodejs-mobile path exists; root scripts may be stale. |
| Motion controls | Missing | Needs new core-owned robot subsystem. |
| Hardware adapter | Missing | Start with null adapter, then serial/ESP32 or ROS. |
| Robot safety watchdog | Missing | Required before any real motors. |

## Recommended Next Implementation Packet

Smallest useful packet:

1. Add `RobotFriendInterface.svelte`.
2. Add `/robot-friend` Astro page.
3. Reuse existing text chat, mic, TTS, and status APIs.
4. Show headless and Cloudflare status as read-only indicators.
5. Add a disabled "Motion controls coming next" panel, not fake controls.
6. Fix `/api/runtime/mode` to call `enterHeadlessMode` / `exitHeadlessMode`.
7. Add a robot-control design note or API stub only after the reduced interface works.

Do not start by building motor control into the frontend. The repo already has enough conversation and voice machinery; the missing hard part is a safe backend robot-control owner.

## Implementation Update - 2026-07-01

Implemented `apps/robot-friend` as a standalone TypeScript + Svelte + Vite app with a tiny Node server.

Current implementation:

- serves a compact robot conversation UI from `apps/robot-friend`
- reads local config from `apps/robot-friend/robot-friend.config.json`
- keeps `robot-friend.config.json` ignored so credentials are not committed
- logs into the configured MetaHuman Astro server through `/api/auth/login`
- stores the MetaHuman session in memory only
- exposes local `/robot/api/*` endpoints to the browser UI
- forwards only allowlisted conversation/status/voice endpoints
- records browser microphone audio with WebM/MediaRecorder
- sends audio to MetaHuman STT through the local proxy
- sends transcripts to `/api/persona_chat` with `mode: "conversation"` and `stream: false`
- plays server TTS WAV audio through Web Audio
- pauses listening while the assistant is thinking or speaking
- includes a disabled motion panel for V1
- documents boundaries and future motion rules in `apps/robot-friend/ARCHITECTURE.md`

Validation completed:

- `pnpm --dir apps/robot-friend typecheck` passed
- `pnpm --dir apps/robot-friend build` passed
- `pnpm --dir apps/robot-friend start` served the built app successfully when run outside the managed sandbox
- `GET /robot/api/app-config` returned default public config
- `GET /robot/api/status` returned local app status with motion disabled
- `GET /` returned the built UI HTML

Notes:

- The smoke start required approval outside the managed sandbox because the sandbox blocked binding to `127.0.0.1:4377` with `EPERM`.
- A real local config is still required before the app can authenticate against a running MetaHuman server.
- V1 still intentionally has no motor, servo, GPIO, ROS, camera, or WebRTC code.
