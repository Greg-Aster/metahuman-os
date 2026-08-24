import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { audit } from './audit.js'
import { storageClient } from './storage-client.js'
import { cosineSimilarity } from './embeddings.js'
import { extractMemoryContent, type ContentMode } from './memory-content-filter.js'
import { callEmbeddings, isEmbeddingServiceAvailable } from './model-router.js'
import { ROOT } from './paths.js'

// ============================================================================
// Index Content Mode Configuration
// ============================================================================

/**
 * Load the index content mode from embeddings.json
 * Controls what content types are included in the vector index
 */
function loadIndexContentMode(): ContentMode {
  try {
    const embeddingsPath = path.join(ROOT, 'etc', 'embeddings.json')
    const config = JSON.parse(fs.readFileSync(embeddingsPath, 'utf-8'))
    const mode = config.indexContentMode || 'user'
    if (['user', 'all', 'agent'].includes(mode)) {
      return mode as ContentMode
    }
  } catch (err) {
    console.warn('[vector-index] Could not load indexContentMode, using default "user"')
  }
  return 'user'
}

/**
 * Resolve user-specific memory paths via storage router
 * @param username - Optional explicit username (use when context isn't available, e.g., CLI)
 */
function resolveMemoryPaths(username?: string) {
  const episodicResult = storageClient.resolvePath({ username, category: 'memory', subcategory: 'episodic' });
  const tasksResult = storageClient.resolvePath({ username, category: 'memory', subcategory: 'tasks' });
  const semanticResult = storageClient.resolvePath({ username, category: 'memory', subcategory: 'semantic' });
  const indexResult = storageClient.resolvePath({ username, category: 'memory', subcategory: 'index' });

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
  memoryType?: string
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

export type MemoryIndexStatus =
  | { exists: false }
  | {
      exists: true
      model: string
      provider: string
      items: number
      dimensions?: number
      createdAt: string
    }

export interface MemoryIndexRefreshOptions {
  username: string
  force?: boolean
  maxAgeHours?: number
  source?: string
}

export interface MemoryIndexRefreshResult {
  username: string
  rebuilt: boolean
  skipped: boolean
  reason: 'forced' | 'missing' | 'stale' | 'recent'
  indexPath?: string
  status: MemoryIndexStatus
}

// Default model name for index filename - must match embeddings.ts DEFAULTS.model
const DEFAULT_INDEX_MODEL = 'qwen3-embedding-0.6b'
const MAX_EMBEDDING_TEXT_LENGTH = 32_000

function prepareEmbeddingText(text: string): string {
  if (text.length <= MAX_EMBEDDING_TEXT_LENGTH) return text
  console.warn(`[vector-index] Embedding text too long (${text.length} chars), truncating to ${MAX_EMBEDDING_TEXT_LENGTH}`)
  return `${text.slice(0, MAX_EMBEDDING_TEXT_LENGTH)}... [truncated]`
}

export function indexFilePath(model?: string, username?: string): string {
  const { indexDir } = resolveMemoryPaths(username);
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

function readRequiredJSON<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T
}

function writeIndexFile(dest: string, index: VectorIndexFile): void {
  const tempPath = `${dest}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(index, null, 2))
    fs.renameSync(tempPath, dest)
  } catch (error) {
    try { fs.unlinkSync(tempPath) } catch {}
    throw error
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
 * @param options.include - Which memory types to include
 */
async function buildMemoryIndex(options: {
  include?: { episodic?: boolean; tasks?: boolean; curated?: boolean; functions?: boolean }
  username?: string  // Explicit username (use when context isn't available, e.g., CLI)
} = {}): Promise<string> {
  const includeEpisodic = options.include?.episodic !== false
  const includeTasks = options.include?.tasks !== false
  const includeCurated = options.include?.curated !== false
  const includeFunctions = options.include?.functions !== false
  const username = options.username

  const items: VectorIndexItem[] = []
  const indexingErrors: Array<{ path: string; message: string }> = []
  let dimensions = 0
  let embeddingModel: string | undefined
  let embeddingProvider: string | undefined

  const memPaths = resolveMemoryPaths(username);

  // Load content mode from config - determines what content types to index
  const indexContentMode = loadIndexContentMode()
  console.log(`[vector-index] Index content mode: ${indexContentMode}`)

  // Helper to get embedding and track dimensions
  const getEmbedding = async (text: string): Promise<number[]> => {
    const response = await callEmbeddings({ text: prepareEmbeddingText(text), userId: username })
    if (!embeddingModel) {
      embeddingModel = response.model
      embeddingProvider = response.provider
      dimensions = response.dimensions
    } else if (
      embeddingModel !== response.model
      || embeddingProvider !== response.provider
      || dimensions !== response.dimensions
    ) {
      throw new Error('Embedding route changed during index build')
    }
    return response.embeddings
  }

  if (includeEpisodic) {
    const files = walkFiles(memPaths.episodic, p => p.endsWith('.json'))
    console.log(`[vector-index] Processing ${files.length} episodic memories...`)
    let processed = 0
    let skippedLLM = 0
    let embeddingErrors = 0
    for (const f of files) {
      try {
        const obj = readRequiredJSON<any>(f)
        if (!obj || !obj.id || !obj.content) continue
        if (obj.validation && obj.validation.status === 'incorrect') continue

        // Skip LLM-generated memory types when in 'user' mode
        const memType = obj.type?.toLowerCase() || ''
        const llmGeneratedTypes = [
          'inner_dialogue',     // LLM internal thoughts
          'reflection',         // LLM reflections on memories
          'reflection_summary', // LLM summaries of reflections
          'summary',            // LLM summaries
        ]
        // In 'user' mode, skip all LLM types. In 'agent' mode, we want these.
        // In 'all' mode, include everything.
        if (indexContentMode === 'user' && llmGeneratedTypes.includes(memType)) {
          skippedLLM++
          continue
        }

        // Extract content using configured mode (handles all formats)
        const extractedContent = extractMemoryContent(obj, indexContentMode)
        if (!extractedContent) {
          // Skip memories with no relevant content for this mode
          continue
        }

        const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : ''
        const entities = Array.isArray(obj.entities) ? obj.entities.join(' ') : ''
        const text = [extractedContent, tags ? `Tags: ${tags}` : '', entities ? ` Entities: ${entities}` : '']
          .filter(Boolean)
          .join(' ')
        const vector = await getEmbedding(text)
        items.push({
          id: obj.id,
          path: f,
          type: 'episodic',
          memoryType: memType || 'observation',
          timestamp: obj.timestamp,
          text,
          vector,
        })
        processed++
        if (processed % 50 === 0) {
          console.log(`[vector-index]   ...processed ${processed}/${files.length} episodic`)
        }
      } catch (err) {
        embeddingErrors++
        indexingErrors.push({ path: f, message: (err as Error).message })
        // Log first few errors then summarize
        if (embeddingErrors <= 3) {
          console.error(`[vector-index] Embedding error: ${(err as Error).message}`)
        }
      }
    }
    if (embeddingErrors > 3) {
      console.error(`[vector-index] ...and ${embeddingErrors - 3} more embedding errors`)
    }
    console.log(`[vector-index] ✓ Indexed ${processed} episodic memories (skipped ${skippedLLM} LLM-generated, ${embeddingErrors} errors)`)
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
        const obj = readRequiredJSON<any>(f)
        if (!obj || !obj.id || !obj.title) continue
        const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : ''
        const text = [obj.title, obj.description || '', tags ? `Tags: ${tags}` : ''].join(' ').trim()
        const vector = await getEmbedding(text)
        items.push({ id: obj.id, path: f, type: 'task', timestamp: obj.updated || obj.created, text, vector })
        processed++
      } catch (error) {
        indexingErrors.push({ path: f, message: (error as Error).message })
      }
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
          const obj = readRequiredJSON<any>(f)
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
        } catch (error) {
          indexingErrors.push({ path: f, message: (error as Error).message })
        }
      }
      console.log(`[vector-index] ✓ Indexed ${processed} functions`)
    } catch (error) {
      indexingErrors.push({ path: memPaths.functions, message: (error as Error).message })
    }
  }

  if (includeCurated) {
    const curatedRoot = path.join(memPaths.semantic, 'curated')
    const files = walkFiles(curatedRoot, p => p.endsWith('.meta.json'))
    console.log(`[vector-index] Processing ${files.length} curated items...`)
    let processed = 0
    for (const f of files) {
      try {
        const base = f.replace(/\.meta\.json$/, '')
        const meta = readRequiredJSON<any>(f)
        if (!meta) continue
        const highlights = readJSON<string[]>(`${base}.highlights.json`) || []
        const title = meta.title || path.basename(base)
        const abstract = meta.abstract || ''
        const tags = Array.isArray(meta.tags) ? meta.tags.join(' ') : ''
        const text = [title, abstract, highlights.length ? `Highlights: ${highlights.join(' ')}` : '', tags ? `Tags: ${tags}` : ''].join(' ').trim()
        const vector = await getEmbedding(text)
        items.push({ id: `cur-${path.basename(base)}`, path: f, type: 'episodic', timestamp: meta?.timestamp, text, vector })
        processed++
      } catch (error) {
        indexingErrors.push({ path: f, message: (error as Error).message })
      }
    }
    console.log(`[vector-index] ✓ Indexed ${processed} curated items`)
  }

  const model = embeddingModel || DEFAULT_INDEX_MODEL
  const provider = embeddingProvider || 'unknown'

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

  if (indexingErrors.length > 0) {
    const examples = indexingErrors
      .slice(0, 3)
      .map(error => `${path.basename(error.path)}: ${error.message}`)
      .join('; ')
    throw new Error(`Index build failed for ${indexingErrors.length} item(s); existing index preserved. ${examples}`)
  }

  // The canonical index filename is a stable role slot. The actual configured
  // model and provider are recorded in metadata and may change between builds.
  const dest = indexFilePath(undefined, username)
  writeIndexFile(dest, out)

  // Clear cache so next query loads fresh index
  clearIndexCache()

  console.log(`[vector-index] ✓ Index saved: ${items.length} items, ${dimensions} dimensions`)

  return dest
}

export function loadIndex(model?: string, username?: string): VectorIndexFile | null {
  const p = indexFilePath(model, username)

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

/**
 * Compute keyword overlap score between query and text.
 * Returns 0-1 based on what fraction of query words appear in text.
 */
function keywordScore(query: string, text: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  if (queryWords.length === 0) return 0

  const textLower = text.toLowerCase()
  let matches = 0
  for (const word of queryWords) {
    if (textLower.includes(word)) matches++
  }
  return matches / queryWords.length
}

export async function queryIndex(
  query: string,
  options: {
    model?: string
    topK?: number
    username?: string
    hybridWeight?: number
    memoryTypes?: string[]
  } = {}
): Promise<Array<{ item: VectorIndexItem; score: number }>> {
  const totalStart = Date.now()
  const topK = options.topK ?? 10
  // Hybrid weight: 0 = pure vector, 1 = pure keyword, 0.3 = 70% vector + 30% keyword
  const hybridWeight = options.hybridWeight ?? 0.3

  // Step 1: Load index (cached after first call)
  const loadStart = Date.now()
  const idx = loadIndex(options.model, options.username)
  const loadTime = Date.now() - loadStart
  if (!idx) {
    // Gracefully handle missing index (new users, etc.)
    console.log('[vector-index] No index found - returning empty results. Build with: mh --user <username> index build')
    return []
  }
  if (idx.data.length === 0) return []

  // Step 2: Generate embedding for query using model router
  const embedStart = Date.now()
  const queryEmbedding = await callEmbeddings({ text: prepareEmbeddingText(query), userId: options.username })
  if (
    queryEmbedding.model !== idx.meta.model
    || queryEmbedding.provider !== idx.meta.provider
    || (idx.meta.dimensions && queryEmbedding.dimensions !== idx.meta.dimensions)
  ) {
    throw new Error('The configured embedding model does not match this index; queue a full index rebuild')
  }
  const qvec = queryEmbedding.embeddings
  const embedTime = Date.now() - embedStart

  // Step 3: Compute HYBRID scores (vector + keyword)
  const scoreStart = Date.now()
  const requestedMemoryTypes = new Set(
    (options.memoryTypes || []).map(type => type.trim().toLowerCase()).filter(Boolean)
  )
  const candidates = requestedMemoryTypes.size > 0
    ? idx.data.filter(item => item.memoryType && requestedMemoryTypes.has(item.memoryType.toLowerCase()))
    : idx.data
  const scored = candidates.map(item => {
    const vectorSim = cosineSimilarity(qvec, item.vector)
    const kwScore = keywordScore(query, item.text)
    // Hybrid: combine vector and keyword scores
    const hybridScore = (1 - hybridWeight) * vectorSim + hybridWeight * kwScore
    return { item, score: hybridScore, vectorScore: vectorSim, keywordScore: kwScore }
  })
  scored.sort((a, b) => b.score - a.score)
  const scoreTime = Date.now() - scoreStart

  const totalTime = Date.now() - totalStart
  console.log(`[vector-index] queryIndex (hybrid): load=${loadTime}ms, embed=${embedTime}ms, score=${scoreTime}ms, total=${totalTime}ms (${candidates.length}/${idx.data.length} items)`)

  // Return with combined score
  return scored.slice(0, topK).map(s => ({ item: s.item, score: s.score }))
}

export function getIndexStatus(model?: string, username?: string): MemoryIndexStatus {
  const idx = loadIndex(model, username)
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

export function decideMemoryIndexRefresh(
  status: MemoryIndexStatus,
  options: Pick<MemoryIndexRefreshOptions, 'force' | 'maxAgeHours'> = {},
  now = Date.now(),
): { refresh: boolean; reason: MemoryIndexRefreshResult['reason'] } {
  if (options.force) return { refresh: true, reason: 'forced' }
  if (!status.exists) return { refresh: true, reason: 'missing' }

  const maxAgeHours = options.maxAgeHours ?? 24
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 0) {
    throw new Error('maxAgeHours must be a non-negative number')
  }
  const createdAt = new Date(status.createdAt).getTime()
  const recent = Number.isFinite(createdAt) && now - createdAt < maxAgeHours * 60 * 60 * 1000
  return recent
    ? { refresh: false, reason: 'recent' }
    : { refresh: true, reason: 'stale' }
}

/**
 * Reconcile the complete memory index behind the coordinator-owned
 * `vector.index-build` handler.
 */
export async function refreshMemoryIndex(options: MemoryIndexRefreshOptions): Promise<MemoryIndexRefreshResult> {
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(options.username)) {
    throw new Error('A valid username is required to refresh the memory index')
  }

  const status = getIndexStatus(undefined, options.username)
  const decision = decideMemoryIndexRefresh(status, options)
  if (!decision.refresh) {
    audit({
      level: 'info',
      category: 'system',
      event: 'memory_index_refresh_skipped',
      actor: options.username,
      details: { username: options.username, reason: decision.reason, source: options.source || 'unknown' },
    })
    return {
      username: options.username,
      rebuilt: false,
      skipped: true,
      reason: decision.reason,
      status,
    }
  }

  if (!await isEmbeddingServiceAvailable(options.username)) {
    const error = new Error(`Embedding service is unavailable for ${options.username}`)
    audit({
      level: 'error',
      category: 'system',
      event: 'memory_index_refresh_failed',
      actor: options.username,
      details: { username: options.username, reason: error.message, source: options.source || 'unknown' },
    })
    throw error
  }

  try {
    const indexPath = await buildMemoryIndex({ username: options.username })
    const refreshedStatus = getIndexStatus(undefined, options.username)
    if (!refreshedStatus.exists) throw new Error('Index build completed without a readable index')
    audit({
      level: 'info',
      category: 'action',
      event: 'memory_index_refreshed',
      actor: options.username,
      details: {
        username: options.username,
        reason: decision.reason,
        source: options.source || 'unknown',
        items: refreshedStatus.items,
        model: refreshedStatus.model,
      },
    })
    return {
      username: options.username,
      rebuilt: true,
      skipped: false,
      reason: decision.reason,
      indexPath,
      status: refreshedStatus,
    }
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'memory_index_refresh_failed',
      actor: options.username,
      details: { username: options.username, reason: (error as Error).message, source: options.source || 'unknown' },
    })
    throw error
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
  type?: string
  tags?: string[]
  entities?: string[]
  path?: string
}, options: { model?: string; username?: string } = {}): Promise<boolean> {
  let idx = loadIndex(options.model, options.username)
  if (!idx) {
    console.log(`[vector-index] No index found for ${options.username || 'current user'}; building the base index before appending ${event.id}`)
    await buildMemoryIndex({ username: options.username })
    idx = loadIndex(options.model, options.username)
    if (!idx) return false

    // The full build scans episodic memory, so it normally includes the event
    // that caused this bootstrap. Avoid writing a duplicate entry.
    if (idx.data.some(item => item.id === event.id)) return true
  }

  if (idx.data.some(item => item.id === event.id)) return true

  // Load content mode from config
  const indexContentMode = loadIndexContentMode()

  // Skip LLM-generated memory types when in 'user' mode
  const memType = event.type?.toLowerCase() || ''
  const llmGeneratedTypes = [
    'inner_dialogue',     // LLM internal thoughts
    'reflection',         // LLM reflections on memories
    'reflection_summary', // LLM summaries of reflections
    'summary',            // LLM summaries
  ]
  if (indexContentMode === 'user' && llmGeneratedTypes.includes(memType)) {
    console.log(`[vector-index] Skipping LLM-generated memory type: ${memType}`)
    return false
  }

  // Extract content using configured mode (handles all formats)
  const extractedContent = extractMemoryContent(event, indexContentMode)
  if (!extractedContent) {
    console.log(`[vector-index] Skipping memory with no relevant content: ${event.id}`)
    return false
  }

  const tags = Array.isArray(event.tags) ? event.tags.join(' ') : ''
  const entities = Array.isArray(event.entities) ? event.entities.join(' ') : ''
  const text = [extractedContent, tags ? `Tags: ${tags}` : '', entities ? ` Entities: ${entities}` : '']
    .filter(Boolean)
    .join(' ')

  // Use model router for embeddings
  const embedding = await callEmbeddings({ text: prepareEmbeddingText(text), userId: options.username })
  if (
    embedding.model !== idx.meta.model
    || embedding.provider !== idx.meta.provider
    || (idx.meta.dimensions && embedding.dimensions !== idx.meta.dimensions)
  ) {
    console.log('[vector-index] Embedding route changed; rebuilding before incremental append')
    await buildMemoryIndex({ username: options.username })
    idx = loadIndex(options.model, options.username)
    if (!idx) return false
    if (idx.data.some(item => item.id === event.id)) return true
    if (
      embedding.model !== idx.meta.model
      || embedding.provider !== idx.meta.provider
      || (idx.meta.dimensions && embedding.dimensions !== idx.meta.dimensions)
    ) {
      throw new Error('The configured embedding model still does not match the requested index')
    }
  }
  const vector = embedding.embeddings
  idx.data.push({
    id: event.id,
    path: event.path || '',
    type: 'episodic',
    memoryType: event.type || 'observation',
    timestamp: event.timestamp,
    text,
    vector,
  })
  idx.meta.items = idx.data.length

  const indexPath = indexFilePath(options.model, options.username)
  writeIndexFile(indexPath, idx)

  // Update cache in place (avoid full reload for single append)
  if (indexCache && indexCache.path === indexPath) {
    const stats = fs.statSync(indexPath)
    indexCache.mtimeMs = stats.mtimeMs
    // idx is already the cached index, so it's updated in place
  }

  return true
}
