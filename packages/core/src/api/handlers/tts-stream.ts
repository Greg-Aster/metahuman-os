import fs from 'node:fs';
import type { UnifiedHandler } from '../types.js';
import { badRequestResponse, errorResponse, streamResponse } from '../types.js';
import { getProfilePaths } from '../../path-builder.js';
import { createKokoroTTSService, generateSpeech } from '../../tts.js';
import { splitSpeechText } from '../../tts/speech-chunks.js';
import type { KokoroStreamChunk } from '../../tts/providers/kokoro-service.js';

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const handleTtsStream: UnifiedHandler = async (req) => {
  try {
    const {
      text,
      provider,
      voice,
      voiceId,
      speed,
      pitchShift,
      langCode,
      requestId,
    } = req.body ?? {};

    console.log('[TTS Stream] Request params:', { provider, voice, voiceId, speed, langCode });

    if (!text || typeof text !== 'string') {
      return badRequestResponse('Text is required');
    }

    const selectedProvider = provider || 'kokoro';
    if (selectedProvider === 'kokoro') {
      return handleKokoroTtsStream(req.user.username, req.signal, {
        text,
        voice,
        voiceId,
        speed,
        langCode,
        requestId,
      });
    }

    const paragraphs = splitSpeechText(text);
    if (paragraphs.length === 0) {
      return badRequestResponse('No content to process');
    }

    const response = streamResponse(streamGeneratedSpeech({
      paragraphs,
      selectedProvider,
      username: req.user.username,
      signal: req.signal,
      voice,
      speed,
      pitchShift,
    }));

    return {
      ...response,
      headers: {
        ...response.headers,
        'X-Accel-Buffering': 'no',
      },
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return { status: 499, data: null };
    }
    console.error('[TTS Stream API] Error:', error);
    return errorResponse((error as Error).message, 500);
  }
};

async function handleKokoroTtsStream(
  username: string,
  signal: AbortSignal | undefined,
  params: {
    text: string;
    voice?: string;
    voiceId?: string;
    speed?: number;
    langCode?: string;
    requestId?: string;
  },
) {
  const service = createKokoroTTSService(username);
  const response = streamResponse(streamKokoroSpeech(service.synthesizeStream(params.text, {
    signal,
    voice: params.voiceId || params.voice,
    speakingRate: params.speed,
    langCode: params.langCode,
    requestId: params.requestId,
  })));
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Accel-Buffering': 'no',
    },
  };
}

async function* streamKokoroSpeech(
  chunks: AsyncIterable<KokoroStreamChunk>,
): AsyncGenerator<string> {
  let totalChunks = 0;
  try {
    for await (const chunk of chunks) {
      totalChunks = chunk.total;
      yield sse({
        chunk_index: chunk.index,
        sentence_index: chunk.index,
        total_sentences: chunk.total,
        audio_base64: chunk.audio.toString('base64'),
        audio_size: chunk.audio.length,
        is_final: chunk.isFinal,
        synthesis_ms: chunk.synthesisMs,
        cache_hit: chunk.cacheHit,
      });
    }
    yield sse({ event: 'complete', total_chunks: totalChunks });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    console.error('[TTS Stream] Kokoro synthesis failed:', error);
    yield sse({ event: 'error', error: (error as Error).message });
  }
}

async function* streamGeneratedSpeech(params: {
  paragraphs: string[];
  selectedProvider: string;
  username: string;
  signal: AbortSignal | undefined;
  voice?: string;
  speed?: number;
  pitchShift?: number;
}): AsyncGenerator<string> {
  const rvcConfig: { pitchShift?: number; voice?: string; speed?: number } = {
    pitchShift: params.pitchShift,
    voice: params.voice,
    speed: params.speed,
  };

  console.log(`[TTS Stream] ${params.selectedProvider.toUpperCase()} streaming: ${params.paragraphs.length} paragraphs`);

  if (params.selectedProvider === 'rvc') {
    const profilePaths = getProfilePaths(params.username);
    if (fs.existsSync(profilePaths.voiceConfig)) {
      try {
        const voiceConfig = JSON.parse(fs.readFileSync(profilePaths.voiceConfig, 'utf-8'));
        if (voiceConfig.tts?.rvc) {
          const rConfig = voiceConfig.tts.rvc;
          rvcConfig.pitchShift = params.pitchShift ?? rConfig.pitchShift ?? 0;
          rvcConfig.voice = params.voice || rConfig.speakerId;
          rvcConfig.speed = params.speed ?? rConfig.speed ?? 1.0;
          console.log(`[TTS Stream] Loaded RVC config: pitch=${rvcConfig.pitchShift}, voice=${rvcConfig.voice}`);
        }
      } catch (error) {
        console.warn('[TTS Stream] Failed to load RVC user config:', error);
      }
    }
  }

  const lookahead = 1;
  const pendingGenerations: Map<number, Promise<Buffer>> = new Map();

  const startPrefetch = (index: number) => {
    if (index >= params.paragraphs.length) return;
    if (pendingGenerations.has(index)) return;
    if (params.signal?.aborted) return;

    const paragraph = params.paragraphs[index];
    console.log(`[TTS Stream] Prefetching paragraph ${index + 1}/${params.paragraphs.length} (${paragraph.length} chars)`);

    const promise = generateSpeech(paragraph, {
      provider: params.selectedProvider as 'piper' | 'rvc',
      voice: rvcConfig.voice,
      speakingRate: rvcConfig.speed,
      pitchShift: rvcConfig.pitchShift,
      username: params.username,
      signal: params.signal,
    }).catch((error) => {
      console.warn(`[TTS Stream] Failed to generate paragraph ${index}:`, error.message);
      return Buffer.alloc(0);
    });

    pendingGenerations.set(index, promise);
  };

  try {
    for (let i = 0; i < Math.min(lookahead + 1, params.paragraphs.length); i++) {
      startPrefetch(i);
    }

    for (let i = 0; i < params.paragraphs.length; i++) {
      if (params.signal?.aborted) break;

      startPrefetch(i);
      for (let j = i + 1; j <= i + lookahead && j < params.paragraphs.length; j++) {
        startPrefetch(j);
      }

      const audioBuffer = await pendingGenerations.get(i);
      pendingGenerations.delete(i);

      if (!audioBuffer || audioBuffer.length === 0) {
        console.warn(`[TTS Stream] No audio for paragraph ${i}`);
        continue;
      }

      console.log(`[TTS Stream] Streaming paragraph ${i + 1}/${params.paragraphs.length}: ${audioBuffer.length} bytes`);

      yield sse({
        chunk_index: i,
        sentence_index: i,
        total_sentences: params.paragraphs.length,
        audio_base64: audioBuffer.toString('base64'),
        audio_size: audioBuffer.length,
        is_final: i === params.paragraphs.length - 1,
      });
    }

    yield sse({ event: 'complete', total_chunks: params.paragraphs.length });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.log('[TTS Stream] Request aborted');
      return;
    }
    console.error('[TTS Stream] Error:', error);
    yield sse({ event: 'error', error: (error as Error).message });
  }
}
