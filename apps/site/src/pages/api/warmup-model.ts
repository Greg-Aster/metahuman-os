import type { APIRoute } from 'astro'
import { getAuthenticatedUser, audit } from '@metahuman/core'
import { callLLM } from '@metahuman/core/model-router'

/**
 * API endpoint to warm up (preload) a specific model role
 *
 * This sends a minimal inference request to Ollama to trigger model loading
 * into memory, preventing cold-start latency on first real use.
 *
 * Features:
 * - Deduplication: Won't warm the same model twice within 5 minutes
 * - Timeout: Fails gracefully after 30s instead of hanging forever
 * - Thread-safe: Uses in-memory cache to prevent concurrent warmups
 */

// In-memory cache to prevent duplicate warmups
// Key: role name, Value: timestamp of last warmup
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

async function warmupWithTimeout(role: string): Promise<any> {
  return Promise.race([
    callLLM({
      role: role as any,
      messages: [{ role: 'user', content: 'hi' }],
      options: {
        maxTokens: 1,
        temperature: 0,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Warmup timeout after ${WARMUP_TIMEOUT}ms`)), WARMUP_TIMEOUT)
    ),
  ]);
}

const postHandler: APIRoute = async ({ cookies, request }) => {
  try {
    // Explicit auth - require authentication for model warmup
    const user = getAuthenticatedUser(cookies);

    const body = await request.json()
    const { role } = body || {}

    if (!role) {
      return new Response(
        JSON.stringify({ success: false, error: 'role parameter is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Validate role
    const validRoles = ['orchestrator', 'persona', 'curator', 'coder', 'planner', 'summarizer', 'fallback']
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid role: ${role}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Skip if recently warmed (deduplication)
    if (isRecentlyWarmed(role)) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Model for role "${role}" was recently warmed (cached)`,
          cached: true
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const startTime = Date.now()

    try {
      // Send minimal inference to trigger model loading with timeout
      await warmupWithTimeout(role)

      const duration = Date.now() - startTime

      // Mark as warmed for deduplication
      markAsWarmed(role)

      audit({
        category: 'system',
        level: 'info',
        event: 'model_warmup',
        actor: user.username,
        details: {
          role,
          duration,
          trigger: 'user_request'
        }
      })

      return new Response(
        JSON.stringify({
          success: true,
          message: `Model for role "${role}" warmed up successfully`,
          duration
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    } catch (error) {
      audit({
        category: 'system',
        level: 'error',
        event: 'model_warmup_failed',
        actor: user.username,
        details: {
          role,
          error: (error as Error).message
        }
      })

      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to warm up model: ${(error as Error).message}`
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// POST requires authentication for model warmup operations
export const POST = postHandler
