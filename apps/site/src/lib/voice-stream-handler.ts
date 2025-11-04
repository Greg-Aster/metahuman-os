/**
 * Voice Stream Handler
 * Manages real-time voice conversations over WebSocket
 */

import type { WebSocket } from './websocket.js';
import { transcribeAudio, generateSpeech, saveVoiceSample } from '@metahuman/core';
import { audit } from '@metahuman/core';

interface VoiceMessage {
  type: 'transcript' | 'audio' | 'error' | 'ready';
  data?: any;
}

/**
 * Handle voice stream WebSocket connection
 */
export async function handleVoiceStream(ws: WebSocket): Promise<void> {
  let audioChunks: Buffer[] = [];
  let isProcessing = false;
  let firstChunkAt: number | null = null;
  let lastChunkAt: number | null = null;

  audit({
    level: 'info',
    category: 'action',
    event: 'voice_stream_connected',
    details: {},
    actor: 'system',
  });

  // Send ready signal
  sendMessage(ws, { type: 'ready' });

  // Handle incoming messages
  ws.onmessage = async (data, isBinary) => {
    try {
      if (isBinary) {
        // Audio chunk received
        audioChunks.push(data as Buffer);
        const now = Date.now();
        if (firstChunkAt == null) firstChunkAt = now;
        lastChunkAt = now;
      } else {
        // Text message (control signals)
        const message = JSON.parse(data.toString());

        if (message.type === 'start_recording') {
          firstChunkAt = typeof message.t === 'number' ? message.t : Date.now();
        } else if (message.type === 'stop_recording') {
          lastChunkAt = Date.now();
          // User stopped recording, process accumulated audio
          if (audioChunks.length > 0 && !isProcessing) {
            isProcessing = true;
            const durationSec = firstChunkAt && lastChunkAt ? Math.max(0.1, (lastChunkAt - firstChunkAt) / 1000) : undefined;
            await processAudioChunks(ws, audioChunks, durationSec);
            audioChunks = [];
            firstChunkAt = null;
            lastChunkAt = null;
            isProcessing = false;
          }
        } else if (message.type === 'clear') {
          // Clear accumulated chunks
          audioChunks = [];
          isProcessing = false;
        }
      }
    } catch (error) {
      console.error('[voice-stream] Error handling message:', error);
      sendMessage(ws, {
        type: 'error',
        data: { message: (error as Error).message },
      });
    }
  };

  ws.onclose = () => {
    audit({
      level: 'info',
      category: 'action',
      event: 'voice_stream_disconnected',
      details: { chunksBuffered: audioChunks.length },
      actor: 'system',
    });
  };

  ws.onerror = (error) => {
    audit({
      level: 'error',
      category: 'action',
      event: 'voice_stream_error',
      details: { error: error.message },
      actor: 'system',
    });
  };
}

/**
 * Process accumulated audio chunks
 */
async function processAudioChunks(ws: WebSocket, chunks: Buffer[], measuredDuration?: number): Promise<void> {
  try {
    // Combine all chunks into single buffer
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length < 1000) {
      // Too short, likely just noise
      return;
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'voice_processing_started',
      details: { chunks: chunks.length, totalBytes: audioBuffer.length },
      actor: 'system',
    });

    // Step 1: Transcribe audio to text
    const startTime = Date.now();
    const transcript = await transcribeAudio(audioBuffer, 'webm');
    const transcriptionTime = Date.now() - startTime;

    if (!transcript || transcript.trim().length === 0) {
      // No speech detected
      sendMessage(ws, {
        type: 'transcript',
        data: { text: '', noSpeech: true },
      });
      return;
    }

    // Send transcript to client
    sendMessage(ws, {
      type: 'transcript',
      data: { text: transcript },
    });

    // Step 1.5: Save voice sample for training (passive collection)
    // Prefer measured wall-clock duration between first and last chunk; fallback to bitrate heuristic (~24kbps)
    const fallbackKbps = 24;
    const estimatedDuration = measuredDuration ?? Math.max(0.1, (audioBuffer.length * 8) / (fallbackKbps * 1024));
    // Quality score based on transcription success and audio size
    const quality = Math.min(1.0, (audioBuffer.length / 50000) * 0.5 + (transcriptionTime < 5000 ? 0.5 : 0.3));

    saveVoiceSample(audioBuffer, transcript, estimatedDuration, quality, 'webm');

    // Step 2: Get LLM response (using persona_chat logic)
    const response = await getPersonaResponse(transcript);

    // Step 3: Generate TTS audio
    const audioResponse = await generateSpeech(response);

    // Step 4: Send audio back to client (as base64)
    sendMessage(ws, {
      type: 'audio',
      data: {
        text: response,
        audio: audioResponse.toString('base64'),
      },
    });

    audit({
      level: 'info',
      category: 'action',
      event: 'voice_response_completed',
      details: {
        transcriptLength: transcript.length,
        responseLength: response.length,
        audioSize: audioResponse.length,
      },
      actor: 'system',
    });
  } catch (error) {
    console.error('[voice-stream] Processing error:', error);
    sendMessage(ws, {
      type: 'error',
      data: { message: (error as Error).message },
    });

    audit({
      level: 'error',
      category: 'action',
      event: 'voice_processing_failed',
      details: { error: (error as Error).message },
      actor: 'system',
    });
  }
}

/**
 * Get persona response from LLM
 * (Reuses existing persona_chat logic)
 */
async function getPersonaResponse(userMessage: string): Promise<string> {
  // Import persona chat logic
  const { default: fetch } = await import('node-fetch');

  try {
    // Call the existing persona_chat API endpoint
    const response = await fetch('http://localhost:4321/api/persona_chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMessage,
        mode: 'conversation',
      }),
    });

    if (!response.ok) {
      throw new Error(`Persona chat failed: ${response.statusText}`);
    }

    // The API streams Server-Sent Events (SSE) with lines like:
    //   data: {"type":"answer","data":{ "response": "..." }}\n\n
    const contentType = response.headers.get('content-type') || '';

    // If it's JSON (fallback), return directly; otherwise parse SSE
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return (data && (data.response || data.message)) || "I'm not sure how to respond to that.";
    }

    // Parse SSE stream and resolve on the first 'answer' event
    const body = response.body as unknown as AsyncIterable<Buffer>;
    let buffer = '';
    for await (const chunk of body) {
      buffer += chunk.toString('utf8');
      // Events are separated by double newlines per SSE spec
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        // Extract the data: line; ignore comments and other fields
        const lines = rawEvent.split(/\r?\n/);
        const dataLines = lines
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const payloadRaw = dataLines.join('\n');
        try {
          const payload = JSON.parse(payloadRaw);
          const type = String(payload?.type || '');
          if (type === 'answer') {
            const resp = payload?.data?.response || payload?.response;
            if (resp && typeof resp === 'string') return resp;
            // If answer arrives without response text, fall through
          }
          // Ignore other event types like 'reasoning', 'error' etc.
        } catch {
          // Ignore malformed chunks and continue
        }
      }
    }

    // If stream ended without an answer, return a friendly fallback
    return "I'm not sure how to respond to that.";
  } catch (error) {
    console.error('[voice-stream] Persona response error:', error);
    return "I'm having trouble thinking right now. Can you try again?";
  }
}

/**
 * Send JSON message over WebSocket
 */
function sendMessage(ws: WebSocket, message: VoiceMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}
