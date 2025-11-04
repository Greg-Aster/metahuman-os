import type { APIRoute } from 'astro'
import { getIndexStatus, buildMemoryIndex } from '@metahuman/core'

export const GET: APIRoute = async () => {
  try {
    const status = getIndexStatus()
    return new Response(JSON.stringify(status), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { action = 'build', provider, model } = body || {}
    if (action !== 'build') {
      return new Response(JSON.stringify({ error: 'Unsupported action' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    await buildMemoryIndex({ provider, model })
    const status = getIndexStatus()
    return new Response(JSON.stringify({ success: true, status }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

