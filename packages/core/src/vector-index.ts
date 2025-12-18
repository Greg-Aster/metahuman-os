import fs from 'node:fs'
import path from 'node:path'
import { storageClient } from './storage-client.js'
import { embedText, cosineSimilarity } from './embeddings.js'

/**
 * Resolve user-specific memory paths via storage router
 */
function resolveMemoryPaths() {
  const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
  const tasksResult = storageClient.resolvePath({ category: 'memory', subcategory: 'tasks' });
  const semanticResult = storageClient.resolvePath({ category: 'memory', subcategory: 'semantic' });
  const indexResult = storageClient.resolvePath({ category: 'memory', subcategory: 'index' });

  if (!episodicResult.success || !tasksResult.success || !indexResult.success) {
    throw new Error('Cannot resolve memory paths via storage router');
  }

  return {
    episodic: episodicResult.path!,
    tasks: tasksResult.path!,
    semantic: semanticResult.path || path.join(episodicResult.profileRoot || '', 'memory', 'semantic'),
    indexDir: indexResult.path!,
    functions: path.join(episodicResult.profileRoot || '', 'memory', 'functions'),
  };
}

/**
 * Vector Index Module - Semantic Search
 *
 * All index files automatically use context-aware paths.
 * When user context is set, indexes go to profiles/{username}/memory/index/
 * When no context is set, indexes go to root-level memory/index/ (backward compatible)
 */

export interface VectorIndexItem {
  id: string
  path: string
  type: 'episodic' | 'task' | 'function'
  timestamp?: string
  text: string
  vector: number[]
}

export interface VectorIndexMeta {
  model: string
  provider: string  // 'local-models', 'ollama', etc.
  createdAt: string
  items: number
  dimensions?: number
}

export interface VectorIndexFile {
  meta: VectorIndexMeta
  data: VectorIndexItem[]
}

// Default model name for index filename (used when model unknown)
const DEFAULT_INDEX_MODEL = 'nomic-embed-text-v1.5'

export function indexFilePath(model?: string): string {
  const { indexDir } = resolveMemoryPaths();
  fs.mkdirSync(indexDir, { recursive: true })
  const modelName = model || DEFAULT_INDEX_MODEL
  const safe = modelName.replace(/[^a-z0-9_.-]/gi, '_')
  return path.join(indexDir, `embeddings-${safe}.json`)
}

function readJSON<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T
  } catch {
    return null
  }
}

// ============================================================================
// In-Memory Index Cache (prevents 59MB JSON parse on every query)
// ============================================================================
interface IndexCacheEntry {
  path: string
  mtimeMs: number
  index: VectorIndexFile
  loadedAt: number
}

let indexCache: IndexCacheEntry | null = null

/**
 * Clear the index cache (call after rebuilding index)
 */
