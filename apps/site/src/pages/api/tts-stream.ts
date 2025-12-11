import type { APIRoute } from 'astro';
import { getUserOrAnonymous, getProfilePaths } from '@metahuman/core';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/tts-stream
 * Stream TTS audio chunk by chunk using Server-Sent Events
 *
 * This endpoint supports real-time streaming for providers that support it (Kokoro).
 * For providers that don't support streaming (RVC, Piper), uses sentence-level chunking
 * with lookahead prefetching for minimal latency.
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
 * Smart sentence splitter that handles:
 * - Standard sentence endings (.!?)
 * - Abbreviations (Dr., Mr., Mrs., etc.)
 * - Numbers with decimals (3.14)
 * - Ellipsis (...)
 * - Quoted sentences
 */
function splitIntoSentences(text: string): string[] {
  // Common abbreviations that shouldn't end sentences
  const abbreviations = new Set([
    'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc', 'ltd',
    'corp', 'st', 'ave', 'blvd', 'rd', 'apt', 'no', 'vol', 'rev', 'gen',
    'col', 'lt', 'sgt', 'capt', 'cmdr', 'adm', 'pvt', 'cpl', 'maj',
    'e.g', 'i.e', 'cf', 'al', 'fig', 'approx', 'dept', 'est', 'min', 'max'
  ]);

  const sentences: string[] = [];
  let current = '';

  // Split by potential sentence boundaries
  const parts = text.split(/([.!?]+["']?\s+)/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (i % 2 === 0) {
      // Content part
      current += part;
    } else {
      // Delimiter part (punctuation + space)
      current += part;

      // Check if previous word is an abbreviation
      const words = current.trim().split(/\s+/);
      const lastWord = words[words.length - 1]?.replace(/[.!?,"']+$/, '').toLowerCase() || '';

      // Don't split on abbreviations or single letters (initials)
      if (!abbreviations.has(lastWord) && lastWord.length > 1) {
        const trimmed = current.trim();
        if (trimmed) {
          sentences.push(trimmed);
        }
        current = '';
      }
    }
  }

  // Add remaining text
  const remaining = current.trim();
  if (remaining) {
    sentences.push(remaining);
  }

  // Filter out empty sentences and merge very short ones
  const merged: string[] = [];
  for (const sentence of sentences) {
    // Merge very short sentences (< 10 chars) with previous
    if (sentence.length < 10 && merged.length > 0) {
      merged[merged.length - 1] += ' ' + sentence;
    } else if (sentence.length > 0) {
      merged.push(sentence);
    }
  }

  return merged;
}
export const POST: APIRoute = async ({ request, cookies }) => {
  const user = getUserOrAnonymous(cookies);

  try {
    const { text, provider, voice, speed, pitchShift, langCode } = await request.json();

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
        voice: voice || 'af_heart',
        speed: speed || 1.0,
        langCode: langCode || 'a',
        customVoicepack: null,
        normalize: false,
      };

      // Check if this is a guest with selected profile (anonymous but using guest profile)
      const isGuestWithProfile = user.role === 'anonymous' && user.id === 'guest';

      // Load user voice config to get custom voicepack path
      // Allow both authenticated users AND guests with profile
      if (user.role !== 'anonymous' || isGuestWithProfile) {
        const profilePaths = getProfilePaths(user.username);
        const voiceConfigPath = profilePaths.voiceConfig;

        if (fs.existsSync(voiceConfigPath)) {
          try {
            const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
            if (voiceConfig.tts?.kokoro) {
              const kConfig = voiceConfig.tts.kokoro;
              kokoroConfig.voice = voice || kConfig.voice || 'af_heart';
              kokoroConfig.speed = speed || kConfig.speed || 1.0;
              kokoroConfig.langCode = langCode || kConfig.langCode || 'a';
              if (kConfig.useCustomVoicepack && kConfig.customVoicepackPath) {
                kokoroConfig.customVoicepack = kConfig.customVoicepackPath;
                kokoroConfig.normalize = kConfig.normalizeCustomVoicepacks ?? true;
              }
            }
          } catch (e) {
            console.warn('[TTS Stream] Failed to load user voice config:', e);
          }
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

    // For RVC/Piper: Implement sentence-level chunking with lookahead prefetching
    // Use smart sentence splitter
    const sentences = splitIntoSentences(text);

    if (sentences.length === 0) {
      return new Response(JSON.stringify({ error: 'No sentences to process' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TTS Stream] ${selectedProvider.toUpperCase()} streaming: ${sentences.length} sentences`);

    // Load RVC-specific config if applicable
    let rvcConfig: { pitchShift?: number; voice?: string; speed?: number } = {
      pitchShift: pitchShift,
      voice: voice,
      speed: speed,
    };

    // Also check for guest with profile for RVC
    const isGuestForRvc = user.role === 'anonymous' && user.id === 'guest';
    if (selectedProvider === 'rvc' && (user.role !== 'anonymous' || isGuestForRvc)) {
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

        // Prefetch queue: generate next sentence while current plays
        // Higher lookahead for slow providers (RVC takes 500ms-2s per sentence)
        const LOOKAHEAD = 3; // Number of sentences to prefetch ahead
        const pendingGenerations: Map<number, Promise<Buffer>> = new Map();

        // Start prefetching first sentences
        const startPrefetch = (index: number) => {
          if (index >= sentences.length) return;
          if (pendingGenerations.has(index)) return;

          const sentence = sentences[index];
          console.log(`[TTS Stream] Prefetching sentence ${index + 1}/${sentences.length}: ${sentence.slice(0, 30)}...`);

          const promise = generateSpeech(sentence, {
            provider: selectedProvider as 'piper' | 'rvc',
            voice: rvcConfig.voice,
            speakingRate: rvcConfig.speed,
            pitchShift: rvcConfig.pitchShift,
            username: (user.role !== 'anonymous' || isGuestForRvc) ? user.username : undefined,
            signal: request.signal,
          });

          pendingGenerations.set(index, promise);
        };

        try {
          // Start initial prefetch batch
          for (let i = 0; i < Math.min(LOOKAHEAD + 1, sentences.length); i++) {
            startPrefetch(i);
          }

          // Process sentences in order, streaming as they complete
          for (let i = 0; i < sentences.length; i++) {
            // Ensure this sentence is being generated
            startPrefetch(i);

            // Start prefetching next sentences
            for (let j = i + 1; j <= i + LOOKAHEAD && j < sentences.length; j++) {
              startPrefetch(j);
            }

            // Wait for current sentence
            const audioBuffer = await pendingGenerations.get(i);
            pendingGenerations.delete(i);

            if (!audioBuffer) {
              console.warn(`[TTS Stream] No audio for sentence ${i}`);
              continue;
            }

            console.log(`[TTS Stream] Streaming sentence ${i + 1}/${sentences.length}: ${audioBuffer.length} bytes`);

            // Encode audio as base64
            const audioBase64 = audioBuffer.toString('base64');

            // Send SSE event
            const eventData = JSON.stringify({
              chunk_index: i,
              sentence_index: i,
              total_sentences: sentences.length,
              audio_base64: audioBase64,
              audio_size: audioBuffer.length,
              is_final: i === sentences.length - 1,
            });

            controller.enqueue(encoder.encode(`data: ${eventData}\n\n`));
          }

          // Send completion event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: 'complete', total_chunks: sentences.length })}\n\n`));
          controller.close();
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            console.log('[TTS Stream] Request aborted');
            controller.close();
            return;
          }
          console.error('[TTS Stream] Error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: 'error', error: (error as Error).message })}\n\n`));
          controller.close();
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
