# Voice Conversations Roadmap

This document outlines the plan for implementing a real-time voice conversation feature in the MetaHuman OS web UI.

## 1. Overview

The goal is to enable a user to have a live, spoken conversation with their digital personality extension. This will be achieved by creating a real-time, bidirectional audio pipeline that integrates microphone input, streaming transcription, LLM response generation, and text-to-speech (TTS) playback.

## 2. Architecture

The feature will be built on the following components:

*   **Frontend (Svelte Component):** A new UI component that handles microphone access, audio capture, and playback.
*   **WebSocket Server:** A new server-side component to manage the real-time communication between the frontend and the backend.
*   **Real-time Transcription Service:** A backend service that uses `whisper` to transcribe the incoming audio stream.
*   **Text-to-Speech (TTS) Service:** A backend service that converts the LLM's text responses into audio.

```
[Frontend: Svelte Component] <--> [WebSocket] <--> [Backend: Real-time Transcription] --> [LLM] --> [Backend: TTS] --> [WebSocket] --> [Frontend: Audio Playback]
```

## 3. Implementation Plan

### Phase 1: Backend Foundation

#### 1.1. WebSocket Server

*   **Task:** Add a WebSocket server to the `apps/site` web server.
*   **Technology:** Use a library like `ws` or `socket.io`.
*   **Functionality:**
    *   Handle WebSocket connections from the frontend.
    *   Receive the incoming audio stream and forward it to the transcription service.
    *   Receive the generated audio response from the TTS service and forward it to the frontend.

#### 1.2. Real-time Transcription Service

*   **Task:** Create a new backend service for real-time transcription.
*   **Technology:** This will be a TypeScript module that spawns and manages a `whisper` process.
*   **Functionality:**
    *   Accept an audio stream from the WebSocket server.
    *   Pipe the audio stream to the `whisper` executable in streaming mode.
    *   Parse the real-time output from `whisper`.
    *   Send the transcribed text back to the frontend via the WebSocket for live display.
    *   When a full sentence or phrase is detected, send the complete text to the LLM for a response.

#### 1.3. Text-to-Speech (TTS) Service

*   **Task:** Create a new backend service for text-to-speech.
*   **Technology:** This service will use a local TTS engine like `piper` or `mimic3`.
*   **Functionality:**
    *   Expose a new API endpoint, `POST /api/tts`.
    *   This endpoint will accept a text string.
    *   It will call the TTS engine to generate an audio file (e.g., in MP3 or WAV format).
    *   It will then stream the audio file back to the caller (in this case, the WebSocket server, which will then forward it to the frontend).

### Phase 2: Frontend Integration

#### 2.1. Voice Interaction Component

*   **Task:** Create a new Svelte component, `VoiceInteraction.svelte`.
*   **Functionality:**
    *   **Microphone Access:** Request microphone permissions from the user.
    *   **UI State:** Provide clear visual feedback for different states (e.g., "listening", "thinking", "speaking").
    *   **Audio Capture:** Use the `MediaRecorder` API to capture audio from the microphone.
    *   **WebSocket Connection:** Establish and manage the WebSocket connection to the backend.
    *   **Audio Streaming:** Send the captured audio data to the backend through the WebSocket.

#### 2.2. Live Transcript and Audio Playback

*   **Task:** Enhance the `VoiceInteraction.svelte` component.
*   **Functionality:**
    *   **Live Transcript:** Listen for transcription messages from the WebSocket and display the incoming text in real-time.
    *   **Audio Playback:** Listen for audio stream messages from the WebSocket and play the AI's spoken response using the browser's `Audio` API.
    *   **Turn Management:** Handle the transition between user speaking, AI thinking, and AI speaking.

## 4. Development Workflow

1.  Implement the backend services first (WebSocket, Transcription, TTS).
2.  Create the basic frontend component for capturing and streaming audio.
3.  Integrate the real-time transcription display.
4.  Integrate the LLM response generation.
5.  Integrate the TTS audio playback.

## 5. Future Enhancements

*   **"Wake Word" Detection:** Allow the user to start a conversation by saying a specific word or phrase (e.g., "Hey, MetaHuman").
*   **Barge-in:** Allow the user to interrupt the AI while it's speaking.
*   **Sound Effects:** Add subtle sound effects to indicate different states (e.g., a soft chime when the AI starts listening).
