import type { APIRoute } from 'astro'
import { getUserContext } from '@metahuman/core/context'
import { withUserContext } from '../../middleware/userContext'
import { callLLM } from '@metahuman/core/model-router'
import { audit } from '@metahuman/core'

/**
 * API endpoint to warm up (preload) a specific model role
 *
 * This sends a minimal inference request to Ollama to trigger model loading
 * into memory, preventing cold-start latency on first real use.
 */

const postHandler: APIRoute = async ({ request }) => {
  try {
    const ctx = getUserContext()
    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

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

    const startTime = Date.now()

    try {
      // Send minimal inference to trigger model loading
      // 1 token generation is enough to load model into memory
      await callLLM({
        role: role as any,
        messages: [{ role: 'user', content: 'hi' }],
        options: {
          maxTokens: 1,
          temperature: 0,
        },
      })

      const duration = Date.now() - startTime

      audit({
        category: 'system',
        level: 'info',
        action: 'model_warmup',
        actor: ctx.username,
        context: {
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
        action: 'model_warmup_failed',
        actor: ctx.username,
        context: {
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

export const POST = withUserContext(postHandler)
