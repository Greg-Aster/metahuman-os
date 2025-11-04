import type { APIRoute } from 'astro'
import { loadDecisionRules, setTrustLevel } from '@metahuman/core/identity'

export const GET: APIRoute = async () => {
  try {
    const rules = loadDecisionRules()
    return new Response(JSON.stringify({ level: rules.trustLevel, available: rules.availableModes || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const level = String(body?.level || '')
    if (!level) {
      return new Response(JSON.stringify({ error: 'Missing level' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    setTrustLevel(level)
    const rules = loadDecisionRules()
    return new Response(JSON.stringify({ ok: true, level: rules.trustLevel }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

