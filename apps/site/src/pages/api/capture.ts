import type { APIRoute } from 'astro'
import { captureEvent } from '@metahuman/core'
import { requireWriteMode } from '../../middleware/cognitiveModeGuard'
import { getSecurityPolicy } from '@metahuman/core/security-policy'
import { withUserContext } from '../../middleware/userContext'

const handler: APIRoute = async (context) => {
  try {
    const body = await context.request.json()
    const { content, tags = [], entities = [], type = 'observation' } = body || {}
    if (!content || typeof content !== 'string') {
      return new Response(JSON.stringify({ error: 'content is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    // Get cognitive mode from security policy
    const policy = getSecurityPolicy(context)
    const cognitiveMode = policy.mode

    const path = captureEvent(content, {
      tags,
      entities,
      type,
      metadata: {
        cognitiveMode,
      },
    })
    return new Response(JSON.stringify({ success: true, path }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

// Wrap with user context (sets user profile paths) and cognitive mode guard (checks permissions)
export const POST = withUserContext(requireWriteMode(handler))

