import type { APIRoute } from 'astro'
import { loadDecisionRules, setTrustLevel } from '@metahuman/core/identity'
import { audit } from '@metahuman/core'
import { auditConfigAccess, requireOwner } from '../../middleware/cognitiveModeGuard'

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

const postHandler: APIRoute = async (context) => {
  try {
    const { request } = context
    const body = await request.json()
    const level = String(body?.level || '')

    if (!level) {
      return new Response(JSON.stringify({ error: 'Missing level' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const currentRules = loadDecisionRules()

    // Audit the trust level change attempt
    auditConfigAccess(context, 'trust_level_change')

    // Additional audit with trust details
    audit({
      level: 'warn',
      category: 'security',
      event: 'trust_level_change',
      details: {
        from: currentRules.trustLevel,
        to: level
      },
      actor: 'web_ui'
    })

    setTrustLevel(level)
    const rules = loadDecisionRules()

    return new Response(JSON.stringify({ ok: true, level: rules.trustLevel }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

// Wrap with owner-only guard (blocks trust changes for non-owners)
export const POST = requireOwner(postHandler)

