# Voice Features Summary

This document summarizes the voice communication features implemented across the app (desktop server and mobile web UI), recent fixes, and how the system behaves in common scenarios.

## Overview
- Transport: WebSocket endpoint at `/voice-stream` managed by an Astro integration (`apps/site/src/integrations/voice-websocket.ts`).
- Server Handler: `apps/site/src/lib/voice-stream-handler.ts`
  - Receives Opus/WebM audio chunks from the client.
  - Transcribes speech to text (STT).
  - Calls the chat API (`/api/persona_chat`) and parses SSE to get the final answer.
  - Generates TTS audio (Piper) and streams it back to the client as base64 WAV.
- STT (Speech-to-Text): `packages/core/src/stt.ts`, `packages/core/src/transcription.ts`
  - Priority: Python faster‑whisper in `venv/` → whisper.cpp (local) → mock (placeholder).
  - Configured via `etc/voice.json`.
- TTS (Text-to-Speech): `packages/core/src/tts.ts`
  - Provider: Piper (local) with model paths configured in `etc/voice.json`.
  - CLI/UI use `/api/tts` to fetch WAV audio.
- Chat API (SSE): `apps/site/src/pages/api/persona_chat.ts`
  - Streams reasoning and answer events (SSE) to clients.

## Recent Fixes & Improvements
- SSE Parsing Fix (server voice stream):
  - `getPersonaResponse()` in `voice-stream-handler.ts` now parses SSE from `/api/persona_chat` and extracts the `answer` event (replaces prior `response.json()` which failed on SSE).
- Mobile Layout & Usability:
  - Dynamic viewport height (`100dvh` + JS fallback) prevents input from being cut off by mobile URL bars.
  - Safe-area padding for the input container (`env(safe-area-inset-bottom)`) keeps the footer above the home indicator.
  - Compact controls on mobile: hide mic button and focus dropdown; replace verbose “Use Operator” checkbox with a glowing icon toggle.
- Secure Context Guard for Mic:
  - Microphone access now shows a friendly error if not on HTTPS or localhost instead of throwing.
- TTS Behavior on Mobile:
  - Final behavior: device SpeechSynthesis disabled; all chat TTS uses server-side Piper via `/api/tts` for consistent voice across devices.
  - Added a small “audio unlock” (silent WebAudio warm-up) to satisfy autoplay policies on mobile before playing Piper audio.

## Configuration
- File: `etc/voice.json`
  - `tts.piper` paths for `binary`, `model`, `config`.
  - `cache.directory` for TTS caching and `out/voice-cache` usage.
  - `stt.whisper` model/device settings and provider priority.
  - `training` options for passive voice sample collection (saved under `out/voice-training`).

## Client Components
- `apps/site/src/components/VoiceInteraction.svelte` (standalone voice UI)
  - Handles mic permission, VAD (voice activity detection), WebSocket streaming, and audio playback.
  - Gracefully errors when mic is unavailable (non-secure origins).
- `apps/site/src/components/ChatInterface.svelte` (main chat UI)
  - Streams SSE answers; when speech is enabled, fetches `/api/tts` and plays Piper audio.
  - Audio unlock on first touch/focus/send for reliable playback.

## How To Use
- Desktop:
  - Start Ollama, then run the UI: `cd apps/site && pnpm dev`.
  - Enable the speech icon in Chat to hear replies via Piper.
- Mobile (same LAN):
  - Open the dev server URL in the mobile browser.
  - Toggle the speech icon on; replies play using Piper audio from the desktop.
  - Note: Microphone streaming requires HTTPS/localhost (browser rule). Use a dev certificate or a tunnel if you need on-phone mic capture.

## Validation Steps
- Chat TTS: Send a message in Chat with the speech icon enabled; confirm audio plays.
- Voice Mode (optional): On a secure origin, start a voice session; speak; confirm transcript and spoken reply.
- Layout: On mobile, rotate portrait/landscape; the input should remain visible and usable.

## Future Enhancements (Optional)
- HTTPS dev server out of the box (mkcert) to enable phone mic capture over LAN.
- Streaming audio playback (MediaSource) so Piper audio can start before the full WAV is generated.
- UI setting to switch between device voice and Piper, if desired.

