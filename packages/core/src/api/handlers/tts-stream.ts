import fs from 'node:fs';
import type { UnifiedHandler } from '../types.js';
import { badRequestResponse, errorResponse, streamResponse } from '../types.js';
import { getProfilePaths } from '../../path-builder.js';
import { generateSpeech } from '../../tts.js';

function splitIntoParagraphs(text: string): string[] {
  const minParagraphLength = 400;
  const maxParagraphLength = 800;
  const rawParagraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const paragraphs: string[] = [];

  for (const paragraph of rawParagraphs) {
    if (paragraph.length <= maxParagraphLength) {
      paragraphs.push(paragraph);
      continue;
    }

    const sentences = paragraph.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const sentence of sentences) {
      if (currentLength + sentence.length > maxParagraphLength && currentChunk.length > 0) {
        paragraphs.push(currentChunk.join(' '));
        currentChunk = [];
        currentLength = 0;
      }

      currentChunk.push(sentence);
      currentLength += sentence.length + 1;

      if (currentLength >= minParagraphLength) {
        paragraphs.push(currentChunk.join(' '));
        currentChunk = [];
        currentLength = 0;
      }
    }

    if (currentChunk.length > 0) paragraphs.push(currentChunk.join(' '));
  }

  if (paragraphs.length === 0 && text.trim()) {
    const sentences = text.trim().split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const sentence of sentences) {
      if (currentLength + sentence.length > maxParagraphLength && currentChunk.length > 0) {
        paragraphs.push(currentChunk.join(' '));
        currentChunk = [];
        currentLength = 0;
      }

      currentChunk.push(sentence);
      currentLength += sentence.length + 1;

      if (currentLength >= minParagraphLength) {
        paragraphs.push(currentChunk.join(' '));
        currentChunk = [];
        currentLength = 0;
      }
    }

    if (currentChunk.length > 0) paragraphs.push(currentChunk.join(' '));
  }

  return paragraphs;
}

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const handleTtsStream: UnifiedHandler = async (req) => {
  try {
    const { text, provider, voice, voiceId, speed, pitchShift, langCode } = req.body ?? {};

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
      });
    }

    const paragraphs = splitIntoParagraphs(text);
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
  },
) {
  const kokoroConfig: {
    voice: string;
    speed: number;
    langCode: string;
    customVoicepack: string | null;
    normalize: boolean;
  } = {
    voice: params.voiceId || params.voice || 'af_heart',
    speed: params.speed || 1.0,
    langCode: params.langCode || 'a',
    customVoicepack: null,
    normalize: false,
  };

  const profilePaths = getProfilePaths(username);
  if (fs.existsSync(profilePaths.voiceConfig)) {
    try {
      const voiceConfig = JSON.parse(fs.readFileSync(profilePaths.voiceConfig, 'utf-8'));
      if (voiceConfig.tts?.kokoro) {
        const kConfig = voiceConfig.tts.kokoro;
        console.log('[TTS Stream] Saved kConfig.voice:', kConfig.voice, 'useCustomVoicepack:', kConfig.useCustomVoicepack);
        kokoroConfig.voice = params.voiceId || params.voice || kConfig.voice || 'af_heart';
        kokoroConfig.speed = params.speed || kConfig.speed || 1.0;
        kokoroConfig.langCode = params.langCode || kConfig.langCode || 'a';

        const requestedVoice = params.voiceId || params.voice;
        const isBuiltInVoiceRequested = requestedVoice && /^[a-z]{2}_[a-z]+$/.test(requestedVoice);

        if (kConfig.useCustomVoicepack && kConfig.customVoicepackPath && !isBuiltInVoiceRequested) {
          kokoroConfig.customVoicepack = kConfig.customVoicepackPath;
          kokoroConfig.normalize = kConfig.normalizeCustomVoicepacks ?? true;
        }
        console.log('[TTS Stream] Final kokoroConfig.voice:', kokoroConfig.voice, 'customVoicepack:', kokoroConfig.customVoicepack, 'isBuiltInVoiceRequested:', isBuiltInVoiceRequested);
      }
    } catch (error) {
      console.warn('[TTS Stream] Failed to load user voice config:', error);
    }
  }

  const kokoroServerUrl = process.env.KOKORO_SERVER_URL || 'http://127.0.0.1:9882';

  try {
    const kokoroResponse = await fetch(`${kokoroServerUrl}/synthesize-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: params.text,
        lang_code: kokoroConfig.langCode,
        voice: kokoroConfig.voice,
        speed: kokoroConfig.speed,
        custom_voicepack: kokoroConfig.customVoicepack,
        normalize: kokoroConfig.normalize,
      }),
      signal,
    });

    if (!kokoroResponse.ok) {
      const errorText = await kokoroResponse.text();
      console.error('[TTS Stream] Kokoro server error:', errorText);
      return errorResponse(`Kokoro server error: ${errorText}`, kokoroResponse.status);
    }

    const response = streamResponse(proxyReadableStream(kokoroResponse.body));
    return {
      ...response,
      headers: {
        ...response.headers,
        'X-Accel-Buffering': 'no',
      },
    };
  } catch (error) {
    const errMsg = (error as Error).message || String(error);
    const cause = (error as { cause?: { code?: string } }).cause;

    if (cause?.code === 'ECONNREFUSED' || errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch failed')) {
      console.warn('[TTS Stream] Kokoro server not available (connection refused). TTS will be skipped.');
      return {
        status: 503,
        data: {
          error: 'Kokoro TTS server is not running. Start it with: ./bin/mh kokoro serve start',
          serverUnavailable: true,
        },
      };
    }

    throw error;
  }
}

async function* proxyReadableStream(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
    const finalChunk = decoder.decode();
    if (finalChunk) yield finalChunk;
  } finally {
    reader.releaseLock();
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
