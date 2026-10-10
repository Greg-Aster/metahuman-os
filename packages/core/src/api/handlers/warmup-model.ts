/**
 * Warmup Model API Handlers
 *
 * Preloads a model role to prevent cold-start latency.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { audit } from '../../audit.js';
import { callLLM, callEmbeddings } from '../../model-router.js';
import { isModelRole, type ModelRole } from '../../model-roles.js';
import { resolveModel, resolveModelForCognitiveMode } from '../../model-resolver.js';

// In-memory cache to prevent duplicate warmups
const warmupCache = new Map<string, number>();
const WARMUP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const WARMUP_TIMEOUT = 30 * 1000; // 30 seconds

function isRecentlyWarmed(role: string): boolean {
  const lastWarmup = warmupCache.get(role);
  if (!lastWarmup) return false;
  return Date.now() - lastWarmup < WARMUP_CACHE_TTL;
}

function markAsWarmed(role: string): void {
  warmupCache.set(role, Date.now());
}

async function warmupWithTimeout(role: ModelRole, username: string, cognitiveMode?: string): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      role === 'embedder'
        ? callEmbeddings({ text: 'hi', userId: username, cognitiveMode })
        : callLLM({ role, userId: username, messages: [{ role: 'user', content: 'hi' }],
            cognitiveMode, options: { maxTokens: 1, temperature: 0 } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Warmup timeout after ${WARMUP_TIMEOUT}ms`)), WARMUP_TIMEOUT);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /api/warmup-model - Warm up a model role
 * Body: { role: string }
 */
export async function handleWarmupModel(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return {
        status: 401,
        error: 'Authentication required for model warmup',
      };
    }

    const { role, cognitiveMode } = body || {};

    if (!role) {
      return {
        status: 400,
        error: 'role parameter is required',
      };
    }

    // Validate role
    if (!isModelRole(role)) {
      return {
        status: 400,
        error: `Invalid role: ${role}`,
      };
    }

    const resolved = cognitiveMode
      ? resolveModelForCognitiveMode(cognitiveMode, role, user.username)
      : resolveModel(role, undefined, user.username);
    const warmupKey = JSON.stringify([user.username, role, cognitiveMode, resolved.id,
      resolved.provider, resolved.model, resolved.options, resolved.adapters]);
    // Skip only if this assignment has already been warmed.
    if (isRecentlyWarmed(warmupKey)) {
      return successResponse({
        success: true,
        message: `Model for role "${role}" was recently warmed (cached)`,
        cached: true,
      });
    }

    const startTime = Date.now();

    try {
      // Send minimal inference to trigger ordinary model loading with timeout.
      await warmupWithTimeout(role, user.username, cognitiveMode);

      const duration = Date.now() - startTime;

      // Mark as warmed for deduplication
      markAsWarmed(warmupKey);

      audit({
        category: 'system',
        level: 'info',
        event: 'model_warmup',
        actor: user.username,
        details: {
          role,
          cognitiveMode: cognitiveMode || 'default',
          duration,
          trigger: 'user_request',
        },
      });

      return successResponse({
        success: true,
        message: `Model for role "${role}" warmed up successfully`,
        duration,
      });
    } catch (error) {
      audit({
        category: 'system',
        level: 'error',
        event: 'model_warmup_failed',
        actor: user.username,
        details: {
          role,
          error: (error as Error).message,
        },
      });

      return {
        status: 500,
        error: `Failed to warm up model: ${(error as Error).message}`,
      };
    }
  } catch (error) {
    console.error('[warmup-model] POST error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
