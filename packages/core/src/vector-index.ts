import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths.js'
import { embedText, cosineSimilarity } from './embeddings.js'

export interface VectorIndexItem {
  id: string
  path: string
  type: 'episodic' | 'task'
  timestamp?: string
  text: string
  vector: number[]
}

export interface VectorIndexMeta {
  model: string
  provider: 'ollama' | 'mock'
  createdAt: string
  items: number
}

export interface VectorIndexFile {
  meta: VectorIndexMeta
  data: VectorIndexItem[]
}

export function indexFilePath(model = 'nomic-embed-text'): string {
  fs.mkdirSync(paths.indexDir, { recursive: true })
  const safe = model.replace(/[^a-z0-9_.-]/gi, '_')
  return path.join(paths.indexDir, `embeddings-${safe}.json`)
}

function readJSON<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T
  } catch {
    return null
  }
}

function walkFiles(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = []
  const go = (d: string) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) go(p)
      else if (e.isFile() && filter(p)) out.push(p)
    }
  }
  go(dir)
  return out
}

export async function buildMemoryIndex(options: {
  provider?: 'ollama' | 'mock'
  model?: string
  include?: { episodic?: boolean; tasks?: boolean; curated?: boolean }
} = {}): Promise<string> {
  const provider = options.provider || 'ollama'
  const model = options.model || 'nomic-embed-text'
  const includeEpisodic = options.include?.episodic !== false
  const includeTasks = options.include?.tasks !== false
  const includeCurated = options.include?.curated !== false

  const items: VectorIndexItem[] = []

  if (includeEpisodic) {
    const files = walkFiles(paths.episodic, p => p.endsWith('.json'))
    for (const f of files) {
      try {
        const obj = readJSON<any>(f)
        if (!obj || !obj.id || !obj.content) continue
        if (obj.validation && obj.validation.status === 'incorrect') continue
        const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : ''
        const entities = Array.isArray(obj.entities) ? obj.entities.join(' ') : ''
        const text = [String(obj.content), tags ? `Tags: ${tags}` : '', entities ? ` Entities: ${entities}` : '']
          .filter(Boolean)
          .join(' ')
        const vector = await embedText(text, { provider, model })
        items.push({ id: obj.id, path: f, type: 'episodic', timestamp: obj.timestamp, text, vector })
      } catch {}
    }
  }

  if (includeTasks) {
    const active = path.join(paths.tasks, 'active')
    const completed = path.join(paths.tasks, 'completed')
    const files = [
      ...walkFiles(active, p => p.endsWith('.json')),
      ...walkFiles(completed, p => p.endsWith('.json')),
    ]
    for (const f of files) {
      try {
        const obj = readJSON<any>(f)
        if (!obj || !obj.id || !obj.title) continue
        const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : ''
        const text = [obj.title, obj.description || '', tags ? `Tags: ${tags}` : ''].join(' ').trim()
        const vector = await embedText(text, { provider, model })
        items.push({ id: obj.id, path: f, type: 'task', timestamp: obj.updated || obj.created, text, vector })
      } catch {}
    }
  }

  if (includeCurated) {
    const curatedRoot = path.join(paths.semantic, 'curated')
    const files = walkFiles(curatedRoot, p => p.endsWith('.meta.json'))
    for (const f of files) {
      try {
        const base = f.replace(/\.meta\.json$/, '')
        const meta = readJSON<any>(f)
        if (!meta) continue
        const highlights = readJSON<string[]>(`${base}.highlights.json`) || []
        const title = meta.title || path.basename(base)
        const abstract = meta.abstract || ''
        const tags = Array.isArray(meta.tags) ? meta.tags.join(' ') : ''
        const text = [title, abstract, highlights.length ? `Highlights: ${highlights.join(' ')}` : '', tags ? `Tags: ${tags}` : ''].join(' ').trim()
        const vector = await embedText(text, { provider, model })
        items.push({ id: `cur-${path.basename(base)}`, path: f, type: 'episodic', timestamp: meta?.timestamp, text, vector })
      } catch {}
    }
  }

  const out: VectorIndexFile = {
    meta: {
      model,
      provider,
      createdAt: new Date().toISOString(),
      items: items.length,
    },
    data: items,
  }

  const dest = indexFilePath(model)
  fs.writeFileSync(dest, JSON.stringify(out, null, 2))
  return dest
}

export function loadIndex(model = 'nomic-embed-text'): VectorIndexFile | null {
  const p = indexFilePath(model)
  return readJSON<VectorIndexFile>(p)
}

export async function queryIndex(
  query: string,
  options: { model?: string; provider?: 'ollama' | 'mock'; topK?: number } = {}
): Promise<Array<{ item: VectorIndexItem; score: number }>> {
  const modelParam = options.model || 'nomic-embed-text'
  const topK = options.topK ?? 10
  const idx = loadIndex(modelParam)
  if (!idx) throw new Error('No index found. Run: mh index build')

  const model = options.model || idx.meta.model
  const provider = options.provider || idx.meta.provider

  const qvec = await embedText(query, { provider, model })
  const scored = idx.data.map(item => ({ item, score: cosineSimilarity(qvec, item.vector) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

export function getIndexStatus(model = 'nomic-embed-text') {
  const idx = loadIndex(model)
  if (!idx) return { exists: false }
  return { exists: true, model: idx.meta.model, provider: idx.meta.provider, items: idx.meta.items, createdAt: idx.meta.createdAt }
}

export function buildRagContext(results: Array<{ item: VectorIndexItem; score: number }>, maxChars = 2000): string {
  let used = 0
  const lines: string[] = []
  for (const r of results) {
    const head = `# ${r.item.type} ${r.item.id} (${(r.score * 100).toFixed(1)}%)`
    const when = r.item.timestamp ? `\nWhen: ${r.item.timestamp}` : ''
    const body = `\nText: ${r.item.text}`
    const chunk = [head, when, body, `\nPath: ${r.item.path}`].join('')
    if (used + chunk.length > maxChars) break
    lines.push(chunk)
    used += chunk.length
  }
  return lines.join('\n\n')
}

/**
 * Append a single episodic event to an existing index (if present).
 * Returns true if appended, false if index not present or failed.
 */
export async function appendEventToIndex(event: {
  id: string
  timestamp: string
  content: string
  tags?: string[]
  entities?: string[]
  path?: string
}, options: { model?: string; provider?: 'ollama' | 'mock' } = {}): Promise<boolean> {
  const modelParam = options.model || 'nomic-embed-text'
  const idx = loadIndex(modelParam)
  if (!idx) return false

  const model = options.model || idx.meta.model
  const provider = options.provider || idx.meta.provider

  const tags = Array.isArray(event.tags) ? event.tags.join(' ') : ''
  const entities = Array.isArray(event.entities) ? event.entities.join(' ') : ''
  const text = [String(event.content), tags ? `Tags: ${tags}` : '', entities ? ` Entities: ${entities}` : '']
    .filter(Boolean)
    .join(' ')
  const vector = await embedText(text, { provider, model })
  idx.data.push({ id: event.id, path: event.path || '', type: 'episodic', timestamp: event.timestamp, text, vector })
  idx.meta.items = idx.data.length
  fs.writeFileSync(indexFilePath(model), JSON.stringify(idx, null, 2))
  return true
}
