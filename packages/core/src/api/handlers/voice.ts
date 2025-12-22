/**
 * Voice Loop API Handlers
 *
 * Endpoints for live voice interaction.
 * Part of Phase 5: Voice Agent + System Operator
 *
 * POST /api/voice/start - Start a voice session
 * POST /api/voice/stop - Stop a voice session
 * GET /api/voice/status - Get current voice loop status
 * POST /api/voice/transcript - Submit a transcript (for non-streaming ASR)
 * GET /api/voice/config - Get voice configuration
 * POST /api/voice/config - Update voice configuration
 * GET /api/voice/session - Get current session details
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import { createVoiceLoop, VoiceLoopController } from '../../voice/index.js';
import type { VoiceLoopConfig } from '../../voice/types.js';
import { audit } from '../../audit.js';

// Store active voice loops by username
const activeVoiceLoops = new Map<string, VoiceLoopController>();

/**
 * Get or create voice loop for a user.
 */
function getVoiceLoop(username: string): VoiceLoopController {
  let loop = activeVoiceLoops.get(username);
  if (!loop) {
    loop = createVoiceLoop(username);
    activeVoiceLoops.set(username, loop);
  }
  return loop;
}

/**
 * POST /api/voice/start
 * Start a voice session
 */
export async function handleVoiceStart(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const loop = getVoiceLoop(req.user.username);
    await loop.start();

    return successResponse({
      success: true,
      status: loop.getStatus(),
      session: loop.getSession(),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/voice/stop
 * Stop a voice session
 */
export async function handleVoiceStop(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const loop = getVoiceLoop(req.user.username);
    const session = loop.getSession();
    await loop.stop();

    return successResponse({
      success: true,
      session,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/voice/status
 * Get current voice loop status
 */
export async function handleVoiceStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const loop = activeVoiceLoops.get(req.user.username);

    if (!loop) {
      return successResponse({
        success: true,
        active: false,
        status: null,
      });
    }

    return successResponse({
      success: true,
      active: true,
      status: loop.getStatus(),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/voice/transcript
 * Submit a transcript (for non-streaming ASR)
 */
export async function handleVoiceTranscript(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { text: string; confidence?: number; isFinal?: boolean } | undefined;

    if (!body?.text) {
      return badRequestResponse('text is required');
    }

    const loop = getVoiceLoop(req.user.username);

    // Simulate ASR result
    const asrResult = {
      text: body.text,
      confidence: body.confidence ?? 1.0,
      language: 'en',
      duration: 0,
      isFinal: body.isFinal ?? true,
    };

    if (asrResult.isFinal) {
      await loop.onTranscriptFinal(asrResult);
    } else {
      loop.onTranscriptPartial(asrResult.text);
    }

    return successResponse({
      success: true,
      status: loop.getStatus(),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/voice/config
 * Get voice configuration
 */
export async function handleGetVoiceConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const loop = activeVoiceLoops.get(req.user.username);
    const config = loop?.getConfig() || getDefaultVoiceConfig();

    return successResponse({
      success: true,
      config,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/voice/config
 * Update voice configuration
 */
export async function handleUpdateVoiceConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as Partial<VoiceLoopConfig> | undefined;

    if (!body) {
      return badRequestResponse('Configuration body is required');
    }

    const loop = getVoiceLoop(req.user.username);
    loop.updateConfig(body);

    audit({
      category: 'action',
      level: 'info',
      event: 'voice_config_updated',
      actor: req.user.username,
      details: { config: body },
    });

    return successResponse({
      success: true,
      config: loop.getConfig(),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/voice/session
 * Get current session details
 */
export async function handleGetVoiceSession(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const loop = activeVoiceLoops.get(req.user.username);
    const session = loop?.getSession();

    if (!session) {
      return successResponse({
        success: true,
        hasSession: false,
        session: null,
      });
    }

    return successResponse({
      success: true,
      hasSession: true,
      session,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/voice/pause
 * Pause voice loop (keep session active)
 */
export async function handleVoicePause(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const loop = activeVoiceLoops.get(req.user.username);

    if (!loop) {
      return errorResponse('No active voice session', 404);
    }

    await loop.pause();

    return successResponse({
      success: true,
      status: loop.getStatus(),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/voice/resume
 * Resume voice loop
 */
export async function handleVoiceResume(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const loop = activeVoiceLoops.get(req.user.username);

    if (!loop) {
      return errorResponse('No active voice session', 404);
    }

    await loop.resume();

    return successResponse({
      success: true,
      status: loop.getStatus(),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/voice/barge-in
 * Signal barge-in (user interrupt)
 */
export async function handleVoiceBargeIn(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const loop = activeVoiceLoops.get(req.user.username);

    if (!loop) {
      return errorResponse('No active voice session', 404);
    }

    loop.onBargeIn();

    return successResponse({
      success: true,
      status: loop.getStatus(),
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * Get default voice configuration.
 */
function getDefaultVoiceConfig(): VoiceLoopConfig {
  return {
    audio: {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      encoding: 'pcm',
    },
    asr: {
      model: 'whisper-small',
      language: 'en',
      vadEnabled: true,
      vadThreshold: 0.5,
      silenceTimeout: 1500,
      maxDuration: 30000,
    },
    tts: {
      model: 'piper',
      voice: 'en_US-lessac-medium',
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
      streaming: true,
    },
    bargeIn: {
      enabled: true,
      sensitivity: 0.6,
      minInterruptDuration: 200,
      gracePeriod: 500,
    },
    autoStart: false,
    saveTranscripts: true,
    saveAudio: false,
  };
}
