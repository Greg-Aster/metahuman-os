import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { storageClient, ROOT } from '@metahuman/core'

function walk(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(p)
  }
  return out
}

function extractUserText(content: string): string {
  // Common format: Me: "text"  — fallback to raw content if no match
  const m = /^\s*Me:\s*"([\s\S]*?)"\s*$/.exec(content)
  if (m && m[1]) return m[1]
  // Remove leading Me: if present
  return content.replace(/^\s*Me:\s*/i, '').trim()
}

export const POST: APIRoute = async () => {
  try {
    const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
    if (!episodicResult.success || !episodicResult.path) {
      return new Response(JSON.stringify({ success: false, error: 'Cannot resolve episodic path' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    const episodicRoot = episodicResult.path
    const files = walk(episodicRoot)
    const records: Array<{ id: string; text: string; ts: string; type?: string }> = []

    for (const f of files) {
      try {
        const obj = JSON.parse(fs.readFileSync(f, 'utf-8'))
        const type = String(obj?.type || '')
        if (type !== 'conversation' && type !== 'inner_dialogue') continue
        if (!obj?.content) continue
        const text = extractUserText(String(obj.content))
        if (!text || text.length < 1) continue
        records.push({ id: String(obj.id || path.basename(f, '.json')), text, ts: String(obj.timestamp || ''), type })
      } catch {}
    }

    if (records.length === 0) {
      return new Response(JSON.stringify({ success: true, count: 0, dir: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const stamp = new Date().toISOString().replace(/[:T.Z]/g, '').slice(0, 14)
    const inboxResult = storageClient.resolvePath({ category: 'memory', subcategory: 'inbox' });
    if (!inboxResult.success || !inboxResult.path) {
      return new Response(JSON.stringify({ success: false, error: 'Cannot resolve inbox path' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    const destDir = path.join(inboxResult.path, `chat-export-${stamp}`)
    fs.mkdirSync(destDir, { recursive: true })

    let n = 0
    for (const r of records) {
      const nameSafe = r.id.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 40) || `rec${n}`
      const fname = `${String(n).padStart(4, '0')}-${nameSafe}.txt`
      const body = r.text.trim() + '\n'
      fs.writeFileSync(path.join(destDir, fname), body)
      n++
    }

    return new Response(JSON.stringify({ success: true, count: n, dir: path.relative(ROOT, destDir) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

