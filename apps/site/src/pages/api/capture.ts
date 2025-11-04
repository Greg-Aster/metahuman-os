import type { APIRoute } from 'astro'
import { captureEvent } from '@metahuman/core'

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { content, tags = [], entities = [], type = 'observation' } = body || {}
    if (!content || typeof content !== 'string') {
      return new Response(JSON.stringify({ error: 'content is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const path = captureEvent(content, { tags, entities, type })
    return new Response(JSON.stringify({ success: true, path }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