export function clearIndexCache(): void {
  indexCache = null
  console.log('[vector-index] Index cache cleared')
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

/**
 * Build the memory index using embeddings from the model router.
 *
 * The model router automatically resolves the 'embedder' role from
 * the user's profile models.json, routing to local-models (llama.cpp)
 * or other configured providers.
 *
 * @param options.force - Force rebuild even if index exists
 * @param options.include - Which memory types to include
 */
export async function buildMemoryIndex(options: {
  force?: boolean
  include?: { episodic?: boolean; tasks?: boolean; curated?: boolean; functions?: boolean }
} = {}): Promise<string> {
  const includeEpisodic = options.include?.episodic !== false
  const includeTasks = options.include?.tasks !== false
  const includeCurated = options.include?.curated !== false
  const includeFunctions = options.include?.functions !== false

  const items: VectorIndexItem[] = []
  let dimensions = 0
  let firstVector: number[] | null = null

  const memPaths = resolveMemoryPaths();

  // Helper to get embedding and track dimensions
  // Note: embeddings.ts handles truncation at 32K chars if needed
  const getEmbedding = async (text: string): Promise<number[]> => {
    const vector = await embedText(text)
    if (!firstVector) {
      firstVector = vector
      dimensions = vector.length
    }
    return vector
  }

  if (includeEpisodic) {
    const files = walkFiles(memPaths.episodic, p => p.endsWith('.json'))
    console.log(`[vector-index] Processing ${files.length} episodic memories...`)
    let processed = 0
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
        const vector = await getEmbedding(text)
        items.push({ id: obj.id, path: f, type: 'episodic', timestamp: obj.timestamp, text, vector })
        processed++
        if (processed % 50 === 0) {
          console.log(`[vector-index]   ...processed ${processed}/${files.length} episodic`)
        }
      } catch {}
    }
    console.log(`[vector-index] ✓ Indexed ${processed} episodic memories`)
  }

  if (includeTasks) {
    const active = path.join(memPaths.tasks, 'active')
    const completed = path.join(memPaths.tasks, 'completed')
    const files = [
      ...walkFiles(active, p => p.endsWith('.json')),
      ...walkFiles(completed, p => p.endsWith('.json')),
    ]
    console.log(`[vector-index] Processing ${files.length} tasks...`)
    let processed = 0
    for (const f of files) {
      try {
        const obj = readJSON<any>(f)
        if (!obj || !obj.id || !obj.title) continue
        const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : ''
        const text = [obj.title, obj.description || '', tags ? `Tags: ${tags}` : ''].join(' ').trim()
        const vector = await getEmbedding(text)
        items.push({ id: obj.id, path: f, type: 'task', timestamp: obj.updated || obj.created, text, vector })
        processed++
      } catch {}
    }
    console.log(`[vector-index] ✓ Indexed ${processed} tasks`)
  }

  if (includeFunctions) {
    try {
      const verified = path.join(memPaths.functions, 'verified')
      const drafts = path.join(memPaths.functions, 'drafts')
      const files = [
        ...walkFiles(verified, p => p.endsWith('.json')),
        ...walkFiles(drafts, p => p.endsWith('.json')),
      ]
      console.log(`[vector-index] Processing ${files.length} functions...`)
      let processed = 0
      for (const f of files) {
        try {
          const obj = readJSON<any>(f)
          if (!obj || !obj.id || !obj.title) continue
          const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : ''
          const skillsUsed = Array.isArray(obj.skillsUsed) ? obj.skillsUsed.join(' ') : ''
          const examples = Array.isArray(obj.examples)
            ? obj.examples.map((ex: any) => `Example: ${ex.query || ''}`).join(' ')
            : ''
          const text = [
            obj.title,
            obj.summary || '',
            obj.description || '',
            tags ? `Tags: ${tags}` : '',
            skillsUsed ? `Skills: ${skillsUsed}` : '',
            examples,
          ].join(' ').trim()
          const vector = await getEmbedding(text)
          items.push({
            id: obj.id,
            path: f,
            type: 'function',
            timestamp: obj.metadata?.createdAt,
            text,
            vector,
          })
          processed++
        } catch {}
      }
      console.log(`[vector-index] ✓ Indexed ${processed} functions`)
    } catch {}
  }

  if (includeCurated) {
    const curatedRoot = path.join(memPaths.semantic, 'curated')
    const files = walkFiles(curatedRoot, p => p.endsWith('.meta.json'))
    console.log(`[vector-index] Processing ${files.length} curated items...`)
    let processed = 0
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
        const vector = await getEmbedding(text)
        items.push({ id: `cur-${path.basename(base)}`, path: f, type: 'episodic', timestamp: meta?.timestamp, text, vector })
        processed++
      } catch {}
    }
    console.log(`[vector-index] ✓ Indexed ${processed} curated items`)
  }

  // Determine model/provider from first embedding (set by model router)
  // The model router uses user profile to resolve 'embedder' role
  const model = DEFAULT_INDEX_MODEL  // From user profile via model router
  const provider = 'local-models'    // Default provider for embeddings

  const out: VectorIndexFile = {
    meta: {
      model,
      provider,
      createdAt: new Date().toISOString(),
      items: items.length,
      dimensions,
    },
    data: items,
  }

  const dest = indexFilePath(model)
  fs.writeFileSync(dest, JSON.stringify(out, null, 2))

  // Clear cache so next query loads fresh index
  clearIndexCache()

  console.log(`[vector-index] ✓ Index saved: ${items.length} items, ${dimensions} dimensions`)

  return dest
}

