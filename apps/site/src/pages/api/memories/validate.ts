import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { paths, timestamp } from '@metahuman/core'
import { requireWriteMode } from '../../../../../../packages/core/src/security-policy.js'

export const POST: APIRoute = requireWriteMode(async (context) => {
  try {
    const body = await context.request.json()
    const { relPath, status } = body || {}

    if (!relPath || typeof relPath !== 'string') {
      return new Response(JSON.stringify({ error: 'relPath is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (status !== 'correct' && status !== 'incorrect') {
      return new Response(JSON.stringify({ error: 'status must be "correct" or "incorrect"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const full = path.join(paths.root, relPath)
    // Security: ensure target is inside episodic directory and is a JSON file
    const episodicRoot = paths.episodic
    const normalized = path.normalize(full)
    if (!normalized.startsWith(path.normalize(episodicRoot))) {
      return new Response(JSON.stringify({ error: 'Invalid path' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (!fs.existsSync(normalized) || !normalized.endsWith('.json')) {
      return new Response(JSON.stringify({ error: 'File not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    const raw = fs.readFileSync(normalized, 'utf8')
    const obj = JSON.parse(raw)
    obj.validation = { status, by: 'user', timestamp: timestamp() }
    fs.writeFileSync(normalized, JSON.stringify(obj, null, 2))

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})

