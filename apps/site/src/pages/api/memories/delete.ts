import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { storageClient, ROOT } from '@metahuman/core'
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard'

const handler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { relPath } = body || {}

    if (!relPath || typeof relPath !== 'string') {
      return new Response(JSON.stringify({ error: 'relPath is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const full = path.join(ROOT, relPath)
    // Security: ensure target is inside episodic directory and is a JSON file
    const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
    if (!episodicResult.success || !episodicResult.path) {
      return new Response(JSON.stringify({ error: 'Cannot resolve episodic path' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    const episodicRoot = episodicResult.path
    const normalized = path.normalize(full)
    if (!normalized.startsWith(path.normalize(episodicRoot))) {
      return new Response(JSON.stringify({ error: 'Invalid path' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (!fs.existsSync(normalized) || !normalized.endsWith('.json')) {
      return new Response(JSON.stringify({ error: 'File not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    fs.unlinkSync(normalized)

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

// Wrap with cognitive mode guard
export const POST = requireWriteMode(handler)

