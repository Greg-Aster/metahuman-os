import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { paths } from '@metahuman/core'

type ChatRole = 'user' | 'assistant'

function readJSON(p: string): any | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

// Cache chat history to avoid expensive filesystem scans
const historyCache = new Map<string, { data: any; timestamp: number; episodicMtime: number; auditMtime: number }>();
const CACHE_TTL = 30000; // 30 seconds

function getCacheKey(mode: string, limit: number, maxDays: number): string {
  return `${mode}-${limit}-${maxDays}`;
}

function getLatestMtime(dir: string, pattern?: RegExp): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    const files = fs.readdirSync(dir);
    let latest = 0;
    for (const file of files) {
      if (pattern && !pattern.test(file)) continue;
      const stat = fs.statSync(path.join(dir, file));
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
    }
    return latest;
  } catch {
    return 0;
  }
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url)
    const mode = (url.searchParams.get('mode') === 'inner') ? 'inner' : 'conversation'
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || '80')))
    // Reduced from 30 to 7 days for faster boot - users can request more via query param
    const maxDays = Math.max(1, Math.min(365, Number(url.searchParams.get('days') || '7')))

    // Check cache
    const cacheKey = getCacheKey(mode, limit, maxDays);
    const now = Date.now();
    const cached = historyCache.get(cacheKey);

    // Get latest modification times for cache invalidation
    const episodicMtime = getLatestMtime(paths.episodic);
    const auditMtime = getLatestMtime(path.join(paths.logs, 'audit'), /\d{4}-\d{2}-\d{2}\.ndjson$/);

    // Return cached if fresh and files haven't changed
    if (cached &&
        (now - cached.timestamp < CACHE_TTL) &&
        cached.episodicMtime === episodicMtime &&
        cached.auditMtime === auditMtime) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
      });
    }

    const items: Array<{ ts: number; role: ChatRole; content: string; relPath?: string }> = []

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.isFile() && entry.name.endsWith('.json')) {
          const obj = readJSON(p)
          if (!obj || !obj.timestamp || !obj.content) continue
          const t = String(obj.type || '')
          const isInner = t === 'inner_dialogue'
          const isConversation = t === 'conversation'
          if ((mode === 'inner' && !isInner) || (mode === 'conversation' && !isConversation)) continue

          const c: string = String(obj.content)
          // Heuristics: map stored capture events to chat roles (only user side from memory)
          if (c.startsWith('Me: "')) {
            items.push({ ts: Date.parse(obj.timestamp), role: 'user', content: c.replace(/^Me: \"|\"$/g, ''), relPath: path.relative(paths.root, p) })
          }
        }
      }
    }

    walk(paths.episodic)
    // Merge assistant replies and idle thoughts from audit logs (up to maxDays)
    try {
      const auditDir = path.join(paths.logs, 'audit')
      const files = fs.existsSync(auditDir)
        ? fs.readdirSync(auditDir).filter(f => /\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort().reverse()
        : []
      let scanned = 0
      for (const f of files) {
        if (scanned >= maxDays) break
        scanned++
        const auditFile = path.join(auditDir, f)
        const content = fs.readFileSync(auditFile,'utf-8')
        const lines = content.trim().split('\n')
        // Read most recent lines first
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i]
          if (!line) continue
          try {
            const obj = JSON.parse(line)
            const ts = Date.parse(obj.timestamp || new Date().toISOString())
            // Assistant replies
            if (obj?.event === 'chat_assistant' && obj?.details?.mode) {
              const m = String(obj.details.mode)
              const text = String(obj.details.content || '')
              if ((mode === 'inner' && m === 'inner') || (mode === 'conversation' && m === 'conversation')) {
                items.push({ ts, role: 'assistant', content: text })
              }
            }
            // Idle thoughts (reflections) appear as reflector insights; include them in inner mode
            if (mode === 'inner') {
              const actor = String(obj.actor || '')
              const evt = String(obj.event || '')
              const reflection = obj?.details?.reflection || obj?.metadata?.reflection
              if (actor === 'reflector' && reflection && (evt === 'Reflector generated new insight' || evt === 'reflector_insight' || obj.category === 'decision')) {
                items.push({ ts, role: 'assistant', content: String(reflection) })
              }
            }
          } catch {}
          if (items.length > limit * 3) break // stop early once we have plenty to trim
        }
        if (items.length > limit * 3) break
      }
    } catch {}

    // De-duplicate by (role, content)
    items.sort((a, b) => a.ts - b.ts)
    const seen = new Set<string>()
    const dedup: typeof items = []
    for (const it of items) {
      const key = `${it.role}|${it.content}`
      if (seen.has(key)) continue
      seen.add(key)
      dedup.push(it)
    }

    const sliced = dedup.slice(-limit)
    const messages = sliced.map(m => ({ role: m.role, content: m.content, timestamp: m.ts, relPath: m.relPath }))

    const responseData = { messages };

    // Update cache
    historyCache.set(cacheKey, {
      data: responseData,
      timestamp: now,
      episodicMtime,
      auditMtime
    });

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
