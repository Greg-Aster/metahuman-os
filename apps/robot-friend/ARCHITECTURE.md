# Robot Friend Architecture

## Purpose

Robot Friend is a small interface app for a robot-side device. It connects to a running MetaHuman server and lets the user talk to the system through a local browser UI.

The main MetaHuman server owns all heavy work: auth, memory, persona chat, STT, TTS, model routing, and cognitive graph execution.

## Runtime Shape

```text
Browser UI
  -> local Robot Friend Node server
  -> allowlisted proxy requests with mh_session cookie
  -> MetaHuman Astro/API server
```

The local server logs in with credentials from `robot-friend.config.json`, stores the session in memory, and forwards only the V1 conversation endpoints. Browser code never stores the MetaHuman password and never sets remote cookies.

## Boundaries

- `apps/robot-friend` must be deletable without breaking any other package.
- Browser code must not import `@metahuman/core`, `apps/site`, or `brain`.
- Server code must not import `@metahuman/core`; this app talks to MetaHuman over HTTP.
- The local proxy must stay allowlisted. It is not a general-purpose proxy.
- V1 contains no motor, servo, GPIO, serial, ROS, camera, or WebRTC control.

## Voice Flow

1. UI loads `/robot/api/app-config` and `/robot/api/status`.
2. UI records WebM audio with `MediaRecorder`.
3. Local proxy forwards raw audio to MetaHuman `/api/stt?format=webm`.
4. UI sends transcript to `/robot/api/chat`.
5. Proxy sends MetaHuman `/api/persona_chat` with `stream: false`.
6. UI displays response text.
7. If TTS is enabled, UI asks `/robot/api/tts` for WAV audio and plays it through Web Audio.
8. Listening pauses during processing and playback, then resumes after cooldown.

## Future Motion

Motion must be backend-owned. The future shape is:

```text
UI/gamepad input
  -> robot backend motion API
  -> RobotMotionService
  -> null/sim adapter first
  -> serial microcontroller or ROS2 adapter later
  -> motor controller
```

The future motion API must require leases, short TTL commands, speed limits, stale-command stop behavior, and a physical emergency stop. Browser code and LLM output must never directly control motors.