export function loadIndex(model?: string): VectorIndexFile | null {
  const p = indexFilePath(model)

  // Check cache validity
  if (indexCache && indexCache.path === p) {
    try {
      const stats = fs.statSync(p)
      if (stats.mtimeMs === indexCache.mtimeMs) {
        // Cache hit - file hasn't changed
        return indexCache.index
      }
      console.log('[vector-index] Index file changed, reloading...')
    } catch {
      // File may have been deleted
      indexCache = null
    }
  }

  // Cache miss - load from disk
  const loadStart = Date.now()
  const index = readJSON<VectorIndexFile>(p)

  if (index) {
    try {
      const stats = fs.statSync(p)
      indexCache = {
        path: p,
        mtimeMs: stats.mtimeMs,
        index,
        loadedAt: Date.now(),
      }
      const loadTime = Date.now() - loadStart
      console.log(`[vector-index] ✓ Index loaded and cached (${index.meta.items} items, ${loadTime}ms)`)
    } catch {
      // Couldn't get stats, still return the index
    }
  }

  return index
}

export async function queryIndex(
  query: string,
  options: { model?: string; topK?: number } = {}
): Promise<Array<{ item: VectorIndexItem; score: number }>> {
  const totalStart = Date.now()
  const topK = options.topK ?? 10

  // Step 1: Load index (cached after first call)
  const loadStart = Date.now()
  const idx = loadIndex(options.model)
  const loadTime = Date.now() - loadStart
  if (!idx) throw new Error('No index found. Run: mh index build')

  // Step 2: Generate embedding for query using model router
  const embedStart = Date.now()
  const qvec = await embedText(query)
  const embedTime = Date.now() - embedStart

  // Step 3: Compute similarity scores
  const scoreStart = Date.now()
  const scored = idx.data.map(item => ({ item, score: cosineSimilarity(qvec, item.vector) }))
  scored.sort((a, b) => b.score - a.score)
  const scoreTime = Date.now() - scoreStart

  const totalTime = Date.now() - totalStart
  console.log(`[vector-index] queryIndex: load=${loadTime}ms, embed=${embedTime}ms, score=${scoreTime}ms, total=${totalTime}ms (${idx.data.length} items)`)

  return scored.slice(0, topK)
}

export function getIndexStatus(model?: string) {
  const idx = loadIndex(model)
  if (!idx) return { exists: false }
  return {
    exists: true,
    model: idx.meta.model,
    provider: idx.meta.provider,
    items: idx.meta.items,
    dimensions: idx.meta.dimensions,
    createdAt: idx.meta.createdAt
  }
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
 * Uses the model router to generate embeddings.
 * Returns true if appended, false if index not present or failed.
 */
export async function appendEventToIndex(event: {
  id: string
  timestamp: string
  content: string
  tags?: string[]
  entities?: string[]
  path?: string
}, options: { model?: string } = {}): Promise<boolean> {
  const idx = loadIndex(options.model)
  if (!idx) return false

  const tags = Array.isArray(event.tags) ? event.tags.join(' ') : ''
  const entities = Array.isArray(event.entities) ? event.entities.join(' ') : ''
  const text = [String(event.content), tags ? `Tags: ${tags}` : '', entities ? ` Entities: ${entities}` : '']
    .filter(Boolean)
    .join(' ')

  // Use model router for embeddings
  const vector = await embedText(text)
  idx.data.push({ id: event.id, path: event.path || '', type: 'episodic', timestamp: event.timestamp, text, vector })
  idx.meta.items = idx.data.length

  const indexPath = indexFilePath(options.model)
  fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2))

  // Update cache in place (avoid full reload for single append)
  if (indexCache && indexCache.path === indexPath) {
    const stats = fs.statSync(indexPath)
    indexCache.mtimeMs = stats.mtimeMs
    // idx is already the cached index, so it's updated in place
  }

  return true
}
