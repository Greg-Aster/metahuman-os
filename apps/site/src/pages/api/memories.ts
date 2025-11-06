import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { paths } from '@metahuman/core'
import { getSecurityPolicy } from '../../../../../packages/core/src/security-policy.js'

type EventItem = {
  id: string
  timestamp: string
  content: string
  tags?: string[]
  entities?: string[]
  links?: Array<{ type: string; target: string }>
  relPath: string
  validation?: { status?: 'correct' | 'incorrect'; by?: string; timestamp?: string }
}

export const GET: APIRoute = async (context) => {
  try {
    // Require authentication to access memory data
    const policy = getSecurityPolicy(context);
    if (!policy.canReadMemory) {
      return new Response(
        JSON.stringify({ error: 'Access not permitted. Please log in to view memories.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const root = paths.episodic
    const items: EventItem[] = []

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const raw = fs.readFileSync(full, 'utf8')
            const obj = JSON.parse(raw)
            if (obj && obj.id && obj.timestamp && obj.content) {
              items.push({
                id: obj.id,
                timestamp: obj.timestamp,
                content: obj.content,
                tags: obj.tags || [],
                entities: Array.isArray(obj.entities) ? obj.entities : [],
                links: Array.isArray(obj.links) ? obj.links : [],
                relPath: path.relative(paths.root, full),
                validation: obj.validation || undefined,
              })
            }
          } catch {}
        }
      }
    }

    walk(root)

    items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    const limited = items.slice(0, 200)

    return new Response(JSON.stringify({ events: limited }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
