/** Transport for graph-backed voice turn detection. */

import { classifySemanticTurn } from '../../semantic-turn.js'
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'

export async function handleSemanticTurn(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  const body = req.body as { transcript?: unknown; context?: unknown } | undefined
  if (typeof body?.transcript !== 'string' || !body.transcript.trim()) {
    return { status: 400, error: 'transcript is required' }
  }
  if (body.context !== undefined && typeof body.context !== 'string') {
    return { status: 400, error: 'context must be a string' }
  }
  try {
    const startedAt = Date.now()
    const result = await classifySemanticTurn({
      transcript: body.transcript,
      context: body.context,
      username: req.user.username,
    })
    return successResponse({ ...result, latency_ms: Date.now() - startedAt })
  } catch (error) {
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Semantic turn classification failed',
    }
  }
}
