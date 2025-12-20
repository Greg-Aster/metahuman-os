import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthRequiredError, getProfilePaths } from '@metahuman/core';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/tts-stream
 * Stream TTS audio chunk by chunk using Server-Sent Events
 *
 * This endpoint supports real-time streaming for providers that support it (Kokoro).
 * For providers that don't support streaming (RVC, Piper), uses paragraph-level chunking
 * (~400-800 chars) with lookahead prefetching for smooth, continuous playback.
 *
 * Body: {
 *   text: string,
 *   provider?: 'piper' | 'kokoro' | 'rvc',
 *   voice?: string,
 *   speed?: number,
 *   pitchShift?: number,    // RVC pitch shift (-12 to +12)
 *   langCode?: string
 * }
 *
 * Returns: Server-Sent Events stream with audio chunks
 */

/**
 * Smart paragraph splitter for streaming TTS.
 * Creates ~400-800 character chunks that:
 * - Respect natural paragraph boundaries (double newlines)
 * - Split long paragraphs at sentence boundaries
 * - FALLBACK: If no paragraph breaks, chunk by character count (400-800 chars)
 *
 * Using paragraph-level chunks eliminates awkward mid-thought pauses.
 * Natural paragraph breaks feel intentional rather than stuttery.
 */
function splitIntoParagraphs(text: string): string[] {
  const MIN_PARAGRAPH_LENGTH = 400;
  const MAX_PARAGRAPH_LENGTH = 800;

  // First, split by explicit paragraph breaks (double newlines)
  const rawParagraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  const paragraphs: string[] = [];

  for (const para of rawParagraphs) {
    if (para.length <= MAX_PARAGRAPH_LENGTH) {
      // Paragraph is good size, use as-is
      paragraphs.push(para);
    } else {
      // Long paragraph - split at sentence boundaries
      const sentences = para.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
      let currentChunk: string[] = [];
      let currentLength = 0;

      for (const sentence of sentences) {
        // If adding this sentence would exceed max, finalize current chunk
        if (currentLength + sentence.length > MAX_PARAGRAPH_LENGTH && currentChunk.length > 0) {
          paragraphs.push(currentChunk.join(' '));
          currentChunk = [];
          currentLength = 0;
        }

        currentChunk.push(sentence);
        currentLength += sentence.length + 1; // +1 for space

        // If chunk is good size, finalize it
        if (currentLength >= MIN_PARAGRAPH_LENGTH) {
          paragraphs.push(currentChunk.join(' '));
          currentChunk = [];
          currentLength = 0;
        }
      }

      // Don't forget remaining sentences
      if (currentChunk.length > 0) {
        paragraphs.push(currentChunk.join(' '));
      }
    }
  }

  // FALLBACK: If no paragraph breaks found, chunk entire text by character count
  if (paragraphs.length === 0 && text.trim()) {
    const sentences = text.trim().split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const sentence of sentences) {
      if (currentLength + sentence.length > MAX_PARAGRAPH_LENGTH && currentChunk.length > 0) {
        paragraphs.push(currentChunk.join(' '));
        currentChunk = [];
        currentLength = 0;
      }

      currentChunk.push(sentence);
      currentLength += sentence.length + 1;

      if (currentLength >= MIN_PARAGRAPH_LENGTH) {
        paragraphs.push(currentChunk.join(' '));
        currentChunk = [];
        currentLength = 0;
      }
    }

    if (currentChunk.length > 0) {
      paragraphs.push(currentChunk.join(' '));
    }
  }

  return paragraphs;
}
export const POST: APIRoute = async ({ request, cookies }) => {
  // Authenticate user - returns 401 if not authenticated
  let user;
  try {
    user = getAuthenticatedUser(cookies);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(JSON.stringify({ error: 'Authentication required', redirect: '/auth' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw error;
  }

  try {
    const { text, provider, voice, voiceId, speed, pitchShift, langCode } = await request.json();

    console.log('[TTS Stream] Request params:', { provider, voice, voiceId, speed, langCode });

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Determine provider (default to kokoro for streaming, as it has native support)
    const selectedProvider = provider || 'kokoro';

    // For Kokoro, proxy to the streaming endpoint
    if (selectedProvider === 'kokoro') {
      // Get user-specific voice config if available
      let kokoroConfig: any = {
        voice: voiceId || voice || 'af_heart',
        speed: speed || 1.0,
        langCode: langCode || 'a',
        customVoicepack: null,
        normalize: false,
      };

      // All users are authenticated - load voice config
      const profilePaths = getProfilePaths(user.username);
      const voiceConfigPath = profilePaths.voiceConfig;

        if (fs.existsSync(voiceConfigPath)) {
          try {
            const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
            if (voiceConfig.tts?.kokoro) {
              const kConfig = voiceConfig.tts.kokoro;
              console.log('[TTS Stream] Saved kConfig.voice:', kConfig.voice, 'useCustomVoicepack:', kConfig.useCustomVoicepack);
              kokoroConfig.voice = voiceId || voice || kConfig.voice || 'af_heart';
              kokoroConfig.speed = speed || kConfig.speed || 1.0;
              kokoroConfig.langCode = langCode || kConfig.langCode || 'a';

              // Check if a built-in voice was explicitly requested via voiceId/voice params
              // Built-in voices follow pattern: af_*, am_*, bf_*, bm_*, etc.
              const requestedVoice = voiceId || voice;
              const isBuiltInVoiceRequested = requestedVoice && /^[a-z]{2}_[a-z]+$/.test(requestedVoice);

              // Only use custom voicepack if NOT explicitly requesting a built-in voice
              if (kConfig.useCustomVoicepack && kConfig.customVoicepackPath && !isBuiltInVoiceRequested) {
                kokoroConfig.customVoicepack = kConfig.customVoicepackPath;
                kokoroConfig.normalize = kConfig.normalizeCustomVoicepacks ?? true;
              }
              console.log('[TTS Stream] Final kokoroConfig.voice:', kokoroConfig.voice, 'customVoicepack:', kokoroConfig.customVoicepack, 'isBuiltInVoiceRequested:', isBuiltInVoiceRequested);
            }
          } catch (e) {
            console.warn('[TTS Stream] Failed to load user voice config:', e);
          }
        }

      // Proxy to Kokoro server streaming endpoint
      const kokoroServerUrl = process.env.KOKORO_SERVER_URL || 'http://127.0.0.1:9882';

      const kokoroResponse = await fetch(`${kokoroServerUrl}/synthesize-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          lang_code: kokoroConfig.langCode,
          voice: kokoroConfig.voice,
          speed: kokoroConfig.speed,
          custom_voicepack: kokoroConfig.customVoicepack,
          normalize: kokoroConfig.normalize,
        }),
        signal: request.signal,
      });

      if (!kokoroResponse.ok) {
        const errorText = await kokoroResponse.text();
        console.error('[TTS Stream] Kokoro server error:', errorText);
        return new Response(JSON.stringify({ error: `Kokoro server error: ${errorText}` }), {
          status: kokoroResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Forward the SSE stream directly
      return new Response(kokoroResponse.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // For RVC/Piper: Implement paragraph-level chunking with lookahead prefetching
    // Using paragraphs (~400-800 chars) instead of sentences for smoother streaming
    const paragraphs = splitIntoParagraphs(text);

    if (paragraphs.length === 0) {
      return new Response(JSON.stringify({ error: 'No content to process' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TTS Stream] ${selectedProvider.toUpperCase()} streaming: ${paragraphs.length} paragraphs`);

    // Load RVC-specific config if applicable
    let rvcConfig: { pitchShift?: number; voice?: string; speed?: number } = {
      pitchShift: pitchShift,
      voice: voice,
      speed: speed,
    };

    // Load RVC config for authenticated user
    if (selectedProvider === 'rvc') {
      const profilePaths = getProfilePaths(user.username);
      const voiceConfigPath = profilePaths.voiceConfig;

      if (fs.existsSync(voiceConfigPath)) {
        try {
          const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
          if (voiceConfig.tts?.rvc) {
            const rConfig = voiceConfig.tts.rvc;
            rvcConfig.pitchShift = pitchShift ?? rConfig.pitchShift ?? 0;
            rvcConfig.voice = voice || rConfig.speakerId;
            rvcConfig.speed = speed ?? rConfig.speed ?? 1.0;
            console.log(`[TTS Stream] Loaded RVC config: pitch=${rvcConfig.pitchShift}, voice=${rvcConfig.voice}`);
          }
        } catch (e) {
          console.warn('[TTS Stream] Failed to load RVC user config:', e);
        }
      }
    }

    // Create a readable stream for SSE with lookahead prefetching
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const { generateSpeech } = await import('@metahuman/core');

        // Track controller state to prevent "already closed" errors
        let isClosed = false;
        const safeEnqueue = (data: Uint8Array) => {
          if (!isClosed) {
            try {
              controller.enqueue(data);
            } catch (e) {
              console.warn('[TTS Stream] Failed to enqueue (controller closed)');
              isClosed = true;
            }
          }
        };
        const safeClose = () => {
          if (!isClosed) {
            isClosed = true;
            try {
              controller.close();
            } catch (e) {
              // Already closed
            }
          }
        };

        // Prefetch queue: generate next paragraph while current plays
        // For RVC on CPU, reduce lookahead to avoid overwhelming the server
        // RVC server processes ONE request at a time, so parallel calls just queue up
        const LOOKAHEAD = 1; // Reduced from 3 - RVC is sequential, not parallel
        const pendingGenerations: Map<number, Promise<Buffer>> = new Map();

        // Start prefetching first paragraphs
        const startPrefetch = (index: number) => {
          if (index >= paragraphs.length) return;
          if (pendingGenerations.has(index)) return;
          if (isClosed) return; // Don't start new work if stream is closed

          const paragraph = paragraphs[index];
          console.log(`[TTS Stream] Prefetching paragraph ${index + 1}/${paragraphs.length} (${paragraph.length} chars)`);

          const promise = generateSpeech(paragraph, {
            provider: selectedProvider as 'piper' | 'rvc',
            voice: rvcConfig.voice,
            speakingRate: rvcConfig.speed,
            pitchShift: rvcConfig.pitchShift,
            username: user.username,
            signal: request.signal,
          }).catch(err => {
            // Log but don't throw - return empty buffer so stream can continue
            console.warn(`[TTS Stream] Failed to generate paragraph ${index}:`, err.message);
            return Buffer.alloc(0);
          });

          pendingGenerations.set(index, promise);
        };

        try {
          // Start initial prefetch batch
          for (let i = 0; i < Math.min(LOOKAHEAD + 1, paragraphs.length); i++) {
            startPrefetch(i);
          }

          // Process paragraphs in order, streaming as they complete
          for (let i = 0; i < paragraphs.length; i++) {
            if (isClosed) break; // Stop processing if stream is closed

            // Ensure this paragraph is being generated
            startPrefetch(i);

            // Start prefetching next paragraphs
            for (let j = i + 1; j <= i + LOOKAHEAD && j < paragraphs.length; j++) {
              startPrefetch(j);
            }

            // Wait for current paragraph
            const audioBuffer = await pendingGenerations.get(i);
            pendingGenerations.delete(i);

            if (!audioBuffer || audioBuffer.length === 0) {
              console.warn(`[TTS Stream] No audio for paragraph ${i}`);
              continue;
            }

            console.log(`[TTS Stream] Streaming paragraph ${i + 1}/${paragraphs.length}: ${audioBuffer.length} bytes`);

            // Encode audio as base64
            const audioBase64 = audioBuffer.toString('base64');

            // Send SSE event
            const eventData = JSON.stringify({
              chunk_index: i,
              sentence_index: i,
              total_sentences: paragraphs.length,
              audio_base64: audioBase64,
              audio_size: audioBuffer.length,
              is_final: i === paragraphs.length - 1,
            });

            safeEnqueue(encoder.encode(`data: ${eventData}\n\n`));
          }

          // Send completion event
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ event: 'complete', total_chunks: paragraphs.length })}\n\n`));
          safeClose();
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            console.log('[TTS Stream] Request aborted');
            safeClose();
            return;
          }
          console.error('[TTS Stream] Error:', error);
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ event: 'error', error: (error as Error).message })}\n\n`));
          safeClose();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return new Response(null, { status: 499, statusText: 'Client Closed Request' });
    }
    console.error('[TTS Stream API] Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
