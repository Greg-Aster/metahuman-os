/**
 * Capture API - Creates new memory events
 * MIGRATED: 2025-11-20 - Explicit authentication pattern
 */

import type { APIRoute } from 'astro'
import { getAuthenticatedUser, captureEvent } from '@metahuman/core'
import { requireWriteMode } from '../../middleware/cognitiveModeGuard'
import { getSecurityPolicy } from '@metahuman/core/security-policy'

const handler: APIRoute = async (context) => {
  // Explicit auth - require authentication for writes
  // Throws UNAUTHORIZED error which middleware converts to 401
  const user = getAuthenticatedUser(context.cookies);
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

// Export with security policy guard - no withUserContext wrapper needed
export const POST = requireWriteMode(handler)

